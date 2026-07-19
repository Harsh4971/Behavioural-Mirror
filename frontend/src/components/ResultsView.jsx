import { useState } from "react"
import Reveal, { RevealItem } from "./Reveal"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import api from "../lib/api"
import SessionSpectrum from "./SessionSpectrum"
import { signalColor } from "../lib/signalColor"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

function CoachingCard({ suggestion }) {
  const priorityColors = { 1: "#f87171", 2: "#fb923c", 3: "#818cf8" }
  const color = priorityColors[suggestion.priority] || "#8b89aa"

  return (
    <div style={{ border: "1px solid #1e2438", borderRadius: 12,
      padding: 16, background: "#151922", borderLeft: `3px solid ${color}` }}>
      <span style={{ fontSize: 11, fontWeight: 700, color,
        textTransform: "uppercase", letterSpacing: 0.5 }}>
        #{suggestion.priority} — {suggestion.area}
      </span>
      <div style={{ fontSize: 12, color: "#4a4865", margin: "8px 0",
        fontStyle: "italic", lineHeight: 1.5 }}>
        {suggestion.issue}
      </div>
      <div style={{ fontSize: 14, color: "#f0eeff", marginBottom: 10,
        lineHeight: 1.6, fontWeight: 500 }}>
        💡 {suggestion.suggestion}
      </div>
      <div style={{ fontSize: 12, color: "#8b89aa", lineHeight: 1.5,
        padding: "10px 12px", background: "#131827", borderRadius: 8 }}>
        <strong style={{ color: "#f0eeff" }}>Why it matters:</strong> {suggestion.why_it_matters}
      </div>
    </div>
  )
}

function ObservationCard({ obs, sessionId, tip }) {
  const [resonance, setResonance] = useState(null)
  const color = signalColor(obs.signal)

  return (
    <div style={{ border: "1px solid #1e2438", borderRadius: 10,
      padding: 16, background: "#151922", borderLeft: `3px solid ${color}`,
      minWidth: 280, maxWidth: 320, flexShrink: 0 }}>
      <div style={{ fontSize: 11, color, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
        {obs.signal.replace(/_/g, " ")}
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.6, color: "#f0eeff" }}>
        {obs.observation}
      </p>

      {/* Resonance vote sits directly against the observation it's voting on —
          not next to the reflective question below, which is a separate,
          optional aside with no response attached to it. */}
      {resonance === null ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#4a4865", marginBottom: 8 }}>
            Does this resonate?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["Yes", "yes"], ["Somewhat", "somewhat"], ["No", "no"]].map(([label, value]) => (
              <button key={label} onClick={async () => {
                setResonance(label)
                if (sessionId) {
                  try {
                    const form = new FormData()
                    form.append("signal", obs.signal)
                    form.append("response", value)
                    await api.post(`/api/sessions/${sessionId}/resonance`, form)
                  } catch {}
                }
              }}
                style={{ padding: "5px 14px", border: "1px solid #1e2438",
                  borderRadius: 20, background: "#131827", cursor: "pointer",
                  fontSize: 12, color: "#8b89aa" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#34d399", marginBottom: 14 }}>✓ Noted — thanks.</div>
      )}

      {tip && (
        <div style={{ fontSize: 13, color: "#f0eeff", lineHeight: 1.6,
          padding: "10px 12px", background: "#131827", borderRadius: 8, marginBottom: 12 }}>
          💡 {tip}
        </div>
      )}

      <div style={{ borderTop: "1px solid #1e2438", paddingTop: 10,
        fontSize: 12.5, color: "#6b6885", fontStyle: "italic", lineHeight: 1.5 }}>
        💭 {obs.resonance_prompt}
      </div>
    </div>
  )
}

export default function ResultsView({ results, onBack }) {
  const [activeTab, setActiveTab] = useState("overview")

  const { signals, insights, filename, detected_speaker, session_id } = results

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.round(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const duration = Math.round(signals.session_duration_s / 60)
  const totalDur = signals.session_duration_s || 1
  const userTalkPct  = Math.round((signals.talk_ratio.user_speaking_time_s  / totalDur) * 100)
  const otherTalkPct = Math.round((signals.talk_ratio.other_speaking_time_s / totalDur) * 100)
  const silencePct   = Math.max(0, 100 - userTalkPct - otherTalkPct)

  const tabs = ["overview", "spectrum", "coaching"]
  const tabLabels = { overview: "Overview", spectrum: "Session Spectrum", coaching: "Coaching" }

  // Client-side match: a coaching_suggestion whose dimension_key lines up with
  // an observation's signal becomes that observation's attached tip — both
  // fields already draw from the same SIGNAL_EVIDENCE_CONFIG key space, so no
  // backend change was needed to wire this up.
  const tipFor = (signal) =>
    insights.coaching_suggestions?.find(c => c.dimension_key === signal)?.suggestion

  return (
    <div>
      <button onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#8b89aa", fontSize: 13, marginBottom: 16, padding: 0 }}>
        ← Back
      </button>

      <div style={{ fontSize: 12, color: "#8b89aa", marginBottom: 12, minHeight: 24 }}>
        {filename && <span style={{ marginRight: 8 }}>📁 {filename} ·</span>}
        Analysis for <strong style={{ color: "#f0eeff" }}>You</strong>
      </div>

      {/* Mirror updated banner */}
      {session_id && (
        <div style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px", marginBottom: 16, borderRadius: 8, fontSize: 12,
          background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.18)" }}>
          <span style={{ color: "#34d399" }}>✓</span>
          <span style={{ color: "#6b8a7a" }}>
            Session saved — your mirror has been updated.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", marginBottom: 20, borderBottom: "1px solid #1e2438" }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`nav-tab${activeTab === tab ? " active" : ""}`}
            style={{ background: "none", border: "none", cursor: "pointer",
              padding: "8px 14px", fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "#5b9cf6" : "#8b89aa" }}>
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <Reveal>
          {/* Metrics first — plain facts, no grading */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8, marginBottom: 8 }}>
            {[
              { label: "Duration",    value: `${duration}`,                           unit: "m"    },
              { label: "Speech rate", value: `${signals.speech_rate.overall_wpm}`,    unit: "wpm"  },
              { label: "Fillers",     value: `${signals.filler_words.rate_per_100_words}`, unit: "/100w" },
            ].map(({ label, value, unit }) => (
              <div key={label} style={{ textAlign: "center", padding: "16px 8px",
                border: "1px solid #1e2438", borderRadius: 10, background: "#151922" }}>
                <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1,
                  background: G, WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  {value}
                </div>
                <div style={{ fontSize: 11, color: "#8b89aa", marginTop: 4 }}>{unit}</div>
              </div>
            ))}
          </div>

          {/* Talk split bar — You / Others / Silence */}
          <div style={{ border: "1px solid #1e2438", borderRadius: 10,
            background: "#151922", padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 10 }}>Talk split</div>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
              <div style={{ width: `${userTalkPct}%`,  background: "#3b82f6", transition: "width 0.4s" }} />
              <div style={{ width: `${otherTalkPct}%`, background: "#8b5cf6", transition: "width 0.4s" }} />
              <div style={{ width: `${silencePct}%`,   background: "#1e2438", transition: "width 0.4s" }} />
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {[
                { label: "You",     pct: userTalkPct,  color: "#3b82f6" },
                { label: "Others",  pct: otherTalkPct, color: "#8b5cf6" },
                { label: "Silence", pct: silencePct,   color: "#4a4865" },
              ].map(({ label, pct, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 11, color: "#8b89aa" }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#f0eeff" }}>{pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Secondary metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 8, marginBottom: 8 }}>
            {[
              { label: "Interruptions given", value: `${signals.interruptions.user_interrupted_other}x` },
              { label: "Interruptions received", value: `${signals.interruptions.user_was_interrupted}x` },
              { label: "Questions asked", value: `${signals.questions.user_questions_asked}` },
              { label: "Energy trend", value: signals.vocal_energy.trend === "insufficient_data"
                  ? "—" : signals.vocal_energy.trend },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: "center", padding: "14px 8px",
                border: "1px solid #1e2438", borderRadius: 10, background: "#151922" }}>
                <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 5 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f0eeff",
                  textTransform: "capitalize" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Folded in from the old Signals tab */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 8, marginBottom: 20 }}>
            {[
              { label: "Vocab richness", value: signals.vocabulary_richness.type_token_ratio?.toFixed(2) || "—" },
              { label: "Longest turn", value: `${signals.monologue.longest_turn_s}s` },
              { label: "Avg response latency", value: `${signals.pauses.response_latency.mean_s}s` },
              { label: "Your turns", value: signals.turn_dynamics.user_turns },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: "center", padding: "14px 8px",
                border: "1px solid #1e2438", borderRadius: 10, background: "#151922" }}>
                <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 5 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#f0eeff" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Speech rate over time — folded in from the old Signals tab */}
          {signals.timeline?.length > 1 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 10,
                textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                Speech rate over time
              </div>
              <div style={{ background: "#151922", border: "1px solid #1e2438",
                borderRadius: 10, padding: 16 }}>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={signals.timeline}>
                    <XAxis dataKey="window_start_s" tickFormatter={formatTime} fontSize={11}
                      tick={{ fill: "#8b89aa" }} axisLine={{ stroke: "#1e2438" }}
                      tickLine={{ stroke: "#1e2438" }} />
                    <YAxis domain={["auto", "auto"]} fontSize={11} width={35}
                      tick={{ fill: "#8b89aa" }} axisLine={{ stroke: "#1e2438" }}
                      tickLine={{ stroke: "#1e2438" }} />
                    <Tooltip
                      contentStyle={{ background: "#151922", border: "1px solid #1e2438",
                        borderRadius: 8 }}
                      labelStyle={{ color: "#8b89aa" }} itemStyle={{ color: "#f0eeff" }}
                      labelFormatter={v => `At ${formatTime(v)}`}
                      formatter={v => [`${Math.round(v)} wpm`, "Speech rate"]} />
                    <Line type="monotone" dataKey="speech_rate_wpm"
                      stroke="#1d4ed8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {signals.speech_acceleration.trend !== "insufficient_data" && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#8b89aa" }}>
                  Trend: <strong style={{ color: "#f0eeff" }}>{signals.speech_acceleration.trend}</strong>
                  {signals.speech_acceleration.delta_wpm &&
                    ` (${signals.speech_acceleration.delta_wpm > 0 ? "+" : ""}${signals.speech_acceleration.delta_wpm} wpm)`}
                </div>
              )}
            </div>
          )}

          {/* Conversation Summary */}
          {insights.conversation_summary && (
            <div style={{ background: "rgba(129,140,248,0.06)",
              borderRadius: 12, padding: 18, marginBottom: 12,
              borderLeft: "3px solid #818cf8" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#818cf8",
                marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                The Conversation
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.75, margin: 0, color: "#c7d2fe" }}>
                {insights.conversation_summary}
              </p>
            </div>
          )}

          {/* Your Perspective */}
          {insights.user_perspective && (
            <div style={{ background: "rgba(59,130,246,0.05)",
              borderRadius: 12, padding: 18, marginBottom: 20,
              borderLeft: "3px solid #3b82f6",
              border: "1px solid rgba(59,130,246,0.15)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#5b9cf6",
                marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Your Perspective
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.8, margin: 0, color: "#f0eeff" }}>
                {insights.user_perspective}
              </p>
            </div>
          )}

          {/* Behavioral Observations — horizontal scroll, each with its own
              resonance vote and any matched tip */}
          {insights.observations?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#8b89aa",
                textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                Behavioral Observations
              </div>
              <div style={{ display: "flex", gap: 12, overflowX: "auto",
                paddingBottom: 8, marginBottom: 8 }}>
                {insights.observations.map((obs, i) => (
                  <ObservationCard key={i} obs={obs} sessionId={session_id}
                    tip={tipFor(obs.signal)} />
                ))}
              </div>
            </div>
          )}
        </Reveal>
      )}

      {/* ── SESSION SPECTRUM TAB ── */}
      {activeTab === "spectrum" && (
        <SessionSpectrum sessionId={session_id} signals={signals} />
      )}

      {/* ── COACHING TAB ── */}
      {activeTab === "coaching" && (
        <Reveal>
          <p style={{ fontSize: 13, color: "#8b89aa", marginBottom: 16, lineHeight: 1.6 }}>
            Specific suggestions based on patterns observed in this conversation.
            Ranked by potential impact.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insights.coaching_suggestions?.map((s, i) => (
              <RevealItem key={i} index={i}>
                <CoachingCard suggestion={s} />
              </RevealItem>
            ))}
            {(!insights.coaching_suggestions || insights.coaching_suggestions.length === 0) && (
              <div style={{ textAlign: "center", padding: 32, color: "#4a4865" }}>
                No coaching suggestions generated for this session.
              </div>
            )}
          </div>
        </Reveal>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 11, color: "#4a4865", padding: 14, marginTop: 20,
        background: "#151922", borderRadius: 8, lineHeight: 1.7,
        border: "1px solid #1e2438" }}>
        <strong style={{ color: "#8b89aa" }}>Note:</strong> Observations and suggestions are
        probabilistic proxies based on acoustic and linguistic patterns, and are self-relative —
        compared to your own usual, never to anyone else. Not validated psychological assessments.
        Use as prompts for self-reflection only.
      </div>
    </div>
  )
}
