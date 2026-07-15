/* ============================================================================
   NEARHUM — push sender API
   ----------------------------------------------------------------------------
   All pushes are sent from here; the service worker (public/sw.js) displays
   whatever arrives.

   THE PIPELINE — no cron required:
     act → the app writes Firestore as it always did → the actor's client
     fires POST /api/push?task=nudge (keyless, throttled) → this route sweeps
     the last hour for events it hasn't pushed yet, claims each one by
     stamping pushedAt on its doc, and fans out over FCM.

   Claiming by pushedAt makes runs idempotent: nudge as often as you like,
   each event sends exactly once. The keyless nudge is safe to expose because
   it can only cause real, unpushed Firestore events to send — hammering it
   just burns a few reads (and the 3s throttle caps that).

   TASKS
     POST /api/push?task=nudge              keyless — the app calls this after
                                            every push-worthy action
     GET  /api/push?task=events&key=...     same sweep, for a cron later
     GET  /api/push?task=streak&key=...     daily 7pm ET streak nudge (cron)
     GET  /api/push?task=test&uid=&key=...  manual delivery check

   EVENTS SWEPT
     hum / reaction / pin / pin_listened    from users/{uid}/activity rows
     "new voice near you"                   from new drops, radius-filtered
     "took the mic"                         from active broadcasts

   A user receives pushes only when pushEnabled && prefs.notif !== false &&
   fcmTokens is non-empty — the Settings toggle is the server-side mute.

   Needs in .env: PUSH_API_SECRET, FIREBASE_SERVICE_ACCOUNT (one-line JSON of
   a service-account key from the Firebase console).
   ============================================================================ */
import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Firestore, DocumentReference } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

export const dynamic = "force-dynamic";

type UserData = {
  handle?: string;
  pushEnabled?: boolean;
  prefs?: { notif?: boolean };
  fcmTokens?: string[];
  location?: { lat?: number; lng?: number };
  city?: string;
  state?: string;
  streak?: number;
  lastActiveDay?: string;
};

type PushMsg = { title: string; body: string; url?: string; tag?: string };

const REACT_LABEL: Record<string, string> = { felt: "felt that", same: "same", loud: "loud" };

function db(): Firestore {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in .env");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

/* ---- geo/slug math mirrored from the client (page.tsx) ------------------- */
function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function cityKey(place: string) {
  const slug = (place || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || "global";
}
function fmtDist(mi: number) {
  if (mi < 0.05) return "on your block";
  return `${mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)} mi away`;
}

function wantsPush(u: UserData | undefined) {
  return !!(
    u &&
    u.pushEnabled &&
    (!u.prefs || u.prefs.notif !== false) &&
    Array.isArray(u.fcmTokens) &&
    u.fcmTokens.length
  );
}

/* Send to every device a user enabled, pruning tokens FCM reports dead. */
async function sendToUser(fs: Firestore, uid: string, u: UserData, msg: PushMsg) {
  if (!wantsPush(u)) return { sent: 0, pruned: 0 };
  const tokens = u.fcmTokens as string[];
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: msg.title, body: msg.body },
    data: { url: msg.url || "/", tag: msg.tag || "nearhum" },
    webpush: {
      headers: { Urgency: "high", TTL: "86400" },
      fcmOptions: { link: msg.url || "/" },
    },
  });
  const dead: string[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-argument"
    ) {
      dead.push(tokens[i]);
    }
  });
  if (dead.length) {
    await fs
      .doc(`users/${uid}`)
      .update({ fcmTokens: FieldValue.arrayRemove(...dead) })
      .catch(() => {});
  }
  return { sent: res.successCount, pruned: dead.length };
}

function activityPush(a: { type?: string; who?: string; react?: string; title?: string }): PushMsg | null {
  if (!a.type || a.type === "system") return null;
  const who = a.who ? `@${a.who}` : "someone";
  const about = a.title ? `"${a.title}"` : "your drop";
  if (a.type === "hum") return { title: `${who} hummed back`, body: `on ${about} — tap to listen`, tag: "nearhum-hum" };
  if (a.type === "reaction")
    return { title: `${who}: ${REACT_LABEL[a.react || ""] || "felt that"}`, body: `on ${about}`, tag: "nearhum-react" };
  if (a.type === "pin")
    return { title: `${who} pinned a hum to you`, body: `${about} — only you can hear it first`, tag: "nearhum-pin" };
  if (a.type === "pin_listened") return { title: `${who} heard your pin`, body: about, tag: "nearhum-pin" };
  return { title: "new activity", body: `${who} · ${about}`, tag: "nearhum" };
}

/* ---- the sweep: push everything unpushed from the last hour ---------------
   Each event doc is claimed by stamping pushedAt inside a transaction before
   sending, so overlapping runs (two nudges racing, nudge racing a cron) can
   never double-send. The lookback window means a missed nudge isn't fatal —
   the next nudge from anyone sweeps it up.
   --------------------------------------------------------------------------- */
const LOOKBACK_MS = 60 * 60 * 1000;
const NUDGE_THROTTLE_MS = 3000;

/* Claim an event doc; returns false if it was already claimed or vanished. */
async function claim(fs: Firestore, ref: DocumentReference) {
  try {
    return await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.pushedAt) return false;
      tx.update(ref, { pushedAt: new Date().toISOString() });
      return true;
    });
  } catch {
    return false;
  }
}

async function runEvents(fs: Firestore, { nudge = false } = {}) {
  const nowMs = Date.now();
  const metaRef = fs.doc("meta/push");
  if (nudge) {
    // keyless endpoint — cap how often a sweep can actually run
    const throttled = await fs.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const last = snap.exists ? Date.parse((snap.data()?.lastRunAt as string) || "") || 0 : 0;
      if (nowMs - last < NUDGE_THROTTLE_MS) return true;
      tx.set(metaRef, { lastRunAt: new Date(nowMs).toISOString() }, { merge: true });
      return false;
    });
    if (throttled) return { task: "nudge", note: "throttled" };
  } else {
    await metaRef.set({ lastRunAt: new Date(nowMs).toISOString() }, { merge: true }).catch(() => {});
  }
  const since = new Date(nowMs - LOOKBACK_MS).toISOString();

  const usersSnap = await fs.collection("users").get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, data: d.data() as UserData }));
  const pushables = users.filter((u) => wantsPush(u.data));

  let sent = 0;
  let pruned = 0;
  const log: string[] = [];
  const tally = (r: { sent: number; pruned: number }, line: string) => {
    sent += r.sent;
    pruned += r.pruned;
    if (r.sent) log.push(line);
  };

  // 1) direct interactions — the app already writes an activity row for each
  for (const u of pushables) {
    const acts = await fs.collection(`users/${u.id}/activity`).where("at", ">", since).get();
    for (const aSnap of acts.docs) {
      const a = aSnap.data();
      if (a.pushedAt) continue;
      const msg = activityPush(a);
      if (!msg) continue;
      if (!(await claim(fs, aSnap.ref))) continue;
      tally(await sendToUser(fs, u.id, u.data, msg), `${msg.title} -> @${u.data.handle}`);
    }
  }

  // 2) new drops — anyone inside the drop's radius hears about it
  const drops = await fs.collection("drops").where("createdAt", ">", since).get();
  for (const dSnap of drops.docs) {
    const d = dSnap.data() as {
      uid?: string; handle?: string; title?: string; mood?: string;
      lat?: number; lng?: number; radiusMi?: number; pinnedToUid?: string;
      pushedAt?: string;
    };
    if (d.pushedAt || d.lat == null || d.lng == null) continue;
    if (!(await claim(fs, dSnap.ref))) continue;
    const radius = d.radiusMi || 25;
    for (const u of pushables) {
      if (u.id === d.uid) continue; // not the author
      if (d.pinnedToUid && u.id === d.pinnedToUid) continue; // they get the pin push instead
      const loc = u.data.location;
      if (!loc || loc.lat == null || loc.lng == null) continue;
      const dist = haversineMi(d.lat, d.lng, loc.lat, loc.lng);
      if (dist > radius) continue;
      tally(
        await sendToUser(fs, u.id, u.data, {
          title: `new voice ${fmtDist(dist)}`,
          body: `@${d.handle} · ${(d.mood || "").toUpperCase()} — "${d.title}"`,
          tag: "nearhum-drop",
        }),
        `new drop by @${d.handle} -> @${u.data.handle}`
      );
    }
  }

  // 3) mic drops — live broadcast takeover in your city
  const bcasts = await fs.collection("broadcasts").get();
  for (const bSnap of bcasts.docs) {
    const b = bSnap.data() as {
      active?: boolean; startedAt?: string; uid?: string; handle?: string;
      place?: string; pushedAt?: string;
    };
    if (!b.active || !b.startedAt || b.startedAt <= since) continue;
    // a new broadcast overwrites the city doc wholesale, clearing pushedAt —
    // so this claim is per-broadcast even though the doc id is per-city
    if (b.pushedAt) continue;
    if (!(await claim(fs, bSnap.ref))) continue;
    for (const u of pushables) {
      if (u.id === b.uid) continue; // not the broadcaster
      if (cityKey(`${u.data.city || ""}, ${u.data.state || ""}`) !== bSnap.id) continue;
      tally(
        await sendToUser(fs, u.id, u.data, {
          title: `🎤 @${b.handle} took the mic`,
          body: `live in ${b.place} right now — listen before it's gone`,
          tag: "nearhum-micdrop",
        }),
        `mic drop by @${b.handle} -> @${u.data.handle}`
      );
    }
  }

  return { task: nudge ? "nudge" : "events", since, sent, pruned, log };
}

/* ---- task=streak: daily 7pm ET nudge -------------------------------------- */
async function runStreak(fs: Firestore) {
  const et = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const yesterday = et(Date.now() - 86400000);

  const usersSnap = await fs.collection("users").where("streak", ">=", 2).get();
  let sent = 0;
  const log: string[] = [];
  for (const snap of usersSnap.docs) {
    const u = snap.data() as UserData;
    // active yesterday but not yet today → streak dies at midnight
    if (u.lastActiveDay !== yesterday) continue;
    const r = await sendToUser(fs, snap.id, u, {
      title: `your ${u.streak}-day streak ends tonight`,
      body: "listen to one voice before midnight to keep it",
      tag: "nearhum-streak",
    });
    sent += r.sent;
    if (r.sent) log.push(`streak saver -> @${u.handle}`);
  }
  return { task: "streak", sent, log };
}

/* ---- task=test: verify delivery to one user (or everyone enabled) --------- */
async function runTest(fs: Firestore, uid: string | null) {
  const targets: { id: string; data: UserData }[] = [];
  if (uid) {
    const snap = await fs.doc(`users/${uid}`).get();
    if (!snap.exists) return { task: "test", error: `no user ${uid}` };
    targets.push({ id: snap.id, data: snap.data() as UserData });
  } else {
    const usersSnap = await fs.collection("users").get();
    usersSnap.forEach((s) => targets.push({ id: s.id, data: s.data() as UserData }));
  }
  let sent = 0;
  const log: string[] = [];
  for (const t of targets) {
    const r = await sendToUser(fs, t.id, t.data, {
      title: "test push from nearhum",
      body: "if you can read this, pushes work",
      tag: "nearhum-test",
    });
    sent += r.sent;
    log.push(`@${t.data.handle}: ${r.sent ? "sent" : "skipped (push not enabled)"}`);
  }
  return { task: "test", sent, log };
}

async function handle(req: NextRequest) {
  const task = req.nextUrl.searchParams.get("task") || "events";

  // nudge is keyless by design: the app calls it after every push-worthy
  // action, it's throttled, and it can only send real unpushed events
  if (task !== "nudge") {
    const secret = process.env.PUSH_API_SECRET || "";
    const given =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      req.nextUrl.searchParams.get("key") ||
      "";
    if (!secret || given !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const fs = db();
    if (task === "nudge") return NextResponse.json(await runEvents(fs, { nudge: true }));
    if (task === "streak") return NextResponse.json(await runStreak(fs));
    if (task === "test") return NextResponse.json(await runTest(fs, req.nextUrl.searchParams.get("uid")));
    return NextResponse.json(await runEvents(fs));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
