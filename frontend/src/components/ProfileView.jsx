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

const SIGNAL_OPTIONS = [
  { key: "talk_ratio",          label: "Talk Ratio",       unit: "%" },
  { key: "wpm",                 label: "Speech Rate",      unit: "wpm" },
  { key: "filler_rate",         label: "Filler Rate",      unit: "/100w" },
  { key: "interruptions_given", label: "Interruptions",    unit: "x" },
  { key: "silence_ratio",       label: "Silence",          unit: "%" },
  { key: "response_latency",    label: "Response Latency", unit: "s" },
]

const TALK_RATIO_NORMS = {
  evaluative: [55, 80], collaborative: [30, 55], social: [35, 65],
  influential: [48, 68], negotiation: [35, 55], adversarial: [35, 55],
  developmental: [25, 45], support: [15, 40], intimate: [35, 60],
}

const DIMENSION_KEYWORDS = {
  confidence:    s => s >= 65 ? "Confident"  : s >= 40 ? "Measured"   : "Cautious",
  assertiveness: s => s >= 65 ? "Direct"     : s >= 40 ? "Balanced"   : "Reserved",
  listening:     s => s >= 65 ? "Present"    : s >= 40 ? "Attentive"  : "Directive",
  composure:     s => s >= 65 ? "Composed"   : s >= 40 ? "Steady"     : "Reactive",
  clarity:       s => s >= 65 ? "Clear"      : s >= 40 ? "Articulate" : "Complex",
}

function deriveKeywords(dimensions) {
  if (!dimensions?.length) return []
  return [...dimensions]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(d => DIMENSION_KEYWORDS[d.key]?.(d.score))
    .filter(Boolean)
}

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!target) return
    const start = Date.now()
    const tick = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target])
  return value
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

// ── Mirror Feed ───────────────────────────────────────────────────

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
        Upload conversations across different contexts — patterns that span multiple
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

        {/* Gradient fade over last item with Show more pill */}
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

      {/* Show less — simple link below when expanded */}
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

// ── Flat dimension bar ────────────────────────────────────────────

function FlatBar({ d }) {
  const score = useCountUp(d.score)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14,
      padding: "10px 0", borderBottom: "1px solid #131827" }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "#c4c2d8",
        minWidth: 130, flexShrink: 0 }}>{d.name}</span>
      <div style={{ flex: 1, height: 4, background: "#1e2438", borderRadius: 2 }}>
        <div style={{ height: "100%", borderRadius: 2, width: `${score}%`,
          background: G, transition: "width 0.5s ease",
          boxShadow: "0 0 8px rgba(59,130,246,0.4)" }} />
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, minWidth: 30, textAlign: "right",
        background: G, WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
        {score}
      </span>
    </div>
  )
}

// ── Pentagon radar chart ──────────────────────────────────────────

function PentagonChart({ dimensions }) {
  if (!dimensions?.length) return null

  const SHORT = {
    "Listening Quality": "Listening",
    "Communication Clarity": "Clarity",
  }

  const radarData = dimensions.map(d => ({
    subject: SHORT[d.name] || d.name,
    score: d.score,
    fullMark: 100,
  }))

  return (
    <div style={{
      background: "#151922", border: "1px solid #1e2438",
      borderRadius: 12, padding: "8px 0",
      boxShadow: "0 2px 16px rgba(0,0,0,0.3)"
    }}>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="66%">
          <PolarGrid stroke="#1e2438" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: "#8b89aa", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="score"
            stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.18} strokeWidth={2.5} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── You Across Contexts ───────────────────────────────────────────

function ContextComparison({ byContext }) {
  const contexts = Object.keys(byContext || {})
  const [activeCtx, setActiveCtx] = useState(contexts[0] || null)
  if (!contexts.length || !activeCtx) return null

  const data = byContext[activeCtx]
  const norm = TALK_RATIO_NORMS[activeCtx]
  const withinNorm = norm ? (data.talk_ratio >= norm[0] && data.talk_ratio <= norm[1]) : null
  const normColor = withinNorm === null ? "#8b89aa" : withinNorm ? "#34d399" : "#f59e0b"

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {contexts.map(ctx => (
          <button key={ctx} onClick={() => setActiveCtx(ctx)}
            style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12,
              cursor: "pointer", border: "1px solid", transition: "all 0.15s",
              background: activeCtx === ctx ? "rgba(59,130,246,0.12)" : "#151922",
              color: activeCtx === ctx ? "#60a5fa" : "#8b89aa",
              borderColor: activeCtx === ctx ? "rgba(59,130,246,0.3)" : "#1e2438" }}>
            {CONTEXT_LABELS[ctx] || ctx}
            <span style={{ opacity: 0.5, marginLeft: 5, fontSize: 10 }}>
              {byContext[ctx].count}×
            </span>
          </button>
        ))}
      </div>

      <div style={{ background: "#151922", border: "1px solid #1e2438",
        borderRadius: 10, padding: "16px 18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 5 }}>Talk ratio</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#f0eeff", lineHeight: 1 }}>
              {data.talk_ratio}<span style={{ fontSize: 13, color: "#8b89aa" }}>%</span>
            </div>
            {norm && (
              <div style={{ fontSize: 11, color: normColor, marginTop: 4 }}>
                {withinNorm ? "✓" : "↑"} norm {norm[0]}–{norm[1]}%
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 5 }}>Speech rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#f0eeff", lineHeight: 1 }}>
              {data.wpm}<span style={{ fontSize: 13, color: "#8b89aa" }}> wpm</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 5 }}>Filler rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#f0eeff", lineHeight: 1 }}>
              {data.filler_rate}<span style={{ fontSize: 13, color: "#8b89aa" }}>/100w</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── What's Changed ────────────────────────────────────────────────

function WhatsChanged({ trendLines, lastDelta }) {
  const dimChanges = lastDelta?.changes || []
  const signalTrends = trendLines || []
  if (!dimChanges.length && !signalTrends.length) return null

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <SectionLabel>Trends</SectionLabel>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
          What's Changed
        </h2>
        <p style={{ fontSize: 12, color: "#4a4d6a", margin: "4px 0 0" }}>
          Movement detected across your sessions
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {dimChanges.map((c, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "7px 13px", borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: c.direction === "up" ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${c.direction === "up" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
            color: c.direction === "up" ? "#34d399" : "#f87171",
          }}>
            {c.direction === "up" ? "↑" : "↓"} {c.dimension}
            <span style={{ opacity: 0.7 }}>
              {" "}{c.direction === "up" ? "+" : ""}{c.diff}pts
            </span>
          </div>
        ))}
        {signalTrends.map((t, i) => (
          <div key={`t${i}`} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "7px 13px", borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: t.direction === "improved" ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${t.direction === "improved" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
            color: t.direction === "improved" ? "#34d399" : "#f87171",
          }}>
            {t.direction === "improved" ? "↗" : "↘"}
            {" "}{t.signal.replace(/_/g, " ")}
            <span style={{ opacity: 0.7 }}>
              {" "}{t.old}{t.unit} → {t.new}{t.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Signal Trends (collapsible) ───────────────────────────────────

function SignalTrends({ chartData, trendLines }) {
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
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>Signal Trends</span>
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

          {trendLines?.filter(t => t.signal === activeSignal).map((t, i) => (
            <div key={i} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 20, fontSize: 12, marginBottom: 10,
              background: t.direction === "improved" ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
              border: `1px solid ${t.direction === "improved" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
              color: t.direction === "improved" ? "#34d399" : "#f87171",
            }}>
              {t.direction === "improved" ? "↗" : "↘"}
              {" "}{signalConfig?.label} {t.direction}: {t.old}{signalConfig?.unit} → {t.new}{signalConfig?.unit}
            </div>
          ))}

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
                  activeDot={{ r: 6, fill: "#22d3ee" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ProfileView ──────────────────────────────────────────────

export default function ProfileView({ active, onUpload }) {
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
          Upload your first conversation to see your behavioral profile.
        </p>
        <button onClick={onUpload} className="btn-grad"
          style={{ padding: "12px 28px", background: G, color: "white",
            border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer",
            fontWeight: 600, boxShadow: "0 0 24px rgba(59,130,246,0.3)" }}>
          Upload a conversation
        </button>
      </div>
    )
  }

  const { by_context, trends: trendLines, session_count, personality,
          blind_spots, completeness, completeness_label, mirror_feed,
          recurring_coaching } = profile

  const keywords = deriveKeywords(personality?.dimensions)

  const chartData = trends.map((point, i) => ({
    ...point,
    label: `S${i + 1}`,
    date: new Date(point.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
  }))

  const hasContextData = by_context && Object.keys(by_context).length > 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Header */}
      <Reveal>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
            Your Behavioral Profile
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: "#4a4865" }}>
              {session_count} session{session_count > 1 ? "s" : ""}
            </span>
            {completeness_label && (
              <>
                <span style={{ color: "#1e2438", fontSize: 12 }}>·</span>
                <span style={{ fontSize: 12, color: "#4a4865" }}>{completeness_label}</span>
                <div style={{ width: 60, height: 3, background: "#1e2438",
                  borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2,
                    width: `${completeness}%`, background: G,
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

        <button onClick={onUpload} className="btn-grad"
          style={{ padding: "8px 18px", background: G, color: "white",
            border: "none", borderRadius: 7, fontSize: 13, cursor: "pointer",
            fontWeight: 600, boxShadow: "0 0 18px rgba(59,130,246,0.25)", flexShrink: 0,
            marginLeft: 16 }}>
          + Upload
        </button>
      </div>
      </Reveal>

      {/* Your Portrait — comes first, it's the centrepiece */}
      {personality && (
        <Reveal delay={80}>
        <div>
          <SectionLabel>Your Portrait</SectionLabel>
          <div style={{
            borderLeft: "3px solid rgba(59,130,246,0.65)",
            paddingLeft: 16, marginTop: 10,
          }}>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <p style={{ flex: 1, fontSize: 14, color: "#c4c2d8",
                lineHeight: 1.9, margin: 0 }}>
                {personality.paragraph}
              </p>
              {keywords.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  {keywords.map((kw, i) => (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 600, padding: "5px 14px",
                      borderRadius: 6, letterSpacing: 0.2,
                      background: "linear-gradient(#151922, #151922) padding-box, linear-gradient(135deg, rgba(59,130,246,0.5), rgba(34,211,238,0.5)) border-box",
                      border: "1px solid transparent",
                      color: "#60a5fa", whiteSpace: "nowrap",
                    }}>
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
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
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 16px", borderRadius: 10,
                  background: "#151922", border: `1px solid #1e2438`,
                  borderLeft: `3px solid ${accent}`,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff",
                    textTransform: "capitalize" }}>
                    {item.area}
                  </span>
                  <span style={{ fontSize: 11, color: accent, fontWeight: 700,
                    background: `${accent}15`, border: `1px solid ${accent}30`,
                    borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>
                    flagged {item.count}× across sessions
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        </Reveal>
      )}

      {/* You Across Contexts */}
      {hasContextData && (
        <Reveal>
        <div>
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Context Breakdown</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              You Across Contexts
            </h2>
            <p style={{ fontSize: 12, color: "#4a4d6a", margin: "4px 0 0" }}>
              How your patterns shift depending on the room
            </p>
          </div>
          <ContextComparison byContext={by_context} />
        </div>
        </Reveal>
      )}

      {/* Your Shape — pentagon + bars */}
      {personality?.dimensions?.length > 0 && (
        <Reveal>
        <div>
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>5 Dimensions</SectionLabel>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              Your Shape
            </h2>
            <p style={{ fontSize: 12, color: "#4a4d6a", margin: "4px 0 0" }}>
              How you show up across five behavioral axes
            </p>
          </div>

          {/* Pentagon chart */}
          <PentagonChart dimensions={personality.dimensions} />

          {/* All 5 flat bars */}
          <div style={{ marginTop: 20 }}>
            {personality.dimensions.map((d, i) => (
              <RevealItem key={d.key} index={i}>
                <FlatBar d={d} />
              </RevealItem>
            ))}
          </div>

          {/* Shape narrative */}
          {personality.shape_narrative && (
            <div style={{ marginTop: 14, padding: "14px 16px",
              background: "#0e1320", border: "1px solid #1e2438",
              borderLeft: "3px solid rgba(29,78,216,0.4)",
              borderRadius: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4865",
                textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                What this shape means
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#8b89aa", lineHeight: 1.75 }}>
                {personality.shape_narrative}
              </p>
            </div>
          )}
        </div>
        </Reveal>
      )}

      {/* What's Changed */}
      {((personality?.last_delta?.changes?.length ?? 0) > 0 || (trendLines?.length ?? 0) > 0) && (
        <Reveal>
          <WhatsChanged trendLines={trendLines} lastDelta={personality?.last_delta} />
        </Reveal>
      )}

      {/* Signal Trends — collapsible */}
      {chartData.length >= 2 && (
        <Reveal>
          <SignalTrends chartData={chartData} trendLines={trendLines} />
        </Reveal>
      )}

    </div>
  )
}
