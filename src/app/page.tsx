"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { auth, firestore } from "@/app/firebase/config";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  increment,
  arrayUnion,
  getDocs,
  runTransaction,
} from "firebase/firestore";

/* ============================================================================
   NEARHUM — the hum of voices near you
   ----------------------------------------------------------------------------
   A hyperlocal voice network. The feed is a radio that plays itself: it auto-
   plays the nearest voices, you listen, and you reply in your own voice.
   No calls, no DMs, no text replies. Drops fade after 24h.

   This file is the entire client. It is a single self-contained component on
   purpose — the whole product lives in one place so it can be reasoned about,
   redesigned, and shipped in one pass.

   ARCHITECTURE MAP
   ----------------------------------------------------------------------------
   tokens          design language: color, type, motion, elevation, mood tint
   config          economy (plays/credits), moods, reactions, prompts, reach
   helpers         geo math (distance + bearing), formatting, color utilities
   icons           a crisp inline-SVG icon set (replaces unicode glyphs)
   atoms           Mark, Wave, ProgWave, Eq, Pulse, Toast, Chip, Stat, Skeleton
   Radar           THE SIGNATURE — a live sweep of the voices around you
   Onboarding      first run: welcome → location → account → mic → enter
   Loader          splash with breathing rings
   Feed pieces     LoudestHero, MoodFilter, SortBar, VoiceCard, PinHums
   Players         MiniPlayer (docked) + FullPlayer (immersive, swipe-to-close)
   Sheets          Reply (hum), Drop (compose), TopUp, Settings, Search,
                   Report, ReactDetail, EditProfile, Location
   Tabs            HUMS · ACTIVITY · YOU
   Root            Nearhum() — state, Firestore subscriptions, audio engine

   FIRESTORE SHAPE (unchanged — do not break)
   ----------------------------------------------------------------------------
   users/{uid}                     handle, email, credits, plays, location{},
                                   city, state, streak, lastActiveDay, prefs{}
   users/{uid}/activity/{id}       type, who, react, title, detail, at, unread
   users/{uid}/ledger/{id}         label, delta, at
   drops/{id}                      uid, handle, title, mood, secs, audioUrl,
                                   place, lat, lng, plays, ttl, radiusMi,
                                   pinnedTo, pinnedToUid, reacts{}, replies[],
                                   createdAt
   ============================================================================ */


/* ----------------------------------------------------------------------------
   DESIGN TOKENS
   The palette is a single hue family (forest green) over near-black, lit from
   the top. Green is the carrier signal; every other color is an accent that
   only appears when it means something (mood, warning, reaction).
   ---------------------------------------------------------------------------- */
const C = {
  // substrate
  bg: "#040806",
  bg2: "#06100A",
  bg3: "#081209",
  panel: "#0A140D",
  panel2: "#0E1B12",
  panel3: "#0B160F",
  card: "#0C1710",
  cardHi: "#102217",
  cardPress: "#0A130C",
  line: "#18301F",
  lineHi: "#244A30",
  lineSoft: "#13261A",

  // signal
  green: "#22C55E",
  greenSoft: "#4ADE80",
  greenDeep: "#16A34A",
  greenGlow: "#34D77A",
  greenInk: "#06140B",

  // accents — used sparingly, only with meaning
  amber: "#F59E0B",
  amberSoft: "#FBBF24",
  violet: "#8B5CF6",
  violetSoft: "#A78BFA",
  cyan: "#22D3EE",
  cyanSoft: "#67E8F9",
  rose: "#FB7185",
  roseSoft: "#FDA4AF",
  red: "#EF4444",
  redSoft: "#F87171",

  // type
  text: "#E4F5E9",
  textHi: "#F2FBF5",
  textDim: "#A9C6B5",
  dim: "#5F8270",
  dimmer: "#3C5244",
  dimmest: "#2A3B30",
};

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SAFE_B = "env(safe-area-inset-bottom, 0px)";
const SAFE_T = "env(safe-area-inset-top, 0px)";

// Motion — one easing language across the app
const EASE = "cubic-bezier(.2,.8,.2,1)";
const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
const SPRING = "cubic-bezier(.34,1.56,.64,1)";

// Elevation — soft, green-tinted shadows so cards feel lit from above
const SHADOW = {
  sm: "0 2px 8px rgba(0,0,0,.4)",
  md: "0 8px 24px rgba(0,0,0,.5)",
  lg: "0 16px 44px rgba(0,0,0,.6)",
  xl: "0 24px 64px rgba(0,0,0,.7)",
};

/* ----------------------------------------------------------------------------
   MOOD SYSTEM
   Four registers a voice can be dropped in. Each owns a color and a one-line
   blurb that doubles as a writing prompt.
   ---------------------------------------------------------------------------- */
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
const MOOD_ICON: Record<string, string> = {
  "Late Night": "🌙",
  Soft: "☁",
  Raw: "⚡",
  Spicy: "🔥",
};

/* ----------------------------------------------------------------------------
   ECONOMY
   Two currencies. PLAYS are spent listening; CREDITS are spent making (drops +
   replies). New accounts get a small grant of both. Nothing here is changed
   from the live model — only the surrounding UI is.
   ---------------------------------------------------------------------------- */
const PLAY_PACKS = [
  { n: 25, price: "$1", best: false, tag: "starter" },
  { n: 150, price: "$5", best: false, tag: "" },
  { n: 350, price: "$10", best: false, tag: "" },
  { n: 800, price: "$20", best: true, tag: "most pick this" },
  { n: 2500, price: "$50", best: false, tag: "" },
  { n: 6000, price: "$100", best: false, tag: "for the night owls" },
];
const CREDIT_PACKS = [
  { n: 15, price: "$1", best: false, tag: "starter" },
  { n: 80, price: "$5", best: false, tag: "" },
  { n: 180, price: "$10", best: false, tag: "" },
  { n: 400, price: "$20", best: true, tag: "most pick this" },
  { n: 1200, price: "$50", best: false, tag: "" },
  { n: 3000, price: "$100", best: false, tag: "for the loud ones" },
];
const PLAY_COST = 1;
const DROP_COST = 2;
const WELCOME_CREDITS = 7;
const WELCOME_PLAYS = 7;

// Mic Drop — the block-wide interrupt. Costs more than a normal drop and caps
// hard at 60s; only one may be live per city at a time (see cityKey below).
const MIC_DROP_COST = 10;
const MIC_DROP_MAX_SECS = 60;
const MIC_DROP_CHUNK_MS = 3000;

/* ----------------------------------------------------------------------------
   REACTIONS
   Voice-first means reactions are tiny and wordless. Three is the whole set.
   ---------------------------------------------------------------------------- */
const REACTIONS = [
  { key: "felt", glyph: "♥", label: "felt that", color: C.rose },
  { key: "same", glyph: "◎", label: "same", color: C.greenSoft },
  { key: "loud", glyph: "✦", label: "loud", color: C.amber },
];

/* ----------------------------------------------------------------------------
   WRITING PROMPTS
   The title field is the hardest blank page in the app, so we seed it with a
   rotating prompt tuned to the hour.
   ---------------------------------------------------------------------------- */
const TITLE_PROMPTS_NIGHT = [
  "the 2am thought I can't shake",
  "why am I still up",
  "something I'd never text",
  "the thing I keep replaying",
  "what the quiet sounds like tonight",
  "a confession with the lights off",
];
const TITLE_PROMPTS_DAY = [
  "my day at work today",
  "the small win today",
  "something I need to get off my chest",
  "what nobody asked but I'm saying anyway",
  "the thing that made me laugh",
  "a question for the block",
  "the rumor I keep hearing",
];
function pickTitlePrompt() {
  const hour = new Date().getHours();
  const pool = hour >= 22 || hour < 5 ? TITLE_PROMPTS_NIGHT : TITLE_PROMPTS_DAY;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ----------------------------------------------------------------------------
   REACH
   How far a drop travels. Distance only — never an exact pin.
   ---------------------------------------------------------------------------- */
const RADIUS_OPTIONS = [
  { mi: 1, blurb: "just your block" },
  { mi: 7, blurb: "around your area" },
  { mi: 25, blurb: "across the city" },
  { mi: 100, blurb: "the whole region" },
];
const DEFAULT_RADIUS_MI = 25;

// Feed sort modes
const SORT_MODES = [
  { key: "near", label: "NEAREST", glyph: "◎" },
  { key: "loud", label: "LOUDEST", glyph: "✦" },
  { key: "fresh", label: "FRESHEST", glyph: "◴" },
];


/* ----------------------------------------------------------------------------
   TYPES
   ActivityItem is given explicit optional fields so the live Firestore-mapped
   object structurally matches (the old `typeof ACTIVITY_SEED[0]` narrowed to a
   union of literal shapes and broke the build).
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

type Reply = {
  id?: string;
  uid?: string;
  handle: string;
  secs: number;
  ago?: string;
  audioUrl?: string;
  createdAt?: string;
};
type Ping = {
  id: string;
  uid?: string;
  handle: string;
  secs: number;
  mood: string;
  title: string;
  body?: string;
  createdAt?: string;
  audioUrl?: string;
  lat?: number | null;
  lng?: number | null;
  radiusMi?: number;
  pinnedTo?: string | null;
  pinnedToUid?: string | null;
  plays: number;
  ttl?: number;
  reacts: { felt: number; same: number; loud: number };
  replies: Reply[];
  distMi?: number | null;
  dist: string;
};
type Prefs = { sound: boolean; autoplay: boolean; notif: boolean; reduceMotion: boolean };

// A live Mic Drop broadcast — one doc per city, doubles as the per-city lock.
type MicDrop = {
  active: boolean;
  uid: string;
  handle: string;
  place: string;
  startedAt: string;
  expiresAt: string;
  chunks: string[];
  ended: boolean;
  endedAt: string | null;
};

/* ----------------------------------------------------------------------------
   HELPERS
   ---------------------------------------------------------------------------- */
function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8,
    toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1),
    dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compass bearing from point 1 → point 2, in degrees (0 = north, clockwise).
// Used to place voices on the radar by direction, not just distance.
function bearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Stable hash for an id → lets us give coordinate-less drops a consistent
// pseudo-direction so the radar still reads as a living place.
function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
function pseudoBearing(id: string) {
  return hashCode(id) % 360;
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
function fmtCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
  return `${Math.round(n / 1000)}k`;
}
function totalReacts(r: { felt: number; same: number; loud: number }) {
  return (r.felt || 0) + (r.same || 0) + (r.loud || 0);
}
function extractMention(title: string): string | null {
  const m = title.match(/@([a-z0-9_]{1,16})/i);
  return m ? m[1].toLowerCase() : null;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function isLateNight() {
  const h = new Date().getHours();
  return h >= 22 || h < 5;
}
// Slugifies a "City, ST" place string into a stable Firestore doc id — the
// key both the broadcast lock and every listener subscription are keyed on.
function cityKey(place: string) {
  const slug = place
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || "global";
}
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function daysBetween(aKey: string, bKey: string) {
  const a = new Date(aKey + "T00:00:00").getTime();
  const b = new Date(bKey + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}
// Light haptic cue where supported. Silent failure everywhere else.
function vibrate(ms: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    /* unsupported */
  }
}
// Soft greeting tuned to the clock — used on the feed header.
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "still up?";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  if (h < 22) return "good evening";
  return "late one tonight";
}

/* ----------------------------------------------------------------------------
   ICON SET
   A small, monoline inline-SVG vocabulary. Replacing the unicode glyphs with
   real strokes makes the whole app feel deliberate rather than typed. Every
   icon inherits color from `color` and scales from `size`.
   ---------------------------------------------------------------------------- */
const PATHS: Record<string, string> = {
  pause: "M9 5v14 M15 5v14",
  heart: "M12 20s-6.7-4.3-9-8.2C1.4 8.9 2.6 5.5 6 5.5c2 0 3.2 1.4 4 2.6.8-1.2 2-2.6 4-2.6 3.4 0 4.6 3.4 3 6.3C18.7 15.7 12 20 12 20Z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  spark: "M12 2.5l2.2 6.1 6.3.3-5 4 1.8 6.1-5.3-3.6L6.7 19l1.8-6.1-5-4 6.3-.3z",
  mic: "M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6",
  stop: "M7 7h10v10H7z",
  plus: "M12 5v14 M5 12h14",
  pin: "M12 22s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  bell: "M18 9a6 6 0 1 0-12 0c0 6-2 8-2 8h16s-2-2-2-8 M10 21a2 2 0 0 0 4 0",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M5 21a7 7 0 0 1 14 0",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M21 21l-4.3-4.3",
  location: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 3v3 M12 18v3 M3 12h3 M18 12h3",
  chevD: "M6 9l6 6 6-6",
  chevL: "M15 18l-6-6 6-6",
  chevR: "M9 6l6 6-6 6",
  send: "M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7Z",
  redo: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
  check: "M5 13l4 4 10-10",
  x: "M6 6l12 12 M18 6L6 18",
  skipBack: "M19 5v14L8 12l11-7Z M5 5v14",
  skipFwd: "M5 5v14l11-7L5 5Z M19 5v14",
  flame: "M12 22c4 0 7-2.7 7-6.6 0-3-1.8-5-3-6.4-.4 1.4-1.6 2-2.4 2 .6-2.4-.4-5.2-2.6-7-.2 2.4-1.6 3.8-3 5.2C6.2 11.6 5 13.4 5 15.4 5 19.3 8 22 12 22Z",
  ear: "M7 10a5 5 0 1 1 10 0c0 2.5-2 3.5-2.8 4.7-.7 1-.4 2.3-1.7 3.3a3 3 0 0 1-4.5-2.6 M9 10a3 3 0 0 1 5.4-1.8",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21 8.2 15.4 8.2 12 9.5 5.5 12 3Z",
  lock: "M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0v3",
  flag: "M5 21V4 M5 4h11l-2 4 2 4H5",
  mute: "M11 5L6 9H3v6h3l5 4V5Z M22 9l-5 6 M17 9l5 6",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M16 6l-4-4-4 4 M12 2v13",
  sliders: "M4 6h10 M18 6h2 M4 12h2 M10 12h10 M4 18h7 M15 18h5 M14 4v4 M6 10v4 M11 16v4",
  radio: "M4 9h16v11H4z M8 14a2 2 0 1 0 4 0 2 2 0 0 0-4 0 M16 12v.01 M4 9l13-5",
  echo: "M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  trophy: "M7 4h10v4a5 5 0 0 1-10 0V4Z M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3 M9 17h6 M10 17l.5-3h3l.5 3 M8 21h8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2",
  refresh: "M21 12a9 9 0 1 1-2.6-6.3 M21 3v5h-5",
  broadcast: "M12 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M8.5 14a5 5 0 0 1 7 0 M5.5 11a9 9 0 0 1 13 0",
};

function I({
  name,
  size = 18,
  color = "currentColor",
  sw = 1.85,
  fill = "none",
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  sw?: number;
  fill?: string;
  style?: React.CSSProperties;
}) {
  if (name === "play") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden>
        <path d="M7 4.5l13 7.5-13 7.5z" fill={color} stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      </svg>
    );
  }
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden>
      <path
        d={d}
        fill={fill}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Reaction glyphs use their own tuned shapes (heart / target / spark). */
function ReactGlyph({ kind, size = 16, color, solid = false }: { kind: string; size?: number; color: string; solid?: boolean }) {
  const name = kind === "felt" ? "heart" : kind === "same" ? "target" : "spark";
  return <I name={name} size={size} color={color} fill={solid ? color : "none"} sw={1.7} />;
}

/* ----------------------------------------------------------------------------
   BRAND MARK
   A dropped pin whose head is a concentric "listening" target — location plus
   sound, the whole thesis in one glyph.
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

function Wordmark({ size = 17, sub = true }: { size?: number; sub?: boolean }) {
  return (
    <div>
      <h1
        style={{
          margin: 0,
          fontFamily: MONO,
          fontSize: size,
          letterSpacing: 4,
          color: C.text,
          fontWeight: 800,
          textTransform: "uppercase",
        }}
      >
        nearhum
      </h1>
      {sub && (
        <p style={{ margin: "3px 0 0", fontSize: 10, color: C.dimmer, letterSpacing: 1, fontFamily: MONO }}>
          the hum of voices near you
        </p>
      )}
    </div>
  );
}

/* A small "live" indicator — three breathing bars + a label. */
function LiveDot({ label = "LIVE", color = C.green }: { label?: string; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 1.5, height: 10 }}>
        {["eqA", "eqB", "eqC"].map((a, i) => (
          <span
            key={i}
            style={{ width: 2, borderRadius: 9, background: color, animation: `${a} .9s ease-in-out infinite`, animationDelay: `${i * 90}ms` }}
          />
        ))}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, color, fontWeight: 700 }}>{label}</span>
    </span>
  );
}

/* ----------------------------------------------------------------------------
   WAVEFORMS + EQUALIZER
   Sound has to be visible everywhere there's audio. Three primitives:
     ProgWave  full-width scrubbable bars with a moving playhead
     Wave      compact bars for cards and rows
     Eq        the tiny three-bar "playing now" mark
   ---------------------------------------------------------------------------- */
function ProgWave({
  n = 40,
  color,
  progress = 0,
  h = 28,
  gap = 2,
  seed = 2,
  playing = false,
}: {
  n?: number;
  color: string;
  progress?: number;
  h?: number;
  gap?: number;
  seed?: number;
  playing?: boolean;
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
          ...(playing && played && !isHead
            ? {
                animation: `playWave ${0.52 + (i % 5) * 0.09}s ease-in-out infinite`,
                animationDelay: `${(i * 41) % 500}ms`,
              }
            : {}),
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
          transformOrigin: "center",
          ...(active
            ? {
                animation: `playWave ${0.6 + (i % 4) * 0.08}s ease-in-out infinite`,
                animationDelay: `${(i * 53) % 480}ms`,
              }
            : {}),
        }}
      />
    );
  }
  return <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, height: 22 }}>{bars}</div>;
}

function Eq({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: size, width: size }}>
      {["eqA", "eqB", "eqC"].map((a, i) => (
        <span key={i} style={{ flex: 1, background: color, borderRadius: 1, animation: `${a} .9s ease-in-out infinite` }} />
      ))}
    </div>
  );
}

/* A single breathing dot — used for "live" markers and unread pings. */
function Pulse({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: 99, background: color }} />
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 99,
          background: color,
          animation: "ping 1.8s cubic-bezier(0,0,.2,1) infinite",
        }}
      />
    </span>
  );
}

/* ----------------------------------------------------------------------------
   ATOMS — small shared building blocks
   ---------------------------------------------------------------------------- */
function SectionLabel({ children, color = C.dim, icon }: { children: React.ReactNode; color?: string; icon?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
      {icon && <I name={icon} size={12} color={color} />}
      <span style={{ fontFamily: MONO, fontSize: 10, color, letterSpacing: 2, fontWeight: 700 }}>{children}</span>
    </div>
  );
}

function Divider({ label }: { label?: string }) {
  if (!label)
    return <div style={{ height: 1, background: C.line, margin: "16px 0" }} />;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
      <div style={{ flex: 1, height: 1, background: C.line }} />
      <span style={{ fontFamily: MONO, fontSize: 9, color: C.dimmer, letterSpacing: 1.5 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.line }} />
    </div>
  );
}

function StatTile({ value, label, color = C.green }: { value: React.ReactNode; label: string; color?: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 16,
        padding: "16px 8px",
        textAlign: "center",
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 22, color, fontWeight: 700 }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1.5, marginTop: 4 }}>{label}</div>
    </div>
  );
}

/* Shimmering placeholder used while the feed tunes in. */
function Skeleton({ h = 96, mb = 10, r = 18 }: { h?: number; mb?: number; r?: number }) {
  return (
    <div
      style={{
        height: h,
        marginBottom: mb,
        borderRadius: r,
        background: `linear-gradient(100deg, ${C.card} 30%, ${C.cardHi} 50%, ${C.card} 70%)`,
        backgroundSize: "240% 100%",
        animation: "shimmer 1.4s ease-in-out infinite",
        border: `1px solid ${C.lineSoft}`,
      }}
    />
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding: "14px 16px", marginBottom: 10, borderRadius: 18, border: `1px solid ${C.lineSoft}`, background: C.card }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Skeleton h={10} mb={0} r={99} />
      </div>
      <Skeleton h={18} mb={12} r={6} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Skeleton h={34} mb={0} r={99} />
        <div style={{ flex: 4 }}>
          <Skeleton h={20} mb={0} r={6} />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   TOAST
   One-line transient confirmations. Lives above the dock + tab bar.
   ---------------------------------------------------------------------------- */
function Toast({ toast }: { toast: { msg: string; icon?: string; color?: string } | null }) {
  if (!toast) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: `calc(150px + ${SAFE_B})`,
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: hexA(C.panel, "F5"),
        border: `1px solid ${C.lineHi}`,
        color: C.text,
        fontFamily: MONO,
        fontSize: 12,
        letterSpacing: 0.5,
        padding: "10px 16px",
        borderRadius: 99,
        boxShadow: SHADOW.lg,
        backdropFilter: "blur(8px)",
        pointerEvents: "none",
        animation: "toastIn .2s ease-out",
        whiteSpace: "nowrap",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      {toast.icon && <I name={toast.icon} size={14} color={toast.color || C.green} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{toast.msg}</span>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   RADAR — the signature
   A sweep of the voices around you. Each drop is a blip placed by direction
   (around the dial) and distance (out from center). A green beam rotates like
   sonar. Tap a blip to jump straight to that voice. Even three drops make the
   block feel inhabited — which is the whole point of a hyperlocal feed.

   Direction uses a stable per-id angle (we only ever know rough distance, never
   an exact pin), and distance is read from the card's label, sqrt-compressed so
   near voices cluster at the center and far ones ride the rim.
   ---------------------------------------------------------------------------- */
function parseDistMi(s: string): number | null {
  if (!s) return null;
  if (s.includes("block")) return 0.03;
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function Radar({
  pings,
  currentId,
  onPick,
  size = 280,
  live = true,
}: {
  pings: Ping[];
  currentId?: string;
  onPick: (id: string) => void;
  size?: number;
  live?: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const pad = 26;
  const maxR = cx - pad;

  const blips = useMemo(() => {
    const parsed = pings.slice(0, 18).map((p) => {
      const d = parseDistMi(p.dist);
      return { p, d };
    });
    const known = parsed.map((x) => x.d).filter((d): d is number => d != null);
    const scaleMax = Math.max(0.5, ...known, 1);
    return parsed.map(({ p, d }) => {
      const bd = pseudoBearing(p.id);
      const rad = (bd * Math.PI) / 180;
      // sqrt compression keeps the center from getting lonely
      const frac =
        d != null
          ? clamp(Math.sqrt(d / scaleMax), 0.1, 0.96)
          : 0.35 + (hashCode(p.id) % 50) / 100;
      const R = pad + frac * (maxR - pad);
      return {
        id: p.id,
        mood: p.mood,
        x: cx + R * Math.sin(rad),
        y: cy - R * Math.cos(rad),
        loud: totalReacts(p.reacts) + p.plays,
        title: p.title,
      };
    });
  }, [pings, cx, cy, maxR]);

  const rings = [0.33, 0.66, 1];

  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <defs>
          <radialGradient id="radarFloor" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={hexA(C.green, "16")} />
            <stop offset="70%" stopColor={hexA(C.green, "08")} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="radarBeam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hexA(C.greenGlow, "55")} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>

        {/* floor glow */}
        <circle cx={cx} cy={cy} r={maxR} fill="url(#radarFloor)" />

        {/* range rings */}
        {rings.map((f, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={pad + f * (maxR - pad)}
            fill="none"
            stroke={C.line}
            strokeWidth={1}
            opacity={0.7 - i * 0.12}
          />
        ))}
        <circle cx={cx} cy={cy} r={maxR} fill="none" stroke={C.lineHi} strokeWidth={1.4} />

        {/* crosshairs */}
        <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke={C.lineSoft} strokeWidth={1} />
        <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke={C.lineSoft} strokeWidth={1} />

        {/* rotating sweep beam */}
        {live && (
          <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: "sweep 4.2s linear infinite" }}>
            <path d={`M ${cx} ${cy} L ${cx} ${cy - maxR} A ${maxR} ${maxR} 0 0 1 ${cx + maxR * 0.5} ${cy - maxR * 0.866} Z`} fill="url(#radarBeam)" />
            <line x1={cx} y1={cy} x2={cx} y2={cy - maxR} stroke={C.greenGlow} strokeWidth={1.4} opacity={0.9} />
          </g>
        )}

        {/* blips */}
        {blips.map((b) => {
          const mc = MOOD[b.mood] || C.green;
          const isCur = b.id === currentId;
          const r = isCur ? 6 : 4 + Math.min(b.loud / 60, 3);
          return (
            <g key={b.id} style={{ cursor: "pointer" }} onClick={() => onPick(b.id)}>
              <circle cx={b.x} cy={b.y} r={r + 6} fill={hexA(mc, "10")} />
              {isCur && <circle cx={b.x} cy={b.y} r={r} fill="none" stroke={mc} strokeWidth={1.5} style={{ transformOrigin: `${b.x}px ${b.y}px`, animation: "blipPing 1.6s ease-out infinite" }} />}
              <circle cx={b.x} cy={b.y} r={r} fill={mc} style={isCur ? {} : { animation: `breathe ${2 + (hashCode(b.id) % 20) / 10}s ease-in-out infinite` }} />
            </g>
          );
        })}

        {/* you */}
        <circle cx={cx} cy={cy} r={5} fill={C.text} />
        <circle cx={cx} cy={cy} r={9} fill="none" stroke={C.greenSoft} strokeWidth={1.2} opacity={0.6} />
      </svg>

      {/* cardinal labels */}
      {[
        ["N", cx, 8, "translate(-50%,0)"],
        ["S", cx, size - 8, "translate(-50%,-100%)"],
        ["E", size - 6, cy, "translate(-100%,-50%)"],
        ["W", 6, cy, "translate(0,-50%)"],
      ].map(([t, x, y, tr]) => (
        <span
          key={t as string}
          style={{
            position: "absolute",
            left: x as number,
            top: y as number,
            transform: tr as string,
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: 1,
            color: C.dimmer,
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   MOOD FILTER
   ---------------------------------------------------------------------------- */
function MoodFilter({ active, onPick, counts }: { active: string; onPick: (m: string) => void; counts?: Record<string, number> }) {
  const all = ["All", ...MOOD_LIST];
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, marginBottom: 16, scrollbarWidth: "none" }}>
      {all.map((m) => {
        const on = active === m;
        const col = m === "All" ? C.green : MOOD[m];
        const c = counts ? counts[m] ?? 0 : null;
        return (
          <button
            key={m}
            onClick={() => {
              vibrate(6);
              onPick(m);
            }}
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: on ? "7px 14px" : "7px 12px",
              borderRadius: 99,
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: 0.8,
              border: `1px solid ${on ? col : C.line}`,
              background: on ? `linear-gradient(135deg, ${hexA(col, "28")}, ${hexA(col, "0E")})` : C.panel2,
              color: on ? col : C.dim,
              transition: `all .15s ${EASE}`,
              boxShadow: on ? `0 2px 12px ${hexA(col, "33")}` : "none",
            }}
          >
            {m !== "All" && <span style={{ fontSize: 10 }}>{MOOD_ICON[m]}</span>}
            {m.toUpperCase()}
            {c != null && c > 0 && (
              <span style={{ fontSize: 9, color: on ? col : C.dimmer, opacity: 0.8 }}>{c}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   SORT BAR — segmented control for ordering the feed
   ---------------------------------------------------------------------------- */
function SortBar({ mode, onPick }: { mode: string; onPick: (m: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, background: C.panel2, borderRadius: 12, padding: 4, marginBottom: 14 }}>
      {SORT_MODES.map((s) => {
        const on = mode === s.key;
        return (
          <button
            key={s.key}
            onClick={() => {
              vibrate(6);
              onPick(s.key);
            }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "9px 0",
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 10.5,
              letterSpacing: 1,
              fontWeight: 700,
              background: on ? hexA(C.green, "1E") : "transparent",
              color: on ? C.green : C.dim,
              transition: `all .15s ${EASE}`,
            }}
          >
            <span style={{ fontSize: 11 }}>{s.glyph}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   A tiny synthesized "hum" — used so onboarding can demonstrate sound without
   shipping an audio asset. A soft sine with a gentle bloom envelope.
   ---------------------------------------------------------------------------- */
function playHum() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const make = (freq: number, delay: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    };
    make(174, 0, 1.1, 0.08);
    make(261, 0.12, 1.0, 0.05);
    make(349, 0.26, 0.9, 0.035);
    setTimeout(() => ctx.close().catch(() => {}), 1600);
  } catch {
    /* no audio context */
  }
}

/* ----------------------------------------------------------------------------
   ONBOARDING
   welcome → location → account → mic → enter. Auth (create/sign-in, the
   welcome grant, the first activity + ledger rows) is unchanged from the live
   build; only the surrounding flow and copy are new.
   ---------------------------------------------------------------------------- */
function friendlyError(code: string) {
  if (code === "auth/email-already-in-use") return "That email is already registered. Sign in instead.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential")
    return "Wrong email or password.";
  if (code === "auth/too-many-requests") return "Too many tries. Wait a moment and try again.";
  if (code === "auth/network-request-failed") return "Network issue. Check your connection.";
  return "Something went wrong. Try again.";
}

function Onboarding({ onDone }: { onDone: (handle: string) => void }) {
  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [locState, setLocState] = useState<"idle" | "asking" | "granted" | "denied">("idle");
  const [micState, setMicState] = useState<"idle" | "granted" | "denied">("idle");
  const locationRef = useRef<GeolocationCoordinates | null>(null);
  const TOTAL = 5;

  const next = () => setStep((s) => Math.min(s + 1, TOTAL - 1));

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocState("denied");
      setStep(2);
      return;
    }
    setLocState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locationRef.current = pos.coords;
        setLocState("granted");
        vibrate(10);
        setTimeout(() => setStep(2), 480);
      },
      () => {
        setLocState("denied");
        setStep(2);
      }
    );
  };

  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState("granted");
      vibrate(10);
      setTimeout(next, 520);
    } catch {
      setMicState("denied");
    }
  };

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) return;
    if (mode === "signup" && !handle.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const loc = locationRef.current;
      const locFields = loc
        ? {
            location: {
              lat: loc.latitude,
              lng: loc.longitude,
              grantedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }
        : {};
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const uid = cred.user.uid;
        setDoc(doc(firestore, "users", uid), {
          handle: handle.trim(),
          email: email.trim(),
          credits: WELCOME_CREDITS,
          plays: WELCOME_PLAYS,
          createdAt: new Date().toISOString(),
          streak: 0,
          lastActiveDay: "",
          ...locFields,
        }).catch(() => {});
        addDoc(collection(firestore, "users", uid, "activity"), {
          type: "system",
          detail: `Welcome to Nearhum. Your first ${WELCOME_PLAYS} plays and ${WELCOME_CREDITS} credits are on us.`,
          at: new Date().toISOString(),
          unread: true,
        }).catch(() => {});
        addDoc(collection(firestore, "users", uid, "ledger"), {
          label: "Welcome bonus",
          delta: WELCOME_CREDITS,
          at: new Date().toISOString(),
        }).catch(() => {});
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        try {
          const snap = await getDoc(doc(firestore, "users", cred.user.uid));
          if (snap.exists()) setHandle((snap.data().handle as string) || "—");
          if (loc)
            updateDoc(doc(firestore, "users", cred.user.uid), {
              "location.lat": loc.latitude,
              "location.lng": loc.longitude,
              "location.updatedAt": new Date().toISOString(),
            }).catch(() => {});
        } catch {
          /* Firestore unavailable, proceed anyway */
        }
      }
      setStep(3);
    } catch (e: unknown) {
      setAuthError(friendlyError((e as { code: string }).code));
    }
    setAuthLoading(false);
  };

  const Btn = ({
    children,
    onClick,
    disabled,
    ghost,
    icon,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    ghost?: boolean;
    icon?: string;
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        transition: `background .15s ${EASE}`,
      }}
    >
      {icon && <I name={icon} size={16} color={ghost ? C.dim : C.bg} />}
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
      {/* progress */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 36 }}>
        {Array.from({ length: TOTAL }).map((_, n) => (
          <span
            key={n}
            style={{
              width: n === step ? 22 : 6,
              height: 6,
              borderRadius: 99,
              background: n <= step ? C.green : C.line,
              transition: `all .25s ${EASE}`,
            }}
          />
        ))}
      </div>

      {/* 0 — welcome */}
      {step === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 26 }}>
            <Mark size={84} knock={C.greenInk} />
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.15, margin: "0 0 14px", letterSpacing: -0.5 }}>
            Hear what your block is saying.
          </h1>
          <p style={{ fontSize: 15, color: C.textDim, lineHeight: 1.6, margin: 0 }}>
            Nearhum is a voice network for exactly where you're standing. Drop a 60-second voice, hear the
            ones near you, reply in your own voice. It plays itself — like a radio of your neighborhood.
          </p>
          <button
            onClick={() => {
              vibrate(8);
              playHum();
            }}
            style={{
              marginTop: 22,
              alignSelf: "center",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              borderRadius: 99,
              border: `1px solid ${C.lineHi}`,
              background: hexA(C.green, "0C"),
              color: C.greenSoft,
              fontFamily: MONO,
              fontSize: 12,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            <I name="play" size={13} color={C.greenSoft} />
            hear the hum
          </button>
          <div style={{ flex: 1 }} />
          <Btn onClick={next} icon="chevR">
            GET STARTED
          </Btn>
          <p style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 14 }}>
            Anonymous to everyone · No calls · No DMs
          </p>
        </div>
      )}

      {/* 1 — location */}
      {step === 1 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <RippleBloom done={locState === "granted"} />
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 10px", textAlign: "center" }}>
            {locState === "granted" ? "Got it." : "Nearhum is wherever you are."}
          </h2>
          <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, textAlign: "center", margin: 0 }}>
            {locState === "granted"
              ? "We'll tune your feed to the voices around you."
              : "The feed is built from voices near you. We use rough distance and direction only — your exact spot is never shown to anyone."}
          </p>
          <div style={{ flex: 1 }} />
          {locState !== "granted" && (
            <>
              <Btn onClick={requestLocation} disabled={locState === "asking"} icon="location">
                {locState === "asking" ? "LOCATING…" : "ALLOW LOCATION"}
              </Btn>
              <Btn ghost onClick={() => setStep(2)}>
                NOT NOW
              </Btn>
            </>
          )}
        </div>
      )}

      {/* 2 — account */}
      {step === 2 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 6px" }}>
            {mode === "signup" ? "Create your account." : "Welcome back."}
          </h2>
          <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, margin: "0 0 22px" }}>
            {mode === "signup" ? "Your @ is how you show up on the block." : "Sign in to pick up where you left off."}
          </p>

          {mode === "signup" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 17,
                  color: C.dim,
                  background: C.panel,
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  padding: "0 13px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                @
              </div>
              <input
                autoFocus
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 16))}
                placeholder="nightowl"
                style={{
                  flex: 1,
                  fontFamily: MONO,
                  fontSize: 17,
                  color: C.text,
                  background: C.panel,
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  padding: 15,
                  outline: "none",
                }}
              />
            </div>
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            placeholder="password"
            style={{ ...inputStyle, marginBottom: 8 }}
          />

          {authError && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 10, lineHeight: 1.4 }}>{authError}</div>
          )}

          <button
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setAuthError(null);
            }}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 0 14px",
              fontFamily: MONO,
              fontSize: 11,
              color: C.dim,
              cursor: "pointer",
              textAlign: "left",
              letterSpacing: 0.5,
            }}
          >
            {mode === "signup" ? "Already have an account? SIGN IN →" : "No account? CREATE ONE →"}
          </button>

          <div style={{ flex: 1 }} />
          <Btn
            onClick={handleAuth}
            disabled={authLoading || !email.trim() || !password.trim() || (mode === "signup" && !handle.trim())}
            icon={authLoading ? undefined : "chevR"}
          >
            {authLoading ? "…" : mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
          </Btn>
        </div>
      )}

      {/* 3 — mic */}
      {step === 3 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 99,
              border: `2px solid ${micState === "granted" ? C.green : C.lineHi}`,
              background: micState === "granted" ? hexA(C.green, "14") : C.panel,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 22px",
              transition: `all .3s ${EASE}`,
            }}
          >
            {micState === "granted" ? <Eq color={C.green} size={30} /> : <I name="mic" size={38} color={C.greenSoft} />}
          </div>
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 10px" }}>
            {micState === "granted" ? "Mic's ready." : "Replies are voice, not text."}
          </h2>
          <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, margin: "0 0 8px" }}>
            {micState === "denied"
              ? "No mic for now — you can still listen and react. Turn it on later in settings to drop and hum."
              : "Nearhum needs your mic so you can record voices. Nothing is recorded until you press the button."}
          </p>
          <div style={{ flex: 1 }} />
          {micState !== "granted" && (
            <>
              <Btn onClick={requestMic} icon="mic">
                ALLOW MIC
              </Btn>
              <Btn ghost onClick={next}>
                I'LL JUST LISTEN
              </Btn>
            </>
          )}
        </div>
      )}

      {/* 4 — enter */}
      {step === 4 && (
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
              color: C.green,
              margin: "0 auto 22px",
            }}
          >
            <I name="check" size={40} color={C.green} sw={2.4} />
          </div>
          <h2 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 10px" }}>
            You're {!handle || handle === "—" ? "anonymous" : `@${handle}`} on Nearhum.
          </h2>
          <p style={{ fontSize: 15, color: C.textDim, lineHeight: 1.6, margin: "0 0 8px" }}>
            {WELCOME_PLAYS} plays and {WELCOME_CREDITS} credits are on us. Press play and listen to your block —
            then drop your first voice.
          </p>
          <div style={{ flex: 1 }} />
          <Btn onClick={() => onDone(!handle ? "—" : handle)} icon="radio">
            ENTER NEARHUM
          </Btn>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: MONO,
  fontSize: 15,
  color: C.text,
  background: C.panel,
  border: `1px solid ${C.line}`,
  borderRadius: 12,
  padding: 15,
  outline: "none",
  marginBottom: 12,
};

function RippleBloom({ done = false }: { done?: boolean }) {
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
            stroke={done ? C.greenSoft : C.green}
            strokeWidth="2"
            opacity={0.5 - i * 0.12}
            style={{ animation: `bloom ${2 + i * 0.4}s ease-in-out infinite` }}
          />
        ))}
        <circle cx="75" cy="75" r="6" fill={done ? C.greenSoft : C.green} />
        {done && <path d="M64 75l8 8 16-18" fill="none" stroke={C.greenSoft} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   SPLASH LOADER
   ---------------------------------------------------------------------------- */
function Loader() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: `radial-gradient(130% 90% at 50% 10%, ${hexA(C.green, "16")}, ${C.bg} 55%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "fadeIn .25s ease-out",
      }}
    >
      <div style={{ position: "relative", width: 130, height: 130, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32 }}>
        <svg width="130" height="130" style={{ position: "absolute", inset: 0 }}>
          {[52, 38, 24].map((r, i) => (
            <circle
              key={i}
              cx="65"
              cy="65"
              r={r}
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
      <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 5, color: C.text, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>
        nearhum
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer, letterSpacing: 1.5, marginBottom: 44 }}>
        the hum of voices near you
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: 28 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{
              width: 4,
              borderRadius: 99,
              background: C.green,
              opacity: 0.55,
              animation: `${["eqA", "eqB", "eqC", "eqB", "eqA"][i]} ${0.8 + i * 0.1}s ease-in-out infinite`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   COACH MARKS
   A one-time, dismissible overlay that names the three gestures that aren't
   obvious: the radar, the self-playing feed, and that replies are voice.
   ---------------------------------------------------------------------------- */
function CoachMarks({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const cards = [
    { icon: "target", title: "This is your radar", body: "Every dot is a voice near you, placed by direction and distance. Tap one to jump straight to it." },
    { icon: "radio", title: "It plays itself", body: "The feed is a radio — when one voice ends, the next nearby one starts. Just listen." },
    { icon: "mic", title: "Reply in your voice", body: "No typing back. Tap Hum to leave a short voice reply. Drops fade after 24 hours." },
  ];
  const c = cards[i];
  const last = i === cards.length - 1;
  return (
    <div
      onClick={() => (last ? onClose() : setI((x) => x + 1))}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        background: "rgba(2,5,3,.86)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        animation: "fadeIn .2s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 360,
          background: C.panel,
          border: `1px solid ${C.lineHi}`,
          borderRadius: 22,
          padding: 26,
          textAlign: "center",
          boxShadow: SHADOW.xl,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: hexA(C.green, "16"),
            border: `1px solid ${hexA(C.green, "44")}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
          }}
        >
          <I name={c.icon} size={28} color={C.green} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 750, color: C.text, marginBottom: 8 }}>{c.title}</div>
        <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, margin: "0 0 22px" }}>{c.body}</p>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
          {cards.map((_, n) => (
            <span key={n} style={{ width: n === i ? 20 : 6, height: 6, borderRadius: 99, background: n === i ? C.green : C.line, transition: `all .2s ${EASE}` }} />
          ))}
        </div>
        <button
          onClick={() => (last ? onClose() : setI((x) => x + 1))}
          style={{
            width: "100%",
            padding: 15,
            borderRadius: 14,
            border: "none",
            background: C.green,
            color: C.bg,
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1.5,
            cursor: "pointer",
          }}
        >
          {last ? "START LISTENING" : "NEXT"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   VOICE CARD
   One drop in the feed. Shows mood, who + distance, title, a play/wave row,
   and a thin stat line. The currently-playing card lights to its mood color
   and shows an ON AIR tag.
   ---------------------------------------------------------------------------- */
function VoiceCard({
  p,
  isCurrent,
  playing,
  onPick,
}: {
  p: Ping;
  isCurrent: boolean;
  playing: boolean;
  onPick: (id: string) => void;
}) {
  const mc = MOOD[p.mood] || C.green;
  const pAny = p as unknown as { createdAt?: string; radiusMi?: number; pinnedTo?: string | null; ttl?: number };
  const fadingSoon = (pAny.ttl ?? 24) <= 4;
  return (
    <button
      onClick={() => {
        vibrate(6);
        onPick(p.id);
      }}
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
        transition: `border-color .2s ${EASE}, background .2s ${EASE}`,
        boxShadow: isCurrent ? `0 6px 22px ${hexA(mc, "22")}` : "none",
      }}
    >
      {/* mood · handle · dist · time */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: mc, flexShrink: 0 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 1, flexShrink: 0 }}>{p.mood.toUpperCase()}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          @{p.handle} · {p.dist}
        </span>
        {isCurrent && playing ? (
          <span style={{ marginLeft: "auto", flexShrink: 0 }}>
            <LiveDot label="ON AIR" color={mc} />
          </span>
        ) : (
          pAny.createdAt && (
            <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dimmer, flexShrink: 0 }}>
              {timeAgo(pAny.createdAt)}
            </span>
          )
        )}
      </div>

      {/* title */}
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {p.title}
      </div>

      {/* play + wave + duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 99,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isCurrent ? mc : hexA(mc, "22"),
            color: isCurrent ? C.bg : mc,
          }}
        >
          {isCurrent && playing ? <Eq color={C.bg} size={14} /> : <I name="play" size={13} color={isCurrent ? C.bg : mc} />}
        </div>
        <Wave n={22} active={isCurrent && playing} color={mc} seed={p.id.length * 2} />
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, flexShrink: 0 }}>{fmtSecs(p.secs)}</span>
      </div>

      {/* stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 11, color: C.dim }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I name="play" size={11} color={C.dim} /> {fmtCount(p.plays)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I name="mic" size={11} color={C.dim} sw={1.6} /> {p.replies.length}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: totalReacts(p.reacts) > 0 ? C.rose : C.dimmer }}>
          <I name="heart" size={11} color={totalReacts(p.reacts) > 0 ? C.rose : C.dimmer} /> {totalReacts(p.reacts)}
        </span>
        {pAny.pinnedTo && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.cyan }}>
            <I name="pin" size={11} color={C.cyan} />
          </span>
        )}
        {fadingSoon && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.amber }}>
            <I name="clock" size={11} color={C.amber} /> soon
          </span>
        )}
        {pAny.radiusMi != null && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, color: C.dim }}>
            <I name="echo" size={11} color={C.dim} /> {pAny.radiusMi}mi
          </span>
        )}
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   LOUDEST HERO
   The thesis on the feed: the single most-heard voice near you, presented big.
   ---------------------------------------------------------------------------- */
function LoudestHero({ p, onOpen }: { p: Ping | null; onOpen: (id: string) => void }) {
  if (!p) return null;
  const mc = MOOD[p.mood] || C.green;
  return (
    <button
      onClick={() => {
        vibrate(8);
        onOpen(p.id);
      }}
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
        boxShadow: `0 10px 30px ${hexA(mc, "1E")}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <I name="spark" size={13} color={mc} />
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: mc }}>LOUDEST NEAR YOU</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I name="play" size={10} color={C.dim} /> {fmtCount(p.plays)}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 750, color: C.text, lineHeight: 1.2, marginBottom: 12 }}>{p.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: 99,
            flexShrink: 0,
            background: mc,
            color: C.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 6px 20px ${hexA(mc, "66")}`,
          }}
        >
          <I name="play" size={18} color={C.bg} />
        </span>
        <Wave n={26} active color={mc} seed={9} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, flexShrink: 0 }}>{fmtSecs(p.secs)}</span>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   MINI PLAYER
   Always-docked transport above the tab bar. Tap to expand; the right button
   toggles play without expanding.
   ---------------------------------------------------------------------------- */
function MiniPlayer({
  p,
  progress,
  playing,
  onToggle,
  onExpand,
}: {
  p: Ping;
  progress: number;
  playing: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const mc = MOOD[p.mood] || C.green;
  return (
    <div
      onClick={onExpand}
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: `calc(68px + ${SAFE_B})`,
        width: "calc(100% - 24px)",
        maxWidth: 460,
        cursor: "pointer",
        zIndex: 41,
      }}
    >
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          background: hexA(C.panel, "F0"),
          border: `1px solid ${hexA(mc, "44")}`,
          boxShadow: `${SHADOW.lg}, 0 0 0 1px ${hexA(mc, "18")}`,
          backdropFilter: "blur(20px)",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: C.line }}>
          <div style={{ height: "100%", width: `${progress * 100}%`, background: mc, transition: "width .12s linear", borderRadius: 99 }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              flexShrink: 0,
              background: `linear-gradient(135deg, ${hexA(mc, "30")}, ${hexA(mc, "10")})`,
              border: `1px solid ${hexA(mc, "50")}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: mc,
            }}
          >
            {playing ? <Eq color={mc} size={16} /> : <I name="play" size={15} color={mc} />}
          </div>

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

          <button
            onClick={(e) => {
              e.stopPropagation();
              vibrate(8);
              onToggle();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 99,
              border: "none",
              flexShrink: 0,
              background: mc,
              color: C.bg,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 4px 14px ${hexA(mc, "55")}`,
            }}
          >
            {playing ? <I name="pause" size={15} color={C.bg} sw={2.4} /> : <I name="play" size={14} color={C.bg} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   FULL-SCREEN PLAYER
   The immersive view. Drag down to dismiss. Reactions are wordless; the big
   action is Hum (reply in voice). Skip/prev move through the radio.
   ---------------------------------------------------------------------------- */
function FullPlayer({
  p,
  progress,
  playing,
  onToggle,
  onSkip,
  onPrev,
  onReply,
  onReact,
  userReact,
  onCollapse,
  onMore,
  idx,
  total,
  isOwn,
}: {
  p: Ping;
  progress: number;
  playing: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onPrev: () => void;
  onReply: () => void;
  onReact: (key: string) => void;
  userReact: string | undefined;
  onCollapse: () => void;
  onMore: () => void;
  idx: number;
  total: number;
  isOwn: boolean;
}) {
  const mc = MOOD[p.mood] || C.green;
  const elapsed = Math.round(p.secs * progress);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const pAny = p as unknown as { radiusMi?: number; ttl?: number };

  const down = (e: React.MouseEvent | React.TouchEvent) => {
    startY.current = "touches" in e ? e.touches[0].clientY : e.clientY;
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (startY.current == null) return;
    const y = "touches" in e ? e.touches[0].clientY : e.clientY;
    setDragY(Math.max(0, y - startY.current));
  };
  const up = () => {
    if (dragY > 120) {
      vibrate(10);
      onCollapse();
    }
    setDragY(0);
    startY.current = null;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: `linear-gradient(180deg, ${hexA(mc, "38")} 0%, ${C.bg} 58%)`,
        display: "flex",
        flexDirection: "column",
        padding: `calc(12px + ${SAFE_T}) 22px calc(28px + ${SAFE_B})`,
        transform: `translateY(${dragY}px)`,
        transition: startY.current == null ? `transform .25s ${EASE_OUT}` : "none",
        opacity: 1 - dragY / 600,
      }}
    >
      {/* grabber + header */}
      <div onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up} style={{ cursor: "grab", paddingBottom: 4 }}>
        <div style={{ width: 42, height: 5, borderRadius: 99, background: hexA(C.text, "55"), margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <button onClick={onCollapse} style={{ width: 40, height: 40, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", marginLeft: -8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <I name="chevD" size={22} color={C.text} />
          </button>
          <span style={{ margin: "0 auto", fontFamily: MONO, fontSize: 10, color: C.text, letterSpacing: 2, opacity: 0.85 }}>
            {playing ? "ON AIR" : "PAUSED"} · {idx + 1}/{total}
          </span>
          <button onClick={onMore} style={{ width: 40, height: 40, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginRight: -8 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 4, height: 4, borderRadius: 99, background: C.text }} />
              ))}
            </span>
          </button>
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: mc }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: mc, letterSpacing: 1.5 }}>{p.mood.toUpperCase()}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>@{p.handle} · {p.dist}</span>
          {pAny.radiusMi != null && (
            <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: C.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <I name="echo" size={11} color={C.dim} /> {pAny.radiusMi}mi
            </span>
          )}
        </div>
        <div style={{ fontSize: 33, fontWeight: 780, color: C.text, lineHeight: 1.15, letterSpacing: -0.5, marginBottom: 14 }}>{p.title}</div>
        {p.body && <p style={{ fontSize: 14, color: C.textDim, lineHeight: 1.5, margin: "0 0 30px" }}>{p.body}</p>}
        <ProgWave n={42} color={mc} progress={progress} h={96} gap={3} seed={p.id.length} playing={playing} />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 12 }}>
          <span>{fmtSecs(elapsed)}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <I name="ear" size={11} color={C.dim} /> {fmtCount(p.plays)} listening
          </span>
          <span>{fmtSecs(p.secs)}</span>
        </div>
      </div>

      {/* reactions */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 18 }}>
        {REACTIONS.map((r) => {
          const on = userReact === r.key;
          return (
            <button
              key={r.key}
              onClick={() => {
                if (!isOwn) {
                  vibrate(on ? 6 : 12);
                  onReact(r.key);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "9px 14px",
                borderRadius: 99,
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 600,
                cursor: isOwn ? "not-allowed" : "pointer",
                opacity: isOwn ? 0.35 : 1,
                border: `1px solid ${on ? r.color : C.line}`,
                background: on ? hexA(r.color, "22") : "transparent",
                color: on ? r.color : C.textDim,
                transition: `all .15s ${SPRING}`,
                transform: on ? "scale(1.04)" : "scale(1)",
              }}
            >
              <ReactGlyph kind={r.key} size={15} color={on ? r.color : C.textDim} solid={on} />
              {(p.reacts as Record<string, number>)[r.key] || 0}
            </button>
          );
        })}
      </div>

      {/* transport */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, marginBottom: 20 }}>
        <button onClick={onPrev} style={{ width: 52, height: 52, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <I name="skipBack" size={22} color={C.text} />
        </button>
        <button onClick={onToggle} style={{ width: 78, height: 78, borderRadius: 99, border: "none", background: mc, color: C.bg, cursor: "pointer", boxShadow: `0 8px 34px ${hexA(mc, "66")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {playing ? <I name="pause" size={28} color={C.bg} sw={2.6} /> : <I name="play" size={26} color={C.bg} />}
        </button>
        <button onClick={onSkip} style={{ width: 52, height: 52, borderRadius: 99, border: "none", background: "transparent", color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <I name="skipFwd" size={22} color={C.text} />
        </button>
      </div>

      {/* hum (voice reply) */}
      <button
        onClick={() => {
          vibrate(8);
          onReply();
        }}
        style={{
          width: "100%",
          padding: 18,
          borderRadius: 16,
          border: `1px solid ${mc}`,
          background: hexA(mc, "1A"),
          color: mc,
          fontFamily: MONO,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
        }}
      >
        <I name="mic" size={16} color={mc} sw={1.7} />
        HUM · {p.replies.length}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   SHEET — the base bottom sheet every modal sits on
   ---------------------------------------------------------------------------- */
function Sheet({ children, onClose, accent = C.green }: { children: React.ReactNode; onClose: () => void; accent?: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.64)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 80,
        animation: "fadeIn .15s ease-out",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: C.panel,
          borderTop: `2px solid ${accent}`,
          borderRadius: "24px 24px 0 0",
          padding: `16px 18px calc(26px + ${SAFE_B})`,
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          animation: `sheetUp .25s ${EASE}`,
          boxShadow: SHADOW.xl,
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 99, background: C.line, margin: "0 auto 18px" }} />
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   REPLY (HUM) SHEET
   Browse the voice replies on a drop and record your own. Upload to Cloudinary
   and append to the drop's replies array — unchanged from the live build.
   ---------------------------------------------------------------------------- */
function ReplySheet({
  ping,
  onClose,
  onAddReply,
  uid,
  myHandle,
  credits,
  onPlayReply,
}: {
  ping: Ping;
  onClose: () => void;
  onAddReply: () => void;
  uid: string;
  myHandle: string;
  credits: number;
  onPlayReply: () => boolean;
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
  const mc = MOOD[ping.mood] || C.green;

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
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const i = setInterval(
      () =>
        setRecSecs((s) => {
          if (s >= 59) {
            stopRec();
            return 59;
          }
          return s + 1;
        }),
      1000
    );
    return () => clearInterval(i);
  }, [recording]);

  const startRec = async () => {
    setMicError(null);
    setAudioBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start(100);
      mrRef.current = mr;
      setRecSecs(0);
      setRecording(true);
      vibrate(12);
    } catch {
      setMicError("Mic access denied. Turn it on in your browser settings.");
    }
  };

  const stopRec = () => {
    mrRef.current?.stop();
    mrRef.current = null;
    setRecording(false);
    vibrate(8);
  };

  const send = async () => {
    if (!audioBlob) return;
    if (credits < 1) {
      setMicError("Not enough credits to hum. Top up to reply.");
      return;
    }
    setUploading(true);
    setMicError(null);
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
      setAudioBlob(null);
      setRecSecs(0);
    } catch {
      setMicError("Upload failed. Check your connection and try again.");
    }
    setUploading(false);
  };

  const togglePlay = (r: Reply, i: number) => {
    const rx = r as unknown as { audioUrl?: string; createdAt?: string };
    const audioUrl = rx.audioUrl || "";
    const key = rx.createdAt || r.id || String(i);
    const audio = humAudioRef.current;
    if (!audio || !audioUrl) return;
    if (playingKey === key) {
      audio.pause();
      setPlayingKey(null);
    } else {
      if (!onPlayReply()) return;
      audio.src = audioUrl;
      audio.play().catch(() => {});
      setPlayingKey(key);
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
      <div style={{ fontFamily: MONO, fontSize: 10, color: mc, letterSpacing: 2, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <I name="mic" size={11} color={mc} sw={1.6} />
        {ping.replies.length > 0 ? `${ping.replies.length} HUM${ping.replies.length !== 1 ? "S" : ""}` : "NO HUMS YET"}
      </div>

      <div style={{ flex: 1, marginBottom: 14, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {ping.replies.length === 0 ? (
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "28px 0", lineHeight: 1.6 }}>
            No voice replies yet. Drop the first hum.
          </div>
        ) : (
          (() => {
            const safeIdx = Math.min(replyIdx, ping.replies.length - 1);
            const r = ping.replies[safeIdx];
            const rx = r as unknown as { audioUrl?: string; createdAt?: string };
            const key = rx.createdAt || r.id || String(safeIdx);
            const on = playingKey === key;
            return (
              <div
                onTouchStart={(e) => {
                  swipeX.current = e.touches[0].clientX;
                }}
                onTouchEnd={(e) => {
                  if (swipeX.current === null) return;
                  const dx = e.changedTouches[0].clientX - swipeX.current;
                  swipeX.current = null;
                  if (dx < -44 && safeIdx < ping.replies.length - 1) goReply(safeIdx + 1);
                  else if (dx > 44 && safeIdx > 0) goReply(safeIdx - 1);
                }}
                style={{ userSelect: "none" }}
              >
                <div style={{ background: C.card, border: `1px solid ${on ? mc : C.line}`, borderRadius: 20, padding: "20px 18px", marginBottom: 14, transition: "border-color .15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.textDim }}>@{r.handle}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer }}>{rx.createdAt ? timeAgo(rx.createdAt) : r.ago || ""}</span>
                  </div>
                  <Wave n={28} active={on} color={mc} seed={(r.id || String(safeIdx)).length * 3 + 7} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>♪ {fmtSecs(r.secs)}</span>
                    <button
                      onClick={() => togglePlay(r, safeIdx)}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 99,
                        border: "none",
                        background: on ? mc : hexA(mc, "22"),
                        color: on ? C.bg : mc,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: rx.audioUrl ? "pointer" : "default",
                      }}
                    >
                      {on ? <Eq color={C.bg} size={16} /> : <I name="play" size={15} color={mc} />}
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  <button
                    onClick={() => goReply(safeIdx - 1)}
                    disabled={safeIdx === 0}
                    style={{ width: 32, height: 32, borderRadius: 99, border: "none", background: safeIdx === 0 ? "transparent" : hexA(mc, "22"), color: safeIdx === 0 ? C.line : mc, cursor: safeIdx === 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <I name="chevL" size={16} color={safeIdx === 0 ? C.line : mc} />
                  </button>
                  <div style={{ display: "flex", gap: 6 }}>
                    {ping.replies.map((_, i) => (
                      <button key={i} onClick={() => goReply(i)} style={{ width: i === safeIdx ? 18 : 6, height: 6, borderRadius: 99, border: "none", background: i === safeIdx ? mc : C.line, padding: 0, cursor: "pointer", transition: "width .2s, background .2s" }} />
                    ))}
                  </div>
                  <button
                    onClick={() => goReply(safeIdx + 1)}
                    disabled={safeIdx === ping.replies.length - 1}
                    style={{ width: 32, height: 32, borderRadius: 99, border: "none", background: safeIdx === ping.replies.length - 1 ? "transparent" : hexA(mc, "22"), color: safeIdx === ping.replies.length - 1 ? C.line : mc, cursor: safeIdx === ping.replies.length - 1 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <I name="chevR" size={16} color={safeIdx === ping.replies.length - 1 ? C.line : mc} />
                  </button>
                </div>
              </div>
            );
          })()
        )}
      </div>

      {micError && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 8, textAlign: "center" }}>{micError}</div>}

      {audioBlob && !recording ? (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => {
              setAudioBlob(null);
              setRecSecs(0);
            }}
            style={{ flex: 1, padding: 15, borderRadius: 14, cursor: "pointer", fontFamily: MONO, fontSize: 12, border: `1px solid ${C.line}`, background: "transparent", color: C.dim, letterSpacing: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          >
            <I name="redo" size={14} color={C.dim} /> REDO
          </button>
          <button
            onClick={send}
            disabled={uploading}
            style={{ flex: 2, padding: 15, borderRadius: 14, cursor: uploading ? "default" : "pointer", fontFamily: MONO, fontSize: 12, border: "none", background: uploading ? C.line : mc, color: uploading ? C.dim : C.bg, letterSpacing: 1, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          >
            {uploading ? "SENDING…" : (
              <>
                <I name="send" size={14} color={C.bg} /> SEND HUM · {fmtSecs(recSecs)}
              </>
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={() => (recording ? stopRec() : startRec())}
          style={{ width: "100%", padding: 18, borderRadius: 16, cursor: "pointer", fontFamily: MONO, fontSize: 13, letterSpacing: 1.5, border: `1px solid ${recording ? C.red : mc}`, background: recording ? "#1A0A0A" : hexA(mc, "1A"), color: recording ? C.red : mc, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}
        >
          {recording ? (
            <>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: C.red, animation: "blink 1s step-start infinite" }} />
              REC {recSecs}s — TAP TO STOP
            </>
          ) : (
            <>
              <I name="mic" size={16} color={mc} sw={1.7} /> HUM
            </>
          )}
        </button>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   DROP SHEET — compose a voice
   record → title → mood → reach → post. The recording is uploaded to
   Cloudinary and written to the `drops` collection. If the title @mentions a
   handle, the drop is pinned to that person (it plays first for them) and a
   pin activity is written to their feed — all unchanged from the live build.
   ---------------------------------------------------------------------------- */
function DropSheet({
  onClose,
  onDrop,
  uid,
  myHandle,
  credits,
  location,
  place,
  canDrop,
  onNeedTopUp,
}: {
  onClose: () => void;
  onDrop: (d: { title: string; mood: string; secs: number; audioUrl: string; dropId: string; radiusMi: number }) => void;
  uid: string;
  myHandle: string;
  credits: number;
  location: { lat: number; lng: number } | null;
  place: string;
  canDrop: boolean;
  onNeedTopUp: () => void;
}) {
  const [stage, setStage] = useState(0); // 0 rec · 1 title · 2 mood · 3 reach
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [title, setTitle] = useState("");
  const [mood, setMood] = useState("Raw");
  const [radiusMi, setRadiusMi] = useState(DEFAULT_RADIUS_MI);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prompt] = useState(pickTitlePrompt());
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const STAGES = ["RECORD", "TITLE", "MOOD", "REACH"];
  const mention = extractMention(title);

  useEffect(() => {
    if (!recording) return;
    const i = setInterval(
      () =>
        setRecSecs((s) => {
          if (s >= 59) {
            stopRec();
            return 60;
          }
          return s + 1;
        }),
      1000
    );
    return () => clearInterval(i);
  }, [recording]);

  const startRec = async () => {
    setErr(null);
    setAudioBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
        setStage(1);
      };
      mr.start(100);
      mrRef.current = mr;
      setRecSecs(0);
      setRecording(true);
      vibrate(14);
    } catch {
      setErr("Mic access denied. Turn it on in your browser settings to drop a voice.");
    }
  };

  const stopRec = () => {
    mrRef.current?.stop();
    mrRef.current = null;
    setRecording(false);
    vibrate(8);
  };

  const post = async () => {
    if (!audioBlob || !title.trim()) return;
    if (credits < DROP_COST) {
      onNeedTopUp();
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      // 1) upload audio
      const fd = new FormData();
      fd.append("file", audioBlob, `drop_${Date.now()}.webm`);
      fd.append("upload_preset", "nearhum_drops");
      const res = await fetch("https://api.cloudinary.com/v1_1/dvtwey6m9/video/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload");
      const { secure_url: audioUrl } = await res.json();

      // 2) resolve @mention → pin target
      let pinnedTo: string | null = null;
      let pinnedToUid: string | null = null;
      if (mention && mention !== myHandle) {
        try {
          const q = query(collection(firestore, "users"), where("handle", "==", mention), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            pinnedTo = mention;
            pinnedToUid = snap.docs[0].id;
          }
        } catch {
          /* lookup failed, post unpinned */
        }
      }

      // 3) write the drop
      const createdAt = new Date().toISOString();
      const dropRef = await addDoc(collection(firestore, "drops"), {
        uid,
        handle: myHandle,
        title: title.trim(),
        mood,
        secs: recSecs || 1,
        audioUrl,
        place,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        plays: 0,
        ttl: 24,
        radiusMi,
        pinnedTo,
        pinnedToUid,
        reacts: { felt: 0, same: 0, loud: 0 },
        replies: [],
        createdAt,
      });

      // 4) notify the pinned person
      if (pinnedToUid) {
        addDoc(collection(firestore, "users", pinnedToUid, "activity"), {
          type: "pin",
          who: myHandle,
          title: title.trim(),
          at: createdAt,
          unread: true,
        }).catch(() => {});
      }

      onDrop({ title: title.trim(), mood, secs: recSecs || 1, audioUrl, dropId: dropRef.id, radiusMi });
    } catch {
      setErr("Couldn't post. Check your connection and try again.");
      setUploading(false);
    }
  };

  const mc = MOOD[mood] || C.green;

  return (
    <Sheet onClose={onClose} accent={mc}>
      {/* stage rail */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {STAGES.map((s, i) => (
          <div key={s} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: 4, borderRadius: 99, background: i <= stage ? mc : C.line, transition: `background .25s ${EASE}` }} />
            <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 1, color: i === stage ? mc : C.dimmer, marginTop: 5, display: "block" }}>{s}</span>
          </div>
        ))}
      </div>

      {!canDrop && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: hexA(C.amber, "12"), border: `1px solid ${hexA(C.amber, "44")}`, borderRadius: 12, padding: "10px 12px", marginBottom: 14 }}>
          <I name="location" size={14} color={C.amber} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.amberSoft, lineHeight: 1.4 }}>You're listening from another area. You can only drop where you actually are.</span>
        </div>
      )}

      {err && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 12, textAlign: "center", lineHeight: 1.4 }}>{err}</div>}

      {/* 0 — record */}
      {stage === 0 && (
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>Say it out loud.</div>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 26px" }}>Up to 60 seconds. No edits, no scripts — just your voice.</p>
          <div style={{ position: "relative", width: 150, height: 150, margin: "0 auto 22px" }}>
            <svg width="150" height="150" style={{ position: "absolute", inset: 0 }}>
              {recording &&
                [62, 48, 34].map((r, i) => (
                  <circle key={i} cx="75" cy="75" r={r} fill="none" stroke={C.red} strokeWidth="2" opacity={0.4 - i * 0.1} style={{ animation: `bloom ${1.6 + i * 0.3}s ease-in-out infinite` }} />
                ))}
            </svg>
            <button
              onClick={() => (recording ? stopRec() : startRec())}
              style={{ position: "absolute", inset: 35, borderRadius: 99, border: `2px solid ${recording ? C.red : mc}`, background: recording ? "#1A0A0A" : hexA(mc, "16"), color: recording ? C.red : mc, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              {recording ? <I name="stop" size={26} color={C.red} fill={C.red} /> : <I name="mic" size={30} color={mc} sw={1.7} />}
            </button>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 22, color: recording ? C.red : C.dim, letterSpacing: 1 }}>{fmtSecs(recSecs)} <span style={{ fontSize: 12, color: C.dimmer }}>/ 1:00</span></div>
          {recording && <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1.5, marginTop: 8 }}>TAP TO STOP</div>}
        </div>
      )}

      {/* 1 — title */}
      {stage === 1 && (
        <div>
          <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>Give it a title.</div>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 16px" }}>One line so people know what they're tuning into. @mention someone to pin it to them.</p>
          <textarea
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 90))}
            placeholder={prompt}
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: 17, fontWeight: 600, color: C.text, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15, outline: "none", resize: "none", lineHeight: 1.35 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: mention ? C.cyan : C.dimmer, display: "inline-flex", alignItems: "center", gap: 5 }}>
              {mention ? (
                <>
                  <I name="pin" size={11} color={C.cyan} /> pinned to @{mention}
                </>
              ) : (
                "tip: @handle to pin"
              )}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer }}>{title.length}/90</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <SheetBtn ghost onClick={() => setStage(0)}>BACK</SheetBtn>
            <SheetBtn accent={mc} disabled={!title.trim()} onClick={() => setStage(2)}>NEXT</SheetBtn>
          </div>
        </div>
      )}

      {/* 2 — mood */}
      {stage === 2 && (
        <div>
          <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>What's the register?</div>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 16px" }}>Mood tints your voice and helps the right people find it.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {MOOD_LIST.map((m) => {
              const on = mood === m;
              const c = MOOD[m];
              return (
                <button
                  key={m}
                  onClick={() => {
                    vibrate(8);
                    setMood(m);
                  }}
                  style={{ textAlign: "left", padding: 15, borderRadius: 16, cursor: "pointer", border: `1px solid ${on ? c : C.line}`, background: on ? `linear-gradient(135deg, ${hexA(c, "26")}, ${C.card})` : C.card, transition: `all .15s ${EASE}` }}
                >
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{MOOD_ICON[m]}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: on ? c : C.text, letterSpacing: 0.5, fontWeight: 700 }}>{m}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>{MOOD_BLURB[m]}</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <SheetBtn ghost onClick={() => setStage(1)}>BACK</SheetBtn>
            <SheetBtn accent={mc} onClick={() => setStage(3)}>NEXT</SheetBtn>
          </div>
        </div>
      )}

      {/* 3 — reach + post */}
      {stage === 3 && (
        <div>
          <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>How far should it travel?</div>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 16px" }}>Distance only — your exact spot is never shared.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {RADIUS_OPTIONS.map((o) => {
              const on = radiusMi === o.mi;
              return (
                <button
                  key={o.mi}
                  onClick={() => {
                    vibrate(6);
                    setRadiusMi(o.mi);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 14, cursor: "pointer", border: `1px solid ${on ? mc : C.line}`, background: on ? hexA(mc, "16") : C.card, transition: `all .15s ${EASE}` }}
                >
                  <I name="echo" size={18} color={on ? mc : C.dim} />
                  <div style={{ textAlign: "left", flex: 1 }}>
                    <div style={{ fontFamily: MONO, fontSize: 13, color: on ? mc : C.text, fontWeight: 700 }}>{o.mi} mi</div>
                    <div style={{ fontSize: 11, color: C.dim }}>{o.blurb}</div>
                  </div>
                  {on && <I name="check" size={16} color={mc} sw={2.4} />}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 14px", marginBottom: 16 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>cost to drop</span>
            <span style={{ fontFamily: MONO, fontSize: 13, color: credits >= DROP_COST ? C.green : C.amber, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <I name="spark" size={12} color={credits >= DROP_COST ? C.green : C.amber} /> {DROP_COST} credits
            </span>
          </div>

          <button
            onClick={post}
            disabled={uploading || !canDrop}
            style={{ width: "100%", padding: 18, borderRadius: 16, border: "none", cursor: uploading || !canDrop ? "default" : "pointer", fontFamily: MONO, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, background: !canDrop ? C.line : uploading ? C.line : mc, color: !canDrop || uploading ? C.dim : C.bg, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}
          >
            {uploading ? "POSTING…" : (
              <>
                <I name="radio" size={16} color={C.bg} /> DROP IT
              </>
            )}
          </button>
          <button onClick={() => setStage(2)} style={{ width: "100%", background: "transparent", border: "none", color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "12px 0 0", cursor: "pointer" }}>BACK</button>
        </div>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   MIC DROP SHEET
   The interrupt. Costs MIC_DROP_COST credits, locked to one live broadcast per
   city at a time — a transaction claims the city's broadcast doc and spends
   the credits atomically, so a busy city is never charged. Records in
   MIC_DROP_CHUNK_MS slices: a fresh MediaRecorder every slice, since only the
   first blob out of a single recorder's timeslices carries a valid webm
   header — each chunk needs to be an independently playable file.
   ---------------------------------------------------------------------------- */
function MicDropSheet({
  onClose,
  uid,
  myHandle,
  credits,
  place,
  canDrop,
}: {
  onClose: () => void;
  uid: string;
  myHandle: string;
  credits: number;
  place: string;
  canDrop: boolean;
}) {
  const [stage, setStage] = useState<0 | 1>(0);
  const [starting, setStarting] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const secsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bRefRef = useRef<ReturnType<typeof doc> | null>(null);
  const stoppingRef = useRef(false);

  const key = cityKey(place);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mrRef.current = null;
  };

  const recordChunk = () => {
    const stream = streamRef.current;
    if (!stream || stoppingRef.current) return;
    const mr = new MediaRecorder(stream);
    const parts: Blob[] = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    mr.onstop = async () => {
      const blob = new Blob(parts, { type: mr.mimeType || "audio/webm" });
      if (blob.size > 0 && bRefRef.current) {
        try {
          const fd = new FormData();
          fd.append("file", blob, `micdrop_${Date.now()}.webm`);
          fd.append("upload_preset", "nearhum_drops");
          const res = await fetch("https://api.cloudinary.com/v1_1/dvtwey6m9/video/upload", { method: "POST", body: fd });
          if (res.ok) {
            const { secure_url } = await res.json();
            await updateDoc(bRefRef.current, { chunks: arrayUnion(secure_url) });
            setChunksSent((n) => n + 1);
          }
        } catch {
          /* this slice is lost, the broadcast keeps going */
        }
      }
      if (!stoppingRef.current) recordChunk();
    };
    mrRef.current = mr;
    mr.start();
    setTimeout(() => {
      if (mrRef.current === mr) mr.stop();
    }, MIC_DROP_CHUNK_MS);
  };

  const endBroadcast = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (secsTimerRef.current) clearInterval(secsTimerRef.current);
    mrRef.current?.stop();
    cleanupStream();
    if (bRefRef.current) {
      await updateDoc(bRefRef.current, { active: false, ended: true, endedAt: new Date().toISOString() }).catch(() => {});
    }
    onClose();
  };

  const start = async () => {
    if (credits < MIC_DROP_COST) {
      setErr("Not enough credits to drop the mic.");
      return;
    }
    setStarting(true);
    setErr(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr("Mic access denied. Turn it on in your browser settings.");
      setStarting(false);
      return;
    }
    streamRef.current = stream;

    try {
      const bRef = doc(firestore, "broadcasts", key);
      const uRef = doc(firestore, "users", uid);
      await runTransaction(firestore, async (tx) => {
        const [bSnap, uSnap] = await Promise.all([tx.get(bRef), tx.get(uRef)]);
        const now = Date.now();
        const b = bSnap.exists() ? (bSnap.data() as MicDrop) : null;
        if (b?.active && new Date(b.expiresAt).getTime() > now) throw new Error("busy");
        const liveCredits = (uSnap.data()?.credits as number) ?? 0;
        if (liveCredits < MIC_DROP_COST) throw new Error("broke");
        const startedAt = new Date().toISOString();
        const expiresAt = new Date(now + MIC_DROP_MAX_SECS * 1000).toISOString();
        tx.set(bRef, { active: true, uid, handle: myHandle, place, startedAt, expiresAt, chunks: [], ended: false, endedAt: null });
        tx.update(uRef, { credits: increment(-MIC_DROP_COST) });
      });
      addDoc(collection(firestore, "users", uid, "ledger"), {
        label: "Mic Drop",
        delta: -MIC_DROP_COST,
        at: new Date().toISOString(),
      }).catch(() => {});

      bRefRef.current = bRef;
      stoppingRef.current = false;
      setStage(1);
      vibrate(16);
      recordChunk();
      secsTimerRef.current = setInterval(() => {
        setRecSecs((s) => {
          if (s + 1 >= MIC_DROP_MAX_SECS) {
            endBroadcast();
            return MIC_DROP_MAX_SECS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      cleanupStream();
      const msg = e instanceof Error ? e.message : "";
      if (msg === "busy") setErr("Someone's already live in your city. Try again in a bit.");
      else if (msg === "broke") setErr("Not enough credits to drop the mic.");
      else setErr(`Couldn't start the broadcast${msg ? `: ${msg}` : ""}. Check your connection and try again.`);
    }
    setStarting(false);
  };

  // Release the mic + stop the broadcast if the sheet unmounts mid-drop.
  useEffect(
    () => () => {
      if (!stoppingRef.current) {
        stoppingRef.current = true;
        if (secsTimerRef.current) clearInterval(secsTimerRef.current);
        mrRef.current?.stop();
        cleanupStream();
        if (bRefRef.current) {
          updateDoc(bRefRef.current, { active: false, ended: true, endedAt: new Date().toISOString() }).catch(() => {});
        }
      }
    },
    []
  );

  return (
    <Sheet onClose={stage === 1 ? () => {} : onClose} accent={C.red}>
      {stage === 0 && (
        <div style={{ textAlign: "center", padding: "6px 0 4px" }}>
          <div style={{ width: 64, height: 64, borderRadius: 99, margin: "0 auto 16px", background: hexA(C.red, "16"), border: `1px solid ${hexA(C.red, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <I name="broadcast" size={28} color={C.red} />
          </div>
          <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>Drop the mic.</div>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, margin: "0 0 20px" }}>
            Every phone in {place || "your area"} stops what it's playing and hears you live, up to {MIC_DROP_MAX_SECS}s. Only one drop can be live at a time.
          </p>
          {!canDrop && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: hexA(C.amber, "12"), border: `1px solid ${hexA(C.amber, "44")}`, borderRadius: 12, padding: "10px 12px", marginBottom: 14, textAlign: "left" }}>
              <I name="location" size={14} color={C.amber} />
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.amberSoft, lineHeight: 1.4 }}>You're listening from another area. You can only drop the mic where you actually are.</span>
            </div>
          )}
          {err && <div style={{ fontFamily: MONO, fontSize: 11, color: C.red, marginBottom: 14, lineHeight: 1.4 }}>{err}</div>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 14px", marginBottom: 16 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>cost to drop</span>
            <span style={{ fontFamily: MONO, fontSize: 13, color: credits >= MIC_DROP_COST ? C.red : C.amber, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <I name="spark" size={12} color={credits >= MIC_DROP_COST ? C.red : C.amber} /> {MIC_DROP_COST} credits
            </span>
          </div>
          <button
            onClick={start}
            disabled={starting || !canDrop || credits < MIC_DROP_COST}
            style={{
              width: "100%",
              padding: 18,
              borderRadius: 16,
              border: "none",
              cursor: starting || !canDrop ? "default" : "pointer",
              fontFamily: MONO,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 1.5,
              background: !canDrop || credits < MIC_DROP_COST ? C.line : C.red,
              color: !canDrop || credits < MIC_DROP_COST ? C.dim : "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
            }}
          >
            {starting ? (
              "GOING LIVE…"
            ) : (
              <>
                <I name="broadcast" size={16} color={!canDrop || credits < MIC_DROP_COST ? C.dim : "#fff"} /> DROP THE MIC
              </>
            )}
          </button>
          <button onClick={onClose} style={{ width: "100%", background: "transparent", border: "none", color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "12px 0 0", cursor: "pointer" }}>CANCEL</button>
        </div>
      )}

      {stage === 1 && (
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ marginBottom: 14 }}>
            <LiveDot label="LIVE NOW" color={C.red} />
          </div>
          <div style={{ position: "relative", width: 150, height: 150, margin: "0 auto 18px" }}>
            <svg width="150" height="150" style={{ position: "absolute", inset: 0 }}>
              {[62, 48, 34].map((r, i) => (
                <circle key={i} cx="75" cy="75" r={r} fill="none" stroke={C.red} strokeWidth="2" opacity={0.4 - i * 0.1} style={{ animation: `bloom ${1.6 + i * 0.3}s ease-in-out infinite` }} />
              ))}
            </svg>
            <div style={{ position: "absolute", inset: 35, borderRadius: 99, border: `2px solid ${C.red}`, background: "#1A0A0A", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <I name="mic" size={30} color={C.red} sw={1.7} />
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 22, color: C.red, letterSpacing: 1 }}>
            {fmtSecs(recSecs)} <span style={{ fontSize: 12, color: C.dimmer }}>/ {fmtSecs(MIC_DROP_MAX_SECS)}</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1.5, marginTop: 8 }}>
            {chunksSent} CHUNKS SENT · LIVE IN {(place || "YOUR AREA").toUpperCase()}
          </div>
          <button
            onClick={endBroadcast}
            style={{ width: "100%", marginTop: 22, padding: 18, borderRadius: 16, border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}
          >
            <I name="stop" size={16} color="#fff" /> END BROADCAST
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   MIC DROP LIVE OVERLAY
   The interrupt itself, mounted above everything the instant a broadcast goes
   live in your city. Owns its own <audio> element (never the feed's
   audioRef) and plays chunks in arrival order as they land in Firestore,
   naturally trailing a few seconds behind the broadcaster. No skip, no scrub —
   it's a broadcast, not a track. Closes itself once the doc ends and the
   queue has fully played out.
   ---------------------------------------------------------------------------- */
function MicDropLiveOverlay({ broadcast, onEnded }: { broadcast: MicDrop; onEnded: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [playingChunk, setPlayingChunk] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playedCountRef = useRef(0);
  const playingRef = useRef(false);

  const playNext = useCallback(() => {
    const audio = audioRef.current;
    const next = queueRef.current.shift();
    if (!audio || !next) {
      playingRef.current = false;
      setPlayingChunk(false);
      return;
    }
    playingRef.current = true;
    audio.src = next;
    audio
      .play()
      .then(() => setPlayingChunk(true))
      .catch(() => {
        playingRef.current = false;
        setPlayingChunk(false);
      });
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", playNext);
    audioRef.current = audio;
    return () => {
      audio.removeEventListener("ended", playNext);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [playNext]);

  useEffect(() => {
    const fresh = broadcast.chunks.slice(playedCountRef.current);
    if (fresh.length === 0) return;
    playedCountRef.current = broadcast.chunks.length;
    queueRef.current.push(...fresh);
    if (!playingRef.current) playNext();
  }, [broadcast.chunks, playNext]);

  useEffect(() => {
    const isOver = broadcast.ended || new Date(broadcast.expiresAt).getTime() < Date.now();
    if (isOver && queueRef.current.length === 0 && !playingRef.current) onEnded();
  }, [broadcast.ended, broadcast.expiresAt, playingChunk, onEnded]);

  useEffect(() => {
    const i = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: `radial-gradient(120% 90% at 50% 0%, ${hexA(C.red, "22")}, ${C.bg} 65%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "fadeIn .2s ease-out",
      }}
    >
      <LiveDot label="MIC DROP" color={C.red} />
      <div style={{ position: "relative", width: 180, height: 180, margin: "26px 0 22px" }}>
        <svg width="180" height="180" style={{ position: "absolute", inset: 0 }}>
          {[74, 58, 42].map((r, i) => (
            <circle key={i} cx="90" cy="90" r={r} fill="none" stroke={C.red} strokeWidth="2" opacity={playingChunk ? 0.45 - i * 0.1 : 0.15} style={{ animation: `bloom ${1.6 + i * 0.3}s ease-in-out infinite` }} />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 45, borderRadius: 99, border: `2px solid ${C.red}`, background: "#1A0A0A", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <I name="broadcast" size={34} color={C.red} />
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 780, color: C.text, marginBottom: 6, textAlign: "center" }}>@{broadcast.handle} is live</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: C.dim, marginBottom: 4 }}>
        {broadcast.place || "nearby"} · {fmtSecs(elapsed)}
      </div>
      <div style={{ marginTop: 20 }}>
        <Wave n={30} active={playingChunk} color={C.red} seed={4} />
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer, letterSpacing: 1, marginTop: 26, textAlign: "center", lineHeight: 1.6 }}>
        everyone in {broadcast.place || "the area"} is hearing this right now
        <br />
        ends automatically
      </div>
    </div>
  );
}

/* Shared sheet button used by the composer and other sheets. */
function SheetBtn({ children, onClick, disabled, ghost, accent = C.green }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; ghost?: boolean; accent?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: ghost ? 1 : 2,
        padding: 16,
        borderRadius: 14,
        cursor: disabled ? "default" : "pointer",
        fontFamily: MONO,
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: 1.2,
        border: ghost ? `1px solid ${C.line}` : "none",
        background: ghost ? "transparent" : disabled ? C.line : accent,
        color: ghost ? C.dim : disabled ? C.dim : C.bg,
        transition: `all .15s ${EASE}`,
      }}
    >
      {children}
    </button>
  );
}

/* A small iOS-style toggle used across settings. */
function Toggle({ on, onChange, color = C.green }: { on: boolean; onChange: () => void; color?: string }) {
  return (
    <button
      onClick={() => {
        vibrate(6);
        onChange();
      }}
      style={{ width: 46, height: 28, borderRadius: 99, border: "none", cursor: "pointer", padding: 3, background: on ? color : C.line, transition: `background .2s ${EASE}`, flexShrink: 0 }}
    >
      <span style={{ display: "block", width: 22, height: 22, borderRadius: 99, background: on ? C.bg : C.dim, transform: `translateX(${on ? 18 : 0}px)`, transition: `transform .2s ${SPRING}` }} />
    </button>
  );
}

function Row({ icon, label, sub, right, onClick, danger }: { icon: string; label: string; sub?: string; right?: React.ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 4px", background: "transparent", border: "none", borderBottom: `1px solid ${C.lineSoft}`, cursor: onClick ? "pointer" : "default", textAlign: "left" }}
    >
      <span style={{ width: 34, height: 34, borderRadius: 10, background: danger ? hexA(C.red, "14") : C.card, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <I name={icon} size={16} color={danger ? C.red : C.greenSoft} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, color: danger ? C.red : C.text, fontWeight: 600 }}>{label}</span>
        {sub && <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 2, fontFamily: MONO }}>{sub}</span>}
      </span>
      {right}
      {onClick && !right && <I name="chevR" size={16} color={C.dimmer} />}
    </button>
  );
}

/* ----------------------------------------------------------------------------
   TOP UP — buy plays or credits
   ---------------------------------------------------------------------------- */
function TopUp({ onClose, onBuy, plays, credits }: { onClose: () => void; onBuy: (type: "plays" | "credits", n: number, price: string) => void; plays: number; credits: number }) {
  const [tab, setTab] = useState<"plays" | "credits">("credits");
  const packs = tab === "plays" ? PLAY_PACKS : CREDIT_PACKS;
  const accent = tab === "plays" ? C.cyan : C.green;
  return (
    <Sheet onClose={onClose} accent={accent}>
      <div style={{ fontSize: 20, fontWeight: 750, color: C.text, marginBottom: 4 }}>Top up</div>
      <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 16px" }}>
        Plays let you listen. Credits let you drop and hum. You currently have{" "}
        <span style={{ color: C.cyanSoft, fontFamily: MONO }}>{plays} plays</span> and{" "}
        <span style={{ color: C.greenSoft, fontFamily: MONO }}>{credits} credits</span>.
      </p>

      <div style={{ display: "flex", gap: 4, background: C.panel2, borderRadius: 12, padding: 4, marginBottom: 16 }}>
        {(["credits", "plays"] as const).map((t) => {
          const on = tab === t;
          const c = t === "plays" ? C.cyan : C.green;
          return (
            <button
              key={t}
              onClick={() => {
                vibrate(6);
                setTab(t);
              }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, background: on ? hexA(c, "1E") : "transparent", color: on ? c : C.dim, transition: `all .15s ${EASE}` }}
            >
              {t.toUpperCase()}
            </button>
          );
        })}
      </div>

      <div style={{ overflowY: "auto", marginBottom: 6 }}>
        {packs.map((p) => (
          <button
            key={p.n}
            onClick={() => {
              vibrate(10);
              onBuy(tab, p.n, p.price);
            }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", marginBottom: 8, borderRadius: 14, cursor: "pointer", border: `1px solid ${p.best ? accent : C.line}`, background: p.best ? `linear-gradient(135deg, ${hexA(accent, "1C")}, ${C.card})` : C.card, textAlign: "left" }}
          >
            <I name={tab === "plays" ? "ear" : "spark"} size={18} color={accent} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: MONO, fontSize: 15, color: C.text, fontWeight: 700 }}>
                {p.n} {tab}
              </div>
              {(p.best || p.tag) && <div style={{ fontFamily: MONO, fontSize: 9.5, color: accent, letterSpacing: 1, marginTop: 2 }}>{(p.tag || "most pick this").toUpperCase()}</div>}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 15, color: accent, fontWeight: 700 }}>{p.price}</div>
          </button>
        ))}
      </div>
      <p style={{ fontFamily: MONO, fontSize: 9.5, color: C.dimmer, textAlign: "center", lineHeight: 1.5, marginTop: 8 }}>
        {/* >>> WIRE Stripe checkout to each pack */}
        Secure checkout · Credits never expire
      </p>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   SETTINGS
   ---------------------------------------------------------------------------- */
function Settings({ onClose, handle, place, prefs, onTogglePref, onSignOut, onEditProfile, onChangeLocation }: { onClose: () => void; handle: string; place: string; prefs: Prefs; onTogglePref: (k: keyof Prefs) => void; onSignOut: () => void; onEditProfile: () => void; onChangeLocation: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 20, fontWeight: 750, color: C.text, marginBottom: 16 }}>Settings</div>
      <div style={{ marginBottom: 8 }}>
        <SectionLabel>ACCOUNT</SectionLabel>
        <Row icon="user" label={handle === "—" ? "Anonymous" : `@${handle}`} sub="your handle on the block" onClick={onEditProfile} />
        <Row icon="location" label="Your area" sub={place || "location off"} onClick={onChangeLocation} />
      </div>
      <div style={{ marginTop: 18, marginBottom: 8 }}>
        <SectionLabel>LISTENING</SectionLabel>
        <Row icon="radio" label="Autoplay feed" sub="play the next voice automatically" right={<Toggle on={prefs.autoplay} onChange={() => onTogglePref("autoplay")} />} />
        <Row icon="ear" label="Sound on" sub="hear voices as they play" right={<Toggle on={prefs.sound} onChange={() => onTogglePref("sound")} />} />
      </div>
      <div style={{ marginTop: 18, marginBottom: 8 }}>
        <SectionLabel>NOTIFICATIONS &amp; MOTION</SectionLabel>
        <Row icon="bell" label="Push notifications" sub="hums, pins and reactions" right={<Toggle on={prefs.notif} onChange={() => onTogglePref("notif")} />} />
        <Row icon="sliders" label="Reduce motion" sub="calm the radar and animations" right={<Toggle on={prefs.reduceMotion} onChange={() => onTogglePref("reduceMotion")} />} />
      </div>
      <div style={{ marginTop: 18, marginBottom: 8 }}>
        <SectionLabel>ABOUT</SectionLabel>
        <Row icon="globe" label="How Nearhum works" sub="the hum, explained" onClick={() => {}} />
        <Row icon="lock" label="Privacy" sub="what we store, what we don't" onClick={() => {}} />
        <Row icon="x" label="Sign out" danger onClick={onSignOut} />
      </div>
      <p style={{ fontFamily: MONO, fontSize: 9.5, color: C.dimmer, textAlign: "center", marginTop: 16 }}>NEARHUM · v7</p>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   SEARCH — live filter across the voices currently near you
   ---------------------------------------------------------------------------- */
function SearchSheet({ onClose, pings, onPick }: { onClose: () => void; pings: Ping[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^@/, "");
    if (!t) return [];
    return pings.filter((p) => p.handle.toLowerCase().includes(t) || p.title.toLowerCase().includes(t) || p.mood.toLowerCase().includes(t)).slice(0, 24);
  }, [q, pings]);
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 16 }}>
        <I name="search" size={18} color={C.dim} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search voices, handles, moods" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.text, fontFamily: MONO, fontSize: 14 }} />
        {q && (
          <button onClick={() => setQ("")} style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex" }}>
            <I name="x" size={16} color={C.dim} />
          </button>
        )}
      </div>
      <div style={{ overflowY: "auto", minHeight: 120 }}>
        {!q.trim() ? (
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "30px 0", lineHeight: 1.6 }}>Find a voice near you by what they said or who they are.</div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: "30px 0" }}>Nothing matching "{q}" on the block right now.</div>
        ) : (
          results.map((p) => {
            const mc = MOOD[p.mood] || C.green;
            return (
              <button key={p.id} onClick={() => onPick(p.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 6px", background: "transparent", border: "none", borderBottom: `1px solid ${C.lineSoft}`, cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: hexA(mc, "1E"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <I name="play" size={13} color={mc} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, color: C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span>
                  <span style={{ display: "block", fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 2 }}>@{p.handle} · {p.dist} · {p.mood}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   MORE MENU — overflow actions on a voice (report / mute / share)
   ---------------------------------------------------------------------------- */
function ReportSheet({ onClose, ping, onMute, onReport, onReactions }: { onClose: () => void; ping: Ping; onMute: (handle: string) => void; onReport: (reason: string) => void; onReactions: () => void }) {
  const [reporting, setReporting] = useState(false);
  const reasons = ["Spam or scam", "Harassment", "Hate or violence", "Sexual content", "Something else"];
  return (
    <Sheet onClose={onClose} accent={C.amber}>
      {!reporting ? (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 2 }}>@{ping.handle}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 16 }}>{ping.title}</div>
          <Row icon="heart" label="See reactions" sub="how people felt about it" onClick={onReactions} />
          <Row icon="mute" label={`Mute @${ping.handle}`} sub="stop hearing this person" onClick={() => onMute(ping.handle)} />
          <Row icon="share" label="Share this voice" sub="copy a link to the drop" onClick={() => { /* >>> WIRE share link */ onClose(); }} />
          <Row icon="flag" label="Report" sub="flag this for review" danger onClick={() => setReporting(true)} />
          <button onClick={onClose} style={{ width: "100%", padding: 15, marginTop: 14, borderRadius: 14, border: `1px solid ${C.line}`, background: "transparent", color: C.dim, fontFamily: MONO, fontSize: 12, letterSpacing: 1, cursor: "pointer" }}>CANCEL</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4 }}>Report this voice</div>
          <p style={{ fontSize: 12, color: C.dim, margin: "0 0 14px" }}>What's wrong? Reports are anonymous.</p>
          {reasons.map((r) => (
            <Row key={r} icon="flag" label={r} onClick={() => onReport(r)} />
          ))}
          <button onClick={() => setReporting(false)} style={{ width: "100%", padding: 15, marginTop: 14, borderRadius: 14, border: `1px solid ${C.line}`, background: "transparent", color: C.dim, fontFamily: MONO, fontSize: 12, letterSpacing: 1, cursor: "pointer" }}>BACK</button>
        </>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   REACT DETAIL — the breakdown of reactions on a drop
   ---------------------------------------------------------------------------- */
function ReactDetailSheet({ onClose, ping }: { onClose: () => void; ping: Ping }) {
  const total = totalReacts(ping.reacts);
  return (
    <Sheet onClose={onClose} accent={C.rose}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 2 }}>Reactions</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 18 }}>{ping.title}</div>
      {REACTIONS.map((r) => {
        const n = (ping.reacts as Record<string, number>)[r.key] || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={r.key} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <ReactGlyph kind={r.key} size={16} color={r.color} solid />
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.text }}>{r.label}</span>
              <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 12, color: r.color, fontWeight: 700 }}>{n}</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: C.line, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: r.color, borderRadius: 99, transition: "width .4s ease" }} />
            </div>
          </div>
        );
      })}
      <p style={{ fontFamily: MONO, fontSize: 9.5, color: C.dimmer, textAlign: "center", marginTop: 6 }}>{total} total · who reacted stays private</p>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   EDIT PROFILE — change your handle (writes through to Firestore)
   ---------------------------------------------------------------------------- */
function EditProfileSheet({ onClose, handle, onSave }: { onClose: () => void; handle: string; onSave: (h: string) => void }) {
  const [h, setH] = useState(handle === "—" ? "" : handle);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>Your handle</div>
      <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 16px" }}>This is the only thing people see. No real name, no photo — just your @.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 17, color: C.dim, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "0 13px", display: "flex", alignItems: "center" }}>@</div>
        <input autoFocus value={h} onChange={(e) => setH(e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 16))} placeholder="nightowl" style={{ flex: 1, fontFamily: MONO, fontSize: 17, color: C.text, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 15, outline: "none" }} />
      </div>
      <button
        onClick={async () => {
          if (!h.trim()) return;
          setSaving(true);
          await onSave(h.trim());
          setSaving(false);
          onClose();
        }}
        disabled={saving || !h.trim()}
        style={{ width: "100%", padding: 17, borderRadius: 16, border: "none", cursor: saving || !h.trim() ? "default" : "pointer", fontFamily: MONO, fontSize: 13, fontWeight: 700, letterSpacing: 1.5, background: !h.trim() || saving ? C.line : C.green, color: !h.trim() || saving ? C.dim : C.bg }}
      >
        {saving ? "SAVING…" : "SAVE HANDLE"}
      </button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   ACTIVITY FEED
   What's happened to you and your voices. Each row maps a type → icon, color
   and a one-line, plain-language description.
   ---------------------------------------------------------------------------- */
function activityView(a: ActivityItem): { icon: string; color: string; text: React.ReactNode } {
  const who = a.who ? `@${a.who}` : "someone";
  switch (a.type) {
    case "pin":
      return { icon: "pin", color: C.cyan, text: <>{who} pinned a voice to you{a.title ? <> — "{a.title}"</> : ""}</> };
    case "pin_listened":
      return { icon: "ear", color: C.cyan, text: <>{who} heard the voice you pinned them</> };
    case "reaction": {
      const r = REACTIONS.find((x) => x.key === a.react);
      return { icon: r ? (a.react === "felt" ? "heart" : a.react === "same" ? "target" : "spark") : "heart", color: r?.color || C.rose, text: <>{who} {r?.label || "reacted"} on "{a.title || "your voice"}"</> };
    }
    case "hum":
    case "reply":
      return { icon: "mic", color: C.greenSoft, text: <>{who} left a hum on "{a.title || "your voice"}"</> };
    case "milestone":
      return { icon: "trophy", color: C.amber, text: <>{a.detail || "You hit a milestone"}</> };
    case "system":
      return { icon: "radio", color: C.green, text: <>{a.detail || "Welcome to Nearhum"}</> };
    default:
      return { icon: "bell", color: C.dim, text: <>{a.detail || "Something happened"}</> };
  }
}

function ActivityFeed({ items, onOpen }: { items: ActivityItem[]; onOpen: (title?: string) => void }) {
  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "70px 30px", color: C.dim }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: C.card, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <I name="bell" size={26} color={C.dim} />
        </div>
        <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 6 }}>Quiet for now.</div>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>When someone hums back, reacts, or pins you a voice, it shows up here.</p>
      </div>
    );
  }
  return (
    <div>
      {items.map((a) => {
        const v = activityView(a);
        const tappable = a.type === "reaction" || a.type === "hum" || a.type === "reply" || a.type === "pin";
        return (
          <button
            key={a.id}
            onClick={() => tappable && onOpen(a.title)}
            style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 6px", background: a.unread ? hexA(C.green, "07") : "transparent", border: "none", borderRadius: 10, borderBottom: `1px solid ${C.lineSoft}`, cursor: tappable ? "pointer" : "default", textAlign: "left", marginBottom: 2 }}
          >
            <span style={{ width: 38, height: 38, borderRadius: 11, background: hexA(v.color, "16"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <I name={v.icon} size={17} color={v.color} />
            </span>
            <span style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
              <span style={{ display: "block", fontSize: 13.5, color: C.text, lineHeight: 1.45 }}>{v.text}</span>
              <span style={{ display: "block", fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 4 }}>{a.ago}</span>
            </span>
            {a.unread && <span style={{ width: 8, height: 8, borderRadius: 99, background: C.green, marginTop: 6, flexShrink: 0 }} />}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   CREDIT CHIP — the plays | credits balance, tap to top up
   ---------------------------------------------------------------------------- */
function CreditChip({ plays, credits, onClick }: { plays: number; credits: number; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 99, padding: "5px 5px 5px 11px", cursor: "pointer", gap: 9 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 12, color: C.cyanSoft, fontWeight: 700 }}>
        <I name="ear" size={12} color={C.cyan} /> {fmtCount(plays)}
      </span>
      <span style={{ width: 1, height: 14, background: C.line }} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 12, color: C.greenSoft, fontWeight: 700 }}>
        <I name="spark" size={12} color={C.green} /> {fmtCount(credits)}
      </span>
      <span style={{ width: 24, height: 24, borderRadius: 99, background: C.green, color: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <I name="plus" size={13} color={C.bg} sw={2.4} />
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   LOCATION SWITCHER
   Listen in from another area — but you can still only drop where you really
   are. "Near me" returns you to your real location.
   ---------------------------------------------------------------------------- */
const PLACES: { state: string; cities: { name: string; lat: number; lng: number }[] }[] = [
  { state: "Florida", cities: [
    { name: "Orlando", lat: 28.5384, lng: -81.3789 },
    { name: "Miami", lat: 25.7617, lng: -80.1918 },
    { name: "Tampa", lat: 27.9506, lng: -82.4572 },
    { name: "Jacksonville", lat: 30.3322, lng: -81.6557 },
  ]},
  { state: "New York", cities: [
    { name: "New York City", lat: 40.7128, lng: -74.006 },
    { name: "Brooklyn", lat: 40.6782, lng: -73.9442 },
  ]},
  { state: "California", cities: [
    { name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
    { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
    { name: "San Diego", lat: 32.7157, lng: -117.1611 },
  ]},
  { state: "Illinois", cities: [{ name: "Chicago", lat: 41.8781, lng: -87.6298 }] },
  { state: "Texas", cities: [
    { name: "Austin", lat: 30.2672, lng: -97.7431 },
    { name: "Houston", lat: 29.7604, lng: -95.3698 },
  ]},
  { state: "Washington", cities: [{ name: "Seattle", lat: 47.6062, lng: -122.3321 }] },
];

function LocationSheet({ onClose, onPick, onHome, realPlace, viewingRemote }: { onClose: () => void; onPick: (c: { name: string; lat: number; lng: number }) => void; onHome: () => void; realPlace: string; viewingRemote: boolean }) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 19, fontWeight: 750, color: C.text, marginBottom: 6 }}>Listen from anywhere</div>
      <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, margin: "0 0 16px" }}>Tune your feed to another area. You can still only drop a voice where you actually are.</p>

      <button onClick={onHome} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", borderRadius: 14, marginBottom: 16, cursor: "pointer", border: `1px solid ${!viewingRemote ? C.green : C.line}`, background: !viewingRemote ? hexA(C.green, "16") : C.card, textAlign: "left" }}>
        <I name="location" size={18} color={C.green} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: 13, color: C.green, fontWeight: 700 }}>Near me</div>
          <div style={{ fontSize: 11, color: C.dim }}>{realPlace || "your real location"}</div>
        </div>
        {!viewingRemote && <I name="check" size={16} color={C.green} sw={2.4} />}
      </button>

      <div style={{ overflowY: "auto" }}>
        {PLACES.map((s) => (
          <div key={s.state} style={{ marginBottom: 14 }}>
            <SectionLabel>{s.state.toUpperCase()}</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {s.cities.map((c) => (
                <button key={c.name} onClick={() => onPick(c)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 13px", borderRadius: 99, cursor: "pointer", border: `1px solid ${C.line}`, background: C.card, color: C.textDim, fontFamily: MONO, fontSize: 12 }}>
                  <I name="globe" size={12} color={C.dim} /> {c.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------------------
   TAB BAR
   HUMS · ACTIVITY · (DROP) · YOU. The drop action is raised and accented — it's
   the one thing we most want people to do.
   ---------------------------------------------------------------------------- */
function TabBar({ tab, onTab, onDrop, unread }: { tab: string; onTab: (t: string) => void; onDrop: () => void; unread: number }) {
  const Item = ({ id, icon, label }: { id: string; icon: string; label: string }) => {
    const on = tab === id;
    return (
      <button onClick={() => { vibrate(6); onTab(id); }} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0 4px", background: "transparent", border: "none", cursor: "pointer", position: "relative" }}>
        <span style={{ position: "relative" }}>
          <I name={icon} size={21} color={on ? C.green : C.dim} sw={on ? 2 : 1.8} />
          {id === "activity" && unread > 0 && (
            <span style={{ position: "absolute", top: -3, right: -6, minWidth: 15, height: 15, padding: "0 4px", borderRadius: 99, background: C.green, color: C.bg, fontFamily: MONO, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${C.bg}` }}>{unread > 9 ? "9+" : unread}</span>
          )}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 1, color: on ? C.green : C.dimmer, fontWeight: 700 }}>{label}</span>
      </button>
    );
  };
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: hexA(C.bg, "F2"), borderTop: `1px solid ${C.line}`, backdropFilter: "blur(20px)", paddingBottom: SAFE_B, display: "flex", alignItems: "center" }}>
      <Item id="feed" icon="radio" label="HUMS" />
      <Item id="activity" icon="bell" label="ACTIVITY" />
      <button onClick={() => { vibrate(12); onDrop(); }} style={{ flex: 1, display: "flex", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", marginTop: -18 }}>
        <span style={{ width: 52, height: 52, borderRadius: 99, background: C.green, color: C.bg, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 6px 22px ${hexA(C.green, "66")}`, border: `3px solid ${C.bg}` }}>
          <I name="mic" size={22} color={C.bg} sw={2} />
        </span>
      </button>
      <Item id="you" icon="user" label="YOU" />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   GLOBAL STYLE — resets + every keyframe referenced above
   ---------------------------------------------------------------------------- */
function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { margin: 0; padding: 0; background: ${C.bg}; overscroll-behavior-y: none; }
      ::-webkit-scrollbar { width: 0; height: 0; }
      button { font-family: inherit; }
      input, textarea { -webkit-appearance: none; }
      input::placeholder, textarea::placeholder { color: ${C.dimmer}; }

      @keyframes playWave { 0%,100% { transform: scaleY(.5); } 50% { transform: scaleY(1); } }
      @keyframes eqA { 0%,100% { height: 30%; } 50% { height: 100%; } }
      @keyframes eqB { 0%,100% { height: 100%; } 50% { height: 40%; } }
      @keyframes eqC { 0%,100% { height: 55%; } 50% { height: 90%; } }
      @keyframes bloom { 0%,100% { opacity: .5; } 50% { opacity: .12; } }
      @keyframes breathe { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
      @keyframes ping { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(2.2); opacity: 0; } }
      @keyframes blipPing { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(2.6); opacity: 0; } }
      @keyframes sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @keyframes blink { 50% { opacity: .25; } }
      @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
      @keyframes spin { to { transform: rotate(360deg); } }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
      }
    `}</style>
  );
}

/* ============================================================================
   ROOT
   ============================================================================ */
const DEFAULT_PREFS: Prefs = { sound: true, autoplay: true, notif: false, reduceMotion: false };

export default function Nearhum() {
  // session / auth
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [uid, setUid] = useState<string>("");
  const [myHandle, setMyHandle] = useState<string>("—");

  // economy
  const [credits, setCredits] = useState(0);
  const [plays, setPlays] = useState(0);

  // location
  const [realLocation, setRealLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [realPlace, setRealPlace] = useState<string>("");
  const [remoteLoc, setRemoteLoc] = useState<{ name: string; lat: number; lng: number } | null>(null);

  // prefs + meta
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [streak, setStreak] = useState(0);
  const [showCoach, setShowCoach] = useState(false);

  // data
  const [rawDrops, setRawDrops] = useState<Record<string, unknown>[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [ledger, setLedger] = useState<{ id: string; label: string; delta: number; ago: string }[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);

  // ui
  const [tab, setTab] = useState("feed");
  const [moodFilter, setMoodFilter] = useState("All");
  const [sortMode, setSortMode] = useState("near");
  const [currentId, setCurrentId] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [myReacts, setMyReacts] = useState<Record<string, string>>({});

  // sheets
  const [replyTarget, setReplyTarget] = useState<Ping | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<Ping | null>(null);
  const [reactTarget, setReactTarget] = useState<Ping | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [micDropOpen, setMicDropOpen] = useState(false);
  const [liveBroadcast, setLiveBroadcast] = useState<MicDrop | null>(null);
  const interruptedForRef = useRef<string | null>(null);

  // toast
  const [toast, setToast] = useState<{ msg: string; icon?: string; color?: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string, icon?: string, color?: string) => {
    setToast({ msg, icon, color });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // refs / engine
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playCountedRef = useRef<Set<string>>(new Set()); // charged for a play
  const markedRef = useRef<Set<string>>(new Set()); // play-count incremented + pin cleared
  const knownPingIdsRef = useRef<Set<string>>(new Set()); // drops already seen in range
  const mutedRef = useRef<Set<string>>(new Set());
  const streakDoneRef = useRef(false);
  const pwaPromptRef = useRef<{ prompt: () => void } | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  const activeLoc = remoteLoc ?? realLocation;
  const viewingRemote = !!remoteLoc;
  const activePlace = remoteLoc ? remoteLoc.name : realPlace;
  const canDrop = !viewingRemote && !!realLocation;

  /* ---- derived feed ------------------------------------------------------ */
  const pings: Ping[] = useMemo(() => {
    const now = Date.now();
    const mapped = rawDrops
      .map((d) => {
        const createdAt = (d.createdAt as string) || new Date().toISOString();
        const hoursLeft = 24 - (now - new Date(createdAt).getTime()) / 3600000;
        const lat = d.lat as number | null;
        const lng = d.lng as number | null;
        const radiusMi = (d.radiusMi as number) ?? DEFAULT_RADIUS_MI;
        let distMi: number | null = null;
        if (activeLoc && lat != null && lng != null) distMi = haversineMi(activeLoc.lat, activeLoc.lng, lat, lng);
        return {
          id: (d.id as string) || (d.dropId as string) || Math.random().toString(36),
          uid: d.uid as string,
          handle: (d.handle as string) || "—",
          secs: (d.secs as number) || 1,
          mood: (d.mood as string) || "Raw",
          title: (d.title as string) || "untitled",
          body: "",
          createdAt,
          audioUrl: (d.audioUrl as string) || "",
          lat,
          lng,
          radiusMi,
          pinnedTo: (d.pinnedTo as string) || null,
          pinnedToUid: (d.pinnedToUid as string) || null,
          plays: (d.plays as number) || 0,
          ttl: hoursLeft,
          reacts: (d.reacts as { felt: number; same: number; loud: number }) || { felt: 0, same: 0, loud: 0 },
          replies: (d.replies as Ping["replies"]) || [],
          distMi,
          dist: distMi != null ? fmtDist(distMi) : "nearby",
        };
      })
      .filter((p) => p.ttl > 0)
      .filter((p) => !mutedRef.current.has(p.handle))
      .filter((p) => (p.distMi != null ? p.distMi <= p.radiusMi : true))
      .filter((p) => moodFilter === "All" || p.mood === moodFilter);

    const pinnedFirst = (a: typeof mapped[0], b: typeof mapped[0]) => {
      const ap = a.pinnedToUid === uid ? 1 : 0;
      const bp = b.pinnedToUid === uid ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (sortMode === "loud") return totalReacts(b.reacts) + b.plays - (totalReacts(a.reacts) + a.plays);
      if (sortMode === "fresh") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      // near (default)
      const ad = a.distMi ?? 9999;
      const bd = b.distMi ?? 9999;
      return ad - bd;
    };
    return mapped.sort(pinnedFirst) as unknown as Ping[];
  }, [rawDrops, activeLoc, moodFilter, sortMode, uid]);

  const moodCounts = useMemo(() => {
    const c: Record<string, number> = { All: pings.length };
    MOOD_LIST.forEach((m) => (c[m] = 0));
    pings.forEach((p) => (c[p.mood] = (c[p.mood] || 0) + 1));
    return c;
  }, [pings]);

  const currentIdx = pings.findIndex((p) => p.id === currentId);
  const current = currentIdx >= 0 ? pings[currentIdx] : null;
  const loudest = useMemo(() => {
    if (pings.length === 0) return null;
    return [...pings].sort((a, b) => totalReacts(b.reacts) + b.plays - (totalReacts(a.reacts) + a.plays))[0];
  }, [pings]);
  const unread = activity.filter((a) => a.unread).length;

  /* ---- auth + user doc --------------------------------------------------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        setOnboarded(true);
      } else {
        setUid("");
        setOnboarded(false);
      }
      setReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(firestore, "users", uid), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setCredits((d.credits as number) ?? 0);
      setPlays((d.plays as number) ?? 0);
      if (d.handle) setMyHandle(d.handle as string);
      const loc = d.location as { lat?: number; lng?: number } | undefined;
      if (loc?.lat != null && loc?.lng != null) setRealLocation({ lat: loc.lat, lng: loc.lng });
      const city = d.city as string | undefined;
      const state = d.state as string | undefined;
      if (city || state) setRealPlace([city, state].filter(Boolean).join(", "));
      setPrefs({ ...DEFAULT_PREFS, ...((d.prefs as Partial<Prefs>) || {}) });
      setStreak((d.streak as number) ?? 0);
      if (!d.seenCoach && !streakDoneRef.current) setShowCoach(true);

      // streak — run once per session
      if (!streakDoneRef.current) {
        streakDoneRef.current = true;
        const today = dayKey();
        const last = (d.lastActiveDay as string) || "";
        let next = (d.streak as number) ?? 0;
        if (last !== today) {
          next = last && daysBetween(last, today) === 1 ? next + 1 : 1;
          updateDoc(doc(firestore, "users", uid), { streak: next, lastActiveDay: today }).catch(() => {});
          setStreak(next);
        }
      }
    });
    return () => unsub();
  }, [uid]);

  /* ---- drops feed -------------------------------------------------------- */
  useEffect(() => {
    if (!uid) return;
    setFeedLoading(true);
    const q = query(collection(firestore, "drops"), orderBy("createdAt", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRawDrops(snap.docs.map((dd) => ({ id: dd.id, ...dd.data() })));
        setFeedLoading(false);
      },
      () => setFeedLoading(false)
    );
    return () => unsub();
  }, [uid]);

  /* ---- mic drop — one live broadcast per city, watched by everyone in it -- */
  useEffect(() => {
    if (!uid || !realPlace) return;
    const key = cityKey(realPlace);
    const unsub = onSnapshot(doc(firestore, "broadcasts", key), (snap) => {
      if (!snap.exists()) {
        setLiveBroadcast(null);
        return;
      }
      const d = snap.data() as MicDrop;
      const isLive = d.active && new Date(d.expiresAt).getTime() > Date.now();
      if (!isLive || d.uid === uid) {
        setLiveBroadcast(null);
        return;
      }
      setLiveBroadcast(d);
      if (interruptedForRef.current !== d.startedAt) {
        interruptedForRef.current = d.startedAt;
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.src = "";
        }
        setPlaying(false);
        setExpanded(false);
        vibrate([30, 40, 30]);
      }
    });
    return () => unsub();
  }, [uid, realPlace]);

  /* ---- activity ---------------------------------------------------------- */
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(firestore, "users", uid, "activity"), orderBy("at", "desc"), limit(60));
    const unsub = onSnapshot(q, (snap) => {
      setActivity(
        snap.docs.map((dd) => {
          const a = dd.data();
          return {
            id: dd.id,
            type: (a.type as string) || "system",
            who: a.who as string | undefined,
            react: a.react as string | undefined,
            title: a.title as string | undefined,
            detail: a.detail as string | undefined,
            ago: a.at ? timeAgo(a.at as string) : "",
            unread: !!a.unread,
          };
        })
      );
    });
    return () => unsub();
  }, [uid]);

  /* ---- ledger ------------------------------------------------------------ */
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(firestore, "users", uid, "ledger"), orderBy("at", "desc"), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      setLedger(
        snap.docs.map((dd) => {
          const l = dd.data();
          return { id: dd.id, label: (l.label as string) || "—", delta: (l.delta as number) || 0, ago: l.at ? timeAgo(l.at as string) : "" };
        })
      );
    });
    return () => unsub();
  }, [uid]);

  /* ---- IP place fallback ------------------------------------------------- */
  useEffect(() => {
    if (realPlace || !uid) return;
    fetch("https://ipapi.co/json/")
      .then((r) => r.json())
      .then((j) => {
        if (j.city || j.region) {
          const p = [j.city, j.region_code || j.region].filter(Boolean).join(", ");
          setRealPlace(p);
          updateDoc(doc(firestore, "users", uid), { city: j.city || "", state: j.region_code || j.region || "" }).catch(() => {});
          if (!realLocation && j.latitude && j.longitude) setRealLocation({ lat: j.latitude, lng: j.longitude });
        }
      })
      .catch(() => {});
  }, [uid, realPlace, realLocation]);

  /* ---- live location (fires as you move) --------------------------------- */
  useEffect(() => {
    if (!uid || !navigator.geolocation) return;
    let lastWrite = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setRealLocation({ lat: latitude, lng: longitude });
        const now = Date.now();
        if (now - lastWrite > 60000) {
          lastWrite = now;
          updateDoc(doc(firestore, "users", uid), {
            "location.lat": latitude,
            "location.lng": longitude,
            "location.updatedAt": new Date().toISOString(),
          }).catch(() => {});
        }
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [uid]);

  /* ---- PWA install ------------------------------------------------------- */
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      pwaPromptRef.current = e as unknown as { prompt: () => void };
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  /* ---- audio element ----------------------------------------------------- */
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    const onTime = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
      if (audio.duration && audio.currentTime / audio.duration > 0.6 && current) markPlayed(current);
    };
    const onEnd = () => {
      setProgress(1);
      if (current) markPlayed(current);
      advance();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.pause();
      audio.src = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, pings.length]);

  /* ---- load + play the current track ------------------------------------- */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.src !== current.audioUrl && current.audioUrl) {
      audio.src = current.audioUrl;
      setProgress(0);
    }
    if (playing && prefs.sound && current.audioUrl) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, playing, prefs.sound]);

  /* ---- stop playback when you walk out of the drop's radius -------------- */
  useEffect(() => {
    if (!currentId || !activeLoc) return;
    const drop = rawDrops.find((d) => (d.id as string) === currentId);
    if (!drop) return;
    const lat = drop.lat as number | null;
    const lng = drop.lng as number | null;
    const radiusMi = (drop.radiusMi as number) ?? DEFAULT_RADIUS_MI;
    if (lat != null && lng != null && haversineMi(activeLoc.lat, activeLoc.lng, lat, lng) > radiusMi) {
      const audio = audioRef.current;
      if (audio) { audio.pause(); audio.src = ""; }
      setPlaying(false);
      setExpanded(false);
      setCurrentId("");
      setProgress(0);
      flash("You've walked out of range", "location", C.amber);
    }
  }, [activeLoc, currentId, rawDrops, flash]);

  /* ---- mark activity read when viewing ----------------------------------- */
  useEffect(() => {
    if (tab !== "activity" || unread === 0) return;
    const t = setTimeout(() => {
      activity.filter((a) => a.unread).forEach((a) => updateDoc(doc(firestore, "users", uid, "activity", a.id), { unread: false }).catch(() => {}));
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, unread]);

  /* ---- economy ----------------------------------------------------------- */
  const chargePlayFor = useCallback(
    (p: Ping): boolean => {
      if (playCountedRef.current.has(p.id)) return true;
      if (plays < PLAY_COST) {
        flash("Out of plays — top up to keep listening", "ear", C.cyan);
        setTopUpOpen(true);
        return false;
      }
      updateDoc(doc(firestore, "users", uid), { plays: increment(-PLAY_COST) }).catch(() => {});
      addDoc(collection(firestore, "users", uid, "ledger"), { label: "Play", delta: -PLAY_COST, at: new Date().toISOString() }).catch(() => {});
      playCountedRef.current.add(p.id);
      return true;
    },
    [plays, uid, flash]
  );

  const markPlayed = useCallback(
    (p: Ping) => {
      if (markedRef.current.has(p.id)) return;
      markedRef.current.add(p.id);
      updateDoc(doc(firestore, "drops", p.id), { plays: increment(1) }).catch(() => {});
      if (p.pinnedToUid === uid) {
        updateDoc(doc(firestore, "drops", p.id), { pinnedTo: null, pinnedToUid: null }).catch(() => {});
        if (p.uid && p.uid !== uid) {
          addDoc(collection(firestore, "users", p.uid, "activity"), { type: "pin_listened", who: myHandle, title: p.title, at: new Date().toISOString(), unread: true }).catch(() => {});
        }
      }
    },
    [uid, myHandle]
  );

  const advance = useCallback(() => {
    if (!prefs.autoplay) {
      setPlaying(false);
      return;
    }
    const i = pings.findIndex((p) => p.id === currentId);
    const next = pings[i + 1];
    if (next) {
      if (chargePlayFor(next)) {
        setCurrentId(next.id);
        setPlaying(true);
      } else setPlaying(false);
    } else {
      setPlaying(false);
    }
  }, [pings, currentId, prefs.autoplay, chargePlayFor]);

  /* ---- auto-play when a drop enters your range --------------------------- */
  useEffect(() => {
    if (playing || !prefs.autoplay) return;
    const currentIds = new Set(pings.map((p) => p.id));
    const newEntrants = pings.filter((p) => !knownPingIdsRef.current.has(p.id));
    knownPingIdsRef.current = currentIds;
    if (newEntrants.length === 0) return;
    const next = newEntrants[0];
    if (chargePlayFor(next)) {
      setCurrentId(next.id);
      setPlaying(true);
      flash(`${next.handle} just entered your range`, "location", C.green);
    }
  }, [pings, playing, prefs.autoplay, chargePlayFor, flash]);

  /* ---- transport --------------------------------------------------------- */
  const selectVoice = (id: string, expand = true) => {
    const p = pings.find((x) => x.id === id);
    if (!p) return;
    setCurrentId(id);
    if (expand) setExpanded(true);
    if (chargePlayFor(p)) setPlaying(true);
    else setPlaying(false);
  };
  const togglePlay = () => {
    if (!current) {
      if (pings[0]) selectVoice(pings[0].id, false);
      return;
    }
    if (playing) setPlaying(false);
    else {
      if (chargePlayFor(current)) setPlaying(true);
    }
  };
  const skip = () => {
    const next = pings[currentIdx + 1];
    if (next && chargePlayFor(next)) {
      setCurrentId(next.id);
      setPlaying(true);
    }
  };
  const prev = () => {
    const p = pings[currentIdx - 1];
    if (p && chargePlayFor(p)) {
      setCurrentId(p.id);
      setPlaying(true);
    }
  };

  /* ---- reactions --------------------------------------------------------- */
  const react = (p: Ping, key: string) => {
    if (p.uid === uid) return;
    const prevKey = myReacts[p.id];
    if (prevKey === key) {
      updateDoc(doc(firestore, "drops", p.id), { [`reacts.${key}`]: increment(-1) }).catch(() => {});
      setMyReacts((m) => {
        const n = { ...m };
        delete n[p.id];
        return n;
      });
      return;
    }
    const patch: Record<string, unknown> = { [`reacts.${key}`]: increment(1) };
    if (prevKey) patch[`reacts.${prevKey}`] = increment(-1);
    updateDoc(doc(firestore, "drops", p.id), patch).catch(() => {});
    setMyReacts((m) => ({ ...m, [p.id]: key }));
    vibrate(12);
    if (p.uid && p.uid !== uid) {
      addDoc(collection(firestore, "users", p.uid, "activity"), { type: "reaction", who: myHandle, react: key, title: p.title, at: new Date().toISOString(), unread: true }).catch(() => {});
    }
    const r = REACTIONS.find((x) => x.key === key);
    flash(r?.label || "reacted", key === "felt" ? "heart" : key === "same" ? "target" : "spark", r?.color);
  };

  /* ---- reply economy (called after a hum uploads) ------------------------ */
  const onReplyPosted = () => {
    const p = replyTarget;
    updateDoc(doc(firestore, "users", uid), { credits: increment(-1) }).catch(() => {});
    addDoc(collection(firestore, "users", uid, "ledger"), { label: "Hum", delta: -1, at: new Date().toISOString() }).catch(() => {});
    if (p && p.uid && p.uid !== uid) {
      addDoc(collection(firestore, "users", p.uid, "activity"), { type: "hum", who: myHandle, title: p.title, at: new Date().toISOString(), unread: true }).catch(() => {});
    }
    flash("Hum sent", "mic", C.greenSoft);
  };

  /* ---- drop economy (called after a drop posts) -------------------------- */
  const onDropPosted = (d: { title: string; mood: string; secs: number; audioUrl: string; dropId: string; radiusMi: number }) => {
    updateDoc(doc(firestore, "users", uid), { credits: increment(-DROP_COST) }).catch(() => {});
    addDoc(collection(firestore, "users", uid, "ledger"), { label: "Drop", delta: -DROP_COST, at: new Date().toISOString() }).catch(() => {});
    setDropOpen(false);
    flash("Your voice is on the block", "radio", C.green);
    setTab("feed");
  };

  /* ---- buy (WIRE Stripe) ------------------------------------------------- */
  const buy = (type: "plays" | "credits", n: number, price: string) => {
    // >>> WIRE real Stripe checkout here; optimistic grant for now
    updateDoc(doc(firestore, "users", uid), { [type]: increment(n) }).catch(() => {});
    addDoc(collection(firestore, "users", uid, "ledger"), { label: `Bought ${n} ${type}`, delta: n, at: new Date().toISOString() }).catch(() => {});
    setTopUpOpen(false);
    flash(`+${n} ${type} added`, type === "plays" ? "ear" : "spark", type === "plays" ? C.cyan : C.green);
  };

  /* ---- prefs / profile / location / mute --------------------------------- */
  const togglePref = (k: keyof Prefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    updateDoc(doc(firestore, "users", uid), { prefs: next }).catch(() => {});
  };
  const saveHandle = async (h: string) => {
    setMyHandle(h);
    await updateDoc(doc(firestore, "users", uid), { handle: h }).catch(() => {});
    flash("Handle updated", "check", C.green);
  };
  const muteHandle = (h: string) => {
    mutedRef.current.add(h);
    setReportTarget(null);
    setRawDrops((d) => [...d]); // force re-filter
    flash(`Muted @${h}`, "mute", C.amber);
  };
  const reportVoice = (reason: string) => {
    // >>> WIRE write report to a moderation collection
    setReportTarget(null);
    flash("Reported — thanks for flagging", "flag", C.amber);
  };
  const signOutNow = async () => {
    setSettingsOpen(false);
    await signOut(auth).catch(() => {});
    setOnboarded(false);
  };
  const closeCoach = () => {
    setShowCoach(false);
    if (uid) updateDoc(doc(firestore, "users", uid), { seenCoach: true }).catch(() => {});
  };
  const refresh = () => {
    setRefreshing(true);
    vibrate(8);
    setTimeout(() => setRefreshing(false), 700);
  };
  const installApp = () => {
    pwaPromptRef.current?.prompt();
    setCanInstall(false);
  };

  const openReply = (p: Ping) => setReplyTarget(p);

  /* ====================================================================== */
  /* RENDER                                                                  */
  /* ====================================================================== */
  if (!ready) return (<><GlobalStyle /><Loader /></>);
  if (!onboarded)
    return (
      <>
        <GlobalStyle />
        <Onboarding
          onDone={(h) => {
            setMyHandle(h);
            setOnboarded(true);
          }}
        />
      </>
    );

  const hasMini = !!current && !expanded;
  const myDrops = rawDrops.filter((d) => d.uid === uid);
  const dropCount = myDrops.length;
  const reactsGot = myDrops.reduce((s, d) => s + totalReacts((d.reacts as { felt: number; same: number; loud: number }) || { felt: 0, same: 0, loud: 0 }), 0);
  const humsGot = myDrops.reduce((s, d) => s + (((d.replies as unknown[]) || []).length), 0);

  // pull-to-refresh (gesture only)
  const pull = { y: 0, top: false } as { y: number; top: false | number };
  const onScrollTouchStart = (e: React.TouchEvent) => {
    const el = e.currentTarget as HTMLDivElement;
    pull.top = el.scrollTop <= 0 ? e.touches[0].clientY : false;
  };
  const onScrollTouchMove = (e: React.TouchEvent) => {
    if (pull.top === false) return;
    const dy = e.touches[0].clientY - (pull.top as number);
    if (dy > 70 && !refreshing) {
      pull.top = false;
      refresh();
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: FONT, maxWidth: 480, margin: "0 auto", borderLeft: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}` }}>
      <GlobalStyle />

      {/* APP BAR */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `calc(10px + ${SAFE_T}) 16px 10px`, borderBottom: `1px solid ${C.line}`, background: hexA(C.bg, "F0"), backdropFilter: "blur(16px)", zIndex: 30 }}>
        <Mark size={26} knock={C.bg} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: 3, color: C.text, fontWeight: 800, textTransform: "uppercase", lineHeight: 1 }}>nearhum</div>
        </div>
        <button onClick={() => setSearchOpen(true)} style={{ width: 38, height: 38, borderRadius: 99, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <I name="search" size={19} color={C.dim} />
        </button>
        <button
          onClick={() => {
            audioRef.current?.pause();
            setPlaying(false);
            setMicDropOpen(true);
          }}
          title="Mic Drop — interrupt your block"
          style={{ width: 38, height: 38, borderRadius: 99, border: `1px solid ${hexA(C.red, "44")}`, background: hexA(C.red, "14"), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <I name="broadcast" size={17} color={C.red} />
        </button>
        <CreditChip plays={plays} credits={credits} onClick={() => setTopUpOpen(true)} />
      </div>

      {/* SCROLL */}
      <div onTouchStart={onScrollTouchStart} onTouchMove={onScrollTouchMove} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", padding: `16px 16px calc(${hasMini ? 168 : 92}px + ${SAFE_B})` }}>
        {refreshing && (
          <div style={{ textAlign: "center", padding: "0 0 12px", display: "flex", justifyContent: "center" }}>
            <span style={{ width: 22, height: 22, border: `2px solid ${C.line}`, borderTopColor: C.green, borderRadius: 99, animation: "spin .7s linear infinite" }} />
          </div>
        )}

        {/* ---------------- FEED ---------------- */}
        {tab === "feed" && (
          <>
            {/* greeting + place */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 750, color: C.text, letterSpacing: -0.3 }}>{timeGreeting()}</div>
                <button onClick={() => setLocationOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "none", padding: "3px 0 0", cursor: "pointer" }}>
                  <I name="location" size={12} color={viewingRemote ? C.amber : C.green} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: viewingRemote ? C.amber : C.dim }}>{viewingRemote ? `listening from ${activePlace}` : activePlace || "locating…"}</span>
                  <I name="chevD" size={12} color={C.dimmer} />
                </button>
              </div>
              {streak > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, background: hexA(C.amber, "12"), border: `1px solid ${hexA(C.amber, "33")}`, borderRadius: 99, padding: "6px 11px" }}>
                  <I name="flame" size={13} color={C.amber} fill={hexA(C.amber, "55")} />
                  <span style={{ fontFamily: MONO, fontSize: 12, color: C.amberSoft, fontWeight: 700 }}>{streak}</span>
                </div>
              )}
            </div>

            {/* RADAR */}
            {pings.length > 0 && (
              <div style={{ background: `radial-gradient(120% 90% at 50% 0%, ${hexA(C.green, "0E")}, ${C.panel} 70%)`, border: `1px solid ${C.line}`, borderRadius: 24, padding: "18px 14px 14px", marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6, padding: "0 4px" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, color: C.dim }}>VOICES AROUND YOU</span>
                  <span style={{ marginLeft: "auto" }}>
                    <LiveDot label={`${pings.length} LIVE`} />
                  </span>
                </div>
                <Radar pings={pings} currentId={currentId} onPick={(id) => selectVoice(id)} size={Math.min(300, 320)} live={!prefs.reduceMotion} />
                <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, marginTop: 6 }}>tap a dot to listen</div>
              </div>
            )}

            <LoudestHero p={loudest} onOpen={(id) => selectVoice(id)} />

            {pings.length > 0 && (
              <>
                <SortBar mode={sortMode} onPick={setSortMode} />
                <MoodFilter active={moodFilter} onPick={setMoodFilter} counts={moodCounts} />
              </>
            )}

            {/* list */}
            {feedLoading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : pings.length === 0 ? (
              <div style={{ textAlign: "center", padding: "50px 24px" }}>
                <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 22px" }}>
                  <svg width="120" height="120" style={{ position: "absolute", inset: 0 }}>
                    {[48, 34, 20].map((r, i) => (
                      <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={C.green} strokeWidth="1.5" opacity={0.25 - i * 0.06} style={{ animation: `bloom ${2 + i * 0.4}s ease-in-out infinite` }} />
                    ))}
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <I name="radio" size={32} color={C.green} />
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 750, color: C.text, marginBottom: 8 }}>{moodFilter === "All" ? "It's quiet here." : `No ${moodFilter.toLowerCase()} voices nearby.`}</div>
                <p style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, margin: "0 0 22px" }}>
                  {viewingRemote ? "Nobody's dropped here lately. Head back to your own area, or be the first to break the silence." : "No voices on the block right now. Be the first — drop something and start the hum."}
                </p>
                <button onClick={() => setDropOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "14px 22px", borderRadius: 99, border: "none", background: C.green, color: C.bg, fontFamily: MONO, fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: "pointer", boxShadow: `0 6px 20px ${hexA(C.green, "44")}` }}>
                  <I name="mic" size={16} color={C.bg} sw={1.8} /> DROP THE FIRST VOICE
                </button>
              </div>
            ) : (
              <>
                <SectionLabel icon="radio">{sortMode === "near" ? "NEAREST VOICES" : sortMode === "loud" ? "LOUDEST VOICES" : "FRESHEST VOICES"}</SectionLabel>
                {pings.map((p) => (
                  <VoiceCard key={p.id} p={p} isCurrent={p.id === currentId} playing={playing && p.id === currentId} onPick={(id) => selectVoice(id)} />
                ))}
                <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.dimmer, padding: "14px 0 4px" }}>that's everyone within reach · voices fade after 24h</div>
              </>
            )}
          </>
        )}

        {/* ---------------- ACTIVITY ---------------- */}
        {tab === "activity" && (
          <>
            <div style={{ fontSize: 24, fontWeight: 780, color: C.text, letterSpacing: -0.4, marginBottom: 4 }}>Activity</div>
            <p style={{ fontFamily: MONO, fontSize: 11, color: C.dim, margin: "0 0 18px" }}>hums, pins and reactions on your voices</p>
            {streak > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: `linear-gradient(135deg, ${hexA(C.amber, "16")}, ${C.card})`, border: `1px solid ${hexA(C.amber, "33")}`, borderRadius: 16, padding: "14px 16px", marginBottom: 18 }}>
                <I name="flame" size={26} color={C.amber} fill={hexA(C.amber, "44")} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{streak}-day streak</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.amberSoft }}>you keep showing up. the block hears you.</div>
                </div>
              </div>
            )}
            <ActivityFeed
              items={activity}
              onOpen={(title) => {
                const p = pings.find((x) => x.title === title);
                if (p) selectVoice(p.id);
                else flash("That voice has faded", "clock", C.dim);
              }}
            />
          </>
        )}

        {/* ---------------- YOU ---------------- */}
        {tab === "you" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: 20, background: `linear-gradient(135deg, ${C.greenDeep}, ${C.green})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 8px 24px ${hexA(C.green, "33")}` }}>
                <I name="user" size={30} color={C.bg} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 780, color: C.text }}>{myHandle === "—" ? "Anonymous" : `@${myHandle}`}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                  <I name="location" size={11} color={C.dim} /> {activePlace || "location off"}
                </div>
              </div>
              <button onClick={() => setSettingsOpen(true)} style={{ width: 40, height: 40, borderRadius: 99, border: `1px solid ${C.line}`, background: C.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <I name="gear" size={18} color={C.dim} />
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <StatTile value={fmtCount(dropCount)} label="DROPS" color={C.green} />
              <StatTile value={fmtCount(humsGot)} label="HUMS GOT" color={C.greenSoft} />
              <StatTile value={fmtCount(reactsGot)} label="REACTIONS" color={C.rose} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
              <StatTile value={fmtCount(plays)} label="PLAYS LEFT" color={C.cyan} />
              <StatTile value={fmtCount(credits)} label="CREDITS" color={C.green} />
              <StatTile value={streak} label="DAY STREAK" color={C.amber} />
            </div>

            <button onClick={() => setTopUpOpen(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", borderRadius: 16, border: `1px solid ${hexA(C.green, "44")}`, background: `linear-gradient(135deg, ${hexA(C.green, "16")}, ${C.card})`, cursor: "pointer", marginBottom: 10, textAlign: "left" }}>
              <I name="spark" size={20} color={C.green} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Top up plays &amp; credits</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>keep listening and dropping</div>
              </div>
              <I name="chevR" size={18} color={C.dim} />
            </button>

            {canInstall && (
              <button onClick={installApp} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", borderRadius: 16, border: `1px solid ${C.line}`, background: C.card, cursor: "pointer", marginBottom: 22, textAlign: "left" }}>
                <I name="share" size={20} color={C.greenSoft} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Add to home screen</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>open Nearhum like an app</div>
                </div>
                <I name="chevR" size={18} color={C.dim} />
              </button>
            )}

            <SectionLabel icon="clock">RECENT</SectionLabel>
            {ledger.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 12, color: C.dim, padding: "10px 0", textAlign: "center" }}>nothing yet — your plays and drops will show here</div>
            ) : (
              ledger.map((l) => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", padding: "12px 4px", borderBottom: `1px solid ${C.lineSoft}` }}>
                  <span style={{ fontSize: 13, color: C.textDim, flex: 1 }}>{l.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.dimmer, marginRight: 12 }}>{l.ago}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: l.delta >= 0 ? C.green : C.dim }}>{l.delta >= 0 ? "+" : ""}{l.delta}</span>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* MINI PLAYER */}
      {hasMini && current && (
        <MiniPlayer p={current} progress={progress} playing={playing} onToggle={togglePlay} onExpand={() => setExpanded(true)} />
      )}

      {/* TAB BAR */}
      <TabBar tab={tab} onTab={setTab} onDrop={() => setDropOpen(true)} unread={unread} />

      {/* FULL PLAYER */}
      {expanded && current && (
        <FullPlayer
          p={current}
          progress={progress}
          playing={playing}
          onToggle={togglePlay}
          onSkip={skip}
          onPrev={prev}
          onReply={() => openReply(current)}
          onReact={(k) => react(current, k)}
          userReact={myReacts[current.id]}
          onCollapse={() => setExpanded(false)}
          onMore={() => setReportTarget(current)}
          idx={currentIdx < 0 ? 0 : currentIdx}
          total={pings.length}
          isOwn={current.uid === uid}
        />
      )}

      {/* SHEETS */}
      {replyTarget && (
        <ReplySheet
          ping={replyTarget}
          onClose={() => setReplyTarget(null)}
          onAddReply={onReplyPosted}
          uid={uid}
          myHandle={myHandle}
          credits={credits}
          onPlayReply={() => chargePlayFor(replyTarget)}
        />
      )}

      {dropOpen && (
        <DropSheet
          onClose={() => setDropOpen(false)}
          onDrop={onDropPosted}
          uid={uid}
          myHandle={myHandle}
          credits={credits}
          location={realLocation}
          place={realPlace}
          canDrop={canDrop}
          onNeedTopUp={() => {
            setDropOpen(false);
            setTopUpOpen(true);
            flash("Not enough credits to drop", "spark", C.amber);
          }}
        />
      )}

      {topUpOpen && <TopUp onClose={() => setTopUpOpen(false)} onBuy={buy} plays={plays} credits={credits} />}

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          handle={myHandle}
          place={activePlace}
          prefs={prefs}
          onTogglePref={togglePref}
          onSignOut={signOutNow}
          onEditProfile={() => {
            setSettingsOpen(false);
            setEditProfileOpen(true);
          }}
          onChangeLocation={() => {
            setSettingsOpen(false);
            setLocationOpen(true);
          }}
        />
      )}

      {searchOpen && (
        <SearchSheet
          onClose={() => setSearchOpen(false)}
          pings={pings}
          onPick={(id) => {
            setSearchOpen(false);
            selectVoice(id);
          }}
        />
      )}

      {locationOpen && (
        <LocationSheet
          onClose={() => setLocationOpen(false)}
          realPlace={realPlace}
          viewingRemote={viewingRemote}
          onPick={(c) => {
            setRemoteLoc(c);
            setLocationOpen(false);
            flash(`Listening from ${c.name}`, "globe", C.cyan);
          }}
          onHome={() => {
            setRemoteLoc(null);
            setLocationOpen(false);
            flash("Back to your area", "location", C.green);
          }}
        />
      )}

      {reportTarget && (
        <ReportSheet
          ping={reportTarget}
          onClose={() => setReportTarget(null)}
          onMute={muteHandle}
          onReport={reportVoice}
          onReactions={() => {
            const t = reportTarget;
            setReportTarget(null);
            setReactTarget(t);
          }}
        />
      )}

      {reactTarget && <ReactDetailSheet ping={reactTarget} onClose={() => setReactTarget(null)} />}

      {editProfileOpen && <EditProfileSheet handle={myHandle} onClose={() => setEditProfileOpen(false)} onSave={saveHandle} />}

      {micDropOpen && (
        <MicDropSheet
          onClose={() => setMicDropOpen(false)}
          uid={uid}
          myHandle={myHandle}
          credits={credits}
          place={realPlace}
          canDrop={canDrop}
        />
      )}

      {showCoach && <CoachMarks onClose={closeCoach} />}

      {liveBroadcast && <MicDropLiveOverlay broadcast={liveBroadcast} onEnded={() => setLiveBroadcast(null)} />}

      <Toast toast={toast} />
    </div>
  );
}