/* ============================================================================
   NEARHUM — admin aggregation API
   ----------------------------------------------------------------------------
   One call returns everything the /admin dashboard shows. Runs on the admin
   SDK (bypasses security rules), so it must stay behind the key check —
   the same PUSH_API_SECRET the push API uses.

   GET /api/admin?key=PUSH_API_SECRET
   ============================================================================ */
import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const ONLINE_MS = 2 * 60 * 1000; // heartbeat writes ~1/min while app is open
const LIVE_EAR_MS = 90000; // matches the client's live-listener window

function db(): Firestore {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in .env");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

export async function GET(req: NextRequest) {
  const secret = process.env.PUSH_API_SECRET || "";
  const given =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.nextUrl.searchParams.get("key") ||
    "";
  if (!secret || given !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const fs = db();
    const now = Date.now();

    /* ---- users ---- */
    const usersSnap = await fs.collection("users").get();
    const users = usersSnap.docs.map((d) => {
      const u = d.data();
      const lastSeenAt = (u.lastSeenAt as string) || "";
      return {
        id: d.id,
        handle: (u.handle as string) || "—",
        email: (u.email as string) || "",
        city: (u.city as string) || "",
        state: (u.state as string) || "",
        plays: (u.plays as number) ?? 0,
        credits: (u.credits as number) ?? 0,
        streak: (u.streak as number) ?? 0,
        createdAt: (u.createdAt as string) || "",
        lastSeenAt,
        online: !!lastSeenAt && now - Date.parse(lastSeenAt) < ONLINE_MS,
        pwaInstalled: !!u.pwaInstalled,
        pushEnabled: !!u.pushEnabled,
        tokens: Array.isArray(u.fcmTokens) ? u.fcmTokens.length : 0,
        notifPref: !(u.prefs && (u.prefs as { notif?: boolean }).notif === false),
      };
    });
    users.sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));

    /* ---- drops (live = within their 24h ttl) ---- */
    const dropsSnap = await fs.collection("drops").get();
    const drops = dropsSnap.docs
      .map((d) => {
        const x = d.data();
        const createdAt = (x.createdAt as string) || "";
        const ageH = createdAt ? (now - Date.parse(createdAt)) / 3600000 : 999;
        const listeners = (x.listeners as Record<string, string>) || {};
        const live = Object.values(listeners).filter((t) => now - Date.parse(t) < LIVE_EAR_MS).length;
        const reacts = (x.reacts as { felt?: number; same?: number; loud?: number }) || {};
        return {
          id: d.id,
          title: (x.title as string) || "untitled",
          handle: (x.handle as string) || "—",
          mood: (x.mood as string) || "",
          place: (x.place as string) || "",
          radiusMi: (x.radiusMi as number) ?? null,
          plays: (x.plays as number) ?? 0,
          live,
          replies: Array.isArray(x.replies) ? x.replies.length : 0,
          reacts: (reacts.felt || 0) + (reacts.same || 0) + (reacts.loud || 0),
          createdAt,
          hoursLeft: Math.max(0, Math.round((24 - ageH) * 10) / 10),
          faded: ageH >= 24,
        };
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const liveDrops = drops.filter((d) => !d.faded);

    /* ---- recent listens across all users (fine at this scale) ---- */
    const listenLists = await Promise.all(
      users.map(async (u) => {
        const snap = await fs
          .collection(`users/${u.id}/listens`)
          .orderBy("at", "desc")
          .limit(5)
          .get();
        return snap.docs.map((d) => {
          const l = d.data();
          return {
            listener: u.handle,
            title: (l.title as string) || "—",
            who: (l.who as string) || "",
            at: (l.at as string) || "",
          };
        });
      })
    );
    const recentListens = listenLists
      .flat()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 20);

    /* ---- push pipeline + broadcasts ---- */
    const meta = await fs.doc("meta/push").get();
    const bSnap = await fs.collection("broadcasts").get();
    const activeBroadcasts = bSnap.docs
      .map((d) => d.data())
      .filter((b) => b.active && b.expiresAt && Date.parse(b.expiresAt as string) > now)
      .map((b) => ({ handle: b.handle as string, place: b.place as string }));

    return NextResponse.json({
      now: new Date(now).toISOString(),
      stats: {
        users: users.length,
        online: users.filter((u) => u.online).length,
        installed: users.filter((u) => u.pwaInstalled).length,
        pushReachable: users.filter((u) => u.pushEnabled && u.tokens > 0 && u.notifPref).length,
        liveDrops: liveDrops.length,
        listeningNow: liveDrops.reduce((s, d) => s + d.live, 0),
      },
      users,
      drops: liveDrops,
      recentListens,
      push: { lastRunAt: (meta.exists && (meta.data()?.lastRunAt as string)) || "" },
      broadcasts: activeBroadcasts,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
