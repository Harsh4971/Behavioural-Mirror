import { useState, useEffect } from "react"
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts"
import api from "../lib/api"
import Reveal, { RevealItem } from "./Reveal"
import { SIGNAL_COLORS } from "../lib/dimensionColors"

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

// Mirrors backend/pipeline/portrait_synthesizer.py's _SIGNAL_FORMAT exactly —
// kept as a literal mirror (same scale/fmt/unit per key) rather than a fresh
// guess, since two independently hand-maintained copies drifting apart is
// exactly what caused this map to go stale after the 9→15 dimension rebuild.
// pacing_arc/energy_arc intentionally absent — categorical, see formatMean.
const SIGNAL_FORMAT = {
  talk_ratio:                 { scale: 100, digits: 0, unit: "% of speaking time" },
  curiosity:                  { scale: 1,   digits: 2, unit: " question-turns per 100 words" },
  turn_taking_assertiveness:  { scale: 1,   digits: 1, unit: " interruptions per 10 speaker changes" },
  conversational_drive:       { scale: 100, digits: 0, unit: "% drive score" },
  hedging:                    { scale: 1,   digits: 1, unit: " hedging phrases per 100 words" },
  directness:                 { scale: 1,   digits: 1, unit: " direct/assertive phrases per 100 words" },
  building_on_others:         { scale: 100, digits: 0, unit: "% of your turns build on someone else's point" },
  pace:                       { scale: 1,   digits: 0, unit: " words per minute" },
  vocal_expressiveness:       { scale: 1,   digits: 1, unit: " Hz of pitch variation" },
  turn_length:                { scale: 1,   digits: 1, unit: "s per turn on average" },
  vocabulary_richness:        { scale: 100, digits: 0, unit: "% unique words in a typical stretch of speech" },
  fillers:                    { scale: 1,   digits: 2, unit: " filler words per 100 words" },
  response_latency:           { scale: 1,   digits: 1, unit: "s before responding" },
}

const CATEGORICAL_SIGNAL_KEYS = new Set(["pacing_arc", "energy_arc"])

function formatMean(signalKey, mean, modeLabel) {
  if (CATEGORICAL_SIGNAL_KEYS.has(signalKey)) {
    return modeLabel ? `consistently ${modeLabel}` : ""
  }
  const f = SIGNAL_FORMAT[signalKey]
  if (!f || mean == null) return ""
  return `${(mean * f.scale).toFixed(f.digits)}${f.unit}`
}

// Practical chart-scaling ranges only — NOT a comparative score. Each signal's
// natural range is mapped to 0-100 purely so the spectrum chart has something
// sensible to plot; nothing here is shown to the user as a number. Categorical
// signals (pacing_arc, energy_arc) use CATEGORICAL_SPECTRUM_POSITIONS instead.
const SPECTRUM_RANGES = {
  talk_ratio:                 [0, 1],
  curiosity:                  [0, 10],
  turn_taking_assertiveness:  [0, 5],
  conversational_drive:       [0, 1],
  hedging:                    [0, 10],
  directness:                 [0, 10],
  building_on_others:         [0, 1],
  pace:                       [80, 220],
  vocal_expressiveness:       [10, 80],
  turn_length:                [3, 45],
  vocabulary_richness:        [0.3, 0.8],
  fillers:                    [0, 8],
  response_latency:           [0, 5],
}

// Fixed positions for categorical dimensions — same "chart-scaling only, not a
// comparative score" spirit as SPECTRUM_RANGES, just for a mode label instead
// of a numeric mean. "stable" sits at the visual center, the two directional
// extremes split toward either side.
const CATEGORICAL_SPECTRUM_POSITIONS = {
  pacing_arc: { decelerating: 25, stable: 50, accelerating: 75 },
  energy_arc: { decreasing: 25, stable: 50, increasing: 75 },
}

function spectrumPosition(signalKey, mean, modeLabel) {
  if (CATEGORICAL_SIGNAL_KEYS.has(signalKey)) {
    const positions = CATEGORICAL_SPECTRUM_POSITIONS[signalKey]
    return positions?.[modeLabel] ?? 0
  }
  const [lo, hi] = SPECTRUM_RANGES[signalKey] || [0, 1]
  if (mean == null) return 0
  const pct = ((mean - lo) / (hi - lo)) * 100
  return Math.max(4, Math.min(100, pct))
}


// Curated to 7 — deliberately not all 15 tracked dimensions ("we can just
// best 5-7 trends which are really worthy to earn that place"). Selection
// follows CLAUDE.md's own priority order (relational lead, one delivery
// slot) — pacing_arc/energy_arc excluded structurally (categorical, can't
// plot on a line chart); building_on_others/vocabulary_richness/
// vocal_expressiveness/turn_length/response_latency/fillers excluded per
// weaknesses already on record elsewhere in this project (weakest proxy,
// framing risk, audio noise, noisier delivery signals, "never the headline").
const SIGNAL_OPTIONS = [
  { key: "talk_ratio",       label: "Talk-share",               unit: "%" },
  { key: "curiosity_rate",   label: "Curiosity",                unit: "/100w" },
  { key: "hedging_rate",     label: "Hedging",                  unit: "/100w" },
  { key: "directness_rate",  label: "Directness",               unit: "/100w" },
  { key: "drive_score",      label: "Conversational drive",     unit: "%" },
  { key: "wpm",              label: "Pace",                     unit: "wpm" },
  { key: "turn_taking_rate", label: "Turn-taking assertiveness", unit: "/10" },
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

// ── Spectrum chart ─────────────────────────────────────────────────
// Real measured signals as axes (never invented trait names), self-relative
// chart-scaling (never a population comparison), no number printed anywhere —
// CLAUDE.md's "fingerprint spectrums", not a graded score. Only steady signals
// get a plotted point; not-yet-steady axes are omitted rather than faked.

// Custom PolarAngleAxis tick — tints each axis label with that signal's
// identity color from SIGNAL_COLORS, ties Shape into the same color language
// as Reflected Back / Context-Shift cards without a meaningless multi-color
// fill region (a radar's fill only makes sense as one series).
function ColoredAxisTick({ x, y, payload, colorBySubject }) {
  const color = colorBySubject[payload.value] || "#8b89aa"
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} fill={color}>
      {payload.value}
    </text>
  )
}

function SpectrumChart({ steady }) {
  if (!steady?.length) return null

  const radarData = steady.map(s => ({
    subject: s.label,
    value: spectrumPosition(s.signal_key, s.mean, s.mode_label),
    recent: s.recent_mean != null
      ? spectrumPosition(s.signal_key, s.recent_mean, s.mode_label)
      : null,
  }))
  const colorBySubject = Object.fromEntries(
    steady.map(s => [s.label, SIGNAL_COLORS[s.signal_key] || "#8b89aa"])
  )

  return (
    <div style={{
      background: "#151922", border: "1px solid #1e2438",
      borderRadius: 12, padding: "8px 0",
      boxShadow: "0 2px 16px rgba(0,0,0,0.3)"
    }}>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="66%">
          <PolarGrid stroke="#1e2438" />
          <PolarAngleAxis dataKey="subject"
            tick={<ColoredAxisTick colorBySubject={colorBySubject} />} />
          {/* niceTicks="none" is load-bearing, not decorative: Recharts 3.x's
              default niceTicks="auto" can silently EXTEND even a fixed [0,100]
              domain (combineAxisDomainWithNiceTicks takes Math.max(domainMax,
              lastNiceTickValue)) — without this, a value of exactly 100 was
              rendering at ~55% of the outer radius instead of 100%, discovered
              via a Playwright pixel-position check, not visible from the code
              alone. Confirmed via recharts/es6/state/selectors/axisSelectors.js. */}
          {/* type="number" / niceTicks="none" / allowDataOverflow / explicit
              radiusAxisId matching are all real, best-practice hardening for
              a fixed 0-100 domain (verified: Recharts' default niceTicks
              can silently expand a fixed domain — see combineAxisDomainWithNiceTicks
              in recharts/es6/state/selectors/axisSelectors.js). Flagging
              honestly: even with all of these, a Playwright pixel-measurement
              check found the *absolute* size of the plotted polygon is still
              compressed relative to the grid's outer ring in this Recharts
              version (3.8.1) — confirmed via tick-label ground truth, not
              speculation. The distortion is uniform across all axes in a
              single render (verified: every axis in a 4-signal test showed
              the identical ratio), so relative shape/proportions — the
              actual information this chart carries, per its own "no numbers,
              just shape" design — are NOT corrupted, only the polygon's
              absolute size within the frame looks smaller than intended.
              Root cause not fully isolated after substantial investigation;
              worth a follow-up pass, not blocking this build. */}
          <PolarRadiusAxis radiusAxisId={0} type="number" domain={[0, 100]} niceTicks="none" allowDataOverflow tick={false} axisLine={false} />
          <Radar radiusAxisId={0} dataKey="value" name="Established"
            stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.18} strokeWidth={2.5} />
          <Radar radiusAxisId={0} dataKey="recent" name="Recently"
            stroke="#f0eeff" fill="none" strokeWidth={1.75} strokeDasharray="4 3"
            connectNulls={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Steady signals — established patterns ──────────────────────────

function SteadySignalCard({ item, i }) {
  const cfg = FRAMING_CONFIG[item.framing] || FRAMING_CONFIG.observation
  const dotColor = SIGNAL_COLORS[item.signal_key] || "#8b89aa"
  const evidence = formatMean(item.signal_key, item.mean, item.mode_label)
  return (
    <RevealItem index={i}>
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: `3px solid ${cfg.color}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>
            {item.label}
          </span>
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
  const pct = Math.min(100, Math.round((item.sample_count / item.min_needed) * 100))
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
  const dotColor = SIGNAL_COLORS[item.signal_key] || "#8b89aa"
  const isCategorical = CATEGORICAL_SIGNAL_KEYS.has(item.signal_key)
  return (
    <RevealItem index={i}>
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>
          {item.label}
        </span>
      </div>
      {item.note && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {item.note}
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {/* by_context values are a raw mean (continuous signals) or the mode
            label itself (categorical signals) — matches main.py's value_field
            selection in get_profile(). */}
        {Object.entries(item.by_context).map(([ctx, value]) => (
          <span key={ctx} style={{
            fontSize: 11, color: "#8b89aa", background: "#0e1320",
            border: "1px solid #1e2438", borderRadius: 20, padding: "4px 12px",
          }}>
            {CONTEXT_LABELS[ctx] || ctx}: {isCategorical
              ? formatMean(item.signal_key, null, value)
              : formatMean(item.signal_key, value)}
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

// ── Portrait paragraph + tags ────────────────────────────────────────
// Narrative connective tissue between several established signals, plus a
// handful of short behavior-phrase chips — deliberately kept even though it
// overlaps with the itemized cards below, for the visual/skimmable value.
// Absent entirely (not a placeholder) until >=1 signal is steady.

function PortraitParagraph({ text, tags }) {
  if (!text) return null
  return (
    <div>
      <p style={{
        margin: tags?.length ? "0 0 10px" : 0, fontSize: 14, color: "#c4c2d8",
        lineHeight: 1.75, fontStyle: "italic",
      }}>
        "{text}"
      </p>
      {tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {tags.map((tag, i) => (
            <span key={i} style={{
              fontSize: 11.5, fontWeight: 600, color: "#a5b4fc",
              background: "rgba(129,140,248,0.10)", border: "1px solid rgba(129,140,248,0.22)",
              borderRadius: 20, padding: "4px 11px", whiteSpace: "nowrap",
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Global indicators strip ──────────────────────────────────────────
// Plain observational facts about the user's own history (not evidence-gated
// patterns) — visible from session 1. Option B styling: stat tiles with a
// colored left-border accent, reusing HomeView's existing card language.

function formatDuration(totalSeconds) {
  if (!totalSeconds) return "0m"
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.round((totalSeconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function StatTile({ value, label, accent }) {
  return (
    <div style={{
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: "11px 12px",
    }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: "#f0eeff",
        fontVariantNumeric: "tabular-nums", letterSpacing: "-0.3px", lineHeight: 1.15 }}>
        {value}
      </div>
      <div style={{ marginTop: 3, fontSize: 10.5, color: "#6b6888" }}>
        {label}
      </div>
    </div>
  )
}

function IndicatorsStrip({ indicators }) {
  if (!indicators) return null
  const tiles = [
    { value: indicators.session_count, label: "Sessions", accent: "#5b9cf6" },
    { value: formatDuration(indicators.time_recorded_s), label: "Recorded", accent: "#34d399" },
    indicators.avg_talk_share != null && {
      value: `${Math.round(indicators.avg_talk_share * 100)}%`, label: "Avg talk-share", accent: "#818cf8",
    },
    indicators.avg_pace != null && {
      value: Math.round(indicators.avg_pace), label: "Avg WPM", accent: "#f59e0b",
    },
    { value: `${indicators.contexts_covered} / ${indicators.contexts_total}`, label: "Contexts", accent: "#22d3ee" },
  ].filter(Boolean)

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
      {tiles.map((t, i) => <StatTile key={i} {...t} />)}
    </div>
  )
}

// ── Where you might grow — coaching synthesis ────────────────────────
// Distilled recurring themes from coaching_suggestions, grouped by
// dimension_key server-side — a concrete-instance complement to Reflected
// Back's aggregate framing, not a restatement of it.

function CoachingCard({ item, i }) {
  const dotColor = SIGNAL_COLORS[item.dimension_key] || "#8b89aa"
  return (
    <RevealItem index={i}>
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: `3px solid ${dotColor}`,
    }}>
      {item.pattern && (
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {item.pattern}
        </p>
      )}
      {item.suggestion && (
        <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#a5a3c2", lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600, color: "#c4c2d8" }}>Try: </span>
          {item.suggestion}
        </p>
      )}
      <p style={{ margin: 0, fontSize: 11, color: "#4a4865" }}>
        Came up in {item.recurrence_count} of your recent sessions
      </p>
    </div>
    </RevealItem>
  )
}

// ── Main ProfileView ("You" page) ──────────────────────────────────

export default function ProfileView({ active }) {
  const [profile, setProfile] = useState(null)
  const [trends, setTrends] = useState([])
  const [loading, setLoading] = useState(true)

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

  const { profile_strength, portrait, how_you_shift_by_context,
          indicators, portrait_paragraph, portrait_tags, coaching } = profile

  const steady = portrait?.steady || []
  const stillForming = portrait?.still_forming || []

  const chartData = trends.map((point, i) => ({
    ...point,
    label: `S${i + 1}`,
    date: new Date(point.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
  }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Header — confidence-only now: how much the app knows about you.
          Facts about you (session count, etc.) live in the indicators
          strip below instead. No page title here — the "You" nav tab
          already says which page this is. */}
      <Reveal>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {profile_strength?.label && (
          <>
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
      </Reveal>

      {/* Portrait paragraph + tags — absent until >=1 signal is steady */}
      {portrait_paragraph && (
        <Reveal delay={40}>
          <div>
            <SectionLabel>Standing Portrait</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px", color: "#f0eeff" }}>
              Your Portrait
            </h2>
            <PortraitParagraph text={portrait_paragraph} tags={portrait_tags} />
          </div>
        </Reveal>
      )}

      {/* Global indicators strip — plain facts, visible from session 1 */}
      <Reveal delay={60}>
        <IndicatorsStrip indicators={indicators} />
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
              Reflected Back
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

      {/* Where you might grow — coaching synthesis, deliberately after the
          descriptive sections above rather than near the top: observe first,
          reflect on growth after. Absent until >=3 sessions and >=1 recurring
          theme — not a repeat of a single session's own coaching card. */}
      {coaching?.length > 0 && (
        <Reveal delay={100}>
        <div>
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Growth</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              Where You Might Grow
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {coaching.map((item, i) => (
              <CoachingCard key={item.dimension_key} item={item} i={i} />
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

      {/* Signal History — collapsible, raw data */}
      {chartData.length >= 2 && (
        <Reveal>
          <SignalTrends chartData={chartData} />
        </Reveal>
      )}

    </div>
  )
}
