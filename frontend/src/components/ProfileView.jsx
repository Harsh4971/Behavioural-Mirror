import { useState, useEffect } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts"
import api from "../lib/api"

const G = "linear-gradient(135deg, #d946ef 0%, #f97316 100%)"

const CONTEXT_LABELS = {
  social: "Social", collaborative: "Collaborative", evaluative: "Evaluative",
  influential: "Influential", negotiation: "Negotiation", adversarial: "Adversarial",
  developmental: "Developmental", support: "Support", intimate: "Intimate",
  casual: "Casual", meeting: "Meeting", job_interview: "Job Interview",
  disagreement: "Disagreement", presentation: "Presentation",
  sales_call: "Sales Call", feedback_conversation: "Feedback",
  coaching_call: "Coaching", first_date: "First Date",
}

const SIGNAL_OPTIONS = [
  { key: "talk_ratio",          label: "Talk Ratio",       unit: "%" },
  { key: "wpm",                 label: "Speech Rate",      unit: "wpm" },
  { key: "filler_rate",         label: "Filler Rate",      unit: "/100w" },
  { key: "interruptions_given", label: "Interruptions",    unit: "x" },
  { key: "silence_ratio",       label: "Silence",          unit: "%" },
  { key: "response_latency",    label: "Response Latency", unit: "s" },
]

const CONTEXT_COLORS = {
  social: "#818cf8", collaborative: "#a78bfa", evaluative: "#f87171",
  influential: "#f59e0b", negotiation: "#22d3ee", adversarial: "#fb923c",
  developmental: "#34d399", support: "#2dd4bf", intimate: "#f472b6",
  casual: "#818cf8", meeting: "#a78bfa", job_interview: "#f87171",
  disagreement: "#fb923c", presentation: "#34d399",
  sales_call: "#f59e0b", feedback_conversation: "#818cf8",
  coaching_call: "#2dd4bf", first_date: "#f472b6",
}

const PATTERN_ICONS = {
  consistently_high: "↑", consistently_low: "↓",
  trending_improved: "↗", trending_declined: "↘",
}

function DimensionCard({ dim }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ background: "#0e0e1a", border: "1px solid #2a2a42",
      borderRadius: 10, padding: "14px 16px", transition: "border-color 0.15s",
      borderColor: expanded ? "rgba(217,70,239,0.35)" : "#2a2a42" }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff" }}>{dim.name}</span>
          <span style={{ fontSize: 11, color: "#4a4865" }}>{dim.label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700,
            background: G, WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            {dim.score}
          </span>
          <span style={{ fontSize: 10, color: "#4a4865" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      <div style={{ height: 4, background: "#2a2a42", borderRadius: 2, margin: "10px 0 0" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          width: `${dim.score}%`,
          background: G,
          transition: "width 0.6s ease",
          boxShadow: "0 0 6px rgba(217,70,239,0.3)",
        }} />
      </div>
      {expanded && dim.narrative && (
        <div style={{ fontSize: 13, color: "#8b89aa", lineHeight: 1.75,
          marginTop: 12, borderTop: "1px solid #2a2a42", paddingTop: 12 }}>
          {dim.narrative}
        </div>
      )}
    </div>
  )
}

function MirrorFeed({ sessions }) {
  const [expanded, setExpanded] = useState(false)
  if (!sessions || sessions.length === 0) return null
  const latest = sessions[0]

  return (
    <div style={{ background: "#14141f", border: "1px solid #2a2a42",
      borderRadius: 12, overflow: "hidden" }}>

      {/* Header */}
      <div onClick={() => setExpanded(v => !v)}
        style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between",
          alignItems: "center", cursor: "pointer",
          borderBottom: expanded ? "1px solid #2a2a42" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>Mirror Feed</span>
          <span style={{ fontSize: 11, color: "#4a4865", background: "#1a1a2e",
            border: "1px solid #2a2a42", borderRadius: 10, padding: "1px 7px" }}>
            {sessions.length} session{sessions.length > 1 ? "s" : ""}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#4a4865" }}>
          {expanded ? "▲ close" : "▼ expand"}
        </span>
      </div>

      {!expanded ? (
        /* Collapsed: most recent session — 2 full + 3rd fading */
        <div style={{ padding: "14px 18px 16px" }}>
          <div style={{ fontSize: 11, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#4a4865" }}>{latest.date}</span>
            <span style={{ color: "#2a2a42" }}>·</span>
            <span style={{ color: CONTEXT_COLORS[latest.context] || "#8b89aa", fontWeight: 500 }}>
              {CONTEXT_LABELS[latest.context] || latest.context}
            </span>
          </div>

          {latest.highlights[0] && (
            <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
              <span style={{ color: "#3a3a52", fontSize: 13, marginTop: 2, flexShrink: 0 }}>—</span>
              <span style={{ fontSize: 13, color: "#c4c2d8", lineHeight: 1.6 }}>
                {latest.highlights[0]}
              </span>
            </div>
          )}

          {latest.highlights[1] && (
            <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
              <span style={{ color: "#3a3a52", fontSize: 13, marginTop: 2, flexShrink: 0 }}>—</span>
              <span style={{ fontSize: 13, color: "#c4c2d8", lineHeight: 1.6 }}>
                {latest.highlights[1]}
              </span>
            </div>
          )}

          {/* 3rd pointer — partial fade peek */}
          {latest.highlights[2] && (
            <div style={{ maxHeight: 22, overflow: "hidden",
              maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: "#3a3a52", fontSize: 13, marginTop: 2, flexShrink: 0 }}>—</span>
                <span style={{ fontSize: 13, color: "#c4c2d8", lineHeight: 1.6 }}>
                  {latest.highlights[2]}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Expanded: scrollable across all sessions */
        <div style={{ maxHeight: 440, overflowY: "auto", padding: "16px 18px",
          scrollbarWidth: "thin", scrollbarColor: "#2a2a42 transparent" }}>
          {sessions.map((s, si) => (
            <div key={si} style={{ marginBottom: si < sessions.length - 1 ? 20 : 0 }}>
              <div style={{ fontSize: 11, marginBottom: 10,
                display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#4a4865" }}>{s.date}</span>
                <span style={{ color: "#2a2a42" }}>·</span>
                <span style={{ color: CONTEXT_COLORS[s.context] || "#8b89aa", fontWeight: 500 }}>
                  {CONTEXT_LABELS[s.context] || s.context}
                </span>
              </div>
              {s.highlights.map((h, hi) => (
                <div key={hi} style={{ display: "flex", gap: 10, marginBottom: 10,
                  alignItems: "flex-start" }}>
                  <span style={{ color: "#3a3a52", fontSize: 13, marginTop: 2, flexShrink: 0 }}>—</span>
                  <span style={{ fontSize: 13, color: "#c4c2d8", lineHeight: 1.6 }}>{h}</span>
                </div>
              ))}
              {si < sessions.length - 1 && (
                <div style={{ height: 1, background: "#1e1e2e", margin: "0 0 0" }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, unit, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "16px 10px",
      border: "1px solid #2a2a42", borderRadius: 10, background: "#14141f" }}>
      <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700,
        background: G, WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
        {value}<span style={{ fontSize: 13, fontWeight: 500 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: "#4a4865", marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: "#4a4865", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  )
}

export default function ProfileView({ active, onUpload }) {
  const [profile, setProfile] = useState(null)
  const [trends, setTrends] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSignal, setActiveSignal] = useState("talk_ratio")

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
    const count = profile?.session_count || 0
    const needed = 3 - count
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🪞</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "#f0eeff" }}>
          Your mirror is warming up
        </h2>
        <p style={{ fontSize: 14, color: "#8b89aa", margin: "0 0 6px", lineHeight: 1.6 }}>
          {count === 0
            ? "Upload your first conversation to get started."
            : `${count} session${count > 1 ? "s" : ""} recorded. Upload ${needed} more to unlock your behavioral profile.`}
        </p>
        {count > 0 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 10,
            margin: "20px 0 28px" }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{
                width: 12, height: 12, borderRadius: "50%",
                background: i < count ? G : "#2a2a42",
                boxShadow: i < count ? "0 0 8px rgba(217,70,239,0.4)" : "none",
              }} />
            ))}
          </div>
        )}
        <button onClick={onUpload}
          style={{ padding: "12px 28px", background: G, color: "white",
            border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer",
            fontWeight: 600, boxShadow: "0 0 24px rgba(217,70,239,0.3)" }}>
          Upload a conversation
        </button>
      </div>
    )
  }

  const { overall, by_context, patterns, trends: trendLines,
          recurring_coaching, session_count, personality, blind_spots,
          completeness, completeness_label, session_highlights } = profile

  const signalConfig = SIGNAL_OPTIONS.find(s => s.key === activeSignal)

  const chartData = trends.map((point, i) => ({
    ...point,
    label: `S${i + 1}`,
    date: new Date(point.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
  }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
            Your Behavioral Profile
          </h2>
          <p style={{ fontSize: 12, color: "#4a4865", margin: "4px 0 0" }}>
            Based on {session_count} session{session_count > 1 ? "s" : ""}
          </p>
        </div>
        <button onClick={onUpload}
          style={{ padding: "8px 18px", background: G, color: "white",
            border: "none", borderRadius: 7, fontSize: 13, cursor: "pointer",
            fontWeight: 600, boxShadow: "0 0 18px rgba(217,70,239,0.25)" }}>
          + Upload
        </button>
      </div>

      {/* Completeness bar */}
      {completeness != null && (
        <div style={{ padding: "14px 16px", background: "#14141f",
          border: "1px solid #2a2a42", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#8b89aa" }}>
              Mirror depth — {completeness_label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700,
              background: G, WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {completeness}%
            </span>
          </div>
          <div style={{ height: 5, background: "#2a2a42", borderRadius: 3 }}>
            <div style={{
              height: "100%", borderRadius: 3,
              width: `${completeness}%`,
              background: G,
              boxShadow: "0 0 8px rgba(217,70,239,0.3)",
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "#4a4865", marginTop: 7 }}>
            {completeness < 100
              ? "Add more sessions and cover different conversation types to deepen the model."
              : "The mirror has a strong picture of who you are across contexts."}
          </div>
        </div>
      )}

      {/* The Mirror */}
      {personality && (
        <div style={{ background: "#14141f", border: "1px solid #2a2a42",
          borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 15 }}>🪞</span>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
              The Mirror
            </h2>
          </div>
          <p style={{ fontSize: 14, color: "#c4c2d8", lineHeight: 1.85, margin: "0 0 20px",
            borderLeft: "2px solid rgba(217,70,239,0.35)", paddingLeft: 14 }}>
            {personality.paragraph}
          </p>

          {/* Session delta */}
          {personality.last_delta?.changes?.length > 0 && (
            <div style={{ marginBottom: 18, padding: "10px 14px",
              background: "rgba(217,70,239,0.06)", border: "1px solid rgba(217,70,239,0.2)",
              borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#a855f7",
                textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                What changed after your last session
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {personality.last_delta.changes.map((c, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                    background: c.direction === "up"
                      ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
                    border: `1px solid ${c.direction === "up"
                      ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                    color: c.direction === "up" ? "#34d399" : "#f87171",
                  }}>
                    <span>{c.direction === "up" ? "↑" : "↓"}</span>
                    <span>{c.dimension}</span>
                    <span style={{ opacity: 0.7 }}>
                      {c.direction === "up" ? "+" : ""}{c.diff} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {personality.dimensions?.map(dim => (
              <DimensionCard key={dim.key} dim={dim} />
            ))}
          </div>
        </div>
      )}

      {/* Mirror Feed */}
      <MirrorFeed sessions={session_highlights} />

      {/* Averages */}
      <div>
        <SectionHeader title="Your Averages" sub="Across all sessions" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <StatCard label="Talk Ratio" value={overall.talk_ratio} unit="%" sub="avg across sessions" />
          <StatCard label="Speech Rate" value={overall.wpm} unit=" wpm" sub="words per minute" />
          <StatCard label="Filler Rate" value={overall.filler_rate} unit="/100w" sub="avg filler words" />
          <StatCard label="Interruptions" value={overall.interruptions_given} unit="x" sub="per session avg" />
          <StatCard label="Response Latency" value={overall.response_latency} unit="s" sub="avg pause before reply" />
          <StatCard label="Silence" value={overall.silence_ratio} unit="%" sub="of conversation" />
        </div>
      </div>

      {/* Consistent patterns */}
      {patterns?.length > 0 && (
        <div>
          <SectionHeader title="Consistent Patterns"
            sub="Behaviors that show up repeatedly across your sessions" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start",
                padding: "12px 14px", background: "#14141f",
                border: "1px solid #2a2a42", borderRadius: 10 }}>
                <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1,
                  background: G, WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  {PATTERN_ICONS[p.type] || "•"}
                </span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8b89aa",
                    textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>
                    {p.signal.replace(/_/g, " ")}
                  </div>
                  <div style={{ fontSize: 13, color: "#f0eeff" }}>{p.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signal trends */}
      {chartData.length >= 2 && (
        <div>
          <SectionHeader title="Signal Trends"
            sub="How your communication patterns change over time" />

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {SIGNAL_OPTIONS.map(s => {
              const isActive = activeSignal === s.key
              return (
                <button key={s.key} onClick={() => setActiveSignal(s.key)}
                  style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12,
                    cursor: "pointer", fontWeight: isActive ? 600 : 400,
                    background: isActive ? "rgba(217,70,239,0.12)" : "#14141f",
                    color: isActive ? "#e879f9" : "#8b89aa",
                    border: isActive ? "1px solid rgba(217,70,239,0.3)" : "1px solid #2a2a42",
                    transition: "all 0.15s" }}>
                  {s.label}
                </button>
              )
            })}
          </div>

          {trendLines?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {trendLines.filter(t => t.signal === activeSignal).map((t, i) => (
                <div key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, marginBottom: 8,
                  background: t.direction === "improved"
                    ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
                  border: `1px solid ${t.direction === "improved"
                    ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                  color: t.direction === "improved" ? "#34d399" : "#f87171",
                }}>
                  {t.direction === "improved" ? "↗" : "↘"}
                  {signalConfig?.label} {t.direction}: {t.old}{signalConfig?.unit} → {t.new}{signalConfig?.unit}
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "#14141f", border: "1px solid #2a2a42",
            borderRadius: 10, padding: 16 }}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a42" />
                <XAxis dataKey="label" fontSize={11} tick={{ fill: "#8b89aa" }}
                  axisLine={{ stroke: "#2a2a42" }} tickLine={{ stroke: "#2a2a42" }} />
                <YAxis fontSize={11} tick={{ fill: "#8b89aa" }} width={38}
                  axisLine={{ stroke: "#2a2a42" }} tickLine={{ stroke: "#2a2a42" }}
                  tickFormatter={v => `${v}${signalConfig?.unit || ""}`} />
                <Tooltip
                  contentStyle={{ background: "#14141f", border: "1px solid #2a2a42",
                    borderRadius: 8 }}
                  labelStyle={{ color: "#8b89aa" }}
                  itemStyle={{ color: "#f0eeff" }}
                  formatter={(v) => [`${v}${signalConfig?.unit || ""}`, signalConfig?.label]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ""}
                />
                <Line type="monotone" dataKey={activeSignal}
                  stroke="#d946ef" strokeWidth={2.5}
                  dot={{ r: 4, fill: "#d946ef", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "#f97316" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* You across contexts */}
      {by_context && Object.keys(by_context).length > 0 && (
        <div>
          <SectionHeader title="You Across Contexts"
            sub="Your averages broken down by conversation type" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(by_context).map(([ctx, data]) => (
              <div key={ctx} style={{ padding: "14px 16px", background: "#14141f",
                border: "1px solid #2a2a42", borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%",
                      background: CONTEXT_COLORS[ctx] || "#8b89aa",
                      boxShadow: `0 0 6px ${CONTEXT_COLORS[ctx] || "#8b89aa"}60` }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff" }}>
                      {CONTEXT_LABELS[ctx] || ctx}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: "#4a4865" }}>
                    {data.count} session{data.count > 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 24 }}>
                  {[
                    { label: "Talk", value: `${data.talk_ratio}%` },
                    { label: "WPM",  value: `${data.wpm}` },
                    { label: "Fillers", value: `${data.filler_rate}/100w` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, color: "#4a4865" }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#f0eeff" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth tracking */}
      {recurring_coaching?.length > 0 && (
        <div>
          <SectionHeader title="Growth Tracking"
            sub="Areas that keep coming up in your coaching — watch these" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recurring_coaching.map((item, i) => {
              const intensity = Math.min(item.count / session_count, 1)
              const barColor = intensity > 0.6 ? "#f87171" : intensity > 0.3 ? "#f59e0b" : "#34d399"
              return (
                <div key={i} style={{ padding: "12px 16px", background: "#14141f",
                  border: "1px solid #2a2a42", borderRadius: 10,
                  borderLeft: `3px solid ${barColor}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff" }}>
                      {item.area}
                    </span>
                    <span style={{ fontSize: 11, color: "#4a4865" }}>
                      flagged in {item.count}/{session_count} sessions
                    </span>
                  </div>
                  <div style={{ height: 4, background: "#2a2a42",
                    borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 2,
                      width: `${Math.round(intensity * 100)}%`,
                      background: barColor,
                      boxShadow: `0 0 6px ${barColor}60`,
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(!patterns || patterns.length === 0) &&
       (!recurring_coaching || recurring_coaching.length === 0) && (
        <div style={{ background: "#14141f", borderRadius: 10, padding: 20,
          textAlign: "center", border: "1px solid #2a2a42" }}>
          <p style={{ fontSize: 13, color: "#8b89aa", margin: 0, lineHeight: 1.6 }}>
            Patterns will appear as you add more sessions.
            Keep uploading conversations to build a richer picture.
          </p>
        </div>
      )}

      {/* Blind spots */}
      {blind_spots?.length > 0 && (
        <div>
          <SectionHeader title="What the mirror can't see yet"
            sub="Upload these conversation types to fill in the gaps" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {blind_spots.map((spot, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start",
                padding: "14px 16px", background: "#14141f",
                border: "1px solid #2a2a42", borderRadius: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  border: "1.5px dashed #3a3a52",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, color: "#4a4865", marginTop: 1 }}>
                  ?
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8b89aa",
                    textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
                    {spot.label}
                  </div>
                  <div style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.65 }}>
                    {spot.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={onUpload}
            style={{ marginTop: 12, width: "100%", padding: "10px 0",
              background: "transparent", color: "#8b89aa",
              border: "1px dashed #3a3a52", borderRadius: 8,
              fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
            Upload a conversation →
          </button>
        </div>
      )}
    </div>
  )
}
