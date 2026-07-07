import { useState, useEffect } from "react"
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts"
import api from "../lib/api"
import Reveal, { RevealItem } from "./Reveal"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

const CONTEXT_LABELS = {
  social: "Casual & Low-Stakes", collaborative: "Collaborative",
  evaluative: "Interview & Review · High Stakes", influential: "Persuading & Pitching",
  negotiation: "Negotiation", adversarial: "Conflict & Friction",
  developmental: "Coaching & Feedback", support: "Supportive Listening",
  intimate: "Deep Personal", casual: "Casual & Low-Stakes", meeting: "Meeting",
  job_interview: "Interview & Review · High Stakes", disagreement: "Conflict & Friction",
  presentation: "Interview & Review · High Stakes", sales_call: "Persuading & Pitching",
  feedback_conversation: "Coaching & Feedback", coaching_call: "Coaching & Feedback",
  first_date: "Deep Personal",
}

// Mirrors backend/pipeline/portrait_synthesizer.py's _SIGNAL_FORMAT — how to
// render each signal's raw established mean as supporting evidence text.
const SIGNAL_FORMAT = {
  talk_ratio:          { scale: 100, digits: 0, unit: "% of speaking time" },
  questions:           { scale: 1,   digits: 1, unit: " questions per session" },
  speech_rate:         { scale: 1,   digits: 0, unit: " wpm" },
  response_latency:    { scale: 1,   digits: 1, unit: "s response latency" },
  hedging:             { scale: 1,   digits: 1, unit: " hedges per 100 words" },
  directness:          { scale: 1,   digits: 1, unit: " direct phrases per 100 words" },
  question_impact:     { scale: 100, digits: 0, unit: "% of your questions picked up" },
  drive_vs_follow:     { scale: 100, digits: 0, unit: "% drive score" },
  building_on_others:  { scale: 100, digits: 0, unit: "% of turns build on others" },
}

function formatMean(signalKey, mean) {
  const f = SIGNAL_FORMAT[signalKey]
  if (!f || mean == null) return ""
  return `${(mean * f.scale).toFixed(f.digits)}${f.unit}`
}

// Practical chart-scaling ranges only — NOT a comparative score. Each signal's
// natural range is mapped to 0-100 purely so the spectrum chart has something
// sensible to plot; nothing here is shown to the user as a number.
const SPECTRUM_RANGES = {
  talk_ratio:          [0, 1],
  questions:           [0, 10],
  speech_rate:         [80, 220],
  response_latency:    [0, 5],
  hedging:             [0, 10],
  directness:          [0, 10],
  question_impact:     [0, 1],
  drive_vs_follow:     [0, 1],
  building_on_others:  [0, 1],
}

function spectrumPosition(signalKey, mean) {
  const [lo, hi] = SPECTRUM_RANGES[signalKey] || [0, 1]
  if (mean == null) return 0
  const pct = ((mean - lo) / (hi - lo)) * 100
  return Math.max(4, Math.min(100, pct))
}

// New 9-signal trend chart options (replaces the old dimension/filler-era list).
const SIGNAL_OPTIONS = [
  { key: "talk_ratio",           label: "Talk-share",             unit: "%" },
  { key: "hedging_rate",         label: "Hedging",                unit: "/100w" },
  { key: "directness_rate",      label: "Directness",             unit: "/100w" },
  { key: "question_pickup_rate", label: "Question follow-through", unit: "%" },
  { key: "drive_score",          label: "Conversational drive",   unit: "%" },
  { key: "building_on_rate",     label: "Building on others",     unit: "%" },
  { key: "wpm",                  label: "Pace",                   unit: "wpm" },
  { key: "response_latency",     label: "Pauses",                 unit: "s" },
]

const FRAMING_CONFIG = {
  strength:    { color: "#34d399", label: "Strength" },
  growth_area: { color: "#fb923c", label: "Growth area" },
  observation: { color: "#818cf8", label: "Observation" },
}


// ── Section label ─────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 1.4,
      textTransform: "uppercase", marginBottom: 4,
      background: G, WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent", backgroundClip: "text",
    }}>
      {children}
    </div>
  )
}

// ── Mirror Feed (unchanged this slice — rebuild is the next slice) ─

const FEED_TYPE_CONFIG = {
  context_contrast: { color: "#818cf8", label: "Context contrast", icon: "↕" },
  trend_up:         { color: "#34d399", label: "Improving",         icon: "↑" },
  trend_down:       { color: "#fb923c", label: "Declining",         icon: "↓" },
  pattern:          { color: "#f59e0b", label: "Consistent pattern", icon: "●" },
}

const FEED_MIN_VISIBLE = 3

function MirrorFeedItem({ insight, i, total }) {
  const cfg = FEED_TYPE_CONFIG[insight.type] || FEED_TYPE_CONFIG.pattern
  return (
    <RevealItem index={i}>
    <div style={{
      display: "flex", gap: 14, padding: "14px 18px",
      borderBottom: i < total - 1 ? "1px solid #131827" : "none",
      alignItems: "flex-start",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: `${cfg.color}18`,
        border: `1px solid ${cfg.color}30`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, color: cfg.color, fontWeight: 700, marginTop: 1,
      }}>
        {cfg.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color,
          textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>
          {cfg.label}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#c4c2d8", lineHeight: 1.75 }}>
          {insight.text}
        </p>
        {insight.tip && (
          <p style={{
            margin: "10px 0 0", fontSize: 12, color: "#6b6888", lineHeight: 1.65,
            paddingTop: 10, borderTop: "1px solid #131827",
          }}>
            <span style={{ color: "#4a4865", fontWeight: 600 }}>— </span>
            {insight.tip}
          </p>
        )}
      </div>
    </div>
    </RevealItem>
  )
}

function MirrorFeed({ insights }) {
  const [expanded, setExpanded] = useState(false)

  if (!insights) return null

  if (!insights.length) {
    return (
      <p style={{ fontSize: 13, color: "#4a4d6a", margin: 0, lineHeight: 1.7 }}>
        Record conversations across different contexts — patterns that span multiple
        sessions will appear here.
      </p>
    )
  }

  const hasMore = insights.length > FEED_MIN_VISIBLE
  const visible = expanded ? insights : insights.slice(0, FEED_MIN_VISIBLE)

  return (
    <div>
      <div style={{ position: "relative" }}>
        <div style={{ background: "#151922", border: "1px solid #1e2438",
          borderRadius: 12, overflow: "hidden",
          boxShadow: "0 2px 16px rgba(0,0,0,0.3)" }}>
          {visible.map((insight, i) => (
            <MirrorFeedItem key={insight.signal || i} insight={insight} i={i} total={visible.length} />
          ))}
        </div>

        {hasMore && !expanded && (
          <div
            onClick={() => setExpanded(true)}
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              height: 90,
              background: "linear-gradient(to bottom, transparent, #0f1117)",
              borderRadius: "0 0 12px 12px",
              display: "flex", alignItems: "flex-end",
              justifyContent: "center", paddingBottom: 14,
              cursor: "pointer",
            }}
          >
            <span style={{
              fontSize: 12, fontWeight: 600, color: "#5b9cf6",
              background: "rgba(15,17,23,0.85)",
              border: "1px solid rgba(29,78,216,0.3)",
              borderRadius: 20, padding: "5px 18px",
            }}>
              Show more
            </span>
          </div>
        )}
      </div>

      {expanded && hasMore && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 8, background: "none", border: "none",
            cursor: "pointer", fontSize: 12, color: "#4a4865",
            display: "block", width: "100%", textAlign: "center", padding: "6px 0",
          }}
        >
          Show less
        </button>
      )}
    </div>
  )
}

// ── Spectrum chart ─────────────────────────────────────────────────
// Real measured signals as axes (never invented trait names), self-relative
// chart-scaling (never a population comparison), no number printed anywhere —
// CLAUDE.md's "fingerprint spectrums", not a graded score. Only steady signals
// get a plotted point; not-yet-steady axes are omitted rather than faked.

function SpectrumChart({ steady }) {
  if (!steady?.length) return null

  const radarData = steady.map(s => ({
    subject: s.label,
    value: spectrumPosition(s.signal_key, s.mean),
  }))

  return (
    <div style={{
      background: "#151922", border: "1px solid #1e2438",
      borderRadius: 12, padding: "8px 0",
      boxShadow: "0 2px 16px rgba(0,0,0,0.3)"
    }}>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="66%">
          <PolarGrid stroke="#1e2438" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b89aa", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="value"
            stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.18} strokeWidth={2.5} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Steady signals — established patterns ──────────────────────────

function SteadySignalCard({ item, i }) {
  const cfg = FRAMING_CONFIG[item.framing] || FRAMING_CONFIG.observation
  const evidence = formatMean(item.signal_key, item.mean)
  return (
    <RevealItem index={i}>
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: `3px solid ${cfg.color}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>
          {item.label}
        </span>
        <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600,
          background: `${cfg.color}15`, border: `1px solid ${cfg.color}30`,
          borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap", marginLeft: 12 }}>
          {cfg.label}
        </span>
      </div>
      {item.note && (
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {item.note}
        </p>
      )}
      {evidence && (
        <p style={{ margin: 0, fontSize: 11, color: "#4a4865" }}>
          Evidence: {evidence} · based on {item.sample_count} sessions
        </p>
      )}
    </div>
    </RevealItem>
  )
}

// ── Still forming — not enough evidence yet ────────────────────────

function StillFormingRow({ item }) {
  const pct = Math.round((item.sample_count / item.min_needed) * 100)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12,
      padding: "9px 0", borderBottom: "1px solid #131827" }}>
      <span style={{ fontSize: 13, color: "#8b89aa", minWidth: 150, flexShrink: 0 }}>
        {item.label}
      </span>
      <div style={{ flex: 1, height: 3, background: "#1e2438", borderRadius: 2 }}>
        <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`,
          background: "#3a3a52" }} />
      </div>
      <span style={{ fontSize: 11, color: "#4a4865", whiteSpace: "nowrap" }}>
        {item.sample_count} of {item.min_needed} sessions
      </span>
    </div>
  )
}

// ── How you shift by context ───────────────────────────────────────

function ContextShiftCard({ item, i }) {
  return (
    <RevealItem index={i}>
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff", marginBottom: 8 }}>
        {item.label}
      </div>
      {item.note && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {item.note}
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(item.by_context).map(([ctx, mean]) => (
          <span key={ctx} style={{
            fontSize: 11, color: "#8b89aa", background: "#0e1320",
            border: "1px solid #1e2438", borderRadius: 20, padding: "4px 12px",
          }}>
            {CONTEXT_LABELS[ctx] || ctx}: {formatMean(item.signal_key, mean)}
          </span>
        ))}
      </div>
    </div>
    </RevealItem>
  )
}

// ── Signal Trends (collapsible, raw history — not a pattern claim) ─

function SignalTrends({ chartData }) {
  const [open, setOpen] = useState(false)
  const [activeSignal, setActiveSignal] = useState("talk_ratio")
  if (chartData.length < 2) return null

  const signalConfig = SIGNAL_OPTIONS.find(s => s.key === activeSignal)

  return (
    <div className="card" style={{ border: "1px solid #1e2438", borderRadius: 12,
      background: "#151922", overflow: "hidden" }}>
      <div onClick={() => setOpen(v => !v)}
        style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between",
          alignItems: "center", cursor: "pointer",
          borderBottom: open ? "1px solid #1e2438" : "none" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>Signal History</span>
        <span style={{ fontSize: 11, color: "#4a4865" }}>{open ? "▲ close" : "▼ expand"}</span>
      </div>

      {open && (
        <div style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {SIGNAL_OPTIONS.map(s => {
              const isActive = activeSignal === s.key
              return (
                <button key={s.key} onClick={() => setActiveSignal(s.key)}
                  style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12,
                    cursor: "pointer", fontWeight: isActive ? 600 : 400,
                    background: isActive ? "rgba(59,130,246,0.12)" : "#0e1320",
                    color: isActive ? "#60a5fa" : "#8b89aa",
                    border: isActive ? "1px solid rgba(59,130,246,0.3)" : "1px solid #1e2438",
                    transition: "all 0.15s" }}>
                  {s.label}
                </button>
              )
            })}
          </div>

          <div style={{ borderRadius: 8, padding: "12px 0" }}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2438" />
                <XAxis dataKey="label" fontSize={11} tick={{ fill: "#8b89aa" }}
                  axisLine={{ stroke: "#1e2438" }} tickLine={{ stroke: "#1e2438" }} />
                <YAxis fontSize={11} tick={{ fill: "#8b89aa" }} width={38}
                  axisLine={{ stroke: "#1e2438" }} tickLine={{ stroke: "#1e2438" }}
                  tickFormatter={v => `${v}${signalConfig?.unit || ""}`} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #1e2438", borderRadius: 8 }}
                  labelStyle={{ color: "#8b89aa" }} itemStyle={{ color: "#f0eeff" }}
                  formatter={v => [`${v}${signalConfig?.unit || ""}`, signalConfig?.label]}
                  labelFormatter={(_, p) => p?.[0]?.payload?.date || ""}
                />
                <Line type="monotone" dataKey={activeSignal}
                  stroke="#3b82f6" strokeWidth={2.5}
                  dot={{ r: 4, fill: "#3b82f6", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "#22d3ee" }}
                  connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ProfileView ("You" page) ──────────────────────────────────

export default function ProfileView({ active }) {
  const [profile, setProfile] = useState(null)
  const [trends, setTrends] = useState([])
  const [loading, setLoading] = useState(true)
  const [blindSpotsOpen, setBlindSpotsOpen] = useState(false)

  useEffect(() => {
    if (!active) return
    setLoading(true)
    Promise.all([api.get("/api/profile"), api.get("/api/trends")])
      .then(([profileRes, trendsRes]) => {
        setProfile(profileRes.data)
        setTrends(trendsRes.data.data || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [active])

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#4a4865" }}>
      Loading your profile…
    </div>
  )

  if (!profile || profile.insufficient_data) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <defs>
              <linearGradient id="pv-empty-g" x1="0" y1="0" x2="52" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1d4ed8"/><stop offset="1" stopColor="#0891b2"/>
              </linearGradient>
            </defs>
            <rect x="2"  y="20" width="6"  height="6"  rx="3" fill="url(#pv-empty-g)" opacity=".35"/>
            <rect x="11" y="13" width="6"  height="13" rx="3" fill="url(#pv-empty-g)" opacity=".6"/>
            <rect x="20" y="6"  width="8"  height="20" rx="4" fill="url(#pv-empty-g)"/>
            <rect x="31" y="13" width="6"  height="13" rx="3" fill="url(#pv-empty-g)" opacity=".6"/>
            <rect x="40" y="20" width="6"  height="6"  rx="3" fill="url(#pv-empty-g)" opacity=".35"/>
            <line x1="0" y1="28" x2="52" y2="28" stroke="#1e2438" strokeWidth="1.25"/>
            <rect x="2"  y="29" width="6"  height="6"  rx="3" fill="url(#pv-empty-g)" opacity=".15"/>
            <rect x="11" y="29" width="6"  height="13" rx="3" fill="url(#pv-empty-g)" opacity=".27"/>
            <rect x="20" y="29" width="8"  height="20" rx="4" fill="url(#pv-empty-g)" opacity=".33"/>
            <rect x="31" y="29" width="6"  height="13" rx="3" fill="url(#pv-empty-g)" opacity=".27"/>
            <rect x="40" y="29" width="6"  height="6"  rx="3" fill="url(#pv-empty-g)" opacity=".15"/>
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "#f0eeff" }}>
          Your mirror is waiting
        </h2>
        <p style={{ fontSize: 14, color: "#8b89aa", margin: "0 0 24px", lineHeight: 1.6 }}>
          Record your first Google Meet call to start building your profile.
        </p>
      </div>
    )
  }

  const { session_count, profile_strength, portrait, how_you_shift_by_context,
          blind_spots, mirror_feed, recurring_coaching } = profile

  const steady = portrait?.steady || []
  const stillForming = portrait?.still_forming || []

  const chartData = trends.map((point, i) => ({
    ...point,
    label: `S${i + 1}`,
    date: new Date(point.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
  }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Header */}
      <Reveal>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
            You
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: "#4a4865" }}>
              {session_count} session{session_count > 1 ? "s" : ""}
            </span>
            {profile_strength?.label && (
              <>
                <span style={{ color: "#1e2438", fontSize: 12 }}>·</span>
                <span style={{ fontSize: 12, color: "#4a4865" }}>{profile_strength.label}</span>
                <div style={{ width: 60, height: 3, background: "#1e2438",
                  borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2,
                    width: `${profile_strength.pct}%`, background: G,
                    transition: "width 0.6s ease" }} />
                </div>
              </>
            )}
          </div>

          {blind_spots?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setBlindSpotsOpen(v => !v)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 10, color: "#3a3a52", display: "inline-block",
                  transform: blindSpotsOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s" }}>▶</span>
                <span style={{ fontSize: 12, color: "#4a4865" }}>
                  {blind_spots.length} context{blind_spots.length > 1 ? "s" : ""} missing
                </span>
              </button>
              {blindSpotsOpen && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {blind_spots.map((spot, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 11, color: "#3a3a52", marginTop: 1, flexShrink: 0 }}>·</span>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#6b6888" }}>{spot.label}</span>
                        <span style={{ fontSize: 12, color: "#4a4865" }}> — {spot.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </Reveal>

      {/* Spectrum — fingerprint shape across your established signals */}
      {steady.length > 0 && (
        <Reveal delay={80}>
        <div>
          <SectionLabel>Your Spectrum</SectionLabel>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
            Your Shape
          </h2>
          <p style={{ fontSize: 12, color: "#4a4d6a", margin: "4px 0 14px" }}>
            Each axis is a real, measured signal — positioned relative to your own history, never compared to anyone else
          </p>
          <SpectrumChart steady={steady} />
        </div>
        </Reveal>
      )}

      {/* Established patterns */}
      {steady.length > 0 && (
        <Reveal delay={100}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Established</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              What We've Noticed
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {steady.map((item, i) => (
              <SteadySignalCard key={item.signal_key} item={item} i={i} />
            ))}
          </div>
        </div>
        </Reveal>
      )}

      {/* How you shift by context */}
      {how_you_shift_by_context?.length > 0 && (
        <Reveal delay={100}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Context Breakdown</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              How You Shift By Context
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {how_you_shift_by_context.map((item, i) => (
              <ContextShiftCard key={item.signal_key} item={item} i={i} />
            ))}
          </div>
        </div>
        </Reveal>
      )}

      {/* Still forming */}
      {stillForming.length > 0 && (
        <Reveal delay={100}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Building Evidence</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              Still Forming
            </h2>
            <p style={{ fontSize: 12, color: "#4a4d6a", margin: "4px 0 0" }}>
              Not enough evidence yet to describe these as established — that's expected early on
            </p>
          </div>
          <div>
            {stillForming.map(item => (
              <StillFormingRow key={item.signal_key} item={item} />
            ))}
          </div>
        </div>
        </Reveal>
      )}

      {/* Mirror Feed */}
      <Reveal delay={80}>
      <div>
        <div style={{ marginBottom: 12 }}>
          <SectionLabel>Cross-Session</SectionLabel>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
            Mirror Feed
          </h2>
        </div>
        <MirrorFeed insights={mirror_feed} />
      </div>
      </Reveal>

      {/* Recurring Coaching */}
      {recurring_coaching?.length > 0 && (
        <Reveal delay={100}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Keeps Coming Up</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              Recurring Themes
            </h2>
            <p style={{ fontSize: 12, color: "#4a4d6a", margin: "4px 0 0" }}>
              Areas flagged in multiple sessions — these are your persistent development opportunities
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recurring_coaching.map((item, i) => {
              const accent = ["#f87171", "#fb923c", "#818cf8"][i] || "#8b89aa"
              return (
                <div key={item.area} style={{
                  padding: "14px 16px", borderRadius: 10,
                  background: "#151922", border: `1px solid #1e2438`,
                  borderLeft: `3px solid ${accent}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: item.tip ? 8 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff",
                      textTransform: "capitalize" }}>
                      {item.area}
                    </span>
                    <span style={{ fontSize: 11, color: accent, fontWeight: 600,
                      background: `${accent}15`, border: `1px solid ${accent}30`,
                      borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap", marginLeft: 12 }}>
                      {item.count} of {session_count} sessions
                    </span>
                  </div>
                  {item.tip && (
                    <p style={{ margin: 0, fontSize: 12, color: "#8b89aa", lineHeight: 1.65 }}>
                      {item.tip}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        </Reveal>
      )}

      {/* Signal History — collapsible, raw data */}
      {chartData.length >= 2 && (
        <Reveal>
          <SignalTrends chartData={chartData} />
        </Reveal>
      )}

    </div>
  )
}
