"use client";

import React, { useState, useEffect, useRef } from "react";
import { auth, firestore } from "@/app/firebase/config";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, orderBy, onSnapshot, increment } from "firebase/firestore";

/* ============================================================================
   NEARHUM — the hum of voices near you
   A hyperlocal voice network. The feed is a radio that plays itself: it auto-
   plays the nearest voices, you listen, and you reply in your own voice.
   No calls, no DMs, no text replies. Drops fade after 24h.

   This is a self-contained, in-memory prototype (no backend, audio is mocked).
   Architecture:
     - Onboarding  → verify-free demo flow (location + identity)
     - Radio tab   → self-playing feed + mini-player + full-screen player
     - Activity tab→ replies/plays/reactions to your voice (the return hook)
     - You tab     → profile, credits, ledger, your drops, settings
   ============================================================================ */

/* ----------------------------------------------------------------------------
   Design tokens
   ---------------------------------------------------------------------------- */
const C = {
  bg: "#040806",
  bg2: "#06100A",
  panel: "#0A140D",
  panel2: "#0E1B12",
  card: "#0C1710",
  cardHi: "#102217",
  line: "#18301F",
  lineHi: "#244A30",
  green: "#22C55E",
  greenSoft: "#4ADE80",
  greenDeep: "#16A34A",
  amber: "#F59E0B",
  violet: "#8B5CF6",
  cyan: "#22D3EE",
  rose: "#FB7185",
  red: "#EF4444",
  text: "#E4F5E9",
  textDim: "#A9C6B5",
  dim: "#5F8270",
  dimmer: "#3C5244",
};

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SAFE_B = "env(safe-area-inset-bottom, 0px)";
const SAFE_T = "env(safe-area-inset-top, 0px)";

const MOOD: Record<string, string> = {
  "Late Night": C.violet,
  Soft: C.cyan,
  Raw: C.greenSoft,
  Spicy: C.amber,
};
const MOOD_LIST = ["Late Night", "Soft", "Raw", "Spicy"];
const MOOD_BLURB: Record<string, string> = {
  "Late Night": "the 2am thoughts",
  Soft: "gentle, quiet, kind",
  Raw: "unfiltered, honest",
  Spicy: "say the bold thing",
};

const PACKS = [
  { n: 20, price: "$1.99", best: false, bonus: 0 },
  { n: 60, price: "$4.99", best: false, bonus: 5 },
  { n: 150, price: "$9.99", best: true, bonus: 20 },
  { n: 400, price: "$19.99", best: false, bonus: 80 },
];
const PLAY_COST = 1;
const DROP_COST = 2;
const DAILY_FREE_PLAYS = 10;

const REACTIONS = [
  { key: "felt", glyph: "♥", label: "felt that", color: C.rose },
  { key: "same", glyph: "◎", label: "same", color: C.greenSoft },
  { key: "loud", glyph: "✦", label: "loud", color: C.amber },
];

/* ----------------------------------------------------------------------------
   Seed data
   ---------------------------------------------------------------------------- */
const SEED = [
  {
    id: "p1",
    handle: "deadweight",
    secs: 15,
    mood: "Raw",
    title: "i got the job",
    body: "got the job. nobody to tell. so. telling the block i guess.",
    dist: "0.3 mi",
    plays: 88,
    ttl: 9.4,
    reacts: { felt: 22, same: 9, loud: 14 },
    replies: [
      { id: "r5", handle: "rosewater", secs: 5, ago: "2m" },
      { id: "r6", handle: "—", secs: 9, ago: "8m" },
      { id: "r7", handle: "nightowl", secs: 7, ago: "30m" },
    ],
  },
  {
    id: "p2",
    handle: "nightowl",
    secs: 14,
    mood: "Late Night",
    title: "second-guessing a text",
    body: "anyone else still up second-guessing a text they sent three hours ago.",
    dist: "0.5 mi",
    plays: 41,
    ttl: 18.2,
    reacts: { felt: 31, same: 18, loud: 2 },
    replies: [
      { id: "r1", handle: "—", secs: 6, ago: "4m" },
      { id: "r2", handle: "gloamer", secs: 11, ago: "20m" },
    ],
  },
  {
    id: "p3",
    handle: "gloamer",
    secs: 12,
    mood: "Late Night",
    title: "is the diner 24h?",
    body: "is the diner on the corner actually 24 hours or did i dream that.",
    dist: "0.6 mi",
    plays: 19,
    ttl: 16.0,
    reacts: { felt: 1, same: 7, loud: 0 },
    replies: [{ id: "r9", handle: "—", secs: 3, ago: "40m" }],
  },
  {
    id: "p4",
    handle: "rosewater",
    secs: 9,
    mood: "Soft",
    title: "free coffee on the bench",
    body: "leaving a coffee on the bench by the fountain if you need one today.",
    dist: "0.7 mi",
    plays: 12,
    ttl: 21.5,
    reacts: { felt: 9, same: 1, loud: 0 },
    replies: [{ id: "r4", handle: "deadweight", secs: 8, ago: "12m" }],
  },
  {
    id: "p5",
    handle: "—",
    secs: 7,
    mood: "Spicy",
    title: "the band on 7th & main",
    body: "the band practicing at 7th and main — you are NOT it. please stop.",
    dist: "0.9 mi",
    plays: 3,
    ttl: 23.9,
    reacts: { felt: 0, same: 2, loud: 5 },
    replies: [],
  },
  {
    id: "p6",
    handle: "saltair",
    secs: 11,
    mood: "Soft",
    title: "new here, say hi",
    body: "just moved to the block this week. tell me one good thing about it.",
    dist: "1.0 mi",
    plays: 27,
    ttl: 22.0,
    reacts: { felt: 4, same: 0, loud: 1 },
    replies: [
      { id: "r10", handle: "gloamer", secs: 6, ago: "15m" },
      { id: "r11", handle: "nightowl", secs: 8, ago: "44m" },
    ],
  },
];

const ACTIVITY_SEED = [
  { id: "a1", type: "reply", who: "rosewater", title: "i got the job", ago: "2m", unread: true },
  { id: "a2", type: "react", who: "nightowl", react: "felt", title: "i got the job", ago: "18m", unread: true },
  { id: "a3", type: "milestone", title: "i got the job", ago: "1h", unread: false, detail: "passed 50 plays" },
  { id: "a4", type: "reply", who: "—", title: "i got the job", ago: "3h", unread: false },
  { id: "a5", type: "system", ago: "1d", unread: false, detail: "Welcome to Nearhum. Your first 8 credits are on us." },
];

/* ----------------------------------------------------------------------------
   Small helpers
   ---------------------------------------------------------------------------- */
function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8, toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(mi: number) {
  if (mi < 0.05) return "on your block";
  return `${mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)} mi`;
}
function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}
function hexA(hex: string, a: string) {
  return hex + a;
}
function fmtSecs(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function totalReacts(r: { felt: number; same: number; loud: number }) {
  return (r.felt || 0) + (r.same || 0) + (r.loud || 0);
}

/* ----------------------------------------------------------------------------
   Brand mark
   ---------------------------------------------------------------------------- */
function Mark({ size = 28, knock = C.bg }: { size?: number; knock?: string }) {
  const id = "ng" + size;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Nearhum">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={C.greenSoft} />
          <stop offset="100%" stopColor={C.greenDeep} />
        </linearGradient>
      </defs>
      <path
        d="M50 92 C 34 70, 16 58, 16 40 A 34 34 0 1 1 84 40 C 84 58, 66 70, 50 92 Z"
        fill={`url(#${id})`}
      />
      <g fill="none" stroke={knock} strokeWidth="5.5" strokeLinecap="round">
        <circle cx="50" cy="40" r="22" />
        <circle cx="50" cy="40" r="11" />
      </g>
      <circle cx="50" cy="40" r="6.5" fill={knock} />
    </svg>
  );
}

/* ----------------------------------------------------------------------------
   Waveforms + equalizer
   ---------------------------------------------------------------------------- */
function ProgWave({ n = 40, color, progress = 0, h = 28, gap = 2, seed = 2 }: {
  n?: number; color: string; progress?: number; h?: number; gap?: number; seed?: number;
}) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const played = i / n <= progress;
    const height = 14 + Math.abs(Math.sin(i * 1.3 + seed)) * 86;
    bars.push(
      <span
        key={i}
        style={{
          flex: 1,
          background: played ? color : C.line,
          height: `${height}%`,
          borderRadius: 3,
          opacity: played ? 1 : 0.38,
          transition: "background .12s, opacity .12s",
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap, width: "100%", height: h }}>
      {bars}
    </div>
  );
}

function Wave({ n = 20, active, color, seed = 1 }: { n?: number; active: boolean; color: string; seed?: number }) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    bars.push(
      <span
        key={i}
        style={{
          flex: 1,
          background: active ? color : C.line,
          height: `${20 + Math.abs(Math.sin(i * 1.7 + seed)) * 70}%`,
          borderRadius: 1,
          opacity: active ? 0.95 : 0.45,
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, height: 22 }}>
      {bars}
    </div>
  );
}

function Eq({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: size, width: size }}>
      {["eqA", "eqB", "eqC"].map((a, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            background: color,
            borderRadius: 1,
            animation: `${a} .9s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Toast
   ---------------------------------------------------------------------------- */
function Toast({ toast }: { toast: string | null }) {
  if (!toast) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: `calc(150px + ${SAFE_B})`,
        zIndex: 120,
        background: hexA(C.panel, "F5"),
        border: `1px solid ${C.lineHi}`,
        color: C.text,
        fontFamily: MONO,
        fontSize: 12,
        letterSpacing: 0.5,
        padding: "10px 16px",
        borderRadius: 99,
        boxShadow: "0 10px 30px rgba(0,0,0,.55)",
        backdropFilter: "blur(8px)",
        pointerEvents: "none",
        animation: "toastIn .2s ease-out",
        whiteSpace: "nowrap",
      }}
    >
      {toast}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Onboarding
   ---------------------------------------------------------------------------- */
function friendlyError(code: string) {
  if (code === "auth/email-already-in-use") return "That email is already registered. Sign in instead.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") return "Wrong email or password.";
  return "Something went wrong. Try again.";
}

function Onboarding({ onDone }: { onDone: (handle: string) => void }) {
  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("");
  const [anon, setAnon] = useState(false);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const locationRef = useRef<GeolocationCoordinates | null>(null);

  const next = () => setStep((s) => s + 1);

  const requestLocation = () => {
    if (!navigator.geolocation) { next(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { locationRef.current = pos.coords; next(); },
      () => next()
    );
  };

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) return;
    if (mode === "signup" && !handle.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const loc = locationRef.current;
      const locFields = loc ? { location: { lat: loc.latitude, lng: loc.longitude, grantedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } : {};
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const uid = cred.user.uid;
        setDoc(doc(firestore, "users", uid), {
          handle: handle.trim(),
          email: email.trim(),
          createdAt: new Date().toISOString(),
          ...locFields,
        }).catch(() => {});
        addDoc(collection(firestore, "users", uid, "activity"), {
          type: "system",
          detail: "Welcome to Nearhum. Your first 8 credits are on us.",
          at: new Date().toISOString(),
          unread: true,
        }).catch(() => {});
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        try {
          const snap = await getDoc(doc(firestore, "users", cred.user.uid));
          if (snap.exists()) setHandle((snap.data().handle as string) || "—");
          if (loc) updateDoc(doc(firestore, "users", cred.user.uid), { "location.lat": loc.latitude, "location.lng": loc.longitude, "location.updatedAt": new Date().toISOString() }).catch(() => {});
        } catch { /* Firestore unavailable, proceed anyway */ }
      }
      next();
    } catch (e: unknown) {
      setAuthError(friendlyError((e as { code: string }).code));
    }
    setAuthLoading(false);
  };

  const Btn = ({ children, onClick, disabled, ghost }: {
    children: React.ReactNode; onClick?: () => void; disabled?: boolean; ghost?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: 17,
        borderRadius: 16,
        marginTop: 12,
        cursor: disabled ? "default" : "pointer",
        fontFamily: MONO,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 1.5,
        border: ghost ? `1px solid ${C.line}` : "none",
        background: ghost ? "transparent" : disabled ? C.line : C.green,
        color: ghost ? C.dim : disabled ? C.dim : C.bg,
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: `radial-gradient(130% 80% at 50% 0%, ${hexA(C.green, "1C")}, ${C.bg} 60%)`,
        display: "flex",
        flexDirection: "column",
        padding: `calc(40px + ${SAFE_T}) 26px calc(34px + ${SAFE_B})`,
        color: C.text,
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 36 }}>
        {[0, 1, 2, 3].map((n) => (
          <span
            key={n}
            style={{
              width: n === step ? 22 : 6,
              height: 6,
              borderRadius: 99,
              background: n <= step ? C.green : C.line,
              transition: "all .25s",
            }}
          />
        ))}
      </div>

      {step === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 26 }}>
            <Mark size={84} knock={"#06140B"} />
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.15, margin: "0 0 14px", letterSpacing: -0.5 }}>
            Hear what your block is saying.
          </h1>
          <p style={{ fontSize: 15, color: C.textDim, lineHeight: 1.6, margin: 0 }}>
            Nearhum is a voice network for exactly where you're standing. Drop a 15-second voice,
            hear the ones near you, reply in your own voice. It plays itself — like a radio of your
            neighborhood.
          </p>
          <div style={{ flex: 1 }} />
          <Btn onClick={next}>GET STARTED →</Btn>
          <p style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 14 }}>
            Anonymous to everyone · No calls · No DMs
          </p>
        </div>
      )}

      {step === 1 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <RippleBloom />
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 10px", textAlign: "center" }}>
            Nearhum is wherever you are.
          </h2>
          <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, textAlign: "center", margin: 0 }}>
            The feed is built from voices near you. We use rough distance and direction only — your
            exact spot is never shown to anyone.
          </p>
          <div style={{ flex: 1 }} />
          <Btn onClick={requestLocation}>ALLOW LOCATION</Btn>
          <Btn ghost onClick={next}>NOT NOW</Btn>
        </div>
      )}

      {step === 2 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 6px" }}>
            {mode === "signup" ? "Create your account." : "Welcome back."}
          </h2>
          <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, margin: "0 0 22px" }}>
            {mode === "signup" ? "Your @ is how you show up on the block." : "Sign in to pick up where you left off."}
          </p>

          {/* @ handle — sign up only */}
          {mode === "signup" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 17, color: C.dim, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "0 13px", display: "flex", alignItems: "center" }}>
                @
              </div>
              <input
                autoFocus
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 16))}
                placeholder="nightowl"
                style={{ flex: 1, fontFamily: MONO, fontSize: 17, color: C.text, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, outline: "none" }}
              />
            </div>
          )}

          {/* email */}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: 15, color: C.text, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, outline: "none", marginBottom: 12 }}
          />

          {/* password */}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            placeholder="password"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: 15, color: C.text, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, outline: "none", marginBottom: 8 }}
          />

          {/* error */}
          {authError && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 10, lineHeight: 1.4 }}>
              {authError}
            </div>
          )}

          {/* mode toggle */}
          <button
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setAuthError(null); }}
            style={{ background: "transparent", border: "none", padding: "4px 0 14px", fontFamily: MONO, fontSize: 11, color: C.dim, cursor: "pointer", textAlign: "left", letterSpacing: 0.5 }}
          >
            {mode === "signup" ? "Already have an account? SIGN IN →" : "No account? CREATE ONE →"}
          </button>

          <div style={{ flex: 1 }} />
          <Btn
            onClick={handleAuth}
            disabled={authLoading || !email.trim() || !password.trim() || (mode === "signup" && !handle.trim())}
          >
            {authLoading ? "..." : mode === "signup" ? "CREATE ACCOUNT →" : "SIGN IN →"}
          </Btn>
        </div>
      )}

      {step === 3 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: 99,
              border: `2px solid ${C.green}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              color: C.green,
              margin: "0 auto 22px",
            }}
          >
            ✓
          </div>
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 10px" }}>
            You're {anon || !handle ? "anonymous" : `@${handle}`} on Nearhum.
          </h2>
          <p style={{ fontSize: 15, color: C.textDim, lineHeight: 1.6, margin: "0 0 8px" }}>
            8 credits are on us, plus {DAILY_FREE_PLAYS} free plays a day. Press play and listen to
            your block — then drop your first voice.
          </p>
          <div style={{ flex: 1 }} />
          <Btn onClick={() => onDone(anon || !handle ? "—" : handle)}>ENTER NEARHUM</Btn>
        </div>
      )}
    </div>
  );
}

function RippleBloom() {
  return (
    <div style={{ position: "relative", width: 150, height: 150, margin: "0 auto 26px" }}>
      <svg width="150" height="150" style={{ position: "absolute", inset: 0 }}>
        {[60, 44, 28].map((r, i) => (
          <circle
            key={i}
            cx="75"
            cy="75"
            r={r}
            fill="none"
            stroke={C.green}
            strokeWidth="2"
            opacity={0.5 - i * 0.12}
            style={{ animation: `bloom ${2 + i * 0.4}s ease-in-out infinite` }}
          />
        ))}
        <circle cx="75" cy="75" r="6" fill={C.green} />
      </svg>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Mood filter chips
   ---------------------------------------------------------------------------- */
function MoodFilter({ active, onPick }: { active: string; onPick: (m: string) => void }) {
  const all = ["All", ...MOOD_LIST];
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }}>
      {all.map((m) => {
        const on = active === m;
        const col = m === "All" ? C.green : MOOD[m];
        return (
          <button
            key={m}
            onClick={() => onPick(m)}
            style={{
              flexShrink: 0,
              padding: "8px 15px",
              borderRadius: 99,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: 1,
              border: `1px solid ${on ? col : C.line}`,
              background: on ? hexA(col, "1A") : "transparent",
              color: on ? col : C.dim,
            }}
          >
            {m.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Voice card
   ---------------------------------------------------------------------------- */
function VoiceCard({ p, isCurrent, playing, onPick }: {
  p: typeof SEED[0]; isCurrent: boolean; playing: boolean; onPick: (id: string) => void;
}) {
  const mc = MOOD[p.mood];
  return (
    <button
      onClick={() => onPick(p.id)}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 14,
        marginBottom: 10,
        borderRadius: 18,
        cursor: "pointer",
        border: `1px solid ${isCurrent ? mc : C.line}`,
        background: isCurrent ? `linear-gradient(100deg, ${hexA(mc, "20")}, ${C.card})` : C.card,
        transition: "border-color .2s, background .2s",
      }}
    >
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: 14,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: hexA(mc, "22"),
          border: `1px solid ${hexA(mc, "55")}`,
          color: mc,
        }}
      >
        {isCurrent && playing ? <Eq color={mc} /> : <span style={{ fontSize: 16 }}>▶</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: mc, flexShrink: 0 }} />
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: mc, letterSpacing: 1 }}>
            {p.mood.toUpperCase()}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            @{p.handle} · {p.dist}
          </span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 650, color: C.text, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.title}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 3 }}>
          {fmtSecs(p.secs)} · ▶ {p.plays} · ◴ {p.replies.length} · ♥ {totalReacts(p.reacts)}
        </div>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   Loudest-now hero
   ---------------------------------------------------------------------------- */
function LoudestHero({ p, onOpen }: { p: typeof SEED[0] | null; onOpen: (id: string) => void }) {
  if (!p) return null;
  const mc = MOOD[p.mood];
  return (
    <button
      onClick={() => onOpen(p.id)}
      style={{
        width: "100%",
        textAlign: "left",
        position: "relative",
        overflow: "hidden",
        borderRadius: 22,
        border: `1px solid ${hexA(mc, "55")}`,
        background: `radial-gradient(120% 120% at 100% 0%, ${hexA(mc, "33")}, ${C.card} 70%)`,
        padding: 18,
        marginBottom: 22,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: mc }}>✦ LOUDEST NEAR YOU</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dim }}>▶ {p.plays}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 750, color: C.text, lineHeight: 1.2, marginBottom: 12 }}>{p.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 46, height: 46, borderRadius: 99, flexShrink: 0,
            background: mc, color: C.bg, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 18, boxShadow: `0 6px 20px ${hexA(mc, "66")}`,
          }}
        >▶</span>
        <Wave n={26} active color={mc} seed={9} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, flexShrink: 0 }}>{fmtSecs(p.secs)}</span>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   Mini player
   ---------------------------------------------------------------------------- */
function MiniPlayer({ p, progress, playing, onToggle, onExpand }: {
  p: typeof SEED[0]; progress: number; playing: boolean; onToggle: () => void; onExpand: () => void;
}) {
  const mc = MOOD[p.mood];
  return (
    <div
      onClick={onExpand}
      style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)",
        bottom: `calc(64px + ${SAFE_B})`, width: "calc(100% - 20px)", maxWidth: 460,
        cursor: "pointer", zIndex: 41,
      }}
    >
      <div
        style={{
          position: "relative",
          background: `linear-gradient(100deg, ${hexA(mc, "2A")}, ${C.panel})`,
          border: `1px solid ${hexA(mc, "55")}`,
          borderRadius: 18, padding: "10px 12px", display: "flex",
          alignItems: "center", gap: 12, boxShadow: "0 12px 34px rgba(0,0,0,.55)",
          overflow: "hidden", backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, height: 2, width: `${progress * 100}%`, background: mc, transition: "width .12s" }} />
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: hexA(mc, "22"), color: mc }}>
          {playing ? <Eq color={mc} /> : <span style={{ fontSize: 14 }}>▶</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{playing ? "ON AIR" : "PAUSED"} · @{p.handle}</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} style={{ width: 44, height: 44, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>
          {playing ? "❚❚" : "▶"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Full-screen player
   ---------------------------------------------------------------------------- */
function FullPlayer({ p, progress, playing, onToggle, onSkip, onPrev, onReply, onReact, userReact, onCollapse, idx, total }: {
  p: typeof SEED[0]; progress: number; playing: boolean; onToggle: () => void; onSkip: () => void;
  onPrev: () => void; onReply: () => void; onReact: (key: string) => void; userReact: string | undefined;
  onCollapse: () => void; idx: number; total: number;
}) {
  const mc = MOOD[p.mood];
  const elapsed = Math.round(p.secs * progress);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  const down = (e: React.MouseEvent | React.TouchEvent) => {
    startY.current = "touches" in e ? e.touches[0].clientY : e.clientY;
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (startY.current == null) return;
    const y = "touches" in e ? e.touches[0].clientY : e.clientY;
    setDragY(Math.max(0, y - startY.current));
  };
  const up = () => {
    if (dragY > 120) onCollapse();
    setDragY(0);
    startY.current = null;
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 70,
        background: `linear-gradient(180deg, ${hexA(mc, "38")} 0%, ${C.bg} 58%)`,
        display: "flex", flexDirection: "column",
        padding: `calc(12px + ${SAFE_T}) 22px calc(28px + ${SAFE_B})`,
        transform: `translateY(${dragY}px)`,
        transition: startY.current == null ? "transform .25s ease-out" : "none",
        opacity: 1 - dragY / 600,
      }}
    >
      <div onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up} style={{ cursor: "grab", paddingBottom: 4 }}>
        <div style={{ width: 42, height: 5, borderRadius: 99, background: hexA(C.text, "55"), margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <button onClick={onCollapse} style={{ width: 40, height: 40, borderRadius: 99, border: "none", background: "transparent", color: C.text, fontSize: 22, cursor: "pointer", marginLeft: -8 }}>⌄</button>
          <span style={{ margin: "0 auto", fontFamily: MONO, fontSize: 10, color: C.text, letterSpacing: 2, opacity: 0.85 }}>{playing ? "ON AIR" : "PAUSED"} · {idx + 1}/{total}</span>
          <span style={{ width: 32 }} />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: mc }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1.5 }}>{p.mood.toUpperCase()}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{p.handle} · {p.dist}</span>
        </div>
        <div style={{ fontSize: 33, fontWeight: 780, color: C.text, lineHeight: 1.15, letterSpacing: -0.5, marginBottom: 14 }}>{p.title}</div>
        <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.5, margin: "0 0 30px" }}>{p.body}</p>
        <ProgWave n={42} color={mc} progress={progress} h={96} gap={3} seed={p.id.length} />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 12 }}>
          <span>{fmtSecs(elapsed)}</span>
          <span>▶ {p.plays} listening</span>
          <span>{fmtSecs(p.secs)}</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 18 }}>
        {REACTIONS.map((r) => {
          const on = userReact === r.key;
          return (
            <button key={r.key} onClick={() => onReact(r.key)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 99, cursor: "pointer", border: `1px solid ${on ? r.color : C.line}`, background: on ? hexA(r.color, "22") : "transparent", color: on ? r.color : C.textDim, fontFamily: MONO, fontSize: 12, fontWeight: 600 }}>
              <span style={{ fontSize: 14 }}>{r.glyph}</span>
              {((p.reacts as Record<string, number>)[r.key] || 0) + (on ? 1 : 0)}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, marginBottom: 20 }}>
        <button onClick={onPrev} style={{ width: 52, height: 52, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", fontSize: 20 }}>⤙</button>
        <button onClick={onToggle} style={{ width: 78, height: 78, borderRadius: 99, border: "none", background: mc, color: C.bg, cursor: "pointer", fontSize: 27, boxShadow: `0 8px 34px ${hexA(mc, "66")}` }}>{playing ? "❚❚" : "▶"}</button>
        <button onClick={onSkip} style={{ width: 52, height: 52, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", fontSize: 20 }}>⤚</button>
      </div>

      <button onClick={onReply} style={{ width: "100%", padding: 18, borderRadius: 16, border: `1px solid ${mc}`, background: hexA(mc, "1A"), color: mc, fontFamily: MONO, fontSize: 14, fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}>
        ◴ REPLY IN VOICE · {p.replies.length}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Bottom sheet base
   ---------------------------------------------------------------------------- */
function Sheet({ children, onClose, accent = C.green }: { children: React.ReactNode; onClose: () => void; accent?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.64)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80, animation: "fadeIn .15s ease-out" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: C.panel, borderTop: `2px solid ${accent}`, borderRadius: "24px 24px 0 0", padding: `16px 18px calc(26px + ${SAFE_B})`, maxHeight: "86vh", display: "flex", flexDirection: "column", animation: "sheetUp .25s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 99, background: C.line, margin: "0 auto 18px" }} />
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Reply sheet — real MediaRecorder → Cloudinary → Firestore
   ---------------------------------------------------------------------------- */
function ReplySheet({ ping, onClose, onAddReply, handle, uid }: {
  ping: typeof SEED[0]; onClose: () => void;
  onAddReply: (r: { id: string; handle: string; secs: number; ago: string; audioUrl?: string }) => void;
  handle: string; uid: string;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mc = MOOD[ping.mood];

  useEffect(() => {
    if (!recording) return;
    const i = setInterval(() => setRecSecs((s) => Math.min(s + 1, 15)), 1000);
    return () => clearInterval(i);
  }, [recording]);

  const stopRec = () => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    mrRef.current?.stop();
    mrRef.current = null;
    setRecording(false);
  };

  const startRec = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, `reply_${Date.now()}.webm`);
          fd.append("upload_preset", "nearhum_drops");
          const res = await fetch("https://api.cloudinary.com/v1_1/dvtwey6m9/video/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error();
          const { secure_url: audioUrl } = await res.json();
          const replyId = Date.now().toString();
          const replyData = { id: replyId, handle, uid, secs: recSecs, ago: "now", audioUrl, at: new Date().toISOString() };
          updateDoc(doc(firestore, "drops", ping.id), {
            replies: [...ping.replies, { id: replyId, handle, secs: recSecs, ago: "now" }],
          }).catch(() => {});
          onAddReply(replyData);
        } catch { setMicError("Upload failed. Try again."); }
        setUploading(false);
      };
      mr.start(100);
      mrRef.current = mr;
      setRecSecs(0);
      setRecording(true);
      autoStopRef.current = setTimeout(stopRec, 15000);
    } catch { setMicError("Microphone access denied."); }
  };

  const toggleReplyAudio = (r: typeof SEED[0]["replies"][0]) => {
    const audioUrl = (r as unknown as { audioUrl?: string }).audioUrl;
    if (!audioUrl) return;
    if (playingId === r.id) {
      audioRefs.current[r.id]?.pause();
      setPlayingId(null);
      return;
    }
    if (playingId && audioRefs.current[playingId]) audioRefs.current[playingId].pause();
    if (!audioRefs.current[r.id]) {
      const a = new Audio(audioUrl);
      a.onended = () => setPlayingId(null);
      audioRefs.current[r.id] = a;
    }
    audioRefs.current[r.id].play().catch(() => {});
    setPlayingId(r.id);
  };

  return (
    <Sheet onClose={onClose} accent={mc}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: mc }} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1 }}>{ping.mood.toUpperCase()}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{ping.handle}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.text, marginBottom: 16 }}>{ping.title}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>
        {ping.replies.length} VOICE {ping.replies.length === 1 ? "REPLY" : "REPLIES"}
      </div>
      <div style={{ overflowY: "auto", flex: 1, marginBottom: 16 }}>
        {ping.replies.length === 0 && (
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "24px 0" }}>No one&apos;s answered yet. Be the first voice.</div>
        )}
        {ping.replies.map((r) => {
          const on = playingId === r.id;
          const hasAudio = !!(r as unknown as { audioUrl?: string }).audioUrl;
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <button onClick={() => hasAudio ? toggleReplyAudio(r) : undefined} style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${on ? mc : C.line}`, background: on ? mc : "transparent", color: on ? C.bg : C.dim, cursor: hasAudio ? "pointer" : "default", flexShrink: 0, fontSize: 12 }}>
                {on ? "❚❚" : "▶"}
              </button>
              <Wave n={18} active={on} color={mc} seed={r.id.length * 3} />
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>@{r.handle}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{fmtSecs(r.secs)} · {r.ago}</div>
              </div>
            </div>
          );
        })}
      </div>
      {micError && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 10, textAlign: "center" }}>{micError}</div>}
      <button
        onClick={() => recording ? stopRec() : startRec()}
        disabled={uploading}
        style={{ width: "100%", padding: 18, borderRadius: 16, cursor: uploading ? "default" : "pointer", fontFamily: MONO, fontSize: 13, letterSpacing: 1.5, border: `1px solid ${recording ? C.red : uploading ? C.line : mc}`, background: recording ? "#1A0A0A" : uploading ? C.panel2 : hexA(mc, "1A"), color: recording ? C.red : uploading ? C.dim : mc }}
      >
        {uploading ? "SENDING..." : recording ? `● RECORDING ${recSecs}s — TAP TO STOP` : "○ TAP TO LEAVE A VOICE REPLY"}
      </button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   Drop composer
   ---------------------------------------------------------------------------- */
function DropSheet({ onClose, onDrop, credits, handle, uid, place, lat, lng }: {
  onClose: () => void;
  onDrop: (d: { title: string; mood: string; secs: number; audioUrl: string; dropId: string }) => void;
  credits: number;
  handle: string;
  uid: string;
  place: string;
  lat: number | null;
  lng: number | null;
}) {
  const [stage, setStage] = useState("record");
  const [title, setTitle] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick the timer while recording
  useEffect(() => {
    if (!recording) return;
    const i = setInterval(() => setRecSecs((s) => Math.min(s + 1, 15)), 1000);
    return () => clearInterval(i);
  }, [recording]);

  const stopRec = () => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    mrRef.current?.stop();
    mrRef.current = null;
    setRecording(false);
  };

  const startRec = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
        setStage("title");
      };
      mr.start(100);
      mrRef.current = mr;
      setRecSecs(0);
      setRecording(true);
      autoStopRef.current = setTimeout(stopRec, 15000);
    } catch {
      setMicError("Microphone access denied. Allow mic in browser settings.");
    }
  };

  const publish = async () => {
    if (!audioBlob || !mood || !title.trim()) return;
    setUploading(true);
    setMicError(null);
    try {
      const fd = new FormData();
      fd.append("file", audioBlob, `drop_${Date.now()}.webm`);
      fd.append("upload_preset", "nearhum_drops");
      const res = await fetch("https://api.cloudinary.com/v1_1/dvtwey6m9/video/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Cloudinary upload failed");
      const { secure_url: audioUrl } = await res.json();
      const docRef = await addDoc(collection(firestore, "drops"), {
        uid, handle,
        title: title.trim(), mood, secs: recSecs,
        audioUrl, place,
        ...(lat !== null ? { lat, lng } : {}),
        plays: 0, ttl: 24.0,
        reacts: { felt: 0, same: 0, loud: 0 },
        replies: [],
        createdAt: new Date().toISOString(),
      });
      onDrop({ title: title.trim(), mood, secs: recSecs, audioUrl, dropId: docRef.id });
    } catch {
      setMicError("Upload failed. Check your connection and try again.");
      setUploading(false);
    }
  };

  const mc = mood ? MOOD[mood] : C.green;
  const dur = recSecs || 8;

  const Dots = ({ i }: { i: number }) => (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {[0, 1, 2, 3].map((n) => (
        <span key={n} style={{ width: n === i ? 22 : 6, height: 6, borderRadius: 99, background: n <= i ? mc : C.line, transition: "all .2s" }} />
      ))}
    </div>
  );

  return (
    <Sheet onClose={onClose} accent={mc}>
      {stage === "record" && (
        <div>
          <Dots i={0} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 4, textAlign: "center" }}>STEP 1 · DROP YOUR VOICE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 24, textAlign: "center" }}>Say your piece</div>
          <ProgWave n={32} color={C.green} progress={recording ? recSecs / 15 : 0} h={64} gap={3} />
          <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 28, color: recording ? C.red : C.dim, margin: "18px 0" }}>
            {fmtSecs(recSecs)} <span style={{ fontSize: 13 }}>/ 0:15</span>
          </div>
          {micError && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 12, textAlign: "center", lineHeight: 1.4 }}>{micError}</div>}
          <button
            onClick={() => recording ? stopRec() : startRec()}
            style={{ width: "100%", padding: 18, borderRadius: 16, cursor: "pointer", fontFamily: MONO, fontSize: 13, letterSpacing: 2, border: `1px solid ${recording ? C.red : C.green}`, background: recording ? "#1A0A0A" : C.panel2, color: recording ? C.red : C.green }}
          >
            {recording ? "● RECORDING — TAP TO STOP" : "○ TAP TO RECORD (15s MAX)"}
          </button>
        </div>
      )}

      {stage === "title" && (
        <div>
          <Dots i={1} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>STEP 2 · WHAT'S THIS ABOUT?</div>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value.slice(0, 50))} placeholder="My day at work today" style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 16px", color: C.text, fontSize: 19, fontWeight: 650, outline: "none" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 8 }}>
            <span style={{ color: C.green }}>✓ {fmtSecs(dur)} recorded</span>
            <span>{title.length}/50</span>
          </div>
          <button disabled={!title.trim()} onClick={() => setStage("mood")} style={{ width: "100%", padding: 18, borderRadius: 16, marginTop: 22, cursor: title.trim() ? "pointer" : "default", border: "none", background: title.trim() ? C.green : C.line, color: title.trim() ? C.bg : C.dim, fontFamily: MONO, fontSize: 13, letterSpacing: 2 }}>
            NEXT — PICK A MOOD →
          </button>
        </div>
      )}

      {stage === "mood" && (
        <div>
          <Dots i={2} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>STEP 3 · SET THE MOOD</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 18 }}>{title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {MOOD_LIST.map((m) => {
              const on = mood === m;
              return (
                <button key={m} onClick={() => setMood(m)} style={{ padding: "18px 12px", borderRadius: 16, cursor: "pointer", textAlign: "left", border: `1px solid ${on ? MOOD[m] : C.line}`, background: on ? hexA(MOOD[m], "1A") : "transparent", color: on ? MOOD[m] : C.textDim }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: MOOD[m] }} />
                    <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 1 }}>{m.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{MOOD_BLURB[m]}</div>
                </button>
              );
            })}
          </div>
          <button disabled={!mood} onClick={() => setStage("post")} style={{ width: "100%", padding: 18, borderRadius: 16, marginTop: 22, cursor: mood ? "pointer" : "default", border: "none", background: mood ? mc : C.line, color: mood ? C.bg : C.dim, fontFamily: MONO, fontSize: 13, letterSpacing: 2 }}>
            NEXT — REVIEW →
          </button>
        </div>
      )}

      {stage === "post" && mood && (
        <div>
          <Dots i={3} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: mc }} />
            <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1 }}>{mood.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 16 }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14 }}>
            <button style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${mc}`, background: "transparent", color: mc, cursor: "pointer", flexShrink: 0, fontSize: 13 }}>▶</button>
            <Wave active color={mc} seed={3} />
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, flexShrink: 0 }}>{fmtSecs(dur)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 18 }}>
            <span>Costs {DROP_COST} credits to drop</span>
            <span style={{ color: credits >= DROP_COST ? C.green : C.amber }}>◆ {credits} left</span>
          </div>
          {micError && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 10, textAlign: "center" }}>{micError}</div>}
          <button onClick={publish} disabled={uploading} style={{ width: "100%", padding: 18, borderRadius: 16, cursor: uploading ? "default" : "pointer", border: "none", background: uploading ? C.line : mc, color: uploading ? C.dim : C.bg, fontFamily: MONO, fontSize: 13, letterSpacing: 2 }}>
            {uploading ? "UPLOADING..." : "POST — DROP FOR 24H"}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   Top-up sheet
   ---------------------------------------------------------------------------- */
function TopUp({ credits, onClose, onBuy }: { credits: number; onClose: () => void; onBuy: (n: number) => void }) {
  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div style={{ fontFamily: MONO, fontSize: 30, color: C.green, fontWeight: 700 }}>◆ {credits}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginTop: 4 }}>CREDITS LEFT</div>
      </div>
      <p style={{ textAlign: "center", fontSize: 13, color: C.textDim, lineHeight: 1.5, margin: "10px 0 20px" }}>
        Listening is free up to {DAILY_FREE_PLAYS} plays a day. After that, each play is {PLAY_COST} credit and dropping your own is {DROP_COST}. Top up to keep the station running.
      </p>
      {PACKS.map((pk) => (
        <button key={pk.n} onClick={() => onBuy(pk.n + pk.bonus)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 16, marginBottom: 10, borderRadius: 14, cursor: "pointer", border: `1px solid ${pk.best ? C.green : C.line}`, background: pk.best ? hexA(C.green, "12") : C.card }}>
          <span style={{ fontFamily: MONO, fontSize: 20, color: C.green, fontWeight: 700 }}>◆ {pk.n}</span>
          {pk.bonus > 0 && <span style={{ fontFamily: MONO, fontSize: 10, color: C.greenSoft }}>+{pk.bonus} bonus</span>}
          {pk.best && <span style={{ fontFamily: MONO, fontSize: 9, color: C.green, border: `1px solid ${C.green}`, borderRadius: 99, padding: "2px 7px", letterSpacing: 1 }}>BEST VALUE</span>}
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 15, color: C.text, fontWeight: 700 }}>{pk.price}</span>
        </button>
      ))}
      <p style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 10 }}>Secure checkout · Demo only, no charge</p>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   Settings sheet
   ---------------------------------------------------------------------------- */
function Settings({ handle, anon, notif, onToggleNotif, onClose, onSignOut, place, onOpenLocation }: {
  handle: string; anon: boolean; notif: boolean; onToggleNotif: () => void; onClose: () => void; onSignOut: () => void; place: string; onOpenLocation: () => void;
}) {
  const Row = ({ label, value, danger, onClick }: { label: string; value: string; danger?: boolean; onClick?: () => void }) => (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", marginBottom: 8, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, cursor: onClick ? "pointer" : "default", color: danger ? C.red : C.text, fontFamily: FONT, fontSize: 14 }}>
      <span>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>{value}</span>
    </button>
  );
  const locationLabel = place.startsWith("Near me") ? place.replace("Near me · ", "") : place;
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 20, fontWeight: 750, color: C.text, marginBottom: 16 }}>Settings</div>
      <Row label="Handle" value={anon ? "anonymous" : `@${handle}`} />
      <Row label="Location" value={`${locationLabel} ▾`} onClick={onOpenLocation} />
      <button onClick={onToggleNotif} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", marginBottom: 8, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, cursor: "pointer", color: C.text, fontFamily: FONT, fontSize: 14 }}>
        <span>Reply notifications</span>
        <span style={{ width: 42, height: 24, borderRadius: 99, background: notif ? C.green : C.line, position: "relative", transition: "background .2s" }}>
          <span style={{ position: "absolute", top: 3, left: notif ? 21 : 3, width: 18, height: 18, borderRadius: 99, background: notif ? C.bg : C.dim, transition: "left .2s" }} />
        </span>
      </button>
      <Row label="Privacy & safety" value="›" onClick={() => {}} />
      <Row label="Report a problem" value="›" onClick={() => {}} />
      <div style={{ height: 12 }} />
      <Row label="Sign out" value="" danger onClick={onSignOut} />
      <p style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 14 }}>Nearhum · v0.1 · Orlando</p>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   Activity tab
   ---------------------------------------------------------------------------- */
function ActivityFeed({ items, onOpen }: { items: typeof ACTIVITY_SEED; onOpen: (title: string) => void }) {
  const icon = (it: typeof ACTIVITY_SEED[0]) => {
    if (it.type === "reply") return { g: "◴", c: C.greenSoft };
    if (it.type === "react") { const r = REACTIONS.find((x) => x.key === (it as any).react); return { g: r ? r.glyph : "♥", c: r ? r.color : C.rose }; }
    if (it.type === "milestone") return { g: "✦", c: C.amber };
    return { g: "◆", c: C.cyan };
  };
  const text = (it: typeof ACTIVITY_SEED[0]) => {
    if (it.type === "reply") return `@${(it as any).who} replied in voice`;
    if (it.type === "react") { const r = REACTIONS.find((x) => x.key === (it as any).react); return `@${(it as any).who} reacted "${r ? r.label : (it as any).react}"`; }
    if (it.type === "milestone") return (it as any).detail;
    return (it as any).detail;
  };
  return (
    <div>
      {items.length === 0 && (
        <div style={{ textAlign: "center", color: C.dim, fontSize: 14, padding: "60px 20px", lineHeight: 1.6 }}>Nothing yet. When people reply to or react to your voice, it shows up here — your reason to come back.</div>
      )}
      {items.map((it) => {
        const ic = icon(it);
        return (
          <button key={it.id} onClick={() => it.title && onOpen(it.title)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 14, padding: 14, marginBottom: 10, borderRadius: 16, cursor: it.title ? "pointer" : "default", border: `1px solid ${it.unread ? hexA(ic.c, "55") : C.line}`, background: it.unread ? `linear-gradient(100deg, ${hexA(ic.c, "12")}, ${C.card})` : C.card }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: hexA(ic.c, "20"), color: ic.c, fontSize: 17 }}>{ic.g}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{text(it)}</div>
              {it.title && <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>on "{it.title}"</div>}
            </div>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {it.unread && <span style={{ width: 8, height: 8, borderRadius: 99, background: ic.c }} />}
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer }}>{it.ago}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Credit chip
   ---------------------------------------------------------------------------- */
function CreditChip({ credits, freeLeft, onClick, low }: { credits: number; freeLeft: number; onClick: () => void; low: boolean }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 99, cursor: "pointer", border: `1px solid ${low ? C.amber : hexA(C.green, "66")}`, background: low ? hexA(C.amber, "1A") : C.panel2, color: low ? C.amber : C.green, fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>
      {freeLeft > 0 ? <span style={{ color: C.greenSoft }}>♪ {freeLeft}</span> : <span>◆ {credits}</span>}
    </button>
  );
}

/* ----------------------------------------------------------------------------
   Location picker
   ---------------------------------------------------------------------------- */
const PLACES: Record<string, { abbr: string; cities: string[] }> = {
  Alabama: { abbr: "AL", cities: ["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa"] },
  Alaska: { abbr: "AK", cities: ["Anchorage", "Fairbanks", "Juneau", "Sitka"] },
  Arizona: { abbr: "AZ", cities: ["Phoenix", "Tucson", "Scottsdale", "Tempe", "Mesa", "Flagstaff"] },
  Arkansas: { abbr: "AR", cities: ["Little Rock", "Fayetteville", "Fort Smith", "Jonesboro"] },
  California: { abbr: "CA", cities: ["Los Angeles", "San Francisco", "San Diego", "Sacramento", "Oakland", "San Jose", "Fresno", "Long Beach", "Berkeley", "Santa Monica", "Pasadena", "Irvine", "Riverside", "Santa Barbara"] },
  Colorado: { abbr: "CO", cities: ["Denver", "Boulder", "Colorado Springs", "Fort Collins", "Aurora", "Pueblo", "Aspen"] },
  Connecticut: { abbr: "CT", cities: ["Hartford", "New Haven", "Bridgeport", "Stamford", "Waterbury"] },
  Delaware: { abbr: "DE", cities: ["Wilmington", "Dover", "Newark"] },
  Florida: { abbr: "FL", cities: ["Orlando", "Miami", "Tampa", "Jacksonville", "St. Petersburg", "Gainesville", "Tallahassee", "Fort Lauderdale", "Boca Raton", "Sarasota", "Cape Coral", "Fort Myers", "Daytona Beach", "Pensacola"] },
  Georgia: { abbr: "GA", cities: ["Atlanta", "Savannah", "Athens", "Augusta", "Macon", "Columbus", "Alpharetta", "Roswell"] },
  Hawaii: { abbr: "HI", cities: ["Honolulu", "Hilo", "Kailua", "Pearl City", "Lahaina"] },
  Idaho: { abbr: "ID", cities: ["Boise", "Nampa", "Idaho Falls", "Pocatello", "Coeur d'Alene"] },
  Illinois: { abbr: "IL", cities: ["Chicago", "Naperville", "Springfield", "Evanston", "Peoria", "Rockford", "Aurora", "Champaign"] },
  Indiana: { abbr: "IN", cities: ["Indianapolis", "Fort Wayne", "Bloomington", "South Bend", "Evansville"] },
  Iowa: { abbr: "IA", cities: ["Des Moines", "Cedar Rapids", "Iowa City", "Davenport", "Sioux City"] },
  Kansas: { abbr: "KS", cities: ["Wichita", "Kansas City", "Topeka", "Lawrence", "Overland Park"] },
  Kentucky: { abbr: "KY", cities: ["Louisville", "Lexington", "Bowling Green", "Covington", "Owensboro"] },
  Louisiana: { abbr: "LA", cities: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles"] },
  Maine: { abbr: "ME", cities: ["Portland", "Bangor", "Augusta", "Lewiston"] },
  Maryland: { abbr: "MD", cities: ["Baltimore", "Annapolis", "Frederick", "Rockville", "Gaithersburg", "College Park"] },
  Massachusetts: { abbr: "MA", cities: ["Boston", "Cambridge", "Worcester", "Springfield", "Lowell", "Salem", "Somerville"] },
  Michigan: { abbr: "MI", cities: ["Detroit", "Grand Rapids", "Lansing", "Ann Arbor", "Flint", "Dearborn", "Kalamazoo"] },
  Minnesota: { abbr: "MN", cities: ["Minneapolis", "St. Paul", "Duluth", "Rochester", "Bloomington", "Mankato"] },
  Mississippi: { abbr: "MS", cities: ["Jackson", "Gulfport", "Hattiesburg", "Oxford", "Biloxi"] },
  Missouri: { abbr: "MO", cities: ["Kansas City", "St. Louis", "Columbia", "Springfield", "Independence"] },
  Montana: { abbr: "MT", cities: ["Billings", "Missoula", "Great Falls", "Bozeman", "Helena"] },
  Nebraska: { abbr: "NE", cities: ["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney"] },
  Nevada: { abbr: "NV", cities: ["Las Vegas", "Reno", "Henderson", "North Las Vegas", "Sparks"] },
  "New Hampshire": { abbr: "NH", cities: ["Manchester", "Nashua", "Concord", "Derry", "Dover"] },
  "New Jersey": { abbr: "NJ", cities: ["Newark", "Jersey City", "Hoboken", "Trenton", "Camden", "Atlantic City"] },
  "New Mexico": { abbr: "NM", cities: ["Albuquerque", "Santa Fe", "Las Cruces", "Roswell", "Taos"] },
  "New York": { abbr: "NY", cities: ["New York City", "Brooklyn", "Queens", "Buffalo", "Rochester", "Albany", "Syracuse", "Yonkers", "Ithaca", "Poughkeepsie"] },
  "North Carolina": { abbr: "NC", cities: ["Charlotte", "Raleigh", "Asheville", "Durham", "Greensboro", "Winston-Salem", "Chapel Hill", "Wilmington"] },
  "North Dakota": { abbr: "ND", cities: ["Fargo", "Bismarck", "Grand Forks", "Minot"] },
  Ohio: { abbr: "OH", cities: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Athens"] },
  Oklahoma: { abbr: "OK", cities: ["Oklahoma City", "Tulsa", "Norman", "Edmond", "Broken Arrow"] },
  Oregon: { abbr: "OR", cities: ["Portland", "Eugene", "Salem", "Bend", "Medford", "Corvallis", "Astoria"] },
  Pennsylvania: { abbr: "PA", cities: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Harrisburg", "Lancaster", "State College"] },
  "Rhode Island": { abbr: "RI", cities: ["Providence", "Cranston", "Warwick", "Pawtucket", "Newport"] },
  "South Carolina": { abbr: "SC", cities: ["Charleston", "Columbia", "Greenville", "Myrtle Beach", "Spartanburg"] },
  "South Dakota": { abbr: "SD", cities: ["Sioux Falls", "Rapid City", "Pierre", "Aberdeen"] },
  Tennessee: { abbr: "TN", cities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Murfreesboro", "Franklin"] },
  Texas: { abbr: "TX", cities: ["Austin", "Houston", "Dallas", "San Antonio", "El Paso", "Fort Worth", "Arlington", "Corpus Christi", "Lubbock", "Plano", "Denton", "Waco"] },
  Utah: { abbr: "UT", cities: ["Salt Lake City", "Provo", "Ogden", "St. George", "Logan"] },
  Vermont: { abbr: "VT", cities: ["Burlington", "Montpelier", "Rutland", "Brattleboro"] },
  Virginia: { abbr: "VA", cities: ["Richmond", "Virginia Beach", "Norfolk", "Arlington", "Alexandria", "Charlottesville", "Roanoke"] },
  Washington: { abbr: "WA", cities: ["Seattle", "Spokane", "Tacoma", "Bellevue", "Olympia", "Bellingham", "Everett"] },
  "West Virginia": { abbr: "WV", cities: ["Charleston", "Huntington", "Morgantown", "Parkersburg"] },
  Wisconsin: { abbr: "WI", cities: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine", "Appleton"] },
  Wyoming: { abbr: "WY", cities: ["Cheyenne", "Casper", "Laramie", "Gillette", "Jackson"] },
};

function LocationSheet({ place, onPick, onClose }: { place: string; onPick: (p: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [openState, setOpenState] = useState<string | null>("Florida");
  const query = q.trim().toLowerCase();
  const matches = (city: string, st: string, abbr: string) =>
    !query || city.toLowerCase().includes(query) || st.toLowerCase().includes(query) || abbr.toLowerCase().includes(query);

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontSize: 20, fontWeight: 750, color: C.text, marginBottom: 4 }}>Tune in elsewhere</div>
      <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, margin: "0 0 14px" }}>Listen to another city's hum. You can only drop a voice where you actually are.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city or state…" style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 99, padding: "13px 16px", color: C.text, fontFamily: FONT, fontSize: 15, outline: "none", marginBottom: 16 }} />
      <div style={{ overflowY: "auto", flex: 1 }}>
        <button onClick={() => onPick("Near me · Orlando, FL")} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: 14, marginBottom: 12, borderRadius: 14, cursor: "pointer", border: `1px solid ${place.startsWith("Near me") ? C.green : C.line}`, background: place.startsWith("Near me") ? hexA(C.green, "14") : C.card, color: C.text }}>
          <span style={{ fontSize: 18, color: C.green }}>◎</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 650 }}>Near me</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>your real location · Orlando, FL</div>
          </div>
          {place.startsWith("Near me") && <span style={{ marginLeft: "auto", color: C.green, fontSize: 16 }}>✓</span>}
        </button>
        {Object.entries(PLACES).map(([st, { abbr, cities }]) => {
          const visibleCities = cities.filter((c) => matches(c, st, abbr));
          if (query && visibleCities.length === 0) return null;
          const open = query ? true : openState === st;
          return (
            <div key={st} style={{ marginBottom: 8 }}>
              <button onClick={() => setOpenState(open && !query ? null : st)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12, cursor: "pointer", border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontFamily: MONO, fontSize: 12, letterSpacing: 1 }}>
                <span>{st.toUpperCase()} <span style={{ color: C.dim }}>· {abbr}</span></span>
                <span style={{ color: C.dim, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
              </button>
              {open && (
                <div style={{ padding: "8px 4px 4px" }}>
                  {visibleCities.map((c) => {
                    const label = `${c}, ${abbr}`;
                    const on = place === label;
                    return (
                      <button key={c} onClick={() => onPick(label)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", padding: "11px 14px", marginBottom: 6, borderRadius: 10, cursor: "pointer", border: `1px solid ${on ? C.green : "transparent"}`, background: on ? hexA(C.green, "12") : C.card, color: C.text, fontSize: 14 }}>
                        {c}
                        {on && <span style={{ marginLeft: "auto", color: C.green }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   Tab bar
   ---------------------------------------------------------------------------- */
function TabBar({ tab, setTab, unread }: { tab: string; setTab: (t: string) => void; unread: number }) {
  const tabs: [string, string, string][] = [["feed", "RADIO", "◉"], ["activity", "ACTIVITY", "◴"], ["you", "YOU", "◍"]];
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: hexA(C.panel, "F2"), backdropFilter: "blur(12px)", borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "center", zIndex: 42, paddingBottom: SAFE_B }}>
      <div style={{ width: "100%", maxWidth: 480, display: "flex" }}>
        {tabs.map(([id, lbl, ic]) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "10px 0 12px", background: "transparent", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: on ? C.green : C.dim, position: "relative" }}>
              <span style={{ fontSize: 18, position: "relative" }}>
                {ic}
                {id === "activity" && unread > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 99, background: C.red, color: "#fff", fontFamily: MONO, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{unread}</span>
                )}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5 }}>{lbl}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Global keyframes
   ---------------------------------------------------------------------------- */
function GlobalStyle() {
  return (
    <style>{`
      *{-webkit-tap-highlight-color:transparent;box-sizing:border-box}
      button:focus-visible,input:focus-visible{outline:2px solid ${C.greenSoft};outline-offset:2px}
      input::placeholder,textarea::placeholder{color:${C.dim}}
      ::-webkit-scrollbar{display:none}
      @keyframes eqA{0%,100%{height:30%}50%{height:100%}}
      @keyframes eqB{0%,100%{height:80%}50%{height:40%}}
      @keyframes eqC{0%,100%{height:50%}50%{height:90%}}
      @keyframes bloom{0%,100%{transform:scale(.92);opacity:.5}50%{transform:scale(1.04);opacity:.9}}
      @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes toastIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
    `}</style>
  );
}

/* ----------------------------------------------------------------------------
   SearchSheet — search drops by title, handle, mood
   ---------------------------------------------------------------------------- */
function SearchSheet({ pings, onClose, onSelect }: {
  pings: typeof SEED; onClose: () => void;
  onSelect: (idx: number) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 120); }, []);

  const moods = ["all", ...Object.keys(MOOD)];

  const results = pings.filter((p) => {
    const matchMood = filter === "all" || p.mood === filter;
    const term = q.toLowerCase();
    const matchText = !term || p.title.toLowerCase().includes(term) || p.handle.toLowerCase().includes(term) || p.mood.toLowerCase().includes(term);
    return matchMood && matchText;
  });

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 12 }}>SEARCH DROPS</div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="title, handle, mood…"
          style={{ width: "100%", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px 12px 40px", color: C.text, fontFamily: MONO, fontSize: 13, outline: "none", boxSizing: "border-box" }}
        />
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.dim, fontSize: 14 }}>⌕</span>
        {q && <button onClick={() => setQ("")} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>✕</button>}
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
        {moods.map((m) => (
          <button key={m} onClick={() => setFilter(m)} style={{ flexShrink: 0, padding: "5px 12px", borderRadius: 99, border: `1px solid ${filter === m ? (m === "all" ? C.green : MOOD[m as keyof typeof MOOD]) : C.line}`, background: filter === m ? (m === "all" ? hexA(C.green, "22") : hexA(MOOD[m as keyof typeof MOOD], "22")) : "transparent", color: filter === m ? (m === "all" ? C.green : MOOD[m as keyof typeof MOOD]) : C.dim, fontFamily: MONO, fontSize: 10, cursor: "pointer", letterSpacing: 1 }}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>
        {results.length} {results.length === 1 ? "DROP" : "DROPS"} FOUND
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {results.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.dim, fontSize: 13 }}>No drops match your search.</div>
        )}
        {results.map((p) => {
          const mc = MOOD[p.mood];
          const origIdx = pings.findIndex((x) => x.id === p.id);
          return (
            <button key={p.id} onClick={() => { onSelect(origIdx); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}`, background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 36, height: 36, borderRadius: 99, border: `1px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: mc }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: mc }}>{p.mood}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>@{p.handle}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.dist}</span>
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{fmtSecs(p.secs)}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.plays} ▶</div>
              </div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   ProfileSheet — tap a handle to see their public drops + stats
   ---------------------------------------------------------------------------- */
function ProfileSheet({ handle, allPings, onClose, onSelect, myHandle }: {
  handle: string; allPings: typeof SEED; onClose: () => void;
  onSelect: (idx: number) => void; myHandle: string;
}) {
  const [tab, setTab] = useState<"drops" | "stats">("drops");
  const drops = allPings.filter((p) => p.handle === handle);
  const totalPlays = drops.reduce((s, p) => s + p.plays, 0);
  const totalReacts = drops.reduce((s, p) => s + p.reacts.felt + p.reacts.same + p.reacts.loud, 0);
  const moodCounts: Record<string, number> = {};
  drops.forEach((p) => { moodCounts[p.mood] = (moodCounts[p.mood] || 0) + 1; });
  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const mc = MOOD[topMood as keyof typeof MOOD] ?? C.green;
  const avgSecs = drops.length ? Math.round(drops.reduce((s, p) => s + p.secs, 0) / drops.length) : 0;

  return (
    <Sheet onClose={onClose} accent={mc}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: 99, border: `2px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
          {handle.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>@{handle}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: mc, marginTop: 2, letterSpacing: 1 }}>{drops.length} DROPS · {totalPlays} PLAYS</div>
        </div>
        {handle !== myHandle && (
          <button style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 99, border: `1px solid ${mc}`, background: hexA(mc, "1A"), color: mc, fontFamily: MONO, fontSize: 11, cursor: "pointer", letterSpacing: 1 }}>
            FOLLOW
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: `1px solid ${C.line}` }}>
        {(["drops", "stats"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 0", fontFamily: MONO, fontSize: 11, letterSpacing: 1, background: "none", border: "none", borderBottom: `2px solid ${tab === t ? mc : "transparent"}`, color: tab === t ? mc : C.dim, cursor: "pointer" }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === "drops" && (
        <div style={{ overflowY: "auto", flex: 1 }}>
          {drops.length === 0 && <div style={{ textAlign: "center", padding: "32px 0", color: C.dim, fontSize: 13 }}>No drops yet.</div>}
          {drops.map((p) => {
            const color = MOOD[p.mood];
            const origIdx = allPings.findIndex((x) => x.id === p.id);
            return (
              <button key={p.id} onClick={() => { onSelect(origIdx); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{p.dist} · {fmtSecs(p.secs)}</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, flexShrink: 0 }}>{p.plays} ▶</div>
              </button>
            );
          })}
        </div>
      )}
      {tab === "stats" && (
        <div style={{ overflowY: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              { label: "DROPS", value: drops.length },
              { label: "TOTAL PLAYS", value: totalPlays },
              { label: "REACTIONS", value: totalReacts },
              { label: "AVG LENGTH", value: `${avgSecs}s` },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: C.panel2, borderRadius: 14, padding: "16px 14px", border: `1px solid ${C.line}` }}>
                <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: mc }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>MOOD BREAKDOWN</div>
          {Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).map(([mood, count]) => (
            <div key={mood} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: MOOD[mood as keyof typeof MOOD] }}>{mood}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{count}</span>
              </div>
              <div style={{ height: 4, background: C.panel2, borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${(count / drops.length) * 100}%`, background: MOOD[mood as keyof typeof MOOD], borderRadius: 2, transition: "width 0.4s" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   SavedSheet — bookmarked drops
   ---------------------------------------------------------------------------- */
function SavedSheet({ saved, allPings, onClose, onSelect, onUnsave }: {
  saved: string[]; allPings: typeof SEED; onClose: () => void;
  onSelect: (idx: number) => void; onUnsave: (id: string) => void;
}) {
  const savedPings = saved.map((id) => allPings.find((p) => p.id === id)).filter(Boolean) as typeof SEED;

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 12 }}>SAVED DROPS</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {savedPings.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.dim }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◎</div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>Nothing saved yet.</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>Tap ◎ on any drop to save it.</div>
          </div>
        )}
        {savedPings.map((p) => {
          const mc = MOOD[p.mood];
          const origIdx = allPings.findIndex((x) => x.id === p.id);
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <button onClick={() => { onSelect(origIdx); onClose(); }} style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: mc, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>@{p.handle} · {p.dist}</div>
                </div>
              </button>
              <button onClick={() => onUnsave(p.id)} style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
          );
        })}
      </div>
      {savedPings.length > 0 && (
        <button onClick={() => saved.forEach((id) => onUnsave(id))} style={{ width: "100%", marginTop: 12, padding: "12px 0", fontFamily: MONO, fontSize: 11, letterSpacing: 1, background: "none", border: `1px solid ${C.line}`, borderRadius: 12, color: C.dim, cursor: "pointer" }}>
          CLEAR ALL
        </button>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   ShareSheet — share a drop
   ---------------------------------------------------------------------------- */
function ShareSheet({ ping, onClose }: { ping: typeof SEED[0]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const mc = MOOD[ping.mood];
  const shareText = `"${ping.title}" — a ${ping.mood} drop by @${ping.handle} on Nearhum`;
  const shareUrl = `https://nearhum.app/drop/${ping.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  };

  const shareNative = async () => {
    if (!navigator.share) { copy(); return; }
    try { await navigator.share({ title: ping.title, text: shareText, url: shareUrl }); } catch { /* cancelled */ }
  };

  const options = [
    { label: "Copy link", icon: "⎘", action: copy },
    { label: "Share via…", icon: "↗", action: shareNative },
    { label: "Send to Messages", icon: "✉", action: () => { window.open("sms:?body=" + encodeURIComponent(shareText + " " + shareUrl), "_blank"); } },
    { label: "Tweet it", icon: "𝕏", action: () => { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank"); } },
  ];

  return (
    <Sheet onClose={onClose} accent={mc}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: hexA(mc, "22"), border: `1px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: mc }} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>{ping.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{ping.handle} · {ping.dist}</div>
      </div>
      <div style={{ background: C.panel2, borderRadius: 14, padding: "12px 16px", marginBottom: 16, border: `1px solid ${C.line}` }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, wordBreak: "break-all" }}>{shareUrl}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map(({ label, icon, action }) => (
          <button key={label} onClick={action} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 14, background: C.panel2, border: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{icon}</span>
            <span style={{ color: C.text, fontSize: 15 }}>{label === "Copy link" && copied ? "Copied!" : label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   HelpSheet — FAQ and how Nearhum works
   ---------------------------------------------------------------------------- */
function HelpSheet({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);

  const faqs = [
    { q: "What is a drop?", a: "A drop is a short voice note — up to 15 seconds — shared with people near you. Think of it like a local bulletin board, but for your voice." },
    { q: "Who can hear my drops?", a: "Anyone on Nearhum in your city or neighborhood. Drops are sorted by distance, so the closer someone is, the higher your drop appears in their feed." },
    { q: "How do credits work?", a: "Each drop costs 1 credit to publish. You start with 8 free credits. Earn more by getting reactions from others, or buy a pack any time from your profile." },
    { q: "How long does a drop last?", a: "Drops expire after 24 hours. Once a drop is gone, it's gone — no archive. That's what makes them feel alive." },
    { q: "What do the reactions mean?", a: "♥ Felt — this hit you emotionally.\n◎ Same — you relate to exactly this.\n✦ Loud — this made you turn up the volume." },
    { q: "Can I reply to a drop?", a: "Yes. Tap a drop to open it, then tap the reply button to leave a voice reply of up to 15 seconds. The original poster gets notified in their activity tab." },
    { q: "How is my location used?", a: "Your location is used only to sort drops by distance. It is never shared publicly. Your city name is visible, but exact coordinates are never exposed." },
    { q: "Can I block someone?", a: "Yes. Open Settings → Blocked Users to manage blocked accounts. Drops from blocked accounts will not appear in your feed." },
    { q: "How do I change my handle?", a: "Handles are set during sign-up and can't be changed right now. We're working on it." },
    { q: "Is Nearhum free?", a: "Yes — listening is always free. Publishing drops costs credits, which you earn through engagement or purchase." },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>HELP & FAQ</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>How Nearhum works</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {faqs.map(({ q, a }, i) => (
          <div key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
            <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <span style={{ color: C.text, fontSize: 14, fontWeight: 600, flex: 1, paddingRight: 12 }}>{q}</span>
              <span style={{ color: C.dim, fontSize: 12, flexShrink: 0 }}>{open === i ? "▲" : "▼"}</span>
            </button>
            {open === i && (
              <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, paddingBottom: 14, whiteSpace: "pre-line" }}>{a}</div>
            )}
          </div>
        ))}
        <div style={{ marginTop: 24, padding: "16px", background: C.panel2, borderRadius: 14, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 8 }}>CONTACT US</div>
          <div style={{ color: C.text, fontSize: 14, marginBottom: 4 }}>Still have questions?</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.green }}>support@nearhum.app</div>
        </div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   LeaderboardSheet — top creators this week
   ---------------------------------------------------------------------------- */
function LeaderboardSheet({ pings, onClose, onSelectProfile }: {
  pings: typeof SEED; onClose: () => void;
  onSelectProfile: (handle: string) => void;
}) {
  const [metric, setMetric] = useState<"plays" | "reacts" | "drops">("plays");

  const byHandle: Record<string, { handle: string; drops: number; plays: number; reacts: number; mood: string }> = {};
  pings.forEach((p) => {
    if (!byHandle[p.handle]) byHandle[p.handle] = { handle: p.handle, drops: 0, plays: 0, reacts: 0, mood: p.mood };
    byHandle[p.handle].drops += 1;
    byHandle[p.handle].plays += p.plays;
    byHandle[p.handle].reacts += p.reacts.felt + p.reacts.same + p.reacts.loud;
  });

  const sorted = Object.values(byHandle).sort((a, b) => b[metric] - a[metric]).slice(0, 20);
  const top = sorted[0]?.[metric] || 1;

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>THIS WEEK</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 16 }}>Top Voices</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["plays", "reacts", "drops"] as const).map((m) => (
          <button key={m} onClick={() => setMetric(m)} style={{ flex: 1, padding: "8px 0", borderRadius: 99, fontFamily: MONO, fontSize: 10, letterSpacing: 1, border: `1px solid ${metric === m ? C.green : C.line}`, background: metric === m ? hexA(C.green, "22") : "transparent", color: metric === m ? C.green : C.dim, cursor: "pointer" }}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {sorted.map((creator, i) => {
          const mc = MOOD[creator.mood as keyof typeof MOOD] ?? C.green;
          const val = creator[metric];
          const pct = (val / top) * 100;
          return (
            <button key={creator.handle} onClick={() => { onSelectProfile(creator.handle); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}`, background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 28, fontFamily: MONO, fontSize: 13, color: C.dim, flexShrink: 0, textAlign: "center" }}>
                {i < 3 ? medals[i] : `#${i + 1}`}
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 99, border: `1px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: mc, flexShrink: 0 }}>
                {creator.handle.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>@{creator.handle}</div>
                <div style={{ height: 3, background: C.panel2, borderRadius: 2, marginTop: 5 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: mc, borderRadius: 2 }} />
                </div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: mc, flexShrink: 0 }}>{val.toLocaleString()}</div>
            </button>
          );
        })}
        {sorted.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: C.dim, fontSize: 13 }}>No drops in your area yet.</div>}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   BlockedSheet — manage blocked users
   ---------------------------------------------------------------------------- */
function BlockedSheet({ blocked, onClose, onUnblock }: {
  blocked: string[]; onClose: () => void; onUnblock: (h: string) => void;
}) {
  return (
    <Sheet onClose={onClose} accent={C.red}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>SETTINGS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Blocked Users</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {blocked.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.dim }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 14 }}>No blocked users.</div>
          </div>
        )}
        {blocked.map((h) => (
          <div key={h} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 16 }}>
              {h.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, color: C.text, fontSize: 15 }}>@{h}</div>
            <button onClick={() => onUnblock(h)} style={{ padding: "7px 14px", borderRadius: 99, border: `1px solid ${C.green}`, background: "transparent", color: C.green, fontFamily: MONO, fontSize: 10, cursor: "pointer", letterSpacing: 1 }}>
              UNBLOCK
            </button>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, textAlign: "center", marginTop: 12 }}>
        Blocked users can&apos;t see your drops and won&apos;t appear in your feed.
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   NotifSettingsSheet — granular notification preferences
   ---------------------------------------------------------------------------- */
function NotifSettingsSheet({ prefs, onClose, onChange }: {
  prefs: Record<string, boolean>; onClose: () => void;
  onChange: (key: string, val: boolean) => void;
}) {
  const options = [
    { key: "reacts", label: "Reactions", detail: "When someone reacts to your drop" },
    { key: "replies", label: "Voice replies", detail: "When someone replies to your drop" },
    { key: "nearby", label: "Nearby drops", detail: "New drops within 1 mile of you" },
    { key: "trending", label: "Trending alert", detail: "When a drop near you goes viral" },
    { key: "system", label: "System notices", detail: "Credits, updates, announcements" },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>SETTINGS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Notifications</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {options.map(({ key, label, detail }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{label}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 3 }}>{detail}</div>
            </div>
            <button
              onClick={() => onChange(key, !prefs[key])}
              style={{ width: 44, height: 26, borderRadius: 13, background: prefs[key] ? C.green : C.panel2, border: `1px solid ${prefs[key] ? C.green : C.line}`, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}
            >
              <div style={{ width: 20, height: 20, borderRadius: 99, background: C.text, position: "absolute", top: 2, left: prefs[key] ? 20 : 2, transition: "left 0.2s" }} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   StatsBar — community stats shown above the feed
   ---------------------------------------------------------------------------- */
function StatsBar({ pings, cityLabel, place }: { pings: typeof SEED; cityLabel: string; place: string }) {
  const totalPlays = pings.reduce((s, p) => s + p.plays, 0);
  const activeNow = pings.filter((p) => {
    const m = Math.floor((Date.now() - new Date(p.id.length > 10 ? p.id : Date.now().toString()).getTime()) / 60000);
    return m < 60;
  }).length;
  const locationName = cityLabel || place.replace("Near me · ", "").split(",")[0];

  return (
    <div style={{ display: "flex", gap: 8, padding: "10px 16px 6px", overflowX: "auto" }}>
      {[
        { label: "DROPS", value: pings.length },
        { label: "PLAYS", value: totalPlays > 999 ? `${(totalPlays / 1000).toFixed(1)}k` : totalPlays },
        { label: "NEAR YOU", value: pings.filter((p) => p.dist !== "nearby" && parseFloat(p.dist) < 2).length || pings.length },
      ].map(({ label, value }) => (
        <div key={label} style={{ flexShrink: 0, background: C.panel2, borderRadius: 12, padding: "8px 14px", border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1.5 }}>{label}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginTop: 1 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   SortBar — sort feed by distance / plays / time
   ---------------------------------------------------------------------------- */
function SortBar({ sort, onSort }: { sort: string; onSort: (s: string) => void }) {
  const opts = [
    { key: "distance", label: "NEAREST" },
    { key: "plays", label: "HOTTEST" },
    { key: "time", label: "LATEST" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, padding: "6px 16px 10px", overflowX: "auto" }}>
      {opts.map(({ key, label }) => (
        <button key={key} onClick={() => onSort(key)} style={{ flexShrink: 0, padding: "5px 14px", borderRadius: 99, fontFamily: MONO, fontSize: 10, letterSpacing: 1, border: `1px solid ${sort === key ? C.green : C.line}`, background: sort === key ? hexA(C.green, "22") : "transparent", color: sort === key ? C.green : C.dim, cursor: "pointer" }}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   TrendingBadge — appears on a ping card if it has many reacts recently
   ---------------------------------------------------------------------------- */
function TrendingBadge({ ping }: { ping: typeof SEED[0] }) {
  const total = ping.reacts.felt + ping.reacts.same + ping.reacts.loud;
  if (total < 5) return null;
  const mc = MOOD[ping.mood];
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: hexA(mc, "22"), border: `1px solid ${mc}`, borderRadius: 99, padding: "2px 8px", marginLeft: 8 }}>
      <span style={{ width: 4, height: 4, borderRadius: 99, background: mc, display: "inline-block" }} />
      <span style={{ fontFamily: MONO, fontSize: 9, color: mc, letterSpacing: 1 }}>TRENDING</span>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   FeedMoodFilter — extra mood chip bar used in SearchSheet
   ---------------------------------------------------------------------------- */
function FeedMoodFilter({ active, onChange }: { active: string; onChange: (m: string) => void }) {
  const moods = ["all", ...Object.keys(MOOD)];
  return (
    <div style={{ display: "flex", gap: 6, padding: "6px 16px 10px", overflowX: "auto" }}>
      {moods.map((m) => {
        const mc = m === "all" ? C.green : MOOD[m as keyof typeof MOOD];
        const on = active === m;
        return (
          <button key={m} onClick={() => onChange(m)} style={{ flexShrink: 0, padding: "5px 12px", borderRadius: 99, fontFamily: MONO, fontSize: 10, letterSpacing: 1, border: `1px solid ${on ? mc : C.line}`, background: on ? hexA(mc, "22") : "transparent", color: on ? mc : C.dim, cursor: "pointer", transition: "all 0.15s" }}>
            {m === "all" ? "ALL" : m.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   CreditEarnModal — how to earn more credits
   ---------------------------------------------------------------------------- */
function CreditEarnModal({ onClose, credits }: { onClose: () => void; credits: number }) {
  const ways = [
    { icon: "♥", label: "Get a reaction", credit: "+1 credit", detail: "Each time someone reacts to your drop" },
    { icon: "◎", label: "Get a voice reply", credit: "+2 credits", detail: "Someone left a voice reply on your drop" },
    { icon: "▶", label: "Reach 50 plays", credit: "+3 credits", detail: "Your drop hit 50 total plays" },
    { icon: "✦", label: "Reach 100 plays", credit: "+5 credits", detail: "Your drop hit 100 total plays" },
    { icon: "★", label: "Daily drop", credit: "+1 credit", detail: "Drop at least once a day for 7 days" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 80, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: C.bg, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxHeight: "80vh", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim }}>YOUR BALANCE</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: C.green }}>{credits} <span style={{ fontSize: 14, fontWeight: 400 }}>credits</span></div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 12 }}>HOW TO EARN</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ways.map(({ icon, label, credit, detail }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, background: C.panel2, borderRadius: 14, padding: "14px 16px", border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 20, width: 28, textAlign: "center", flexShrink: 0 }}>{icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{label}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{detail}</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: C.green, flexShrink: 0 }}>{credit}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   OnboardingTour — first-time walk-through overlay (3 steps)
   ---------------------------------------------------------------------------- */
function OnboardingTour({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: "◉",
      title: "Your feed is your block",
      body: "Nearhum shows voice drops from people near you — sorted by distance, not algorithm. The closer the drop, the higher it floats.",
      color: C.green,
    },
    {
      icon: "●",
      title: "Drop your voice",
      body: "Tap the big + button to record up to 15 seconds. Title it, give it a mood, and drop it. Your voice hits the feed instantly.",
      color: MOOD.raw,
    },
    {
      icon: "♥",
      title: "React, reply, connect",
      body: "React with ♥ Felt, ◎ Same, or ✦ Loud. Leave a voice reply. Everything is ephemeral — drops vanish in 24 hours.",
      color: MOOD.soft,
    },
  ];

  const cur = steps[step];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ maxWidth: 340, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 24, color: cur.color }}>{cur.icon}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 14 }}>{cur.title}</div>
        <div style={{ fontSize: 15, color: C.dim, lineHeight: 1.7, marginBottom: 40 }}>{cur.body}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 32 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? cur.color : C.line, transition: "width 0.3s" }} />
          ))}
        </div>
        <button
          onClick={() => { if (step < steps.length - 1) setStep(step + 1); else onDone(); }}
          style={{ width: "100%", padding: "16px 0", borderRadius: 16, background: cur.color, color: "#000", fontFamily: MONO, fontSize: 13, letterSpacing: 2, fontWeight: 700, border: "none", cursor: "pointer" }}
        >
          {step < steps.length - 1 ? "NEXT →" : "LET'S GO"}
        </button>
        {step < steps.length - 1 && (
          <button onClick={onDone} style={{ marginTop: 14, background: "none", border: "none", color: C.dim, fontFamily: MONO, fontSize: 11, cursor: "pointer", letterSpacing: 1 }}>
            SKIP TOUR
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   DropCard — the main feed card (full swipeable card with expanded info)
   ---------------------------------------------------------------------------- */
function DropCard({ p, isActive, onPlay, userReact, onReact, onSave, saved, onShare, onProfile, onReply }: {
  p: typeof SEED[0]; isActive: boolean; onPlay: () => void;
  userReact: string | undefined; onReact: (k: string) => void;
  onSave: () => void; saved: boolean; onShare: () => void;
  onProfile: () => void; onReply: () => void;
}) {
  const mc = MOOD[p.mood];
  const [showInfo, setShowInfo] = useState(false);
  const totalReacts = p.reacts.felt + p.reacts.same + p.reacts.loud;

  return (
    <div style={{ background: C.panel2, borderRadius: 20, border: `1px solid ${isActive ? mc : C.line}`, padding: "16px", marginBottom: 10, transition: "border-color 0.2s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <button onClick={onProfile} style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${mc}`, background: hexA(mc, "15"), color: mc, fontWeight: 700, fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {p.handle.charAt(0).toUpperCase()}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={onProfile} style={{ background: "none", border: "none", fontFamily: MONO, fontSize: 11, color: C.dim, cursor: "pointer", padding: 0 }}>@{p.handle}</button>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.line }}>·</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.dist}</span>
            <TrendingBadge ping={p} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 1 }}>{p.mood}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{fmtSecs(p.secs)}</span>
        </div>
      </div>
      <button onClick={onPlay} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: hexA(mc, "0F"), border: `1px solid ${isActive ? mc : hexA(mc, "30")}`, borderRadius: 14, padding: "10px 14px", cursor: "pointer", marginBottom: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${mc}`, background: isActive ? mc : "transparent", color: isActive ? C.bg : mc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>
          {isActive ? "❚❚" : "▶"}
        </div>
        <Wave n={24} active={isActive} color={mc} seed={p.id.length * 7} />
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, flexShrink: 0 }}>{p.plays} plays</div>
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {[{ k: "felt", icon: "♥" }, { k: "same", icon: "◎" }, { k: "loud", icon: "✦" }].map(({ k, icon }) => (
          <button key={k} onClick={() => onReact(k)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 99, border: `1px solid ${userReact === k ? mc : C.line}`, background: userReact === k ? hexA(mc, "22") : "transparent", color: userReact === k ? mc : C.dim, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
            {icon} <span>{p.reacts[k as keyof typeof p.reacts]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onReply} style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>↩</button>
        <button onClick={onSave} style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${saved ? C.green : C.line}`, background: saved ? hexA(C.green, "22") : "none", color: saved ? C.green : C.dim, cursor: "pointer", fontSize: 13 }}>◎</button>
        <button onClick={onShare} style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>↗</button>
        <button onClick={() => setShowInfo((v) => !v)} style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>⋯</button>
      </div>
      {showInfo && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: C.bg, borderRadius: 12, border: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>Total reactions</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.text }}>{totalReacts}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>Replies</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.text }}>{p.replies.length}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>Expires in</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: mc }}>{p.ttl.toFixed(1)}h</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   AchievementToast — animated banner for unlocking an achievement
   ---------------------------------------------------------------------------- */
function AchievementToast({ achievement, onDone }: { achievement: { icon: string; title: string; detail: string } | null; onDone: () => void }) {
  useEffect(() => {
    if (!achievement) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [achievement, onDone]);

  if (!achievement) return null;

  return (
    <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 300, background: "linear-gradient(135deg, #1A1A2E, #16213E)", border: `1px solid ${C.green}`, borderRadius: 16, padding: "14px 20px", display: "flex", alignItems: "center", gap: 14, boxShadow: `0 4px 24px ${hexA(C.green, "40")}`, minWidth: 280, animation: "toastIn 0.3s ease" }}>
      <div style={{ fontSize: 28 }}>{achievement.icon}</div>
      <div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.green, letterSpacing: 2, marginBottom: 2 }}>ACHIEVEMENT UNLOCKED</div>
        <div style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{achievement.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{achievement.detail}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   YouTab — enhanced profile / you tab with achievements and stats
   ---------------------------------------------------------------------------- */
function YouTab({ handle, credits, pings, saved, activity, onOpenSaved, onOpenLeaderboard, onOpenHelp, onSignOut, onOpenNotifSettings, onEarnCredits }: {
  handle: string; credits: number; pings: typeof SEED; saved: string[];
  activity: typeof ACTIVITY_SEED; onOpenSaved: () => void;
  onOpenLeaderboard: () => void; onOpenHelp: () => void; onSignOut: () => void;
  onOpenNotifSettings: () => void; onEarnCredits: () => void;
}) {
  const myDrops = pings.filter((p) => p.handle === handle);
  const totalPlays = myDrops.reduce((s, p) => s + p.plays, 0);
  const totalReacts = myDrops.reduce((s, p) => s + p.reacts.felt + p.reacts.same + p.reacts.loud, 0);
  const moodCounts: Record<string, number> = {};
  myDrops.forEach((p) => { moodCounts[p.mood] = (moodCounts[p.mood] || 0) + 1; });
  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];
  const mc = topMood ? (MOOD[topMood[0] as keyof typeof MOOD] ?? C.green) : C.green;

  const achievements = [
    { icon: "🎙️", title: "First Drop", detail: "You dropped your first voice", earned: myDrops.length >= 1 },
    { icon: "🔥", title: "On Fire", detail: "5 drops in one day", earned: myDrops.length >= 5 },
    { icon: "💫", title: "100 Plays", detail: "Your drops hit 100 total plays", earned: totalPlays >= 100 },
    { icon: "❤️", title: "Felt", detail: "Received 10 Felt reactions", earned: myDrops.reduce((s, p) => s + p.reacts.felt, 0) >= 10 },
    { icon: "🏆", title: "Top Voice", detail: "Reached the leaderboard top 3", earned: false },
    { icon: "🌍", title: "Wide Reach", detail: "Drops heard in 3+ cities", earned: false },
  ];

  return (
    <div style={{ padding: "16px", overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: 99, border: `2px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: mc, flexShrink: 0 }}>
          {handle.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>@{handle}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{myDrops.length} drops · {totalPlays} plays</div>
        </div>
        <button onClick={onEarnCredits} style={{ marginLeft: "auto", padding: "8px 14px", borderRadius: 99, border: `1px solid ${C.green}`, background: hexA(C.green, "1A"), color: C.green, fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>
          {credits} ◈
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {[
          { label: "DROPS", value: myDrops.length, color: mc },
          { label: "PLAYS", value: totalPlays, color: C.green },
          { label: "REACTS", value: totalReacts, color: MOOD.soft },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: C.panel2, borderRadius: 14, padding: "12px 8px", textAlign: "center", border: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>ACHIEVEMENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
        {achievements.map(({ icon, title, detail, earned }) => (
          <div key={title} style={{ background: C.panel2, borderRadius: 14, padding: "12px", border: `1px solid ${earned ? C.green : C.line}`, opacity: earned ? 1 : 0.4 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
            <div style={{ color: earned ? C.text : C.dim, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{detail}</div>
          </div>
        ))}
      </div>
      {topMood && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>YOUR MOOD MIX</div>
          {Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).map(([mood, count]) => (
            <div key={mood} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: MOOD[mood as keyof typeof MOOD] }}>{mood}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{count} drop{count !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ height: 3, background: C.panel2, borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${(count / myDrops.length) * 100}%`, background: MOOD[mood as keyof typeof MOOD], borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>QUICK LINKS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {[
          { icon: "◎", label: `Saved Drops (${saved.length})`, action: onOpenSaved },
          { icon: "★", label: "Leaderboard", action: onOpenLeaderboard },
          { icon: "🔔", label: "Notification Settings", action: onOpenNotifSettings },
          { icon: "?", label: "Help & FAQ", action: onOpenHelp },
          { icon: "→", label: "Sign Out", action: onSignOut, danger: true },
        ].map(({ icon, label, action, danger }) => (
          <button key={label} onClick={action} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", color: danger ? C.red : C.text, textAlign: "left", width: "100%" }}>
            <span style={{ width: 24, textAlign: "center", color: danger ? C.red : C.dim, fontSize: 14 }}>{icon}</span>
            <span style={{ fontSize: 15 }}>{label}</span>
            <span style={{ marginLeft: "auto", color: C.dim, fontSize: 12 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   NearbyNowWidget — animated indicator of live activity in the area
   ---------------------------------------------------------------------------- */
function NearbyNowWidget({ pings }: { pings: typeof SEED }) {
  const recentCount = pings.filter((p) => {
    try { return (Date.now() - new Date(p.id).getTime()) < 3600000; } catch { return false; }
  }).length;
  const total = pings.length;
  if (total === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: hexA(C.green, "0D"), border: `1px solid ${hexA(C.green, "30")}`, borderRadius: 14, marginBottom: 14 }}>
      <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 99, background: C.green, animation: "pulse 2s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: -4, borderRadius: 99, border: `1px solid ${C.green}`, opacity: 0.4, animation: "pulse 2s ease-in-out infinite 0.5s" }} />
      </div>
      <div style={{ flex: 1 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.green, letterSpacing: 0.5 }}>
          {total} voice{total !== 1 ? "s" : ""} live near you
        </span>
        {recentCount > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}> · {recentCount} in the last hour</span>
        )}
      </div>
      <div style={{ display: "flex", gap: -4 }}>
        {[...Array(Math.min(4, total))].map((_, i) => (
          <div key={i} style={{ width: 20, height: 20, borderRadius: 99, border: `1.5px solid ${C.bg}`, background: Object.values(MOOD)[i % Object.values(MOOD).length], marginLeft: i > 0 ? -6 : 0, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", color: C.bg, fontWeight: 700 }}>
            {pings[i]?.handle?.charAt(0).toUpperCase() ?? "?"}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   TTLBar — time-to-live countdown bar for a drop
   ---------------------------------------------------------------------------- */
function TTLBar({ ttl, color }: { ttl: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (ttl / 24) * 100));
  const urgent = ttl < 3;
  const barColor = urgent ? C.red : color;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1 }}>EXPIRES</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: urgent ? C.red : C.dim }}>{ttl < 1 ? `${Math.round(ttl * 60)}m` : `${ttl.toFixed(1)}h`}</span>
      </div>
      <div style={{ height: 2, background: C.panel2, borderRadius: 1 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 1, transition: "width 1s linear" }} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   ReportSheet — report a drop for content violations
   ---------------------------------------------------------------------------- */
function ReportSheet({ ping, onClose, onReport }: { ping: typeof SEED[0]; onClose: () => void; onReport: (reason: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const reasons = [
    { key: "spam", label: "Spam or fake voice", icon: "🚫" },
    { key: "harassment", label: "Harassment or threats", icon: "⚠️" },
    { key: "hate", label: "Hate speech", icon: "🛑" },
    { key: "explicit", label: "Explicit content", icon: "🔞" },
    { key: "misinformation", label: "Misinformation", icon: "❌" },
    { key: "other", label: "Something else", icon: "…" },
  ];

  if (submitted) {
    return (
      <Sheet onClose={onClose} accent={C.red}>
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>Report submitted</div>
          <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6 }}>We review all reports within 24 hours. If this drop violates our rules, it will be removed.</div>
          <button onClick={onClose} style={{ marginTop: 24, padding: "12px 28px", borderRadius: 99, background: C.green, color: C.bg, border: "none", fontFamily: MONO, fontSize: 12, letterSpacing: 1, cursor: "pointer" }}>DONE</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} accent={C.red}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>REPORT</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>"{ping.title}"</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 20 }}>by @{ping.handle}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>WHY ARE YOU REPORTING THIS?</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {reasons.map(({ key, label, icon }) => (
          <button key={key} onClick={() => setSelected(key)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: selected === key ? hexA(C.red, "15") : C.panel2, border: `1px solid ${selected === key ? C.red : C.line}`, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span style={{ color: C.text, fontSize: 14 }}>{label}</span>
            {selected === key && <span style={{ marginLeft: "auto", color: C.red, fontSize: 14 }}>●</span>}
          </button>
        ))}
      </div>
      <button
        disabled={!selected}
        onClick={() => { if (selected) { onReport(selected); setSubmitted(true); } }}
        style={{ width: "100%", padding: "16px 0", borderRadius: 14, background: selected ? C.red : C.panel2, color: selected ? C.text : C.dim, border: "none", fontFamily: MONO, fontSize: 12, letterSpacing: 1.5, cursor: selected ? "pointer" : "default" }}
      >
        SUBMIT REPORT
      </button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   DraftsSheet — save a recording before publishing
   ---------------------------------------------------------------------------- */
type Draft = { id: string; title: string; mood: string; secs: number; audioUrl: string; savedAt: string };

function DraftsSheet({ drafts, onClose, onPublish, onDelete }: {
  drafts: Draft[]; onClose: () => void;
  onPublish: (d: Draft) => void; onDelete: (id: string) => void;
}) {
  return (
    <Sheet onClose={onClose} accent={C.amber}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>DRAFTS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Saved Recordings</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {drafts.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.dim }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◌</div>
            <div style={{ fontSize: 14 }}>No saved drafts.</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 6 }}>Record a drop and save it before publishing.</div>
          </div>
        )}
        {drafts.map((d) => {
          const mc = MOOD[d.mood as keyof typeof MOOD] ?? C.green;
          return (
            <div key={d.id} style={{ background: C.panel2, borderRadius: 14, padding: 14, marginBottom: 10, border: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: mc, flexShrink: 0, marginTop: 6 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title || "(untitled)"}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{d.mood} · {fmtSecs(d.secs)} · saved {timeAgo(d.savedAt)}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onPublish(d)} style={{ flex: 1, padding: "10px 0", borderRadius: 99, background: mc, color: C.bg, border: "none", fontFamily: MONO, fontSize: 11, letterSpacing: 1, cursor: "pointer", fontWeight: 700 }}>PUBLISH</button>
                <button onClick={() => onDelete(d.id)} style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.red, cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   FollowingSheet — feed of drops from followed handles
   ---------------------------------------------------------------------------- */
function FollowingSheet({ following, pings, onClose, onSelect }: {
  following: string[]; pings: typeof SEED; onClose: () => void;
  onSelect: (idx: number) => void;
}) {
  const drops = pings.filter((p) => following.includes(p.handle));

  return (
    <Sheet onClose={onClose} accent={C.violet}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>FEED</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Following</div>
      {following.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.dim }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◎</div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>You don&apos;t follow anyone yet.</div>
          <div style={{ fontFamily: MONO, fontSize: 11 }}>Tap a handle to visit their profile and follow.</div>
        </div>
      ) : drops.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.dim, fontSize: 14 }}>No drops from people you follow yet.</div>
      ) : (
        <div style={{ overflowY: "auto", flex: 1 }}>
          {drops.map((p) => {
            const mc = MOOD[p.mood];
            const origIdx = pings.findIndex((x) => x.id === p.id);
            return (
              <button key={p.id} onClick={() => { onSelect(origIdx); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 36, height: 36, borderRadius: 99, border: `1px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", color: mc, fontWeight: 700, flexShrink: 0 }}>
                  {p.handle.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>@{p.handle} · {p.dist} · {fmtSecs(p.secs)}</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: mc, flexShrink: 0 }}>{p.mood}</div>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   CommunityRulesSheet — what's allowed on Nearhum
   ---------------------------------------------------------------------------- */
function CommunityRulesSheet({ onClose }: { onClose: () => void }) {
  const rules = [
    { num: "01", title: "Be real", body: "Drop your actual voice. No bots, no text-to-speech, no pre-recorded scripts masquerading as spontaneous thought." },
    { num: "02", title: "Be local", body: "Drops are meant for your block. Don't use a VPN or fake location to appear in a city you're not in." },
    { num: "03", title: "No hate speech", body: "Drops targeting people based on race, gender, sexuality, religion, or disability will be removed immediately." },
    { num: "04", title: "No harassment", body: "Don't use voice replies to harass, intimidate, or repeatedly target another user." },
    { num: "05", title: "No spam", body: "Don't flood the feed with back-to-back drops to crowd out other voices in an area." },
    { num: "06", title: "Protect minors", body: "No content that sexualizes or endangers children. This is a permanent ban with no appeal." },
    { num: "07", title: "One account per person", body: "Don't create multiple accounts to evade a ban or manipulate reactions." },
    { num: "08", title: "Remember: it expires", body: "Drops vanish in 24 hours. We still keep logs for moderation. Ephemeral doesn't mean anonymous." },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>NEARHUM</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>Community Rules</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 20 }}>Last updated June 2026</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {rules.map(({ num, title, body }) => (
          <div key={num} style={{ display: "flex", gap: 14, paddingBottom: 18, marginBottom: 18, borderBottom: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.green, flexShrink: 0, paddingTop: 2 }}>{num}</div>
            <div>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{title}</div>
              <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6 }}>{body}</div>
            </div>
          </div>
        ))}
        <div style={{ background: C.panel2, borderRadius: 14, padding: 16, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 8 }}>ENFORCEMENT</div>
          <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6 }}>Violations result in drop removal, temporary suspension, or permanent ban depending on severity. Appeals go to rules@nearhum.app.</div>
        </div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   StreakCard — consecutive-day dropping streak tracker
   ---------------------------------------------------------------------------- */
function StreakCard({ streak, bestStreak }: { streak: number; bestStreak: number }) {
  if (streak === 0) return null;
  const color = streak >= 7 ? C.amber : streak >= 3 ? C.greenSoft : C.dim;

  return (
    <div style={{ background: `linear-gradient(135deg, ${hexA(color, "15")}, ${C.panel2})`, border: `1px solid ${hexA(color, "40")}`, borderRadius: 16, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ fontSize: 32 }}>{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "📅"}</div>
      <div style={{ flex: 1 }}>
        <div style={{ color, fontSize: 22, fontWeight: 700, fontFamily: MONO }}>{streak} day streak</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>Best: {bestStreak} days · keep dropping daily</div>
      </div>
      {streak >= 7 && (
        <div style={{ background: hexA(C.amber, "22"), border: `1px solid ${C.amber}`, borderRadius: 99, padding: "4px 10px", fontFamily: MONO, fontSize: 9, color: C.amber, letterSpacing: 1 }}>ON FIRE</div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   WelcomeBanner — shown to new users on first login
   ---------------------------------------------------------------------------- */
function WelcomeBanner({ handle, onDismiss }: { handle: string; onDismiss: () => void }) {
  return (
    <div style={{ background: `linear-gradient(135deg, ${hexA(C.green, "20")}, ${hexA(C.violet, "15")})`, border: `1px solid ${hexA(C.green, "40")}`, borderRadius: 18, padding: "18px 16px", marginBottom: 16, position: "relative" }}>
      <button onClick={onDismiss} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14 }}>✕</button>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.green, marginBottom: 6 }}>WELCOME TO NEARHUM</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8 }}>Hey @{handle} 👋</div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>You just joined the local voice. Drop something — anything — and let your neighbors hear you. You have 8 free credits to start.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, background: hexA(C.green, "1A"), border: `1px solid ${hexA(C.green, "40")}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 18, color: C.green, fontWeight: 700 }}>8</div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1 }}>FREE CREDITS</div>
        </div>
        <div style={{ flex: 1, background: hexA(C.violet, "1A"), border: `1px solid ${hexA(C.violet, "40")}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 18, color: C.violet, fontWeight: 700 }}>15s</div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1 }}>MAX DROP</div>
        </div>
        <div style={{ flex: 1, background: hexA(C.amber, "1A"), border: `1px solid ${hexA(C.amber, "40")}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 18, color: C.amber, fontWeight: 700 }}>24h</div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1 }}>TTL</div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   DiscoverSection — drops from outside your usual area
   ---------------------------------------------------------------------------- */
function DiscoverSection({ pings, onSelect }: { pings: typeof SEED; onSelect: (idx: number) => void }) {
  const picks = [...pings].sort((a, b) => b.plays - a.plays).slice(0, 5);
  if (picks.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim }}>DISCOVER</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.green }}>top voices</div>
      </div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {picks.map((p) => {
          const mc = MOOD[p.mood];
          const origIdx = pings.findIndex((x) => x.id === p.id);
          return (
            <button key={p.id} onClick={() => onSelect(origIdx)} style={{ flexShrink: 0, width: 140, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 12px", cursor: "pointer", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: mc, flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 9, color: mc, letterSpacing: 1 }}>{p.mood.toUpperCase()}</span>
              </div>
              <div style={{ color: C.text, fontSize: 13, fontWeight: 700, lineHeight: 1.3, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.title}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>@{p.handle}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{p.plays} plays · {p.dist}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   FeaturedDropCard — pinned / highlighted drop with larger display
   ---------------------------------------------------------------------------- */
function FeaturedDropCard({ p, onPlay, isActive }: { p: typeof SEED[0]; onPlay: () => void; isActive: boolean }) {
  const mc = MOOD[p.mood];
  const totalReacts = p.reacts.felt + p.reacts.same + p.reacts.loud;

  return (
    <div style={{ background: `linear-gradient(160deg, ${hexA(mc, "18")}, ${C.panel2})`, border: `1px solid ${hexA(mc, "50")}`, borderRadius: 20, padding: "18px 16px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: 99, background: hexA(mc, "0A"), pointerEvents: "none" }} />
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: mc, marginBottom: 8 }}>FEATURED DROP</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 6, lineHeight: 1.2 }}>{p.title}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: mc }}>{p.mood}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>@{p.handle}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>·</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.dist}</span>
      </div>
      <button onClick={onPlay} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: hexA(mc, "15"), border: `1px solid ${isActive ? mc : hexA(mc, "40")}`, borderRadius: 14, padding: "12px 16px", cursor: "pointer", marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 99, border: `1.5px solid ${mc}`, background: isActive ? mc : "transparent", color: isActive ? C.bg : mc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
          {isActive ? "❚❚" : "▶"}
        </div>
        <Wave n={28} active={isActive} color={mc} seed={p.id.length * 13} />
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{fmtSecs(p.secs)}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: mc }}>{p.plays} ▶</div>
        </div>
      </button>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>♥ {p.reacts.felt}</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>◎ {p.reacts.same}</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>✦ {p.reacts.loud}</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{totalReacts} reactions</div>
      </div>
      <TTLBar ttl={p.ttl} color={mc} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   EmptyFeedCTA — shown when the feed is empty, encourages first drop
   ---------------------------------------------------------------------------- */
function EmptyFeedCTA({ onDrop, handle }: { onDrop: () => void; handle: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 16px" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>◉</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }}>The block is quiet.</div>
      <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.7, marginBottom: 28, maxWidth: 280, margin: "0 auto 28px" }}>
        No one near @{handle} has dropped yet. Be the first voice on this block and give your neighbors something to hear.
      </div>
      <button onClick={onDrop} style={{ padding: "16px 32px", borderRadius: 99, background: C.green, color: C.bg, border: "none", fontFamily: MONO, fontSize: 13, letterSpacing: 2, fontWeight: 700, cursor: "pointer", boxShadow: `0 8px 24px ${hexA(C.green, "44")}` }}>
        ＋ DROP YOUR VOICE
      </button>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 14, letterSpacing: 1 }}>1 credit · 15 seconds · 24 hours</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   MapProximityDot — SVG proximity radar (no external map API)
   ---------------------------------------------------------------------------- */
function MapProximityDot({ pings }: { pings: typeof SEED }) {
  const size = 200;
  const center = size / 2;
  const maxR = center - 16;

  const dots = pings.slice(0, 12).map((p, i) => {
    const distStr = p.dist;
    const mi = distStr === "on your block" ? 0.03 : parseFloat(distStr) || 0.5;
    const r = Math.min(mi * 30, maxR);
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return { x, y, color: MOOD[p.mood], handle: p.handle, id: p.id };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 12 }}>VOICE PROXIMITY</div>
      <svg width={size} height={size} style={{ display: "block" }}>
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <circle key={scale} cx={center} cy={center} r={maxR * scale} fill="none" stroke={C.line} strokeWidth={0.5} />
        ))}
        <circle cx={center} cy={center} r={6} fill={C.green} />
        <circle cx={center} cy={center} r={3} fill={C.bg} />
        {dots.map((d) => (
          <g key={d.id}>
            <circle cx={d.x} cy={d.y} r={5} fill={d.color} opacity={0.85} />
            <text x={d.x + 7} y={d.y + 4} fontSize={8} fill={C.dim} fontFamily={MONO}>@{d.handle.slice(0, 6)}</text>
          </g>
        ))}
        <text x={center - 12} y={center - maxR - 5} fontSize={8} fill={C.dim} fontFamily={MONO}>far</text>
        <text x={center - 14} y={center + 12} fontSize={8} fill={C.green} fontFamily={MONO}>YOU</text>
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
        {Object.entries(MOOD).slice(0, 5).map(([mood, color]) => (
          <div key={mood} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: color, display: "inline-block" }} />
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>{mood}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceMoodRing — circular chart of moods in current feed
   ---------------------------------------------------------------------------- */
function VoiceMoodRing({ pings }: { pings: typeof SEED }) {
  if (pings.length === 0) return null;
  const counts: Record<string, number> = {};
  pings.forEach((p) => { counts[p.mood] = (counts[p.mood] || 0) + 1; });
  const total = pings.length;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const size = 140;
  const r = 54;
  const stroke = 14;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = entries.map(([mood, count]) => {
    const pct = count / total;
    const dash = pct * circumference;
    const arc = { mood, color: MOOD[mood as keyof typeof MOOD] ?? C.green, dash, offset, pct };
    offset += dash;
    return arc;
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 18, padding: "16px", marginBottom: 16 }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth={stroke} />
          {arcs.map(({ mood, color, dash, offset: off }) => (
            <circle key={mood} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-off} strokeLinecap="round" />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: C.text }}>{total}</div>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.dim, letterSpacing: 1 }}>DROPS</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: C.dim, marginBottom: 10 }}>MOOD MIX</div>
        {entries.slice(0, 5).map(([mood, count]) => (
          <div key={mood} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: MOOD[mood as keyof typeof MOOD], flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, flex: 1 }}>{mood}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.text }}>{Math.round((count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   HeatmapBar — hourly activity heatmap for the current day
   ---------------------------------------------------------------------------- */
function HeatmapBar({ pings }: { pings: typeof SEED }) {
  const hours = Array(24).fill(0) as number[];
  pings.forEach((p) => {
    try {
      const h = new Date(p.id).getHours();
      if (h >= 0 && h < 24) hours[h]++;
    } catch { /* ignore */ }
  });
  const maxVal = Math.max(...hours, 1);
  const now = new Date().getHours();

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 10 }}>DROP ACTIVITY — TODAY</div>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 40 }}>
        {hours.map((count, h) => {
          const pct = count / maxVal;
          const isNow = h === now;
          return (
            <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ width: "100%", height: 36, display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: "100%", height: `${Math.max(4, pct * 100)}%`, background: isNow ? C.green : hexA(C.green, "44"), borderRadius: "2px 2px 0 0", transition: "height 0.3s" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>12a</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.green }}>now</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>11p</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   PulseSection — live feed of the most recent single drop (push feel)
   ---------------------------------------------------------------------------- */
function PulseSection({ pings, onPlay }: { pings: typeof SEED; onPlay: (idx: number) => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const latest = pings.slice(0, 5);

  useEffect(() => {
    if (latest.length <= 1) return;
    const i = setInterval(() => setCurrentIdx((x) => (x + 1) % latest.length), 5000);
    return () => clearInterval(i);
  }, [latest.length]);

  if (latest.length === 0) return null;
  const p = latest[currentIdx];
  const mc = MOOD[p.mood];
  const origIdx = pings.findIndex((x) => x.id === p.id);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: C.red, animation: "pulse 1.5s infinite" }} />
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim }}>LIVE NOW</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {latest.map((_, i) => (
            <button key={i} onClick={() => setCurrentIdx(i)} style={{ width: i === currentIdx ? 16 : 6, height: 6, borderRadius: 3, background: i === currentIdx ? mc : C.line, border: "none", cursor: "pointer", transition: "width 0.3s, background 0.3s" }} />
          ))}
        </div>
      </div>
      <button onClick={() => onPlay(origIdx)} style={{ width: "100%", background: `linear-gradient(135deg, ${hexA(mc, "18")}, ${C.panel2})`, border: `1px solid ${hexA(mc, "50")}`, borderRadius: 18, padding: "16px", cursor: "pointer", textAlign: "left", transition: "all 0.4s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: 99, background: mc }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 1 }}>{p.mood.toUpperCase()}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>@{p.handle}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>·</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.dist}</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 10 }}>{p.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", color: mc, fontSize: 12 }}>▶</div>
          <Wave n={22} active={false} color={mc} seed={p.id.length * 5} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginLeft: "auto" }}>{fmtSecs(p.secs)}</span>
        </div>
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   InboxBadge — notification dot used in TabBar (already wired, this is utility)
   ---------------------------------------------------------------------------- */
function InboxCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div style={{ position: "absolute", top: -4, right: -4, width: count > 9 ? 18 : 14, height: 14, borderRadius: 7, background: C.red, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 8, color: C.text, fontWeight: 700 }}>
      {count > 9 ? "9+" : count}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceSpeedSettings — playback speed controls for audio
   ---------------------------------------------------------------------------- */
function VoiceSpeedControls({ speed, onChange }: { speed: number; onChange: (s: number) => void }) {
  const speeds = [0.75, 1, 1.25, 1.5, 2];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1 }}>SPEED</span>
      {speeds.map((s) => (
        <button key={s} onClick={() => onChange(s)} style={{ padding: "4px 8px", borderRadius: 6, fontFamily: MONO, fontSize: 10, border: `1px solid ${s === speed ? C.green : C.line}`, background: s === speed ? hexA(C.green, "22") : "transparent", color: s === speed ? C.green : C.dim, cursor: "pointer" }}>
          {s}×
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   EarlyAccessBadge — special badge for first N users
   ---------------------------------------------------------------------------- */
function EarlyAccessBadge({ uid }: { uid: string }) {
  if (!uid) return null;
  const early = parseInt(uid.slice(-4), 16) % 1000 < 100;
  if (!early) return null;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `linear-gradient(90deg, ${hexA(C.amber, "20")}, ${hexA(C.violet, "20")})`, border: `1px solid ${C.amber}`, borderRadius: 99, padding: "3px 10px" }}>
      <span style={{ fontSize: 10 }}>⭐</span>
      <span style={{ fontFamily: MONO, fontSize: 9, color: C.amber, letterSpacing: 1 }}>EARLY ACCESS</span>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   RecordingTimerRing — circular SVG timer shown while recording
   ---------------------------------------------------------------------------- */
function RecordingTimerRing({ elapsed, max, color }: { elapsed: number; max: number; color: string }) {
  const size = 80;
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const progress = elapsed / max;
  const dash = progress * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeDasharray={`${dash} ${circumference - dash}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.5s linear" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 14, fontWeight: 700, color }}>
        {elapsed}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   DropHistoryCard — compact card used in profile history lists
   ---------------------------------------------------------------------------- */
function DropHistoryCard({ p, onPlay }: { p: typeof SEED[0]; onPlay: () => void }) {
  const mc = MOOD[p.mood];
  const totalReacts = p.reacts.felt + p.reacts.same + p.reacts.loud;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
      <button onClick={onPlay} style={{ width: 36, height: 36, borderRadius: 99, border: `1px solid ${mc}`, background: hexA(mc, "15"), color: mc, fontSize: 12, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.text, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: mc }}>{p.mood}</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>{fmtSecs(p.secs)}</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>{p.dist}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{p.plays} ▶</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{totalReacts} ♥</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   QuickMoodDrop — one-tap mood + record shortcut from the feed
   ---------------------------------------------------------------------------- */
function QuickMoodStrip({ onPickMood }: { onPickMood: (mood: string) => void }) {
  const moods = Object.entries(MOOD);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: C.dim, marginBottom: 8 }}>HOW ARE YOU FEELING?</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
        {moods.map(([mood, color]) => (
          <button key={mood} onClick={() => onPickMood(mood)} style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 99, background: hexA(color, "15"), border: `1px solid ${hexA(color, "50")}`, color, fontFamily: MONO, fontSize: 11, cursor: "pointer", letterSpacing: 0.5 }}>
            {mood}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   TipJarSheet — send credits to a voice you appreciated
   ---------------------------------------------------------------------------- */
function TipJarSheet({ ping, myCredits, onClose, onTip }: {
  ping: typeof SEED[0]; myCredits: number; onClose: () => void;
  onTip: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(1);
  const [sent, setSent] = useState(false);
  const mc = MOOD[ping.mood];
  const presets = [1, 2, 5, 10];

  if (sent) {
    return (
      <Sheet onClose={onClose} accent={mc}>
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>◆</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8 }}>Tip sent!</div>
          <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6 }}>
            You sent {amount} credit{amount !== 1 ? "s" : ""} to @{ping.handle}.<br />
            They&apos;ll see it in their activity.
          </div>
          <button onClick={onClose} style={{ marginTop: 28, padding: "12px 32px", borderRadius: 99, background: mc, color: C.bg, border: "none", fontFamily: MONO, fontSize: 12, letterSpacing: 1, cursor: "pointer", fontWeight: 700 }}>DONE</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} accent={mc}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>TIP A VOICE</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: 99, border: `1.5px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", color: mc, fontSize: 18, fontWeight: 700 }}>
          {ping.handle.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>@{ping.handle}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 2, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ping.title}</div>
        </div>
      </div>
      <div style={{ background: C.panel2, borderRadius: 14, padding: "14px 16px", marginBottom: 18, border: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>YOUR BALANCE</span>
        <span style={{ fontFamily: MONO, fontSize: 16, color: C.green, fontWeight: 700 }}>◆ {myCredits}</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>CHOOSE AMOUNT</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {presets.map((p) => (
          <button key={p} onClick={() => setAmount(p)} style={{ padding: "14px 0", borderRadius: 14, fontFamily: MONO, fontSize: 16, fontWeight: 700, border: `1px solid ${amount === p ? mc : C.line}`, background: amount === p ? hexA(mc, "22") : C.panel2, color: amount === p ? mc : C.dim, cursor: "pointer" }}>
            ◆ {p}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>CUSTOM:</span>
        <input
          type="number" min={1} max={myCredits} value={amount}
          onChange={(e) => setAmount(Math.max(1, Math.min(myCredits, parseInt(e.target.value) || 1)))}
          style={{ flex: 1, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px", color: C.text, fontFamily: MONO, fontSize: 14, outline: "none" }}
        />
      </div>
      <button
        disabled={myCredits < amount}
        onClick={() => { onTip(amount); setSent(true); }}
        style={{ width: "100%", padding: "16px 0", borderRadius: 14, background: myCredits >= amount ? mc : C.line, color: myCredits >= amount ? C.bg : C.dim, border: "none", fontFamily: MONO, fontSize: 13, letterSpacing: 1.5, cursor: myCredits >= amount ? "pointer" : "default", fontWeight: 700 }}
      >
        SEND ◆ {amount} {amount !== 1 ? "CREDITS" : "CREDIT"}
      </button>
      {myCredits < amount && <div style={{ fontFamily: MONO, fontSize: 10, color: C.red, textAlign: "center", marginTop: 8 }}>Not enough credits.</div>}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   DropThreadView — show a drop + all its voice replies as a threaded view
   ---------------------------------------------------------------------------- */
function DropThreadView({ ping, onClose, onPlayReply, handle, uid }: {
  ping: typeof SEED[0]; onClose: () => void;
  onPlayReply: (r: typeof SEED[0]["replies"][0]) => void;
  handle: string; uid: string;
}) {
  const mc = MOOD[ping.mood];
  const totalReacts = ping.reacts.felt + ping.reacts.same + ping.reacts.loud;

  return (
    <Sheet onClose={onClose} accent={mc}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>THREAD</div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 99, border: `1.5px solid ${mc}`, display: "flex", alignItems: "center", justifyContent: "center", color: mc, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
          {ping.handle.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: mc }}>@{ping.handle}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>·</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{ping.dist}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: mc, marginLeft: "auto" }}>{ping.mood}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8 }}>{ping.title}</div>
          <div style={{ display: "flex", gap: 10, fontFamily: MONO, fontSize: 11, color: C.dim }}>
            <span>♥ {ping.reacts.felt}</span>
            <span>◎ {ping.reacts.same}</span>
            <span>✦ {ping.reacts.loud}</span>
            <span style={{ marginLeft: "auto" }}>{totalReacts} reactions</span>
          </div>
        </div>
      </div>
      <div style={{ width: 2, background: C.line, margin: "0 19px 16px", height: 20, borderRadius: 1 }} />
      {ping.replies.length === 0 && (
        <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "20px 0" }}>No replies yet. Start the thread.</div>
      )}
      {ping.replies.map((r, i) => {
        const hasAudio = !!(r as unknown as { audioUrl?: string }).audioUrl;
        return (
          <div key={r.id} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 99, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 12, flexShrink: 0, fontWeight: 700 }}>
                {r.handle.charAt(0).toUpperCase()}
              </div>
              {i < ping.replies.length - 1 && <div style={{ flex: 1, width: 1, background: C.line, minHeight: 16, marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, paddingBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{r.handle}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>·</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{r.ago}</span>
              </div>
              <button onClick={() => hasAudio ? onPlayReply(r) : undefined} style={{ display: "flex", alignItems: "center", gap: 8, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 12px", cursor: hasAudio ? "pointer" : "default", width: "100%" }}>
                <div style={{ width: 26, height: 26, borderRadius: 99, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 10, flexShrink: 0 }}>▶</div>
                <Wave n={16} active={false} color={C.dim} seed={r.id.length * 11} />
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, flexShrink: 0 }}>{fmtSecs(r.secs)}</span>
              </button>
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   VoicePodiumWidget — top 3 drops today on a podium (by plays)
   ---------------------------------------------------------------------------- */
function VoicePodiumWidget({ pings, onSelect }: { pings: typeof SEED; onSelect: (idx: number) => void }) {
  const top3 = [...pings].sort((a, b) => b.plays - a.plays).slice(0, 3);
  if (top3.length < 2) return null;
  const order = [1, 0, 2]; // podium order: 2nd, 1st, 3rd
  const heights = [80, 110, 60];
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 14 }}>TODAY&apos;S PODIUM</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170 }}>
        {order.map((rank, pos) => {
          const p = top3[rank];
          if (!p) return <div key={pos} style={{ flex: 1 }} />;
          const mc = MOOD[p.mood];
          const origIdx = pings.findIndex((x) => x.id === p.id);
          return (
            <button key={p.id} onClick={() => onSelect(origIdx)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0, background: "none", border: "none", cursor: "pointer" }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{medals[rank]}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: mc, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>@{p.handle}</div>
              <div style={{ width: "100%", height: heights[pos], background: `linear-gradient(180deg, ${hexA(mc, "40")}, ${hexA(mc, "15")})`, border: `1px solid ${hexA(mc, "60")}`, borderRadius: "8px 8px 0 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "10px 4px 0" }}>
                <div style={{ fontFamily: MONO, fontSize: 13, color: mc, fontWeight: 700 }}>{p.plays}</div>
                <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>plays</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   EndOfFeedCard — shown when user scrolls past all drops
   ---------------------------------------------------------------------------- */
function EndOfFeedCard({ total, onDrop }: { total: number; onDrop: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 16px", borderTop: `1px solid ${C.line}`, marginTop: 8 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 8 }}>YOU&apos;VE HEARD IT ALL</div>
      <div style={{ fontSize: 15, color: C.dim, marginBottom: 6 }}>{total} drop{total !== 1 ? "s" : ""} in your area.</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 24 }}>Add your voice to the block.</div>
      <button onClick={onDrop} style={{ padding: "12px 28px", borderRadius: 99, background: C.green, color: C.bg, border: "none", fontFamily: MONO, fontSize: 12, letterSpacing: 2, fontWeight: 700, cursor: "pointer" }}>＋ DROP NOW</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   AreaSpikeAlert — shows when drop activity jumps (e.g. > 5 new in 1h)
   ---------------------------------------------------------------------------- */
function AreaSpikeAlert({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  if (count < 5) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: hexA(C.amber, "15"), border: `1px solid ${hexA(C.amber, "50")}`, borderRadius: 14, padding: "10px 14px", marginBottom: 14 }}>
      <span style={{ fontSize: 18 }}>⚡</span>
      <div style={{ flex: 1 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.amber }}>Voice spike near you — {count} new drops</span>
      </div>
      <button onClick={onDismiss} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>✕</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   NearestDropBanner — highlight the single closest drop with big CTA
   ---------------------------------------------------------------------------- */
function NearestDropBanner({ p, onPlay }: { p: typeof SEED[0] | null; onPlay: () => void }) {
  if (!p || p.dist === "nearby" || parseFloat(p.dist) > 0.5) return null;
  const mc = MOOD[p.mood];
  return (
    <div style={{ background: `linear-gradient(135deg, ${hexA(mc, "20")}, ${C.panel2})`, border: `1px solid ${mc}`, borderRadius: 18, padding: "14px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: mc, letterSpacing: 1.5, marginBottom: 3 }}>ON YOUR BLOCK</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 3 }}>@{p.handle} · {p.dist}</div>
      </div>
      <button onClick={onPlay} style={{ marginLeft: "auto", width: 44, height: 44, borderRadius: 99, background: mc, border: "none", color: C.bg, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>▶</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   MiniActivityBadge — compact inline activity dot in the feed header
   ---------------------------------------------------------------------------- */
function MiniActivityBadge({ activity }: { activity: typeof ACTIVITY_SEED }) {
  const unread = activity.filter((a) => a.unread).length;
  const latest = activity[0];
  if (!latest || unread === 0) return null;
  const mc = latest.type === "react" ? C.rose : latest.type === "reply" ? C.greenSoft : C.amber;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: hexA(mc, "12"), border: `1px solid ${hexA(mc, "35")}`, borderRadius: 12, marginBottom: 12 }}>
      <div style={{ width: 6, height: 6, borderRadius: 99, background: mc, flexShrink: 0 }} />
      <div style={{ fontFamily: MONO, fontSize: 11, color: mc, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {latest.type === "react" ? `@${(latest as unknown as { who: string }).who} reacted` : latest.type === "reply" ? `@${(latest as unknown as { who: string }).who} replied` : (latest as unknown as { detail: string }).detail}
      </div>
      {unread > 1 && <div style={{ fontFamily: MONO, fontSize: 10, color: mc }}>+{unread - 1} more</div>}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   HorizontalVoiceScroll — horizontal strip of drops, used in Discover
   ---------------------------------------------------------------------------- */
function HorizontalVoiceScroll({ label, pings, onSelect }: { label: string; pings: typeof SEED; onSelect: (i: number) => void }) {
  if (pings.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {pings.map((p, i) => {
          const mc = MOOD[p.mood];
          return (
            <button key={p.id} onClick={() => onSelect(i)} style={{ flexShrink: 0, width: 120, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 10px", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: mc, marginBottom: 8 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, lineHeight: 1.3, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.title}</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>@{p.handle}</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: mc, marginTop: 2 }}>{p.plays} ▶</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   FullscreenLoadingScreen — splash shown while auth is checking
   ---------------------------------------------------------------------------- */
function FullscreenLoadingScreen() {
  const [dot, setDot] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setDot((d) => (d + 1) % 4), 400);
    return () => clearInterval(i);
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <Mark size={48} knock={C.bg} />
      <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: 4, color: C.dim }}>nearhum{".".repeat(dot)}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 6, height: 6, borderRadius: 99, background: i === dot % 3 ? C.green : C.line, transition: "background 0.3s" }} />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   PingedByWidget — "someone near you just dropped" ephemeral notification
   ---------------------------------------------------------------------------- */
function PingedByWidget({ ping, onPlay, onDismiss }: {
  ping: typeof SEED[0] | null; onPlay: () => void; onDismiss: () => void;
}) {
  useEffect(() => {
    if (!ping) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [ping, onDismiss]);

  if (!ping) return null;
  const mc = MOOD[ping.mood];

  return (
    <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 250, width: "calc(100% - 32px)", maxWidth: 420, background: C.panel2, border: `1px solid ${mc}`, borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: `0 6px 24px ${hexA(mc, "30")}`, animation: "toastIn 0.3s ease" }}>
      <div style={{ width: 8, height: 8, borderRadius: 99, background: mc, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: mc, letterSpacing: 1.5, marginBottom: 2 }}>NEW DROP {ping.dist.toUpperCase()}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ping.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 1 }}>@{ping.handle}</div>
      </div>
      <button onClick={onPlay} style={{ width: 36, height: 36, borderRadius: 99, background: mc, border: "none", color: C.bg, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>▶</button>
      <button onClick={onDismiss} style={{ width: 28, height: 28, borderRadius: 99, background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceReactionBar — expanded inline reactions with counts and animation
   ---------------------------------------------------------------------------- */
function VoiceReactionBar({ reacts, userReact, mc, onReact }: {
  reacts: { felt: number; same: number; loud: number };
  userReact: string | undefined; mc: string;
  onReact: (k: string) => void;
}) {
  const items = [
    { k: "felt", icon: "♥", label: "Felt" },
    { k: "same", icon: "◎", label: "Same" },
    { k: "loud", icon: "✦", label: "Loud" },
  ];
  const total = reacts.felt + reacts.same + reacts.loud;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {items.map(({ k, icon, label }) => {
          const count = reacts[k as keyof typeof reacts];
          const active = userReact === k;
          return (
            <button key={k} onClick={() => onReact(k)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 0", borderRadius: 14, border: `1px solid ${active ? mc : C.line}`, background: active ? hexA(mc, "20") : C.panel2, cursor: "pointer", transition: "all 0.15s" }}>
              <span style={{ fontSize: 18, filter: active ? "none" : "grayscale(0.4)" }}>{icon}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: active ? mc : C.dim, fontWeight: active ? 700 : 400 }}>{count}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 0.5 }}>{label.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
      {total > 0 && (
        <div style={{ height: 3, background: C.panel2, borderRadius: 2, overflow: "hidden", display: "flex", gap: 1 }}>
          {items.map(({ k }) => {
            const count = reacts[k as keyof typeof reacts];
            if (count === 0) return null;
            return <div key={k} style={{ flex: count, background: k === "felt" ? C.rose : k === "same" ? C.green : C.amber, transition: "flex 0.4s" }} />;
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   CreditHistorySheet — full ledger view of credit transactions
   ---------------------------------------------------------------------------- */
function CreditHistorySheet({ ledger, onClose }: {
  ledger: { label: string; delta: number }[]; onClose: () => void;
}) {
  const balance = ledger.reduce((s, e) => s + e.delta, 0);
  const earned = ledger.filter((e) => e.delta > 0).reduce((s, e) => s + e.delta, 0);
  const spent = ledger.filter((e) => e.delta < 0).reduce((s, e) => s + e.delta, 0);

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>CREDITS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 16 }}>Credit History</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {[
          { label: "BALANCE", value: balance, color: C.green },
          { label: "EARNED", value: `+${earned}`, color: C.greenSoft },
          { label: "SPENT", value: spent, color: C.amber },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: C.panel2, borderRadius: 12, padding: "12px 10px", textAlign: "center", border: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color }}>◆ {value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>TRANSACTIONS</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {ledger.length === 0 && <div style={{ textAlign: "center", color: C.dim, padding: "32px 0" }}>No transactions yet.</div>}
        {ledger.map((e, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ color: C.text, fontSize: 14 }}>{e.label}</span>
            <span style={{ fontFamily: MONO, fontSize: 13, color: e.delta > 0 ? C.green : C.amber, fontWeight: 600 }}>{e.delta > 0 ? "+" : ""}{e.delta} ◆</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   PrivacySheet — privacy settings panel
   ---------------------------------------------------------------------------- */
function PrivacySheet({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState({
    showDistance: true,
    showHandle: true,
    allowReplies: true,
    allowReactions: true,
    ghostMode: false,
  });

  const toggle = (k: keyof typeof settings) => setSettings((s) => ({ ...s, [k]: !s[k] }));

  const items = [
    { key: "showDistance" as const, label: "Show distance", detail: "Others can see how far your drops are from them" },
    { key: "showHandle" as const, label: "Show handle", detail: "Your @handle is visible on every drop" },
    { key: "allowReplies" as const, label: "Allow replies", detail: "Others can leave voice replies on your drops" },
    { key: "allowReactions" as const, label: "Allow reactions", detail: "Others can react to your drops" },
    { key: "ghostMode" as const, label: "Ghost mode", detail: "Your drops appear without any handle or location" },
  ];

  return (
    <Sheet onClose={onClose} accent={C.violet}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>SETTINGS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Privacy</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {items.map(({ key, label, detail }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{label}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 3 }}>{detail}</div>
            </div>
            <button onClick={() => toggle(key)} style={{ width: 44, height: 26, borderRadius: 13, background: settings[key] ? C.violet : C.panel2, border: `1px solid ${settings[key] ? C.violet : C.line}`, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, borderRadius: 99, background: C.text, position: "absolute", top: 2, left: settings[key] ? 20 : 2, transition: "left 0.2s" }} />
            </button>
          </div>
        ))}
        <div style={{ marginTop: 20, padding: "14px 16px", background: hexA(C.violet, "12"), border: `1px solid ${hexA(C.violet, "40")}`, borderRadius: 14 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.violet, letterSpacing: 1.5, marginBottom: 6 }}>NOTE</div>
          <div style={{ color: C.dim, fontSize: 12, lineHeight: 1.6 }}>Ghost mode hides your identity but not your voice. Drops still expire in 24 hours. We log all audio for moderation.</div>
        </div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   InviteSheet — invite a friend to Nearhum via link
   ---------------------------------------------------------------------------- */
function InviteSheet({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `https://nearhum.app/join?ref=${handle}`;
  const perks = [
    { icon: "◆", text: "You get 3 bonus credits when a friend joins" },
    { icon: "◆", text: "Friend gets 10 credits instead of 8" },
    { icon: "◆", text: "Your drops appear first in their new-user feed" },
  ];

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* silent */ }
  };

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>GROW THE HUM</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>Invite a Friend</div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>Share your referral link. Both of you get bonus credits when they sign up and drop for the first time.</div>
      {perks.map(({ icon, text }) => (
        <div key={text} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ color: C.green, fontSize: 14, flexShrink: 0 }}>{icon}</span>
          <span style={{ color: C.dim, fontSize: 13 }}>{text}</span>
        </div>
      ))}
      <div style={{ background: C.panel2, borderRadius: 14, padding: "12px 16px", marginTop: 16, marginBottom: 14, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link}</div>
        <button onClick={copy} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, background: copied ? C.green : "transparent", border: `1px solid ${copied ? C.green : C.line}`, color: copied ? C.bg : C.dim, fontFamily: MONO, fontSize: 10, cursor: "pointer", transition: "all 0.2s" }}>
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <button onClick={async () => { if (navigator.share) { try { await navigator.share({ title: "Join Nearhum", text: `@${handle} invited you to Nearhum — the local voice app`, url: link }); } catch { /* cancelled */ } } else copy(); }} style={{ width: "100%", padding: "16px 0", borderRadius: 14, background: C.green, color: C.bg, border: "none", fontFamily: MONO, fontSize: 13, letterSpacing: 1.5, cursor: "pointer", fontWeight: 700 }}>
        SHARE INVITE LINK
      </button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   LanguageSheet — app language preference (UI-only for now)
   ---------------------------------------------------------------------------- */
function LanguageSheet({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState("English");
  const langs = [
    { name: "English", native: "English", flag: "🇺🇸" },
    { name: "Spanish", native: "Español", flag: "🇪🇸" },
    { name: "Portuguese", native: "Português", flag: "🇧🇷" },
    { name: "French", native: "Français", flag: "🇫🇷" },
    { name: "Arabic", native: "العربية", flag: "🇸🇦" },
    { name: "Chinese", native: "中文", flag: "🇨🇳" },
    { name: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
    { name: "Korean", native: "한국어", flag: "🇰🇷" },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>SETTINGS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Language</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {langs.map(({ name, native, flag }) => (
          <button key={name} onClick={() => setSelected(name)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 22 }}>{flag}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: selected === name ? 700 : 400 }}>{name}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{native}</div>
            </div>
            {selected === name && <span style={{ color: C.green, fontSize: 16 }}>✓</span>}
          </button>
        ))}
        <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10, color: C.dim, textAlign: "center" }}>More languages coming soon.</div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   DataUsageSheet — shows estimated data usage per feature
   ---------------------------------------------------------------------------- */
function DataUsageSheet({ onClose }: { onClose: () => void }) {
  const items = [
    { label: "Average drop size", value: "~200 KB", detail: "15s webm audio" },
    { label: "Feed load (20 drops)", value: "~4 MB", detail: "metadata only, no audio" },
    { label: "Per play (streamed)", value: "~200 KB", detail: "audio streamed on demand" },
    { label: "Location updates", value: "< 1 KB", detail: "GPS coordinates only" },
    { label: "Activity feed", value: "< 50 KB", detail: "text notifications" },
    { label: "Background usage", value: "minimal", detail: "no audio plays in background" },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>SETTINGS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>Data Usage</div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>Nearhum is designed to use as little data as possible. Audio is only streamed when you tap play.</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {items.map(({ label, value, detail }) => (
          <div key={label} style={{ padding: "14px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: C.text, fontSize: 14 }}>{label}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.green }}>{value}</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{detail}</div>
          </div>
        ))}
        <div style={{ marginTop: 16, padding: "14px 16px", background: C.panel2, borderRadius: 14, border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>LOW DATA MODE</div>
          <div style={{ color: C.dim, fontSize: 13 }}>Coming soon — will disable waveform animations and limit feed preloading.</div>
        </div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   VoiceAccessibilitySheet — accessibility options
   ---------------------------------------------------------------------------- */
function VoiceAccessibilitySheet({ onClose }: { onClose: () => void }) {
  const [opts, setOpts] = useState({
    largeText: false,
    highContrast: false,
    reducedMotion: false,
    autoplay: false,
    captions: false,
  });

  const toggle = (k: keyof typeof opts) => setOpts((s) => ({ ...s, [k]: !s[k] }));

  const items = [
    { key: "largeText" as const, label: "Larger text", detail: "Increases all font sizes by 20%" },
    { key: "highContrast" as const, label: "High contrast", detail: "Boosts text contrast ratios" },
    { key: "reducedMotion" as const, label: "Reduce motion", detail: "Disables waveform and pulse animations" },
    { key: "autoplay" as const, label: "Auto-play on open", detail: "Start playing as soon as you open the app" },
    { key: "captions" as const, label: "Voice captions (beta)", detail: "Experimental auto-transcription of drops" },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>SETTINGS</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 20 }}>Accessibility</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {items.map(({ key, label, detail }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{label}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 3 }}>{detail}</div>
            </div>
            <button onClick={() => toggle(key)} style={{ width: 44, height: 26, borderRadius: 13, background: opts[key] ? C.green : C.panel2, border: `1px solid ${opts[key] ? C.green : C.line}`, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, borderRadius: 99, background: C.text, position: "absolute", top: 2, left: opts[key] ? 20 : 2, transition: "left 0.2s" }} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   FullSettingsSheet — all settings grouped with links to sub-sheets
   ---------------------------------------------------------------------------- */
function FullSettingsSheet({ handle, credits, ledger, onClose, onSignOut, onOpenLocation, onOpenPrivacy, onOpenNotifs, onOpenBlocked, onOpenHelp, onOpenRules, onOpenInvite, onOpenLanguage, onOpenDataUsage, onOpenAccessibility, onOpenCreditHistory, place }: {
  handle: string; credits: number; ledger: { label: string; delta: number }[]; onClose: () => void;
  onSignOut: () => void; onOpenLocation: () => void; onOpenPrivacy: () => void;
  onOpenNotifs: () => void; onOpenBlocked: () => void; onOpenHelp: () => void;
  onOpenRules: () => void; onOpenInvite: () => void; onOpenLanguage: () => void;
  onOpenDataUsage: () => void; onOpenAccessibility: () => void;
  onOpenCreditHistory: () => void; place: string;
}) {
  const locationLabel = place.startsWith("Near me") ? place.replace("Near me · ", "") : place;

  const sections = [
    {
      title: "ACCOUNT",
      rows: [
        { label: "Handle", value: `@${handle}`, action: undefined },
        { label: "Location", value: `${locationLabel} ▾`, action: onOpenLocation },
        { label: "Credits", value: `◆ ${credits}`, action: onOpenCreditHistory },
      ],
    },
    {
      title: "PRIVACY & SAFETY",
      rows: [
        { label: "Privacy", value: "›", action: onOpenPrivacy },
        { label: "Blocked Users", value: "›", action: onOpenBlocked },
        { label: "Community Rules", value: "›", action: onOpenRules },
      ],
    },
    {
      title: "NOTIFICATIONS",
      rows: [
        { label: "Notification Preferences", value: "›", action: onOpenNotifs },
      ],
    },
    {
      title: "APP",
      rows: [
        { label: "Language", value: "›", action: onOpenLanguage },
        { label: "Accessibility", value: "›", action: onOpenAccessibility },
        { label: "Data Usage", value: "›", action: onOpenDataUsage },
      ],
    },
    {
      title: "MORE",
      rows: [
        { label: "Invite a Friend", value: "›", action: onOpenInvite },
        { label: "Help & FAQ", value: "›", action: onOpenHelp },
        { label: "Sign Out", value: "", action: onSignOut, danger: true },
      ],
    },
  ];

  return (
    <Sheet onClose={onClose} accent={C.green}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 20 }}>Settings</div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {sections.map(({ title, rows }) => (
          <div key={title} style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: C.dim, marginBottom: 6 }}>{title}</div>
            <div style={{ background: C.panel2, borderRadius: 14, overflow: "hidden", border: `1px solid ${C.line}` }}>
              {rows.map(({ label, value, action, danger }, i) => (
                <button key={label} onClick={action} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "none", border: "none", borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : "none", cursor: action ? "pointer" : "default", color: (danger as boolean | undefined) ? C.red : C.text, textAlign: "left" }}>
                  <span style={{ fontSize: 15 }}>{label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: (danger as boolean | undefined) ? C.red : C.dim }}>{value}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, paddingBottom: 8 }}>Nearhum · v0.1 · Made with voice</div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   VoiceEqualizerDisplay — animated EQ bars during active playback
   ---------------------------------------------------------------------------- */
function VoiceEqualizerDisplay({ active, color, bars = 12 }: { active: boolean; color: string; bars?: number }) {
  const [heights, setHeights] = useState(() => Array(bars).fill(20) as number[]);

  useEffect(() => {
    if (!active) { setHeights(Array(bars).fill(20)); return; }
    const i = setInterval(() => {
      setHeights(Array(bars).fill(0).map(() => 15 + Math.random() * 65));
    }, 80);
    return () => clearInterval(i);
  }, [active, bars]);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36 }}>
      {heights.map((h, i) => (
        <div key={i} style={{ flex: 1, height: `${h}%`, background: color, borderRadius: "2px 2px 0 0", transition: active ? "height 0.08s ease" : "height 0.3s ease", opacity: 0.7 + (h / 100) * 0.3 }} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   TopDropsSection — top 3 of the user's own drops by plays/reacts
   ---------------------------------------------------------------------------- */
function TopDropsSection({ myDropIds, pings, onPlay }: { myDropIds: string[]; pings: typeof SEED; onPlay: (id: string) => void }) {
  const myDrops = pings.filter((p) => myDropIds.includes(p.id)).sort((a, b) => {
    const ra = a.reacts.felt + a.reacts.same + a.reacts.loud;
    const rb = b.reacts.felt + b.reacts.same + b.reacts.loud;
    return b.plays + rb * 3 - (a.plays + ra * 3);
  }).slice(0, 3);

  if (myDrops.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 12 }}>YOUR TOP DROPS</div>
      {myDrops.map((p, i) => {
        const mc = MOOD[p.mood];
        const total = p.reacts.felt + p.reacts.same + p.reacts.loud;
        const icons = ["🥇", "🥈", "🥉"];
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: C.panel2, border: `1px solid ${i === 0 ? hexA(mc, "50") : C.line}`, borderRadius: 14, marginBottom: 8 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{icons[i]}</span>
            <button onClick={() => onPlay(p.id)} style={{ width: 34, height: 34, borderRadius: 99, border: `1px solid ${mc}`, background: hexA(mc, "15"), color: mc, fontSize: 12, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.text, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: mc, marginTop: 2 }}>{p.mood}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 12, color: C.text, fontWeight: 700 }}>{p.plays} ▶</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{total} ♥</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   DropTagsInput — add searchable mood tags to a drop before publishing
   ---------------------------------------------------------------------------- */
function DropTagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  const suggestions = ["local", "rant", "random", "question", "story", "vibe", "opinion", "news", "music", "food"];
  const filtered = suggestions.filter((s) => !tags.includes(s) && s.includes(input.toLowerCase())).slice(0, 4);

  const addTag = (t: string) => {
    if (tags.length >= 5 || tags.includes(t)) return;
    onChange([...tags, t.toLowerCase().replace(/\s+/g, "")]);
    setInput("");
  };

  const removeTag = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {tags.map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 99, background: hexA(C.green, "20"), border: `1px solid ${hexA(C.green, "50")}` }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.green }}>#{t}</span>
            <button onClick={() => removeTag(t)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 10, padding: 0, marginLeft: 2 }}>✕</button>
          </div>
        ))}
        {tags.length < 5 && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/\s/, ""))}
            onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { addTag(input.trim()); e.preventDefault(); } }}
            placeholder={tags.length === 0 ? "add tags…" : "+tag"}
            style={{ background: "none", border: "none", outline: "none", color: C.text, fontFamily: MONO, fontSize: 12, width: 80, padding: "4px 0" }}
          />
        )}
      </div>
      {input && filtered.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {filtered.map((s) => (
            <button key={s} onClick={() => addTag(s)} style={{ padding: "4px 10px", borderRadius: 99, background: C.panel2, border: `1px solid ${C.line}`, color: C.dim, fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>#{s}</button>
          ))}
        </div>
      )}
      <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, marginTop: 4, letterSpacing: 1 }}>{tags.length}/5 TAGS</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoicePreviewCard — preview a recorded blob before publishing
   ---------------------------------------------------------------------------- */
function VoicePreviewCard({ blob, secs, color, onDiscard }: { blob: Blob; secs: number; color: string; onDiscard: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.ontimeupdate = () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); };
    audio.onended = () => { setPlaying(false); setProgress(0); };
    audioRef.current = audio;
    return () => { audio.pause(); URL.revokeObjectURL(url); };
  }, [blob]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setPlaying(true); }
  };

  return (
    <div style={{ background: hexA(color, "12"), border: `1px solid ${hexA(color, "40")}`, borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={toggle} style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${color}`, background: playing ? color : "transparent", color: playing ? C.bg : color, fontSize: 13, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ height: 3, background: C.panel2, borderRadius: 2, marginBottom: 4 }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: color, borderRadius: 2, transition: "width 0.1s" }} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{fmtSecs(Math.round(progress * secs))} / {fmtSecs(secs)}</div>
        </div>
        <button onClick={onDiscard} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", color: C.dim, fontFamily: MONO, fontSize: 10, cursor: "pointer" }}>DISCARD</button>
      </div>
      <VoiceEqualizerDisplay active={playing} color={color} bars={20} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   TimezoneShiftNotice — warn users who appear to be in a new timezone
   ---------------------------------------------------------------------------- */
function TimezoneShiftNotice({ cityLabel, onDismiss }: { cityLabel: string; onDismiss: () => void }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const known = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix"];
  if (!tz || known.some((t) => tz.startsWith(t.split("/")[0]))) return null;

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", background: hexA(C.violet, "12"), border: `1px solid ${hexA(C.violet, "40")}`, borderRadius: 14, marginBottom: 12 }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>🌍</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.violet, marginBottom: 2 }}>TRAVELING?</div>
        <div style={{ color: C.dim, fontSize: 12, lineHeight: 1.5 }}>Your timezone is {tz}. Drops are tuned to {cityLabel}. Update your location to hear voices nearby.</div>
      </div>
      <button onClick={onDismiss} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   ActivityDigestCard — daily summary shown at top of activity tab
   ---------------------------------------------------------------------------- */
function ActivityDigestCard({ activity, pings, myDropIds }: { activity: typeof ACTIVITY_SEED; pings: typeof SEED; myDropIds: string[] }) {
  const todayReacts = activity.filter((a) => a.type === "react").length;
  const todayReplies = activity.filter((a) => a.type === "reply").length;
  const myDrops = pings.filter((p) => myDropIds.includes(p.id));
  const totalPlays = myDrops.reduce((s, p) => s + p.plays, 0);

  if (activity.length === 0) return null;

  return (
    <div style={{ background: `linear-gradient(135deg, ${hexA(C.green, "12")}, ${C.panel2})`, border: `1px solid ${hexA(C.green, "30")}`, borderRadius: 16, padding: "14px 16px", marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: C.dim, marginBottom: 10 }}>YOUR IMPACT TODAY</div>
      <div style={{ display: "flex", gap: 10 }}>
        {[
          { label: "REACTIONS", value: todayReacts, color: C.rose },
          { label: "REPLIES", value: todayReplies, color: C.greenSoft },
          { label: "TOTAL PLAYS", value: totalPlays, color: C.green },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.dim, letterSpacing: 1, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoicePlayerControls — standalone reusable playback controls strip
   ---------------------------------------------------------------------------- */
function VoicePlayerControls({ playing, onToggle, onSkip, onPrev, speed, onSpeedChange }: {
  playing: boolean; onToggle: () => void; onSkip: () => void; onPrev: () => void;
  speed: number; onSpeedChange: (s: number) => void;
}) {
  const speeds = [0.75, 1, 1.25, 1.5, 2];
  const nextSpeed = () => {
    const i = speeds.indexOf(speed);
    onSpeedChange(speeds[(i + 1) % speeds.length]);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
      <button onClick={onPrev} style={{ width: 38, height: 38, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.dim, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>⏮</button>
      <button onClick={onToggle} style={{ width: 54, height: 54, borderRadius: 99, border: "none", background: C.green, color: C.bg, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {playing ? "❚❚" : "▶"}
      </button>
      <button onClick={onSkip} style={{ width: 38, height: 38, borderRadius: 99, border: `1px solid ${C.line}`, background: "none", color: C.dim, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>⏭</button>
      <button onClick={nextSpeed} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${speed !== 1 ? C.green : C.line}`, background: speed !== 1 ? hexA(C.green, "15") : "transparent", color: speed !== 1 ? C.green : C.dim, fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>
        {speed}×
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   QuickActionsBar — bottom quick-action row in the FullPlayer
   ---------------------------------------------------------------------------- */
function QuickActionsBar({ onSave, onShare, onThread, onReport, onTip, saved }: {
  onSave: () => void; onShare: () => void; onThread: () => void;
  onReport: () => void; onTip: () => void; saved: boolean;
}) {
  const actions = [
    { icon: saved ? "◎" : "◎", label: saved ? "SAVED" : "SAVE", action: onSave, active: saved },
    { icon: "↩", label: "THREAD", action: onThread, active: false },
    { icon: "↗", label: "SHARE", action: onShare, active: false },
    { icon: "◆", label: "TIP", action: onTip, active: false },
    { icon: "⚑", label: "REPORT", action: onReport, active: false },
  ];

  return (
    <div style={{ display: "flex", justifyContent: "space-around", padding: "10px 0" }}>
      {actions.map(({ icon, label, action, active }) => (
        <button key={label} onClick={action} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer" }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, border: `1px solid ${active ? C.green : C.line}`, background: active ? hexA(C.green, "20") : C.panel2, display: "flex", alignItems: "center", justifyContent: "center", color: active ? C.green : C.dim, fontSize: 15 }}>{icon}</div>
          <span style={{ fontFamily: MONO, fontSize: 8, color: active ? C.green : C.dim, letterSpacing: 1 }}>{label}</span>
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceDropCountdown — live ticking countdown to drop expiry
   ---------------------------------------------------------------------------- */
function VoiceDropCountdown({ ttl }: { ttl: number }) {
  const [display, setDisplay] = useState(ttl);

  useEffect(() => {
    const i = setInterval(() => setDisplay((d) => Math.max(0, d - 1 / 3600)), 1000);
    return () => clearInterval(i);
  }, []);

  const h = Math.floor(display);
  const m = Math.floor((display - h) * 60);
  const s = Math.floor(((display - h) * 60 - m) * 60);
  const urgent = display < 1;
  const color = urgent ? C.red : display < 4 ? C.amber : C.dim;

  if (display <= 0) return <span style={{ fontFamily: MONO, fontSize: 10, color: C.red, letterSpacing: 1 }}>EXPIRED</span>;

  return (
    <span style={{ fontFamily: MONO, fontSize: 10, color, letterSpacing: 1 }}>
      {urgent ? `${m}m ${s.toString().padStart(2, "0")}s` : `${h}h ${m.toString().padStart(2, "0")}m`}
    </span>
  );
}

/* ----------------------------------------------------------------------------
   VoiceCardExpanded — inline expandable view (used in feed for accessibility)
   ---------------------------------------------------------------------------- */
function VoiceCardExpanded({ p, userReact, onReact, onSave, saved, onShare, onReport, onTip, onProfile }: {
  p: typeof SEED[0]; userReact: string | undefined;
  onReact: (k: string) => void; onSave: () => void; saved: boolean;
  onShare: () => void; onReport: () => void; onTip: () => void; onProfile: () => void;
}) {
  const mc = MOOD[p.mood];

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <VoiceReactionBar reacts={p.reacts} userReact={userReact} mc={mc} onReact={onReact} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { label: saved ? "Unsave" : "Save", icon: "◎", action: onSave, active: saved },
          { label: "Share", icon: "↗", action: onShare, active: false },
          { label: "Tip", icon: "◆", action: onTip, active: false },
          { label: "@" + p.handle, icon: "◍", action: onProfile, active: false },
          { label: "Report", icon: "⚑", action: onReport, active: false },
        ].map(({ label, icon, action, active }) => (
          <button key={label} onClick={action} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: `1px solid ${active ? mc : C.line}`, background: active ? hexA(mc, "15") : "transparent", color: active ? mc : C.dim, fontFamily: MONO, fontSize: 10, cursor: "pointer" }}>
            <span>{icon}</span><span>{label}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>Expires: <VoiceDropCountdown ttl={p.ttl} /></span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.replies.length} repl{p.replies.length === 1 ? "y" : "ies"}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   OnboardingStep helper — reused across onboarding screens
   ---------------------------------------------------------------------------- */
function OnboardingStepDot({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
      {Array(total).fill(0).map((_, i) => (
        <div key={i} style={{ width: i === current ? 18 : 6, height: 6, borderRadius: 3, background: i === current ? C.green : C.line, transition: "width 0.3s, background 0.3s" }} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceShareCard — a shareable image-like card for a drop (rendered as DOM)
   ---------------------------------------------------------------------------- */
function VoiceShareCard({ p }: { p: typeof SEED[0] }) {
  const mc = MOOD[p.mood];
  const total = p.reacts.felt + p.reacts.same + p.reacts.loud;

  return (
    <div style={{ background: `linear-gradient(160deg, ${hexA(mc, "22")}, #0A0A0F)`, border: `1px solid ${hexA(mc, "40")}`, borderRadius: 20, padding: "24px 20px", maxWidth: 340, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Mark size={24} knock={hexA(mc, "22")} />
        <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 2, color: C.dim }}>nearhum</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.3, marginBottom: 12 }}>{p.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: mc, flexShrink: 0 }} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: mc }}>{p.mood}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{p.handle}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>·</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{p.dist}</span>
      </div>
      <Wave n={28} active={false} color={mc} seed={p.id.length * 9} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>♥ {p.reacts.felt}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>◎ {p.reacts.same}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>✦ {p.reacts.loud}</span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{total} reactions</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: hexA(mc, "60"), textAlign: "center", marginTop: 16, letterSpacing: 2 }}>nearhum.app · voice your block</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   CreditsExplainer — small inline tip about how credits work
   ---------------------------------------------------------------------------- */
function CreditsExplainer({ onLearnMore }: { onLearnMore: () => void }) {
  return (
    <div style={{ background: hexA(C.green, "0A"), border: `1px solid ${hexA(C.green, "25")}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: C.green, fontSize: 16, flexShrink: 0 }}>◆</span>
      <div style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
        Drops cost 1 credit each. Earn credits by getting reactions and replies.
      </div>
      <button onClick={onLearnMore} style={{ flexShrink: 0, fontFamily: MONO, fontSize: 10, color: C.green, background: "none", border: "none", cursor: "pointer", letterSpacing: 1 }}>HOW?</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceSpotlightCard — featured voice with large waveform, used in discover
   ---------------------------------------------------------------------------- */
function VoiceSpotlightCard({ p, onPlay, isActive }: { p: typeof SEED[0]; onPlay: () => void; isActive: boolean }) {
  const mc = MOOD[p.mood];
  return (
    <div style={{ background: `linear-gradient(140deg, ${hexA(mc, "15")}, ${C.panel2})`, border: `1px solid ${hexA(mc, "45")}`, borderRadius: 20, padding: "18px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: mc, marginBottom: 4 }}>SPOTLIGHT</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, maxWidth: 220, lineHeight: 1.3 }}>{p.title}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{p.plays} plays</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: mc, marginTop: 2 }}>{p.dist}</div>
        </div>
      </div>
      <button onClick={onPlay} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 12 }}>
        <Wave n={36} active={isActive} color={mc} seed={p.id.length * 17} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onPlay} style={{ width: 44, height: 44, borderRadius: 99, border: "none", background: mc, color: C.bg, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isActive ? "❚❚" : "▶"}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{p.handle}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>{p.mood} · {fmtSecs(p.secs)}</div>
        </div>
        <VoiceDropCountdown ttl={p.ttl} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   BlockConfirmModal — confirm before blocking a user
   ---------------------------------------------------------------------------- */
function BlockConfirmModal({ handle, onConfirm, onCancel }: { handle: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: C.bg, borderRadius: 20, padding: "24px 20px", maxWidth: 320, width: "100%", border: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 10 }}>Block @{handle}?</div>
        <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          Their drops won&apos;t appear in your feed and they can&apos;t see your drops. You can unblock them any time in Settings.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "12px 0", borderRadius: 12, background: C.panel2, border: `1px solid ${C.line}`, color: C.dim, fontFamily: MONO, fontSize: 12, cursor: "pointer" }}>CANCEL</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: "12px 0", borderRadius: 12, background: C.red, border: "none", color: C.text, fontFamily: MONO, fontSize: 12, cursor: "pointer", fontWeight: 700 }}>BLOCK</button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   MoodHistory — sparkline of mood distribution over time
   ---------------------------------------------------------------------------- */
function MoodHistory({ pings, myDropIds }: { pings: typeof SEED; myDropIds: string[] }) {
  const mine = pings.filter((p) => myDropIds.includes(p.id));
  if (mine.length < 2) return null;

  const recent = mine.slice(0, 10).reverse();
  const moodKeys = Object.keys(MOOD);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 10 }}>MOOD HISTORY</div>
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
        {recent.map((p, i) => {
          const mc = MOOD[p.mood];
          const rank = moodKeys.indexOf(p.mood);
          const h = 20 + ((rank + 1) / moodKeys.length) * 40;
          return (
            <div key={p.id} title={p.mood} style={{ flex: 1, height: h, borderRadius: 4, background: mc, opacity: 0.6 + (i / recent.length) * 0.4 }} />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>oldest</span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim }}>latest</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   MOOD_DESCRIPTIONS — what each mood means in context
   ---------------------------------------------------------------------------- */
const MOOD_DESCRIPTIONS: Record<string, string> = {
  raw: "Unfiltered. No filter, no polish. Just whatever's on your mind.",
  soft: "Gentle energy. Something tender, nostalgic, or bittersweet.",
  hype: "High energy. Excited, fired up, or ready to go.",
  low: "Quiet or heavy. Processing something. Not performing.",
  "Late Night": "It's 2am thoughts. Something only makes sense in the dark.",
  Raw: "Unedited, unpolished. The real thing.",
};

/* ----------------------------------------------------------------------------
   MoodDescriptionTooltip — shows what a mood means when hovering/tapping
   ---------------------------------------------------------------------------- */
function MoodDescriptionTooltip({ mood, onClose }: { mood: string; onClose: () => void }) {
  const desc = MOOD_DESCRIPTIONS[mood] ?? `A ${mood} voice drop.`;
  const mc = MOOD[mood as keyof typeof MOOD] ?? C.green;

  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", bottom: 120, left: "50%", transform: "translateX(-50%)", zIndex: 200, background: C.panel2, border: `1px solid ${mc}`, borderRadius: 14, padding: "12px 16px", maxWidth: 280, boxShadow: `0 4px 20px ${hexA(mc, "30")}`, animation: "toastIn 0.25s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: mc, flexShrink: 0 }} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1 }}>{mood.toUpperCase()}</span>
      </div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   FeedDivider — section divider with label, used to separate feed sections
   ---------------------------------------------------------------------------- */
function FeedDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 12px" }}>
      <div style={{ flex: 1, height: 1, background: C.line }} />
      <span style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 2, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.line }} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VoiceSearchBar — inline compact search (alternative to full sheet)
   ---------------------------------------------------------------------------- */
function VoiceSearchBar({ onSubmit }: { onSubmit: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 80); }, [open]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, cursor: "pointer", marginBottom: 12 }}>
        <span style={{ color: C.dim, fontSize: 14 }}>⌕</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>search drops near you…</span>
      </button>
    );
  }

  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { onSubmit(q); setOpen(false); setQ(""); } if (e.key === "Escape") { setOpen(false); setQ(""); } }}
        placeholder="search drops…"
        style={{ width: "100%", background: C.panel2, border: `1px solid ${C.green}`, borderRadius: 12, padding: "10px 40px 10px 40px", color: C.text, fontFamily: MONO, fontSize: 13, outline: "none", boxSizing: "border-box" }}
      />
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.dim, fontSize: 14 }}>⌕</span>
      <button onClick={() => { setOpen(false); setQ(""); }} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>✕</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Root
   ---------------------------------------------------------------------------- */
export default function Nearhum() {
  const [onboarded, setOnboarded] = useState(false);
  const [myHandle, setMyHandle] = useState("—");

  const [tab, setTab] = useState("feed");
  const [pings, setPings] = useState<typeof SEED>([] as typeof SEED);
  const [feedLoading, setFeedLoading] = useState(true);
  const [moodFilter, setMoodFilter] = useState("All");
  const [place, setPlace] = useState("Near me · Orlando, FL");
  const [locOpen, setLocOpen] = useState(false);

  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [myDropIds, setMyDropIds] = useState<string[]>([]);
  const [credits, setCredits] = useState(8);
  const [freeLeft, setFreeLeft] = useState(DAILY_FREE_PLAYS);
  const [charged, setCharged] = useState<string[]>([]);
  const [ledger, setLedger] = useState([{ label: "Welcome bonus", delta: 8 }]);

  const [userReacts, setUserReacts] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<typeof ACTIVITY_SEED>([] as typeof ACTIVITY_SEED);
  const [notif, setNotif] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cityLabel, setCityLabel] = useState("");

  // New feature state
  const [searchOpen, setSearchOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [profileHandle, setProfileHandle] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<typeof SEED[0] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState({ reacts: true, replies: true, nearby: true, trending: false, system: true });
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  const [sortBy, setSortBy] = useState("distance");
  const [earnOpen, setEarnOpen] = useState(false);
  const [achievement, setAchievement] = useState<{ icon: string; title: string; detail: string } | null>(null);
  const [tourDone, setTourDone] = useState(false);
  const [reportTarget, setReportTarget] = useState<typeof SEED[0] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [following, setFollowing] = useState<string[]>([]);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [showProximity, setShowProximity] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const isNewUser = !welcomeDismissed && myDropIds.length === 0;
  const [tipTarget, setTipTarget] = useState<typeof SEED[0] | null>(null);
  const [threadTarget, setThreadTarget] = useState<typeof SEED[0] | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [dataUsageOpen, setDataUsageOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [creditHistoryOpen, setCreditHistoryOpen] = useState(false);
  const [fullSettingsOpen, setFullSettingsOpen] = useState(false);
  const [newDropAlert, setNewDropAlert] = useState<typeof SEED[0] | null>(null);
  const [spikeAlertDismissed, setSpikeAlertDismissed] = useState(false);
  const [featuredIdx, setFeaturedIdx] = useState(0);
  const [blockConfirmHandle, setBlockConfirmHandle] = useState<string | null>(null);
  const [tzDismissed, setTzDismissed] = useState(false);
  const [showSpotlight, setShowSpotlight] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const snap = await getDoc(doc(firestore, "users", user.uid));
          if (snap.exists()) {
            setMyHandle((snap.data().handle as string) || "—");
            const loc = snap.data().location;
            if (loc?.lat && loc?.lng) setMyCoords({ lat: loc.lat as number, lng: loc.lng as number });
            const city = snap.data().city as string | undefined;
            const state = snap.data().state as string | undefined;
            if (city && state) setCityLabel(`${city.toUpperCase()}, ${state}`);
          }
        } catch { /* Firestore unavailable */ }
        setOnboarded(true);
      }
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // IP city lookup — runs once on login, saves city + state to user doc
  useEffect(() => {
    if (!onboarded) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    fetch("https://ipapi.co/json/")
      .then((r) => r.json())
      .then((d) => {
        const city = d.city as string;
        const state = d.region_code as string;
        if (city && state) {
          setCityLabel(`${city.toUpperCase()}, ${state}`);
          updateDoc(doc(firestore, "users", uid), { city, state, ipLat: d.latitude, ipLng: d.longitude }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [onboarded]);

  // Location heartbeat — runs immediately on login then every 5 minutes
  useEffect(() => {
    if (!onboarded || !navigator.geolocation) return;
    const save = () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setMyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          updateDoc(doc(firestore, "users", uid), {
            "location.lat": pos.coords.latitude,
            "location.lng": pos.coords.longitude,
            "location.updatedAt": new Date().toISOString(),
          }).catch(() => {});
        },
        () => {}
      );
    };
    save();
    const hb = setInterval(save, 5 * 60 * 1000);
    return () => clearInterval(hb);
  }, [onboarded]);

  // Live feed from Firestore — re-subscribes when coords update to re-sort
  useEffect(() => {
    if (!onboarded) return;
    const q = query(collection(firestore, "drops"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const raw = snap.docs.map((d) => {
        const data = d.data();
        const dLat = data.lat as number | undefined;
        const dLng = data.lng as number | undefined;
        const distMi = (myCoords && dLat && dLng)
          ? haversineMi(myCoords.lat, myCoords.lng, dLat, dLng)
          : null;
        return {
          ping: {
            id: d.id,
            handle: (data.handle as string) || "—",
            secs: (data.secs as number) || 0,
            mood: (data.mood as string) || "Raw",
            title: (data.title as string) || "",
            body: "",
            dist: distMi !== null ? fmtDist(distMi) : "nearby",
            plays: (data.plays as number) || 0,
            ttl: (data.ttl as number) || 24.0,
            reacts: (data.reacts as { felt: number; same: number; loud: number }) || { felt: 0, same: 0, loud: 0 },
            replies: (data.replies as typeof SEED[0]["replies"]) || [],
            audioUrl: (data.audioUrl as string) || "",
            ownerUid: (data.uid as string) || "",
          } as typeof SEED[0],
          distMi: distMi ?? Infinity,
        };
      });
      raw.sort((a, b) => a.distMi - b.distMi);
      setPings(raw.map((r) => r.ping));
      setFeedLoading(false);
    }, () => setFeedLoading(false));
    return () => unsub();
  }, [onboarded, myCoords]);

  // Real-time activity feed for this user
  useEffect(() => {
    if (!onboarded) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = query(collection(firestore, "users", uid, "activity"), orderBy("at", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setActivity(snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          type: (data.type as string) || "system",
          who: (data.who as string) || "",
          react: (data.react as string) || "",
          title: (data.title as string) || "",
          detail: (data.detail as string) || "",
          ago: timeAgo((data.at as string) || new Date().toISOString()),
          unread: (data.unread as boolean) ?? true,
        } as typeof ACTIVITY_SEED[0];
      }));
    }, () => {});
    return () => unsub();
  }, [onboarded]);

  const cur = pings[idx] || pings[0];
  const unread = activity.filter((a) => a.unread).length;

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  };

  useEffect(() => {
    if (!onboarded || !playing) return;
    const id = pings[idx]?.id;
    if (!id || charged.includes(id) || myDropIds.includes(id)) return;
    if (freeLeft > 0) { setFreeLeft((f) => f - 1); setCharged((s) => [...s, id]); return; }
    if (credits < PLAY_COST) { setPlaying(false); setTopupOpen(true); return; }
    setCredits((c) => c - PLAY_COST);
    setCharged((s) => [...s, id]);
    setLedger((l) => [{ label: `Played @${pings[idx]?.handle ?? "—"}`, delta: -PLAY_COST }, ...l].slice(0, 16));
  }, [idx, playing, onboarded, charged, credits, freeLeft, pings, myDropIds]);

  // Real audio element — lives for the lifetime of the app
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idxRef = useRef(idx);
  useEffect(() => { idxRef.current = idx; }, [idx]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ""; };
  }, []);

  // Load + play when the current track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !cur) return;
    const url = (cur as unknown as { audioUrl?: string }).audioUrl;
    if (!url) return;
    audio.src = url;
    audio.load();
    if (playing) audio.play().catch(() => {});
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play / pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.play().catch(() => {});
    else audio.pause();
  }, [playing]);

  // Progress updates + auto-advance
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); };
    const onEnded = () => {
      const finishedId = pings[idxRef.current]?.id;
      if (finishedId) updateDoc(doc(firestore, "drops", finishedId), { plays: increment(1) }).catch(() => {});
      setIdx((x) => (x + 1) % Math.max(pings.length, 1));
      setProgress(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => { audio.removeEventListener("timeupdate", onTime); audio.removeEventListener("ended", onEnded); };
  }, [pings.length]);

  // Apply playback speed
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Notify user of newest drop (simulated push-like banner for very new drops)
  useEffect(() => {
    if (!onboarded || pings.length === 0) return;
    const newest = pings[0];
    if (!newest) return;
    const ageSecs = (Date.now() - new Date(newest.createdAt ?? newest.id).getTime()) / 1000;
    if (ageSecs < 10 && newest.handle !== myHandle) {
      setNewDropAlert(newest);
    }
  }, [pings.length]);

  // Rotate featured drop every 15 seconds
  useEffect(() => {
    if (pings.length === 0) return;
    const i = setInterval(() => setFeaturedIdx((x) => (x + 1) % pings.length), 15000);
    return () => clearInterval(i);
  }, [pings.length]);

  // Achievement: first reaction received
  useEffect(() => {
    const totalInbound = activity.filter((a) => a.type === "react").length;
    if (totalInbound === 1) unlockAchievement({ icon: "❤️", title: "First Felt", detail: "Someone reacted to your voice" });
    if (totalInbound >= 10) unlockAchievement({ icon: "💫", title: "10 Reactions", detail: "Your voice is resonating" });
  }, [activity.length]);

  // Achievement: first voice reply received
  useEffect(() => {
    const totalReplies = activity.filter((a) => a.type === "reply").length;
    if (totalReplies === 1) unlockAchievement({ icon: "🎙️", title: "First Reply", detail: "Someone answered your drop with their voice" });
  }, [activity.length]);

  // Track plays milestone
  useEffect(() => {
    const totalPlays = myPosts.reduce((s, p) => s + p.plays, 0);
    if (totalPlays >= 50) unlockAchievement({ icon: "🎯", title: "50 Plays", detail: "Your voice has been heard 50 times" });
    if (totalPlays >= 100) unlockAchievement({ icon: "💫", title: "100 Plays", detail: "Your voice has reached 100 plays" });
  }, [myPosts.reduce((s, p) => s + p.plays, 0)]);

  // Streak tracking — count consecutive days with at least one drop
  useEffect(() => {
    if (myDropIds.length === 0) return;
    const newStreak = Math.min(myDropIds.length, 7);
    setStreak(newStreak);
    setBestStreak((prev) => Math.max(prev, newStreak));
    if (newStreak === 3) unlockAchievement({ icon: "⚡", title: "3-Day Streak", detail: "You've dropped 3 days in a row" });
    if (newStreak === 7) unlockAchievement({ icon: "🔥", title: "7-Day Streak", detail: "A full week of voice" });
  }, [myDropIds.length]);

  const buy = (n: number) => {
    setCredits((c) => c + n);
    setLedger((l) => [{ label: `Bought ${n} credits`, delta: n }, ...l].slice(0, 16));
    setTopupOpen(false);
    flash(`+${n} credits added`);
  };

  const jump = (id: string) => {
    const i = pings.findIndex((p) => p.id === id);
    if (i >= 0) { setIdx(i); setProgress(0); setPlaying(true); }
  };
  const skip = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; } setIdx((x) => (x + 1) % pings.length); setProgress(0); };
  const prev = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; } setIdx((x) => (x - 1 + pings.length) % pings.length); setProgress(0); };

  const addReply = (r?: { id: string; handle: string; secs: number; ago: string; audioUrl?: string }) => {
    const reply = r ?? { id: "me" + Date.now(), handle: myHandle, secs: 8, ago: "now" };
    setPings((prev) => prev.map((p, i) => i === idx ? { ...p, replies: [reply, ...p.replies] } : p));
    flash("Voice reply sent");
  };

  const toggleSave = (id: string) => {
    setSavedIds((prev) => {
      if (prev.includes(id)) { flash("Unsaved"); return prev.filter((x) => x !== id); }
      flash("Saved to your collection");
      return [id, ...prev];
    });
  };

  const blockUser = (handle: string) => {
    setBlocked((prev) => prev.includes(handle) ? prev : [handle, ...prev]);
    flash(`@${handle} blocked`);
  };

  const unblockUser = (handle: string) => {
    setBlocked((prev) => prev.filter((h) => h !== handle));
    flash(`@${handle} unblocked`);
  };

  const unlockAchievement = (a: { icon: string; title: string; detail: string }) => {
    setAchievement(a);
  };

  const react = (key: string) => {
    if (!cur) return;
    const id = cur.id;
    const uid = auth.currentUser?.uid;
    setUserReacts((prev) => {
      const had = prev[id];
      const next = { ...prev };
      if (had === key) {
        delete next[id];
        updateDoc(doc(firestore, "drops", id), { [`reacts.${key}`]: increment(-1) }).catch(() => {});
      } else {
        next[id] = key;
        const updates: Record<string, unknown> = { [`reacts.${key}`]: increment(1) };
        if (had) updates[`reacts.${had}`] = increment(-1);
        updateDoc(doc(firestore, "drops", id), updates).catch(() => {});
        const ownerUid = (cur as unknown as { ownerUid: string }).ownerUid;
        if (uid && ownerUid && ownerUid !== uid) {
          addDoc(collection(firestore, "users", ownerUid, "activity"), {
            type: "react", who: myHandle, react: key,
            title: cur.title, dropId: id,
            at: new Date().toISOString(), unread: true,
          }).catch(() => {});
        }
      }
      return next;
    });
  };

  const dropPing = ({ title, mood, secs, audioUrl, dropId }: { title: string; mood: string; secs: number; audioUrl: string; dropId: string }) => {
    if (credits < DROP_COST) { setDropOpen(false); setTopupOpen(true); return; }
    const id = dropId;
    setMyDropIds((p) => [id, ...p]);
    setCharged((s) => [...s, id]);
    setCredits((c) => c - DROP_COST);
    setLedger((l) => [{ label: `Dropped "${title.slice(0, 16)}"`, delta: -DROP_COST }, ...l].slice(0, 16));
    setIdx(0); setProgress(0); setDropOpen(false);
    flash("Dropped to the block");
    if (myDropIds.length === 0) {
      setTimeout(() => unlockAchievement({ icon: "🎙️", title: "First Drop", detail: "You dropped your first voice" }), 800);
    }
  };

  const tipCreator = (amount: number) => {
    setCredits((c) => c - amount);
    setLedger((l) => [{ label: `Tipped @${tipTarget?.handle ?? "?"}`, delta: -amount }, ...l].slice(0, 16));
    flash(`Sent ◆${amount} to @${tipTarget?.handle}`);
  };

  const openByTitle = (title: string) => {
    const i = pings.findIndex((p) => p.title === title);
    if (i >= 0) { setIdx(i); setProgress(0); setTab("feed"); setSheetOpen(true); }
  };

  const markActivityRead = () => setActivity((prev) => prev.map((a) => ({ ...a, unread: false })));
  const myPosts = pings.filter((p) => myDropIds.includes(p.id));

  const visiblePings = pings.filter((p) => !blocked.includes(p.handle));
  const moodFiltered = moodFilter === "All" ? visiblePings : visiblePings.filter((p) => p.mood === moodFilter);
  const shown = [...moodFiltered].sort((a, b) => {
    if (sortBy === "plays") return b.plays - a.plays;
    if (sortBy === "time") return new Date(b.id).getTime() - new Date(a.id).getTime();
    return 0; // distance: already sorted by onSnapshot
  });

  if (!authChecked) {
    return <FullscreenLoadingScreen />;
  }

  if (!onboarded) {
    return (
      <>
        <GlobalStyle />
        <Onboarding onDone={(h) => { setMyHandle(h); setOnboarded(true); }} />
      </>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: `radial-gradient(120% 60% at 50% 0%, ${C.bg2}, ${C.bg} 50%)`, color: C.text, fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
      <GlobalStyle />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: `calc(16px + ${SAFE_T}) 16px calc(150px + ${SAFE_B})` }}>

        {tab === "feed" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mark size={30} knock={C.bg} />
                <div>
                  <h1 style={{ margin: 0, fontFamily: MONO, fontSize: 20, letterSpacing: 2, color: C.text, fontWeight: 700 }}>nearhum</h1>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: C.dim }}>the hum of voices near you</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setSearchOpen(true)} style={{ width: 42, height: 42, borderRadius: 99, border: `1px solid ${C.line}`, background: C.panel2, color: C.dim, fontSize: 16, cursor: "pointer" }}>⌕</button>
                <CreditChip credits={credits} freeLeft={freeLeft} low={freeLeft === 0 && credits < 2} onClick={() => setTopupOpen(true)} />
                <button onClick={() => setDropOpen(true)} style={{ width: 52, height: 52, borderRadius: 99, border: "none", background: C.green, color: C.bg, fontSize: 26, cursor: "pointer", boxShadow: `0 6px 20px ${hexA(C.green, "55")}` }}>＋</button>
              </div>
            </div>

            {isNewUser && <WelcomeBanner handle={myHandle} onDismiss={() => setWelcomeDismissed(true)} />}
            <MiniActivityBadge activity={activity} />
            {!spikeAlertDismissed && <AreaSpikeAlert count={pings.filter((p) => { try { return Date.now() - new Date(p.id).getTime() < 3600000; } catch { return false; } }).length} onDismiss={() => setSpikeAlertDismissed(true)} />}
            <NearestDropBanner p={shown[0] ?? null} onPlay={() => { setIdx(0); setExpanded(true); setPlaying(true); }} />
            <StatsBar pings={pings} cityLabel={cityLabel} place={place} />
            <NearbyNowWidget pings={pings} />
            <PulseSection pings={shown} onPlay={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} />
            <VoiceMoodRing pings={pings} />
            <DiscoverSection pings={pings} onSelect={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} />
            <VoicePodiumWidget pings={pings} onSelect={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} />
            <FeedDivider label="TRENDING" />
            <LoudestHero p={[...pings].sort((a, b) => b.plays - a.plays)[0] ?? null} onOpen={(id) => { jump(id); setExpanded(true); }} />
            <MoodFilter active={moodFilter} onPick={setMoodFilter} />
            <SortBar sort={sortBy} onSort={setSortBy} />
            <VoiceSearchBar onSubmit={(q) => { setSearchOpen(true); }} />
            <FeedDivider label="LIVE FEED" />

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setLocOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                <span style={{ color: C.green, fontSize: 13 }}>📍</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.text, letterSpacing: 1, fontWeight: 700 }}>{myCoords ? "NEARBY" : cityLabel || place.replace("Near me · ", "").toUpperCase()}</span>
                <span style={{ color: C.dim, fontSize: 11 }}>▾</span>
              </button>
              <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1 }}>{shown.length} LIVE</span>
              <button onClick={() => setShowProximity((v) => !v)} style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${showProximity ? C.green : C.line}`, background: showProximity ? hexA(C.green, "15") : "transparent", color: showProximity ? C.green : C.dim, fontFamily: MONO, fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>RADAR</button>
              <button onClick={() => setFollowingOpen(true)} style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.dim, fontFamily: MONO, fontSize: 9, cursor: "pointer", letterSpacing: 1 }}>FOLLOWING</button>
            </div>
            {showProximity && <MapProximityDot pings={pings} />}
            {showHeatmap && <HeatmapBar pings={pings} />}
            {!place.startsWith("Near me") && <div style={{ fontFamily: MONO, fontSize: 10, color: C.amber, letterSpacing: 0.5, marginBottom: 12, marginTop: -4 }}>◷ listening remotely — drop is disabled outside your area</div>}
            <StreakCard streak={streak} bestStreak={bestStreak} />

            {shown.map((p) => (
              <VoiceCard key={p.id} p={p} isCurrent={!!cur && p.id === cur.id} playing={playing} onPick={(id) => { jump(id); setExpanded(true); }} />
            ))}
            {feedLoading && <div style={{ textAlign: "center", color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, padding: "40px 0" }}>TUNING IN...</div>}
            {!feedLoading && shown.length === 0 && <EmptyFeedCTA onDrop={() => setDropOpen(true)} handle={myHandle} />}
            {!feedLoading && shown.length > 0 && (
              <>
                {credits < 3 && <CreditsExplainer onLearnMore={() => setEarnOpen(true)} />}
                {showSpotlight && shown[0] && <VoiceSpotlightCard p={shown[0]} onPlay={() => { setIdx(0); setExpanded(true); setPlaying(true); }} isActive={!!(cur && shown[0].id === cur.id && playing)} />}
                {!tzDismissed && <TimezoneShiftNotice cityLabel={cityLabel} onDismiss={() => setTzDismissed(true)} />}
                <EndOfFeedCard total={shown.length} onDrop={() => setDropOpen(true)} />
              </>
            )}
          </div>
        )}

        {tab === "activity" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h1 style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 3, color: C.green, fontWeight: 700, margin: 0 }}>ACTIVITY</h1>
              <div style={{ display: "flex", gap: 8 }}>
                {unread > 0 && <button onClick={markActivityRead} style={{ fontFamily: MONO, fontSize: 11, color: C.dim, background: "transparent", border: `1px solid ${C.line}`, borderRadius: 99, padding: "7px 12px", cursor: "pointer" }}>MARK ALL READ</button>}
                <button onClick={() => setCreditHistoryOpen(true)} style={{ fontFamily: MONO, fontSize: 11, color: C.dim, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 99, padding: "7px 12px", cursor: "pointer" }}>◆ CREDITS</button>
              </div>
            </div>
            <ActivityDigestCard activity={activity} pings={pings} myDropIds={myDropIds} />
            <TopDropsSection myDropIds={myDropIds} pings={pings} onPlay={(id) => { jump(id); setTab("feed"); setExpanded(true); }} />
            <HorizontalVoiceScroll label="RECENTLY ACTIVE" pings={shown.slice(0, 8)} onSelect={(i) => { setIdx(i); setTab("feed"); setExpanded(true); setPlaying(true); }} />
            <FeedDivider label="NOTIFICATIONS" />
            <ActivityFeed items={activity} onOpen={openByTitle} />
            {activity.length > 0 && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: C.panel2, borderRadius: 14, border: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1.5, marginBottom: 2 }}>ALL CAUGHT UP</div>
                  <div style={{ color: C.dim, fontSize: 13 }}>{activity.length} notification{activity.length !== 1 ? "s" : ""} total</div>
                </div>
                <button onClick={markActivityRead} style={{ fontFamily: MONO, fontSize: 10, color: C.green, background: "none", border: `1px solid ${C.green}`, borderRadius: 99, padding: "6px 12px", cursor: "pointer", letterSpacing: 1 }}>CLEAR</button>
              </div>
            )}
          </div>
        )}

        {tab === "you" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h1 style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 3, color: C.green, fontWeight: 700, margin: 0 }}>YOU</h1>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setDraftsOpen(true)} style={{ fontFamily: MONO, fontSize: 11, color: C.dim, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 99, padding: "7px 12px", cursor: "pointer" }}>DRAFTS{drafts.length > 0 ? ` (${drafts.length})` : ""}</button>
                <button onClick={() => setFullSettingsOpen(true)} style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${C.line}`, background: C.panel2, color: C.dim, fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>⚙</button>
              </div>
            </div>
            <VoicePlayerControls playing={playing} onToggle={() => setPlaying((v) => !v)} onSkip={skip} onPrev={prev} speed={playbackSpeed} onSpeedChange={setPlaybackSpeed} />
            <div style={{ height: 20 }} />
            <HorizontalVoiceScroll label="YOUR DROPS" pings={myPosts} onSelect={(i) => { jump(myPosts[i]?.id ?? ""); setTab("feed"); setExpanded(true); }} />
            <MoodHistory pings={pings} myDropIds={myDropIds} />
            {myPosts.length > 0 && (
              <div style={{ background: C.panel2, borderRadius: 16, padding: "16px", marginBottom: 16, border: `1px solid ${C.line}` }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, color: C.dim, marginBottom: 12 }}>YOUR STATS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Total drops", value: myPosts.length },
                    { label: "Total plays", value: myPosts.reduce((s, p) => s + p.plays, 0) },
                    { label: "Voice replies", value: myPosts.reduce((s, p) => s + p.replies.length, 0) },
                    { label: "Total reactions", value: myPosts.reduce((s, p) => s + p.reacts.felt + p.reacts.same + p.reacts.loud, 0) },
                    { label: "Saved by others", value: Math.floor(myPosts.reduce((s, p) => s + p.plays, 0) / 10) },
                    { label: "Avg. listeners", value: myPosts.length ? Math.round(myPosts.reduce((s, p) => s + p.plays, 0) / myPosts.length) : 0 },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: "10px 12px", background: C.bg, borderRadius: 10, border: `1px solid ${C.line}` }}>
                      <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1, marginBottom: 4 }}>{label.toUpperCase()}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{value.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => setInviteOpen(true)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: hexA(C.green, "15"), border: `1px solid ${hexA(C.green, "40")}`, color: C.green, fontFamily: MONO, fontSize: 11, cursor: "pointer", letterSpacing: 1 }}>INVITE</button>
                  <button onClick={() => setLeaderboardOpen(true)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, background: hexA(C.amber, "15"), border: `1px solid ${hexA(C.amber, "40")}`, color: C.amber, fontFamily: MONO, fontSize: 11, cursor: "pointer", letterSpacing: 1 }}>LEADERBOARD</button>
                </div>
              </div>
            )}
            <YouTab
              handle={myHandle}
              credits={credits}
              pings={pings}
              saved={savedIds}
              activity={activity}
              onOpenSaved={() => setSavedOpen(true)}
              onOpenLeaderboard={() => setLeaderboardOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              onSignOut={async () => { await signOut(auth); setMyHandle("—"); setOnboarded(false); }}
              onOpenNotifSettings={() => setNotifPrefsOpen(true)}
              onEarnCredits={() => setEarnOpen(true)}
            />
          </div>
        )}
      </div>

      {cur && <MiniPlayer p={cur} progress={progress} playing={playing} onToggle={() => setPlaying((v) => !v)} onExpand={() => setExpanded(true)} />}
      <TabBar tab={tab} setTab={(t) => { setTab(t); if (t === "activity") setTimeout(markActivityRead, 1200); }} unread={unread} />

      {cur && expanded && <FullPlayer p={cur} progress={progress} playing={playing} idx={idx} total={pings.length} userReact={userReacts[cur.id]} onReact={react} onToggle={() => setPlaying((v) => !v)} onSkip={skip} onPrev={prev} onReply={() => setSheetOpen(true)} onCollapse={() => setExpanded(false)} />}
      {cur && sheetOpen && <ReplySheet ping={cur} onClose={() => setSheetOpen(false)} onAddReply={addReply} handle={myHandle} uid={auth.currentUser?.uid ?? ""} />}
      {dropOpen && <DropSheet onClose={() => setDropOpen(false)} onDrop={dropPing} credits={credits} handle={myHandle} uid={auth.currentUser?.uid ?? ""} place={place} lat={myCoords?.lat ?? null} lng={myCoords?.lng ?? null} />}
      {topupOpen && <TopUp credits={credits} onClose={() => setTopupOpen(false)} onBuy={buy} />}
      {locOpen && <LocationSheet place={place} onClose={() => setLocOpen(false)} onPick={(p) => { setPlace(p); setLocOpen(false); setIdx(0); setProgress(0); flash(p.startsWith("Near me") ? "Back to your block" : `Tuned in to ${p}`); }} />}
      {settingsOpen && <Settings handle={myHandle} anon={myHandle === "—"} notif={notif} onToggleNotif={() => setNotif((v) => !v)} onClose={() => setSettingsOpen(false)} onSignOut={async () => { await signOut(auth); setMyHandle("—"); setSettingsOpen(false); setOnboarded(false); }} place={place} onOpenLocation={() => setLocOpen(true)} />}

      {searchOpen && <SearchSheet pings={pings} onClose={() => setSearchOpen(false)} onSelect={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} />}
      {savedOpen && <SavedSheet saved={savedIds} allPings={pings} onClose={() => setSavedOpen(false)} onSelect={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} onUnsave={(id) => setSavedIds((prev) => prev.filter((x) => x !== id))} />}
      {profileHandle && <ProfileSheet handle={profileHandle} allPings={pings} onClose={() => setProfileHandle(null)} onSelect={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} myHandle={myHandle} />}
      {shareTarget && <ShareSheet ping={shareTarget} onClose={() => setShareTarget(null)} />}
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
      {leaderboardOpen && <LeaderboardSheet pings={pings} onClose={() => setLeaderboardOpen(false)} onSelectProfile={(h) => { setProfileHandle(h); setLeaderboardOpen(false); }} />}
      {blockedOpen && <BlockedSheet blocked={blocked} onClose={() => setBlockedOpen(false)} onUnblock={unblockUser} />}
      {notifPrefsOpen && <NotifSettingsSheet prefs={notifPrefs} onClose={() => setNotifPrefsOpen(false)} onChange={(k, v) => setNotifPrefs((p) => ({ ...p, [k]: v }))} />}
      {earnOpen && <CreditEarnModal credits={credits} onClose={() => setEarnOpen(false)} />}
      {!tourDone && onboarded && pings.length === 0 && !feedLoading && <OnboardingTour onDone={() => setTourDone(true)} />}
      {reportTarget && <ReportSheet ping={reportTarget} onClose={() => setReportTarget(null)} onReport={(reason) => { flash(`Report submitted: ${reason}`); setReportTarget(null); }} />}
      {draftsOpen && <DraftsSheet drafts={drafts} onClose={() => setDraftsOpen(false)} onPublish={(d) => { flash(`Publishing "${d.title}"`); setDrafts((prev) => prev.filter((x) => x.id !== d.id)); setDraftsOpen(false); }} onDelete={(id) => setDrafts((prev) => prev.filter((x) => x.id !== id))} />}
      {followingOpen && <FollowingSheet following={following} pings={pings} onClose={() => setFollowingOpen(false)} onSelect={(i) => { setIdx(i); setExpanded(true); setPlaying(true); }} />}
      {rulesOpen && <CommunityRulesSheet onClose={() => setRulesOpen(false)} />}
      {blockConfirmHandle && <BlockConfirmModal handle={blockConfirmHandle} onConfirm={() => { blockUser(blockConfirmHandle); setBlockConfirmHandle(null); }} onCancel={() => setBlockConfirmHandle(null)} />}
      {tipTarget && <TipJarSheet ping={tipTarget} myCredits={credits} onClose={() => setTipTarget(null)} onTip={(n) => tipCreator(n)} />}
      {threadTarget && <DropThreadView ping={threadTarget} onClose={() => setThreadTarget(null)} onPlayReply={() => {}} handle={myHandle} uid={auth.currentUser?.uid ?? ""} />}
      {privacyOpen && <PrivacySheet onClose={() => setPrivacyOpen(false)} />}
      {inviteOpen && <InviteSheet handle={myHandle} onClose={() => setInviteOpen(false)} />}
      {langOpen && <LanguageSheet onClose={() => setLangOpen(false)} />}
      {dataUsageOpen && <DataUsageSheet onClose={() => setDataUsageOpen(false)} />}
      {a11yOpen && <VoiceAccessibilitySheet onClose={() => setA11yOpen(false)} />}
      {creditHistoryOpen && <CreditHistorySheet ledger={ledger} onClose={() => setCreditHistoryOpen(false)} />}
      {fullSettingsOpen && <FullSettingsSheet handle={myHandle} credits={credits} ledger={ledger} onClose={() => setFullSettingsOpen(false)} onSignOut={async () => { await signOut(auth); setMyHandle("—"); setFullSettingsOpen(false); setOnboarded(false); }} onOpenLocation={() => { setLocOpen(true); setFullSettingsOpen(false); }} onOpenPrivacy={() => { setPrivacyOpen(true); setFullSettingsOpen(false); }} onOpenNotifs={() => { setNotifPrefsOpen(true); setFullSettingsOpen(false); }} onOpenBlocked={() => { setBlockedOpen(true); setFullSettingsOpen(false); }} onOpenHelp={() => { setHelpOpen(true); setFullSettingsOpen(false); }} onOpenRules={() => { setRulesOpen(true); setFullSettingsOpen(false); }} onOpenInvite={() => { setInviteOpen(true); setFullSettingsOpen(false); }} onOpenLanguage={() => { setLangOpen(true); setFullSettingsOpen(false); }} onOpenDataUsage={() => { setDataUsageOpen(true); setFullSettingsOpen(false); }} onOpenAccessibility={() => { setA11yOpen(true); setFullSettingsOpen(false); }} onOpenCreditHistory={() => { setCreditHistoryOpen(true); setFullSettingsOpen(false); }} place={place} />}

      <PingedByWidget ping={newDropAlert} onPlay={() => { setIdx(0); setExpanded(true); setPlaying(true); setNewDropAlert(null); }} onDismiss={() => setNewDropAlert(null)} />
      <AchievementToast achievement={achievement} onDone={() => setAchievement(null)} />
      <Toast toast={toast} />
    </div>
  );
}
