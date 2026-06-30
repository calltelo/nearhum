"use client";

import React, { useState, useEffect, useRef } from "react";
import { auth, firestore } from "@/app/firebase/config";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, orderBy, onSnapshot, increment, arrayUnion } from "firebase/firestore";

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

const PLAY_PACKS = [
  { n: 25,   price: "$1",   best: false },
  { n: 150,  price: "$5",   best: false },
  { n: 350,  price: "$10",  best: false },
  { n: 800,  price: "$20",  best: true  },
  { n: 2500, price: "$50",  best: false },
  { n: 6000, price: "$100", best: false },
];
const CREDIT_PACKS = [
  { n: 15,   price: "$1",   best: false },
  { n: 80,   price: "$5",   best: false },
  { n: 180,  price: "$10",  best: false },
  { n: 400,  price: "$20",  best: true  },
  { n: 1200, price: "$50",  best: false },
  { n: 3000, price: "$100", best: false },
];
const PLAY_COST = 1;
const DROP_COST = 2;
const DAILY_FREE_PLAYS = 10;

const REACTIONS = [
  { key: "felt", glyph: "♥", label: "felt that", color: C.rose },
  { key: "same", glyph: "◎", label: "same", color: C.greenSoft },
  { key: "loud", glyph: "✦", label: "loud", color: C.amber },
];

const TITLE_PROMPTS_NIGHT = [
  "the 2am thought I can't shake",
  "why am I still up",
  "something I'd never text",
  "the thing I keep replaying",
];
const TITLE_PROMPTS_DAY = [
  "my day at work today",
  "the small win today",
  "something I need to get off my chest",
  "what nobody asked but I'm saying anyway",
  "the thing that made me laugh",
];
function pickTitlePrompt() {
  const hour = new Date().getHours();
  const pool = (hour >= 22 || hour < 5) ? TITLE_PROMPTS_NIGHT : TITLE_PROMPTS_DAY;
  return pool[Math.floor(Math.random() * pool.length)];
}

const RADIUS_OPTIONS = [
  { mi: 1, blurb: "just your block" },
  { mi: 7, blurb: "around your area" },
  { mi: 25, blurb: "across the city" },
  { mi: 100, blurb: "the whole region" },
];
const DEFAULT_RADIUS_MI = 25;

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
    createdAt: "",
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

/* ----------------------------------------------------------------------------
   Activity feed types
   NOTE: previously this used `typeof ACTIVITY_SEED[0]`, which TS narrows to a
   union of 4 distinct literal shapes (one per seed row). The live Firestore-
   mapped object (with every field always present) doesn't structurally match
   any single union member, which is what broke the build. An explicit type
   with optional fields fixes that.
   ---------------------------------------------------------------------------- */
type ActivityItem = {
  id: string;
  type: string;
  who?: string;
  react?: string;
  title?: string;
  detail?: string;
  ago: string;
  unread: boolean;
};


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
function ProgWave({ n = 40, color, progress = 0, h = 28, gap = 2, seed = 2, playing = false }: {
  n?: number; color: string; progress?: number; h?: number; gap?: number; seed?: number; playing?: boolean;
}) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const ratio = i / n;
    const played = ratio <= progress;
    const isHead = played && (i + 1) / n > progress;
    const height = 14 + Math.abs(Math.sin(i * 1.3 + seed)) * 86;
    bars.push(
      <span
        key={i}
        style={{
          flex: 1,
          background: isHead ? C.text : played ? color : C.line,
          height: `${height}%`,
          borderRadius: 3,
          opacity: isHead ? 1 : played ? 0.9 : 0.3,
          transition: "background .1s, opacity .1s",
          transformOrigin: "center",
          ...(playing && played && !isHead ? {
            animation: `playWave ${0.52 + (i % 5) * 0.09}s ease-in-out infinite`,
            animationDelay: `${(i * 41) % 500}ms`,
          } : {}),
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
    if (!navigator.geolocation) { setStep(2); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { locationRef.current = pos.coords; setStep(2); },
      () => setStep(2)
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
          credits: 7,
          plays: 7,
          createdAt: new Date().toISOString(),
          ...locFields,
        }).catch(() => {});
        addDoc(collection(firestore, "users", uid, "activity"), {
          type: "system",
          detail: "Welcome to Nearhum. Your first 7 plays and 7 credits are on us.",
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
            Nearhum is a voice network for exactly where you're standing. Drop a 60-second voice,
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
          <Btn ghost onClick={() => setStep(2)}>NOT NOW</Btn>
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
            7 plays and 7 credits are on us. Press play and listen to
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
   Splash loader
   ---------------------------------------------------------------------------- */
function Loader() {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: `radial-gradient(130% 90% at 50% 10%, ${hexA(C.green, "16")}, ${C.bg} 55%)`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      animation: "fadeIn .25s ease-out",
    }}>
      {/* logo + pulse rings */}
      <div style={{ position: "relative", width: 130, height: 130, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32 }}>
        <svg width="130" height="130" style={{ position: "absolute", inset: 0 }}>
          {[52, 38, 24].map((r, i) => (
            <circle
              key={i}
              cx="65" cy="65" r={r}
              fill="none"
              stroke={C.green}
              strokeWidth="1.5"
              opacity={0.3 - i * 0.07}
              style={{ animation: `bloom ${2 + i * 0.4}s ease-in-out infinite`, animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </svg>
        <Mark size={62} knock={C.bg} />
      </div>

      {/* wordmark */}
      <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 5, color: C.text, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>
        nearhum
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer, letterSpacing: 1.5, marginBottom: 44 }}>
        the hum of voices near you
      </div>

      {/* animated waveform bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: 28 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{
              width: 4, borderRadius: 99,
              background: C.green,
              opacity: 0.55,
              animation: `${["eqA","eqB","eqC","eqB","eqA"][i]} ${0.8 + i * 0.1}s ease-in-out infinite`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Mood filter chips
   ---------------------------------------------------------------------------- */
const MOOD_DOT: Record<string, string> = {
  "Late Night": "🌙", Soft: "☁", Raw: "⚡", Spicy: "🔥",
};

function MoodFilter({ active, onPick }: { active: string; onPick: (m: string) => void }) {
  const all = ["All", ...MOOD_LIST];
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, marginBottom: 16, scrollbarWidth: "none" }}>
      {all.map((m) => {
        const on = active === m;
        const col = m === "All" ? C.green : MOOD[m];
        return (
          <button
            key={m}
            onClick={() => onPick(m)}
            style={{
              flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
              padding: on ? "7px 14px" : "7px 12px",
              borderRadius: 99,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: 0.8,
              border: `1px solid ${on ? col : C.line}`,
              background: on ? `linear-gradient(135deg, ${hexA(col, "28")}, ${hexA(col, "0E")})` : C.panel2,
              color: on ? col : C.dim,
              transition: "all .15s",
              boxShadow: on ? `0 2px 12px ${hexA(col, "33")}` : "none",
            }}
          >
            {m !== "All" && <span style={{ fontSize: 10 }}>{MOOD_DOT[m]}</span>}
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
  const pAny = p as unknown as { createdAt?: string; radiusMi?: number };
  return (
    <button
      onClick={() => onPick(p.id)}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 16px",
        marginBottom: 10,
        borderRadius: 18,
        cursor: "pointer",
        border: `1px solid ${isCurrent ? mc : C.line}`,
        background: isCurrent ? `linear-gradient(135deg, ${hexA(mc, "1A")}, ${C.card} 70%)` : C.card,
        transition: "border-color .2s, background .2s",
      }}
    >
      {/* mood · handle · dist · time */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: mc, flexShrink: 0 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 1, flexShrink: 0 }}>
          {p.mood.toUpperCase()}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          @{p.handle} · {p.dist}
        </span>
        {pAny.createdAt && (
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dimmer, flexShrink: 0 }}>
            {timeAgo(pAny.createdAt)}
          </span>
        )}
      </div>

      {/* title */}
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {p.title}
      </div>

      {/* play button + waveform + duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 99, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: isCurrent ? mc : hexA(mc, "22"),
          color: isCurrent ? C.bg : mc,
          fontSize: 12,
        }}>
          {isCurrent && playing ? <Eq color={isCurrent ? C.bg : mc} size={14} /> : "▶"}
        </div>
        <Wave n={22} active={isCurrent && playing} color={mc} seed={p.id.length * 2} />
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, flexShrink: 0 }}>{fmtSecs(p.secs)}</span>
      </div>

      {/* stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 11 }}>
        <span style={{ color: C.dim }}>▶ {p.plays}</span>
        <span style={{ color: C.dim }}>◴ {p.replies.length}</span>
        <span style={{ color: totalReacts(p.reacts) > 0 ? C.rose : C.dimmer }}>♥ {totalReacts(p.reacts)}</span>
        {pAny.radiusMi != null && (
          <span style={{ marginLeft: "auto", color: C.dim }}>↬ {pAny.radiusMi}mi</span>
        )}
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
        bottom: `calc(68px + ${SAFE_B})`, width: "calc(100% - 24px)", maxWidth: 460,
        cursor: "pointer", zIndex: 41,
      }}
    >
      <div
        style={{
          position: "relative", overflow: "hidden", borderRadius: 20,
          background: hexA(C.panel, "F0"),
          border: `1px solid ${hexA(mc, "44")}`,
          boxShadow: `0 16px 40px rgba(0,0,0,.6), 0 0 0 1px ${hexA(mc, "18")}`,
          backdropFilter: "blur(20px)",
        }}
      >
        {/* progress bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: C.line }}>
          <div style={{ height: "100%", width: `${progress * 100}%`, background: mc, transition: "width .12s", borderRadius: 99 }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
          {/* mood dot + eq */}
          <div style={{
            width: 42, height: 42, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg, ${hexA(mc, "30")}, ${hexA(mc, "10")})`,
            border: `1px solid ${hexA(mc, "50")}`,
            display: "flex", alignItems: "center", justifyContent: "center", color: mc,
          }}>
            {playing ? <Eq color={mc} size={16} /> : <span style={{ fontSize: 15 }}>▶</span>}
          </div>

          {/* text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
              {p.title}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: mc, flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 0.8 }}>{p.mood.toUpperCase()}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>· @{p.handle}</span>
            </div>
          </div>

          {/* play/pause */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            style={{
              width: 40, height: 40, borderRadius: 99, border: "none", flexShrink: 0,
              background: mc, color: C.bg, cursor: "pointer", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 14px ${hexA(mc, "55")}`,
            }}
          >
            {playing ? "❚❚" : "▶"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Full-screen player
   ---------------------------------------------------------------------------- */
function FullPlayer({ p, progress, playing, onToggle, onSkip, onPrev, onReply, onReact, userReact, onCollapse, idx, total, isOwn }: {
  p: typeof SEED[0]; progress: number; playing: boolean; onToggle: () => void; onSkip: () => void;
  onPrev: () => void; onReply: () => void; onReact: (key: string) => void; userReact: string | undefined;
  onCollapse: () => void; idx: number; total: number; isOwn: boolean;
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
        <ProgWave n={42} color={mc} progress={progress} h={96} gap={3} seed={p.id.length} playing={playing} />
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
            <button
              key={r.key}
              onClick={() => { if (!isOwn) onReact(r.key); }}
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "9px 14px",
                borderRadius: 99, fontFamily: MONO, fontSize: 12, fontWeight: 600,
                cursor: isOwn ? "not-allowed" : "pointer",
                opacity: isOwn ? 0.35 : 1,
                border: `1px solid ${on ? r.color : C.line}`,
                background: on ? hexA(r.color, "22") : "transparent",
                color: on ? r.color : C.textDim,
              }}
            >
              <span style={{ fontSize: 14 }}>{r.glyph}</span>
              {(p.reacts as Record<string, number>)[r.key] || 0}
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
        ◴ HUM · {p.replies.length}
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
   Reply sheet
   ---------------------------------------------------------------------------- */
function ReplySheet({ ping, onClose, onAddReply, uid, myHandle, credits, onPlayReply }: {
  ping: typeof SEED[0]; onClose: () => void; onAddReply: () => void; uid: string; myHandle: string; credits: number; onPlayReply: () => boolean;
}) {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [replyIdx, setReplyIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const humAudioRef = useRef<HTMLAudioElement | null>(null);
  const swipeX = useRef<number | null>(null);
  const mc = MOOD[ping.mood];

  const goReply = (n: number) => {
    humAudioRef.current?.pause();
    setPlayingKey(null);
    setReplyIdx(n);
  };

  useEffect(() => {
    const audio = new Audio();
    humAudioRef.current = audio;
    const onEnded = () => setPlayingKey(null);
    audio.addEventListener("ended", onEnded);
    return () => { audio.removeEventListener("ended", onEnded); audio.pause(); audio.src = ""; };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const i = setInterval(() => setRecSecs((s) => { if (s >= 59) { stopRec(); return 59; } return s + 1; }), 1000);
    return () => clearInterval(i);
  }, [recording]);

  const startRec = async () => {
    setMicError(null); setAudioBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => { setAudioBlob(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" })); stream.getTracks().forEach((t) => t.stop()); };
      mr.start(100); mrRef.current = mr; setRecSecs(0); setRecording(true);
    } catch { setMicError("Microphone access denied."); }
  };

  const stopRec = () => { mrRef.current?.stop(); mrRef.current = null; setRecording(false); };

  const send = async () => {
    if (!audioBlob) return;
    if (credits < 1) { setMicError("Not enough credits. Top up to hum."); return; }
    setUploading(true); setMicError(null);
    try {
      const fd = new FormData();
      fd.append("file", audioBlob, `reply_${Date.now()}.webm`);
      fd.append("upload_preset", "nearhum_drops");
      const res = await fetch("https://api.cloudinary.com/v1_1/dvtwey6m9/video/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { secure_url: audioUrl } = await res.json();
      const createdAt = new Date().toISOString();
      await updateDoc(doc(firestore, "drops", ping.id), {
        replies: arrayUnion({ uid, handle: myHandle, audioUrl, secs: recSecs || 1, createdAt }),
      });
      onAddReply();
      setAudioBlob(null); setRecSecs(0);
    } catch { setMicError("Upload failed. Try again."); }
    setUploading(false);
  };

  const togglePlay = (r: typeof SEED[0]["replies"][0], i: number) => {
    const rx = r as unknown as { audioUrl?: string; createdAt?: string };
    const audioUrl = rx.audioUrl || "";
    const key = rx.createdAt || r.id || String(i);
    const audio = humAudioRef.current;
    if (!audio || !audioUrl) return;
    if (playingKey === key) { audio.pause(); setPlayingKey(null); }
    else {
      if (!onPlayReply()) return;
      audio.src = audioUrl; audio.play().catch(() => {}); setPlayingKey(key);
    }
  };

  return (
    <Sheet onClose={onClose} accent={mc}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: mc }} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1 }}>{ping.mood.toUpperCase()}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{ping.handle}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>{ping.title}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 2, marginBottom: 14 }}>
        {ping.replies.length > 0 ? `◉ ${ping.replies.length} HUM${ping.replies.length !== 1 ? "S" : ""}` : "◉ NO HUMS YET"}
      </div>

      <div style={{ flex: 1, marginBottom: 14, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {ping.replies.length === 0 ? (
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "28px 0", lineHeight: 1.6 }}>
            No voice replies yet. Drop the first hum.
          </div>
        ) : (() => {
          const safeIdx = Math.min(replyIdx, ping.replies.length - 1);
          const r = ping.replies[safeIdx];
          const rx = r as unknown as { audioUrl?: string; createdAt?: string };
          const key = rx.createdAt || r.id || String(safeIdx);
          const on = playingKey === key;
          return (
            <div
              onTouchStart={(e) => { swipeX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                if (swipeX.current === null) return;
                const dx = e.changedTouches[0].clientX - swipeX.current;
                swipeX.current = null;
                if (dx < -44 && safeIdx < ping.replies.length - 1) goReply(safeIdx + 1);
                else if (dx > 44 && safeIdx > 0) goReply(safeIdx - 1);
              }}
              style={{ userSelect: "none" }}
            >
              {/* Card */}
              <div style={{ background: C.card, border: `1px solid ${on ? mc : C.line}`, borderRadius: 20, padding: "20px 18px", marginBottom: 14, transition: "border-color .15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.textDim }}>@{r.handle}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer }}>{rx.createdAt ? timeAgo(rx.createdAt) : (r.ago || "")}</span>
                </div>
                <Wave n={28} active={on} color={mc} seed={(r.id || String(safeIdx)).length * 3 + 7} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>♪ {fmtSecs(r.secs)}</span>
                  <button
                    onClick={() => togglePlay(r, safeIdx)}
                    style={{ width: 48, height: 48, borderRadius: 99, border: "none", background: on ? mc : hexA(mc, "22"), color: on ? C.bg : mc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: rx.audioUrl ? "pointer" : "default" }}
                  >
                    {on ? <Eq color={C.bg} size={16} /> : "▶"}
                  </button>
                </div>
              </div>

              {/* Nav row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <button onClick={() => goReply(safeIdx - 1)} disabled={safeIdx === 0} style={{ width: 32, height: 32, borderRadius: 99, border: "none", background: safeIdx === 0 ? "transparent" : hexA(mc, "22"), color: safeIdx === 0 ? C.line : mc, fontSize: 16, cursor: safeIdx === 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
                <div style={{ display: "flex", gap: 6 }}>
                  {ping.replies.map((_, i) => (
                    <button key={i} onClick={() => goReply(i)} style={{ width: i === safeIdx ? 18 : 6, height: 6, borderRadius: 99, border: "none", background: i === safeIdx ? mc : C.line, padding: 0, cursor: "pointer", transition: "width .2s, background .2s" }} />
                  ))}
                </div>
                <button onClick={() => goReply(safeIdx + 1)} disabled={safeIdx === ping.replies.length - 1} style={{ width: 32, height: 32, borderRadius: 99, border: "none", background: safeIdx === ping.replies.length - 1 ? "transparent" : hexA(mc, "22"), color: safeIdx === ping.replies.length - 1 ? C.line : mc, fontSize: 16, cursor: safeIdx === ping.replies.length - 1 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
              </div>
            </div>
          );
        })()}
      </div>

      {micError && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 8, textAlign: "center" }}>{micError}</div>}

      {audioBlob && !recording ? (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { setAudioBlob(null); setRecSecs(0); }} style={{ flex: 1, padding: 15, borderRadius: 14, cursor: "pointer", fontFamily: MONO, fontSize: 12, border: `1px solid ${C.line}`, background: "transparent", color: C.dim, letterSpacing: 1 }}>
            ✕ REDO
          </button>
          <button onClick={send} disabled={uploading} style={{ flex: 2, padding: 15, borderRadius: 14, cursor: uploading ? "default" : "pointer", fontFamily: MONO, fontSize: 12, border: "none", background: uploading ? C.line : mc, color: uploading ? C.dim : C.bg, letterSpacing: 1, fontWeight: 700 }}>
            {uploading ? "SENDING..." : `▲ SEND HUM · ${fmtSecs(recSecs)}`}
          </button>
        </div>
      ) : (
        <button
          onClick={() => recording ? stopRec() : startRec()}
          style={{ width: "100%", padding: 18, borderRadius: 16, cursor: "pointer", fontFamily: MONO, fontSize: 13, letterSpacing: 1.5, border: `1px solid ${recording ? C.red : mc}`, background: recording ? "#1A0A0A" : hexA(mc, "1A"), color: recording ? C.red : mc }}
        >
          {recording ? `● REC ${recSecs}s — TAP TO STOP` : "○ HUM"}
        </button>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   Drop composer
   ---------------------------------------------------------------------------- */
function DropSheet({ onClose, onDrop, credits, handle, uid, place, lat, lng }: {
  onClose: () => void;
  onDrop: (d: { title: string; mood: string; secs: number; audioUrl: string; dropId: string; radiusMi: number }) => void;
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
  const [radius, setRadius] = useState<number | null>(null);
  const [titlePlaceholder] = useState(pickTitlePrompt);
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
    const i = setInterval(() => setRecSecs((s) => Math.min(s + 1, 60)), 1000);
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
      autoStopRef.current = setTimeout(stopRec, 60000);
    } catch {
      setMicError("Microphone access denied. Allow mic in browser settings.");
    }
  };

  const publish = async () => {
    if (!audioBlob || !mood || !title.trim() || !radius) return;
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
        plays: 0, ttl: 24.0, radiusMi: radius,
        reacts: { felt: 0, same: 0, loud: 0 },
        replies: [],
        createdAt: new Date().toISOString(),
      });
      onDrop({ title: title.trim(), mood, secs: recSecs, audioUrl, dropId: docRef.id, radiusMi: radius });
    } catch {
      setMicError("Upload failed. Check your connection and try again.");
      setUploading(false);
    }
  };

  const mc = mood ? MOOD[mood] : C.green;
  const dur = recSecs || 8;

  const Dots = ({ i }: { i: number }) => (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {[0, 1, 2, 3, 4].map((n) => (
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
          <ProgWave n={32} color={C.green} progress={recording ? recSecs / 60 : 0} h={64} gap={3} />
          <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 28, color: recording ? C.red : C.dim, margin: "18px 0" }}>
            {fmtSecs(recSecs)} <span style={{ fontSize: 13 }}>/ 1:00</span>
          </div>
          {micError && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 12, textAlign: "center", lineHeight: 1.4 }}>{micError}</div>}
          <button
            onClick={() => recording ? stopRec() : startRec()}
            style={{ width: "100%", padding: 18, borderRadius: 16, cursor: "pointer", fontFamily: MONO, fontSize: 13, letterSpacing: 2, border: `1px solid ${recording ? C.red : C.green}`, background: recording ? "#1A0A0A" : C.panel2, color: recording ? C.red : C.green }}
          >
            {recording ? "● RECORDING — TAP TO STOP" : "○ HUM"}
          </button>
        </div>
      )}

      {stage === "title" && (
        <div>
          <Dots i={1} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 4, textAlign: "center" }}>STEP 2 · TITLE IT</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 18, textAlign: "center" }}>What's the drop?</div>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value.slice(0, 50))} placeholder={titlePlaceholder} style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 16px", color: C.text, fontSize: 19, fontWeight: 650, outline: "none" }} />
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
          <button disabled={!mood} onClick={() => setStage("radius")} style={{ width: "100%", padding: 18, borderRadius: 16, marginTop: 22, cursor: mood ? "pointer" : "default", border: "none", background: mood ? mc : C.line, color: mood ? C.bg : C.dim, fontFamily: MONO, fontSize: 13, letterSpacing: 2 }}>
            NEXT — SET REACH →
          </button>
        </div>
      )}

      {stage === "radius" && (
        <div>
          <Dots i={3} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>STEP 4 · HOW FAR SHOULD THIS REACH?</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 18 }}>{title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {RADIUS_OPTIONS.map((r) => {
              const on = radius === r.mi;
              return (
                <button key={r.mi} onClick={() => setRadius(r.mi)} style={{ padding: "18px 12px", borderRadius: 16, cursor: "pointer", textAlign: "left", border: `1px solid ${on ? mc : C.line}`, background: on ? hexA(mc, "1A") : "transparent", color: on ? mc : C.textDim }}>
                  <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700 }}>{r.mi} MI</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{r.blurb}</div>
                </button>
              );
            })}
          </div>
          <button disabled={!radius} onClick={() => setStage("post")} style={{ width: "100%", padding: 18, borderRadius: 16, marginTop: 22, cursor: radius ? "pointer" : "default", border: "none", background: radius ? mc : C.line, color: radius ? C.bg : C.dim, fontFamily: MONO, fontSize: 13, letterSpacing: 2 }}>
            NEXT — REVIEW →
          </button>
        </div>
      )}

      {stage === "post" && mood && radius && (
        <div>
          <Dots i={4} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10, textAlign: "center" }}>STEP 5 · REVIEW &amp; POST</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: mc }} />
            <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1 }}>{mood.toUpperCase()}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>· reaches {radius} mi</span>
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
function TopUp({ credits, plays, onClose, onBuy }: {
  credits: number; plays: number; onClose: () => void;
  onBuy: (type: "plays" | "credits", n: number) => void;
}) {
  const [tab, setTab] = useState<"plays" | "credits">("plays");
  const isPlays = tab === "plays";
  const col = isPlays ? C.cyan : C.green;
  const packs = isPlays ? PLAY_PACKS : CREDIT_PACKS;

  return (
    <Sheet onClose={onClose} accent={col}>
      {/* balances */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {[
          { label: "PLAYS", val: plays, color: C.cyan, glyph: "♪" },
          { label: "CREDITS", val: credits, color: C.green, glyph: "◆" },
        ].map(({ label, val, color, glyph }) => (
          <div key={label} style={{ flex: 1, background: hexA(color, "0E"), border: `1px solid ${hexA(color, "30")}`, borderRadius: 14, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: MONO, fontSize: 24, color, fontWeight: 700 }}>{glyph} {val}</div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1.5, marginTop: 3 }}>{label} LEFT</div>
          </div>
        ))}
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, background: C.panel2, borderRadius: 12, padding: 4 }}>
        {(["plays", "credits"] as const).map((t) => {
          const on = tab === t;
          const tc = t === "plays" ? C.cyan : C.green;
          return (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 11, letterSpacing: 1, fontWeight: 700, background: on ? hexA(tc, "22") : "transparent", color: on ? tc : C.dim, transition: "all .15s" }}>
              {t === "plays" ? "♪  PLAYS" : "◆  CREDITS"}
            </button>
          );
        })}
      </div>

      {/* context line */}
      <p style={{ fontFamily: MONO, fontSize: 10, color: C.dim, lineHeight: 1.65, margin: "0 0 14px", letterSpacing: 0.2 }}>
        {isPlays
          ? "Each play = one voice heard. Stack plays to keep listening without limits."
          : `Drop costs ${DROP_COST} credits · Hum costs ${PLAY_COST} credit. Credits never expire.`}
      </p>

      {/* packs */}
      {packs.map((pk) => (
        <button
          key={pk.n}
          onClick={() => onBuy(tab, pk.n)}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", marginBottom: 8, borderRadius: 14, cursor: "pointer", border: `1px solid ${pk.best ? col : C.line}`, background: pk.best ? hexA(col, "12") : C.card, transition: "border-color .15s" }}
        >
          <span style={{ fontFamily: MONO, fontSize: 20, color: col, fontWeight: 700 }}>{isPlays ? "♪" : "◆"} {pk.n}</span>
          {pk.best && (
            <span style={{ fontFamily: MONO, fontSize: 9, color: col, border: `1px solid ${col}`, borderRadius: 99, padding: "2px 8px", letterSpacing: 1 }}>BEST VALUE</span>
          )}
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
function ActivityFeed({ items, onOpen }: { items: ActivityItem[]; onOpen: (title: string) => void }) {
  const icon = (it: ActivityItem) => {
    if (it.type === "reply") return { g: "◴", c: C.greenSoft };
    if (it.type === "react") { const r = REACTIONS.find((x) => x.key === it.react); return { g: r ? r.glyph : "♥", c: r ? r.color : C.rose }; }
    if (it.type === "milestone") return { g: "✦", c: C.amber };
    return { g: "◆", c: C.cyan };
  };
  const text = (it: ActivityItem) => {
    if (it.type === "reply") return `@${it.who} replied in voice`;
    if (it.type === "react") { const r = REACTIONS.find((x) => x.key === it.react); return `@${it.who} reacted "${r ? r.label : it.react}"`; }
    if (it.type === "milestone") return it.detail;
    return it.detail;
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
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 0,
      borderRadius: 99, cursor: "pointer",
      border: `1.5px solid ${low ? hexA(C.amber, "55") : hexA(C.green, "38")}`,
      background: low ? hexA(C.amber, "0E") : hexA(C.green, "0A"),
      overflow: "hidden", fontFamily: MONO, fontSize: 12, fontWeight: 700,
    }}>
      <span style={{ padding: "6px 11px", display: "flex", alignItems: "center", gap: 5, color: C.cyan }}>
        <span style={{ fontSize: 11 }}>♪</span>
        <span>{freeLeft}</span>
      </span>
      <span style={{ width: 1, alignSelf: "stretch", background: low ? hexA(C.amber, "40") : hexA(C.green, "30") }} />
      <span style={{ padding: "6px 11px", display: "flex", alignItems: "center", gap: 5, color: low ? C.amber : C.green }}>
        <span style={{ fontSize: 10 }}>◆</span>
        <span>{credits}</span>
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   Location picker
   ---------------------------------------------------------------------------- */
const PLACES: Record<string, { abbr: string; cities: string[] }> = {
  Florida: { abbr: "FL", cities: ["Orlando", "Miami", "Tampa", "Jacksonville", "St. Petersburg", "Gainesville", "Tallahassee"] },
  Georgia: { abbr: "GA", cities: ["Atlanta", "Savannah", "Athens", "Augusta"] },
  "New York": { abbr: "NY", cities: ["New York City", "Brooklyn", "Buffalo", "Rochester"] },
  California: { abbr: "CA", cities: ["Los Angeles", "San Francisco", "San Diego", "Sacramento", "Oakland"] },
  Texas: { abbr: "TX", cities: ["Austin", "Houston", "Dallas", "San Antonio", "El Paso"] },
  Illinois: { abbr: "IL", cities: ["Chicago", "Naperville", "Springfield"] },
  Washington: { abbr: "WA", cities: ["Seattle", "Spokane", "Tacoma"] },
  Colorado: { abbr: "CO", cities: ["Denver", "Boulder", "Colorado Springs"] },
  "North Carolina": { abbr: "NC", cities: ["Charlotte", "Raleigh", "Asheville", "Durham"] },
  Tennessee: { abbr: "TN", cities: ["Nashville", "Memphis", "Knoxville"] },
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
  const tabs: [string, string, string][] = [["feed", "HUMS", "◉"], ["activity", "ACTIVITY", "◴"], ["you", "YOU", "◍"]];
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
      @keyframes playWave{0%,100%{transform:scaleY(0.78)}50%{transform:scaleY(1.22)}}
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
   Root
   ---------------------------------------------------------------------------- */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Nearhum() {
  const [onboarded, setOnboarded] = useState(false);
  const [myHandle, setMyHandle] = useState("—");

  const [pwaPrompt, setPwaPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaDismissed, setPwaDismissed] = useState(false);

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
  const [credits, setCredits] = useState(0);
  const [freeLeft, setFreeLeft] = useState(0);
  const lastBilledRef = useRef<{ idx: number; id: string } | null>(null);
  const [ledger, setLedger] = useState([{ label: "Welcome bonus", delta: 8 }]);

  const [userReacts, setUserReacts] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [notif, setNotif] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cityLabel, setCityLabel] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const snap = await getDoc(doc(firestore, "users", user.uid));
          if (snap.exists()) {
            const d = snap.data();
            setMyHandle((d.handle as string) || "—");
            const loc = d.location;
            if (loc?.lat && loc?.lng) setMyCoords({ lat: loc.lat as number, lng: loc.lng as number });
            const city = d.city as string | undefined;
            const state = d.state as string | undefined;
            if (city && state) setCityLabel(`${city.toUpperCase()}, ${state}`);
            if (typeof d.credits === "number") setCredits(d.credits);
            if (typeof d.plays === "number") setFreeLeft(d.plays);
          }
        } catch { /* Firestore unavailable */ }
        setOnboarded(true);
      }
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // Service worker + PWA install prompt
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPwaPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPwaPrompt(null);
      const uid = auth.currentUser?.uid;
      if (uid) {
        updateDoc(doc(firestore, "users", uid), { pwaInstalledAt: new Date().toISOString() }).catch(() => {});
      }
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
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
            replies: ((data.replies as Array<{uid?: string; handle?: string; audioUrl?: string; secs?: number; createdAt?: string}>) || []).map((r) => ({
              id: r.createdAt || `rep_${Math.random()}`,
              handle: r.handle || "—",
              secs: r.secs || 0,
              ago: r.createdAt ? timeAgo(r.createdAt) : "now",
              uid: r.uid || "",
              audioUrl: r.audioUrl || "",
              createdAt: r.createdAt || "",
            })) as typeof SEED[0]["replies"],
            audioUrl: (data.audioUrl as string) || "",
            ownerUid: (data.uid as string) || "",
            createdAt: (data.createdAt as string) || "",
            radiusMi: (data.radiusMi as number) || DEFAULT_RADIUS_MI,
          } as typeof SEED[0],
          distMi: distMi ?? Infinity,
        };
      }).filter((r) => {
        const ownerUid = (r.ping as unknown as { ownerUid?: string }).ownerUid;
        if (ownerUid && ownerUid === auth.currentUser?.uid) return true;
        if (r.distMi === Infinity) return true;
        const radiusMi = (r.ping as unknown as { radiusMi?: number }).radiusMi ?? DEFAULT_RADIUS_MI;
        return r.distMi <= radiusMi;
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
        };
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
    if (!id) return;
    // Deduplicate: only charge once per (idx, id) slot — but allow billing again if user replays
    if (lastBilledRef.current?.idx === idx && lastBilledRef.current?.id === id) return;
    const pingOwner = (pings[idx] as unknown as { ownerUid?: string } | undefined)?.ownerUid ?? "";
    if (myDropIds.includes(id) || (pingOwner && pingOwner === auth.currentUser?.uid)) return;
    lastBilledRef.current = { idx, id };
    if (freeLeft > 0) {
      setFreeLeft((f) => f - 1);
      const uid = auth.currentUser?.uid;
      if (uid) updateDoc(doc(firestore, "users", uid), { plays: increment(-1) }).catch(() => {});
      if (pingOwner) updateDoc(doc(firestore, "users", pingOwner), { plays: increment(-1) }).catch(() => {});
      return;
    }
    if (credits < PLAY_COST) { setPlaying(false); setTopupOpen(true); return; }
    setCredits((c) => c - PLAY_COST);
    const uid2 = auth.currentUser?.uid;
    if (uid2) updateDoc(doc(firestore, "users", uid2), { credits: increment(-PLAY_COST) }).catch(() => {});
    if (pingOwner) updateDoc(doc(firestore, "users", pingOwner), { plays: increment(-1) }).catch(() => {});
    setLedger((l) => [{ label: `Played @${pings[idx]?.handle ?? "—"}`, delta: -PLAY_COST }, ...l].slice(0, 16));
  }, [idx, playing, onboarded, credits, freeLeft, pings, myDropIds]);

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

  const buy = (type: "plays" | "credits", n: number) => {
    const uid = auth.currentUser?.uid;
    if (type === "plays") {
      setFreeLeft((f) => f + n);
      if (uid) updateDoc(doc(firestore, "users", uid), { plays: increment(n) }).catch(() => {});
      flash(`+${n} plays added`);
    } else {
      setCredits((c) => c + n);
      setLedger((l) => [{ label: `Bought ${n} credits`, delta: n }, ...l].slice(0, 16));
      if (uid) updateDoc(doc(firestore, "users", uid), { credits: increment(n) }).catch(() => {});
      flash(`+${n} credits added`);
    }
    setTopupOpen(false);
  };

  const jump = (id: string) => {
    const i = pings.findIndex((p) => p.id === id);
    if (i >= 0) { setIdx(i); setProgress(0); setPlaying(true); }
  };
  const skip = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; } setIdx((x) => (x + 1) % pings.length); setProgress(0); };
  const prev = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; } setIdx((x) => (x - 1 + pings.length) % pings.length); setProgress(0); };

  const chargePlay = (): boolean => {
    const uid = auth.currentUser?.uid;
    if (freeLeft > 0) {
      setFreeLeft((f) => f - 1);
      if (uid) updateDoc(doc(firestore, "users", uid), { plays: increment(-1) }).catch(() => {});
      return true;
    }
    if (credits >= PLAY_COST) {
      setCredits((c) => c - PLAY_COST);
      setLedger((l) => [{ label: "Played a hum reply", delta: -PLAY_COST }, ...l].slice(0, 16));
      if (uid) updateDoc(doc(firestore, "users", uid), { credits: increment(-PLAY_COST) }).catch(() => {});
      return true;
    }
    setTopupOpen(true);
    return false;
  };

  const addReply = () => {
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateDoc(doc(firestore, "users", uid), { credits: increment(-1) }).catch(() => {});
      setCredits((c) => Math.max(0, c - 1));
      setLedger((l) => [{ label: `Replied to @${cur?.handle ?? "—"}`, delta: -1 }, ...l].slice(0, 16));
      const ownerUid = (cur as unknown as { ownerUid: string }).ownerUid;
      if (ownerUid && ownerUid !== uid) {
        addDoc(collection(firestore, "users", ownerUid, "activity"), {
          type: "reply", who: myHandle, title: cur?.title, dropId: cur?.id,
          at: new Date().toISOString(), unread: true,
        }).catch(() => {});
      }
    }
    flash("Hum sent · −1 credit");
  };

  const bumpReact = (dropId: string, key: string, delta: number) => {
    setPings((prev) => prev.map((p) => {
      if (p.id !== dropId) return p;
      const r = { ...(p.reacts as Record<string, number>) };
      r[key] = Math.max(0, (r[key] || 0) + delta);
      return { ...p, reacts: r as typeof p.reacts };
    }));
  };

  const react = (key: string) => {
    if (!cur) return;
    const id = cur.id;
    const uid = auth.currentUser?.uid;
    const ownerUid = (cur as unknown as { ownerUid: string }).ownerUid;
    if (!uid || uid === ownerUid) return;
    const had = userReacts[id];

    if (had === key) {
      setUserReacts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      bumpReact(id, key, -1);
      updateDoc(doc(firestore, "drops", id), { [`reacts.${key}`]: increment(-1) }).catch(() => {});
    } else {
      setUserReacts((prev) => ({ ...prev, [id]: key }));
      bumpReact(id, key, 1);
      if (had) bumpReact(id, had, -1);
      const updates: Record<string, unknown> = { [`reacts.${key}`]: increment(1) };
      if (had) updates[`reacts.${had}`] = increment(-1);
      updateDoc(doc(firestore, "drops", id), updates).catch(() => {});
      if (uid && ownerUid && ownerUid !== uid) {
        addDoc(collection(firestore, "users", ownerUid, "activity"), {
          type: "react", who: myHandle, react: key,
          title: cur.title, dropId: id,
          at: new Date().toISOString(), unread: true,
        }).catch(() => {});
      }
    }
  };

  const dropPing = ({ title, mood, secs, audioUrl, dropId, radiusMi }: { title: string; mood: string; secs: number; audioUrl: string; dropId: string; radiusMi: number }) => {
    if (credits < DROP_COST) { setDropOpen(false); setTopupOpen(true); return; }
    const id = dropId;
    const dUid = auth.currentUser?.uid;
    setMyDropIds((p) => [id, ...p]);
    setCredits((c) => c - DROP_COST);
    if (dUid) updateDoc(doc(firestore, "users", dUid), { credits: increment(-DROP_COST) }).catch(() => {});
    setLedger((l) => [{ label: `Dropped "${title.slice(0, 16)}"`, delta: -DROP_COST }, ...l].slice(0, 16));
    setIdx(0); setProgress(0); setDropOpen(false);
    flash(`Dropped · reaches ${radiusMi} mi`);
  };

  const openByTitle = (title: string) => {
    const i = pings.findIndex((p) => p.title === title);
    if (i >= 0) { setIdx(i); setProgress(0); setTab("feed"); setSheetOpen(true); }
  };

  const markActivityRead = () => setActivity((prev) => prev.map((a) => ({ ...a, unread: false })));
  const uid = auth.currentUser?.uid;
  const myPosts = pings.filter((p) => {
    const own = (p as unknown as { ownerUid: string }).ownerUid;
    return own === uid || myDropIds.includes(p.id);
  });
  const shown = moodFilter === "All" ? pings : pings.filter((p) => p.mood === moodFilter);

  if (!authChecked) {
    return (
      <>
        <GlobalStyle />
        <Loader />
      </>
    );
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Mark size={42} knock={C.bg} />
                <div>
                  <h1 style={{ margin: 0, fontFamily: MONO, fontSize: 17, letterSpacing: 4, color: C.text, fontWeight: 800, textTransform: "uppercase" }}>nearhum</h1>
                  <p style={{ margin: "3px 0 0", fontSize: 10, color: C.dimmer, letterSpacing: 1, fontFamily: MONO }}>the hum of voices near you</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CreditChip credits={credits} freeLeft={freeLeft} low={freeLeft === 0 && credits < 2} onClick={() => setTopupOpen(true)} />
                <button
                  onClick={() => { if (place.startsWith("Near me")) setDropOpen(true); else flash("You can only drop where you actually are"); }}
                  style={{ width: 44, height: 44, borderRadius: 99, border: "none", background: C.green, color: C.bg, fontSize: 22, cursor: place.startsWith("Near me") ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 18px ${hexA(C.green, "65")}`, opacity: place.startsWith("Near me") ? 1 : 0.38 }}
                >＋</button>
              </div>
            </div>

            {pwaPrompt && !pwaDismissed && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 16, borderRadius: 16, background: `linear-gradient(120deg, ${hexA(C.green, "12")}, ${C.card})`, border: `1px solid ${hexA(C.green, "40")}` }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>📲</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, color: C.text, marginBottom: 2 }}>Add Nearhum to your home screen</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>One tap for instant local hums</div>
                </div>
                <button
                  onClick={async () => {
                    if (!pwaPrompt) return;
                    await pwaPrompt.prompt();
                    const { outcome } = await pwaPrompt.userChoice;
                    if (outcome === "accepted") {
                      const uid = auth.currentUser?.uid;
                      if (uid) updateDoc(doc(firestore, "users", uid), { pwaInstalledAt: new Date().toISOString() }).catch(() => {});
                    }
                    setPwaPrompt(null);
                  }}
                  style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 99, border: "none", background: C.green, color: C.bg, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}
                >
                  INSTALL
                </button>
                <button onClick={() => setPwaDismissed(true)} style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 99, border: "none", background: "transparent", color: C.dim, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            )}

            <LoudestHero p={[...pings].sort((a, b) => b.plays - a.plays)[0] ?? null} onOpen={(id) => { jump(id); setExpanded(true); }} />
            <MoodFilter active={moodFilter} onPick={setMoodFilter} />

            <button onClick={() => setLocOpen(true)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: "none", padding: 0, margin: "0 0 12px", cursor: "pointer" }}>
              <span style={{ color: C.green, fontSize: 13 }}>📍</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.text, letterSpacing: 1, fontWeight: 700 }}>{myCoords ? "NEARBY" : cityLabel || place.replace("Near me · ", "").toUpperCase()}</span>
              <span style={{ color: C.dim, fontSize: 11 }}>▾</span>
              <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1 }}>{shown.length} LIVE</span>
            </button>
            {!place.startsWith("Near me") && <div style={{ fontFamily: MONO, fontSize: 10, color: C.amber, letterSpacing: 0.5, marginBottom: 12, marginTop: -4 }}>◷ listening remotely — drop is disabled outside your area</div>}

            {shown.map((p) => (
              <VoiceCard key={p.id} p={p} isCurrent={!!cur && p.id === cur.id} playing={playing} onPick={(id) => { jump(id); setExpanded(true); }} />
            ))}
            {feedLoading && <div style={{ textAlign: "center", color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, padding: "40px 0" }}>TUNING IN...</div>}
            {!feedLoading && shown.length === 0 && <div style={{ textAlign: "center", color: C.dim, fontSize: 14, padding: "40px 0" }}>No {moodFilter === "All" ? "" : moodFilter.toLowerCase() + " "}voices yet. Be the first to drop.</div>}
          </div>
        )}

        {tab === "activity" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h1 style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 3, color: C.green, fontWeight: 700, margin: 0 }}>ACTIVITY</h1>
              {unread > 0 && <button onClick={markActivityRead} style={{ fontFamily: MONO, fontSize: 11, color: C.dim, background: "transparent", border: `1px solid ${C.line}`, borderRadius: 99, padding: "7px 12px", cursor: "pointer" }}>MARK ALL READ</button>}
            </div>
            <ActivityFeed items={activity} onOpen={openByTitle} />
          </div>
        )}

        {tab === "you" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h1 style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 3, color: C.green, fontWeight: 700, margin: 0 }}>YOU</h1>
              <button onClick={() => setSettingsOpen(true)} style={{ width: 42, height: 42, borderRadius: 99, border: `1px solid ${C.line}`, background: C.card, color: C.textDim, fontSize: 18, cursor: "pointer" }}>⚙</button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 99, border: `2px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: C.green, flexShrink: 0 }}>◍</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 650 }}>{myHandle === "—" ? "Anonymous" : `@${myHandle}`}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>shown as "{myHandle}" · verified · Orlando</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              {[["DROPS", myPosts.length], ["PLAYS", myPosts.reduce((s, p) => s + p.plays, 0)], ["REPLIES", myPosts.reduce((s, p) => s + p.replies.length, 0)]].map(([k, v]) => (
                <div key={String(k)} style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 8px", textAlign: "center" }}>
                  <div style={{ fontFamily: MONO, fontSize: 22, color: C.green, fontWeight: 700 }}>{v}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1.5, marginTop: 4 }}>{k}</div>
                </div>
              ))}
            </div>

            <div style={{ background: `linear-gradient(120deg, ${hexA(C.green, "1F")}, ${C.card})`, border: `1px solid ${hexA(C.green, "55")}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>YOUR CREDITS</div>
                  <div style={{ fontFamily: MONO, fontSize: 34, color: C.green, fontWeight: 700, lineHeight: 1 }}>◆ {credits}</div>
                </div>
                <button onClick={() => setTopupOpen(true)} style={{ padding: "12px 18px", borderRadius: 99, border: "none", background: C.green, color: C.bg, fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}>GET CREDITS</button>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 6 }}>
                  <span>PLAYS BALANCE</span>
                  <span style={{ color: C.greenSoft }}>♪ {freeLeft}</span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min((freeLeft / DAILY_FREE_PLAYS) * 100, 100)}%`, height: "100%", background: `linear-gradient(90deg, ${C.greenDeep}, ${C.greenSoft})`, transition: "width .3s" }} />
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 14, fontFamily: MONO, fontSize: 11, color: C.dim }}>
                  <span>▶ extra play · {PLAY_COST}</span>
                  <span>＋ drop · {DROP_COST}</span>
                </div>
              </div>
            </div>

            <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>CREDIT LEDGER</div>
            <div style={{ marginBottom: 22 }}>
              {ledger.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: C.text }}>{e.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: e.delta > 0 ? C.green : C.amber }}>{e.delta > 0 ? "+" : ""}{e.delta} ◆</span>
                </div>
              ))}
            </div>

            <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>YOUR DROPS</div>
            {myPosts.length === 0 && <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "30px 0" }}>Nothing yet. Tap ＋ on the radio to drop your first voice.</div>}
            {myPosts.map((p) => (
              <VoiceCard key={p.id} p={p} isCurrent={false} playing={false} onPick={(id) => { jump(id); setTab("feed"); setExpanded(true); }} />
            ))}
          </div>
        )}
      </div>

      {cur && <MiniPlayer p={cur} progress={progress} playing={playing} onToggle={() => setPlaying((v) => !v)} onExpand={() => setExpanded(true)} />}
      <TabBar tab={tab} setTab={(t) => { setTab(t); if (t === "activity") setTimeout(markActivityRead, 1200); }} unread={unread} />

      {cur && expanded && <FullPlayer p={cur} progress={progress} playing={playing} idx={idx} total={pings.length} userReact={userReacts[cur.id]} onReact={react} onToggle={() => setPlaying((v) => !v)} onSkip={skip} onPrev={prev} onReply={() => setSheetOpen(true)} onCollapse={() => setExpanded(false)} isOwn={auth.currentUser?.uid === (cur as unknown as { ownerUid: string }).ownerUid} />}
      {cur && sheetOpen && <ReplySheet ping={cur} onClose={() => setSheetOpen(false)} onAddReply={addReply} uid={auth.currentUser?.uid ?? ""} myHandle={myHandle} credits={credits} onPlayReply={chargePlay} />}
      {dropOpen && <DropSheet onClose={() => setDropOpen(false)} onDrop={dropPing} credits={credits} handle={myHandle} uid={auth.currentUser?.uid ?? ""} place={place} lat={myCoords?.lat ?? null} lng={myCoords?.lng ?? null} />}
      {topupOpen && <TopUp credits={credits} plays={freeLeft} onClose={() => setTopupOpen(false)} onBuy={buy} />}
      {locOpen && <LocationSheet place={place} onClose={() => setLocOpen(false)} onPick={(p) => { setPlace(p); setLocOpen(false); setIdx(0); setProgress(0); flash(p.startsWith("Near me") ? "Back to your block" : `Tuned in to ${p}`); }} />}
      {settingsOpen && <Settings handle={myHandle} anon={myHandle === "—"} notif={notif} onToggleNotif={() => setNotif((v) => !v)} onClose={() => setSettingsOpen(false)} onSignOut={async () => { await signOut(auth); setMyHandle("—"); setSettingsOpen(false); setOnboarded(false); }} place={place} onOpenLocation={() => setLocOpen(true)} />}

      <Toast toast={toast} />
    </div>
  );
}