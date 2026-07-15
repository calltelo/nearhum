"use client";

/* ============================================================================
   NEARHUM — admin dashboard (/admin)
   ----------------------------------------------------------------------------
   Operator view of everything: who's online (heartbeat), installs, push
   reach, live drops with real listener counts, recent listens, and the push
   pipeline. Unlocks with PUSH_API_SECRET (kept in localStorage); all data
   comes from /api/admin which does the admin-SDK aggregation server-side.
   Auto-refreshes every 30s.
   ============================================================================ */
import React, { useCallback, useEffect, useState } from "react";

const C = {
  bg: "#040806",
  panel: "#0A140D",
  card: "#0C1710",
  line: "#18301F",
  lineHi: "#244A30",
  green: "#22C55E",
  greenSoft: "#4ADE80",
  cyan: "#22D3EE",
  cyanSoft: "#67E8F9",
  amber: "#F59E0B",
  amberSoft: "#FBBF24",
  rose: "#FB7185",
  violet: "#A78BFA",
  text: "#E4F5E9",
  textDim: "#A9C6B5",
  dim: "#5F8270",
  dimmer: "#3C5244",
};
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

type AdminData = {
  now: string;
  stats: { users: number; online: number; installed: number; pushReachable: number; liveDrops: number; listeningNow: number };
  users: {
    id: string; handle: string; email: string; city: string; state: string;
    plays: number; credits: number; streak: number; createdAt: string; lastSeenAt: string;
    online: boolean; pwaInstalled: boolean; pushEnabled: boolean; tokens: number; notifPref: boolean;
  }[];
  drops: {
    id: string; title: string; handle: string; mood: string; place: string; radiusMi: number | null;
    plays: number; live: number; replies: number; reacts: number; createdAt: string; hoursLeft: number;
  }[];
  recentListens: { listener: string; title: string; who: string; at: string }[];
  push: { lastRunAt: string };
  broadcasts: { handle: string; place: string }[];
};

function timeAgo(iso: string) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

function Stat({ value, label, color }: { value: React.ReactNode; label: string; color: string }) {
  return (
    <div style={{ flex: "1 1 100px", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 10px", textAlign: "center", minWidth: 100 }}>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1.5, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 2, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

const th: React.CSSProperties = { fontFamily: MONO, fontSize: 9, color: C.dim, letterSpacing: 1, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${C.lineHi}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12.5, color: C.textDim, padding: "9px 10px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", fontFamily: MONO };

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "2px 7px", borderRadius: 99, background: on ? "rgba(34,197,94,.12)" : "transparent", border: `1px solid ${on ? "rgba(34,197,94,.4)" : C.line}`, color: on ? C.greenSoft : C.dimmer, marginRight: 4 }}>
      {label}
    </span>
  );
}

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [input, setInput] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // deferred so hydration completes with the lock screen before the saved
    // key (external state) swaps the view — also keeps the linter honest
    const t = setTimeout(() => {
      try {
        const saved = localStorage.getItem("nh_admin_key");
        if (saved) setKey(saved);
      } catch {
        /* no storage */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/admin?key=${encodeURIComponent(k)}`);
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "failed");
        if (r.status === 401) {
          setKey("");
          try { localStorage.removeItem("nh_admin_key"); } catch { /* no storage */ }
        }
        return;
      }
      setErr("");
      setData(j);
    } catch {
      setErr("network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => load(key), 0);
    const iv = setInterval(() => load(key), 30000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [key, load]);

  if (!key) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 360, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20, padding: 26 }}>
          <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, letterSpacing: 3, color: C.text, marginBottom: 4 }}>NEARHUM</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1.5, marginBottom: 20 }}>ADMIN ACCESS</div>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                try { localStorage.setItem("nh_admin_key", input.trim()); } catch { /* no storage */ }
                setKey(input.trim());
              }
            }}
            placeholder="admin key"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: 14, color: C.text, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, outline: "none", marginBottom: 12 }}
          />
          <button
            onClick={() => {
              if (!input.trim()) return;
              try { localStorage.setItem("nh_admin_key", input.trim()); } catch { /* no storage */ }
              setKey(input.trim());
            }}
            style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 12, fontWeight: 800, letterSpacing: 2, background: C.green, color: C.bg }}
          >
            UNLOCK
          </button>
          {err && <div style={{ fontFamily: MONO, fontSize: 11, color: C.rose, marginTop: 12, textAlign: "center" }}>{err}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.text, padding: "22px 18px 60px", maxWidth: 1100, margin: "0 auto" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div>
          <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 800, letterSpacing: 3 }}>NEARHUM</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.green, letterSpacing: 2, marginLeft: 10 }}>ADMIN</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {data && <span style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer }}>updated {timeAgo(data.now)}</span>}
          <button onClick={() => load(key)} disabled={loading} style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.lineHi}`, background: C.card, color: loading ? C.dim : C.greenSoft, cursor: loading ? "default" : "pointer" }}>
            {loading ? "LOADING…" : "REFRESH"}
          </button>
        </div>
      </div>

      {err && <div style={{ fontFamily: MONO, fontSize: 11, color: C.rose, marginBottom: 16 }}>{err}</div>}

      {data && (
        <>
          {/* stats */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 26 }}>
            <Stat value={data.stats.users} label="USERS" color={C.text} />
            <Stat value={data.stats.online} label="ONLINE NOW" color={C.greenSoft} />
            <Stat value={data.stats.installed} label="INSTALLED" color={C.cyanSoft} />
            <Stat value={data.stats.pushReachable} label="PUSH REACH" color={C.violet} />
            <Stat value={data.stats.liveDrops} label="LIVE DROPS" color={C.amberSoft} />
            <Stat value={data.stats.listeningNow} label="LISTENING NOW" color={C.green} />
          </div>

          {data.broadcasts.length > 0 && (
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.amberSoft, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 12, padding: "10px 14px", marginBottom: 22 }}>
              🎤 MIC DROP LIVE — {data.broadcasts.map((b) => `@${b.handle} in ${b.place}`).join(" · ")}
            </div>
          )}

          {/* users */}
          <Section title={`USERS (${data.users.length})`}>
            <div style={{ overflowX: "auto", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 780 }}>
                <thead>
                  <tr>
                    <th style={th}>HANDLE</th><th style={th}>STATUS</th><th style={th}>SEEN</th><th style={th}>PLACE</th>
                    <th style={th}>PLAYS</th><th style={th}>CREDITS</th><th style={th}>STREAK</th><th style={th}>JOINED</th><th style={th}>EMAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ ...td, color: C.text, fontWeight: 700 }}>
                        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 99, background: u.online ? C.green : C.dimmer, marginRight: 8 }} />
                        @{u.handle}
                      </td>
                      <td style={td}>
                        <Badge on={u.pwaInstalled} label="PWA" />
                        <Badge on={u.pushEnabled && u.tokens > 0 && u.notifPref} label={`PUSH${u.tokens > 1 ? ` ×${u.tokens}` : ""}`} />
                      </td>
                      <td style={{ ...td, color: u.online ? C.greenSoft : C.dim }}>{timeAgo(u.lastSeenAt)}</td>
                      <td style={td}>{[u.city, u.state].filter(Boolean).join(", ") || "—"}</td>
                      <td style={{ ...td, color: C.cyanSoft }}>{u.plays}</td>
                      <td style={{ ...td, color: C.greenSoft }}>{u.credits}</td>
                      <td style={{ ...td, color: u.streak > 0 ? C.amberSoft : C.dim }}>{u.streak || "—"}</td>
                      <td style={td}>{timeAgo(u.createdAt)}</td>
                      <td style={{ ...td, color: C.dim }}>{u.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* live drops */}
          <Section title={`LIVE DROPS (${data.drops.length})`}>
            {data.drops.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, padding: "8px 2px" }}>nothing live — drops fade after 24h</div>
            ) : (
              <div style={{ overflowX: "auto", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th style={th}>TITLE</th><th style={th}>BY</th><th style={th}>MOOD</th><th style={th}>LIVE</th>
                      <th style={th}>HEARD</th><th style={th}>HUMS</th><th style={th}>REACTS</th><th style={th}>FADES IN</th><th style={th}>REACH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drops.map((d) => (
                      <tr key={d.id}>
                        <td style={{ ...td, color: C.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</td>
                        <td style={td}>@{d.handle}</td>
                        <td style={td}>{d.mood}</td>
                        <td style={{ ...td, color: d.live > 0 ? C.greenSoft : C.dimmer, fontWeight: 700 }}>{d.live > 0 ? `● ${d.live}` : "—"}</td>
                        <td style={{ ...td, color: C.cyanSoft }}>{d.plays}</td>
                        <td style={td}>{d.replies}</td>
                        <td style={{ ...td, color: d.reacts > 0 ? C.rose : C.dim }}>{d.reacts}</td>
                        <td style={{ ...td, color: d.hoursLeft <= 4 ? C.amberSoft : C.dim }}>{d.hoursLeft}h</td>
                        <td style={td}>{d.radiusMi != null ? `${d.radiusMi}mi` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* recent listens */}
          <Section title="RECENT LISTENS">
            {data.recentListens.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, padding: "8px 2px" }}>no listens recorded yet</div>
            ) : (
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "4px 0" }}>
                {data.recentListens.map((l, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: C.greenSoft, fontWeight: 700, flexShrink: 0 }}>@{l.listener}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, flexShrink: 0 }}>listened to</span>
                    <span style={{ fontSize: 12.5, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      &quot;{l.title}&quot; <span style={{ color: C.dim }}>by @{l.who}</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: C.dimmer, marginLeft: "auto", flexShrink: 0 }}>{timeAgo(l.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* push pipeline */}
          <Section title="PUSH PIPELINE">
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.textDim, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
              last sweep: <span style={{ color: data.push.lastRunAt ? C.greenSoft : C.rose }}>{data.push.lastRunAt ? `${timeAgo(data.push.lastRunAt)} ago (${data.push.lastRunAt})` : "never"}</span>
              <span style={{ color: C.dimmer }}> · sweeps run on user actions (nudge) — quiet block, old timestamp is normal</span>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
