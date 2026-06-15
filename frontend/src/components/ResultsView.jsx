import { useState } from "react"
import Reveal, { RevealItem } from "./Reveal"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import api from "../lib/api"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

const SCORE_COLORS = ["#f87171", "#fb923c", "#f59e0b", "#34d399", "#10b981"]

function ScoreBar({ score, max = 5 }) {
  const color = SCORE_COLORS[score - 1] || "#4a4865"
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} style={{
          width: 20, height: 7, borderRadius: 4,
          background: i < score ? color : "#1e2438",
          boxShadow: i < score ? `0 0 6px ${color}50` : "none",
          transition: "all 0.2s",
        }} />
      ))}
    </div>
  )
}

function DimensionCard({ title, icon, items, narrative }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ border: "1px solid #1e2438", borderRadius: 12,
      background: "#151922", marginBottom: 10, overflow: "hidden" }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ padding: "14px 16px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontWeight: 600, fontSize: 14, color: "#f0eeff" }}>{title}</span>
        </div>
        <span style={{ color: "#4a4865", fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      <div style={{ padding: "0 16px 16px", display: "flex", flexWrap: "wrap", gap: 12 }}>
        {items.map(({ label, score, labelText }) => (
          <div key={label} style={{ flex: "1 1 150px" }}>
            <div style={{ fontSize: 11, color: "#8b89aa", marginBottom: 5 }}>{label}</div>
            <ScoreBar score={score} />
            <div style={{ fontSize: 11, fontWeight: 600,
              color: SCORE_COLORS[score - 1], marginTop: 4 }}>
              {labelText}
            </div>
          </div>
        ))}
      </div>

      {expanded && narrative && (
        <div style={{ padding: "14px 16px", borderTop: "1px solid #1e2438",
          background: "#131827", fontSize: 13, color: "#8b89aa", lineHeight: 1.7 }}>
          {narrative}
        </div>
      )}
    </div>
  )
}

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

function ObservationCard({ obs, sessionId }) {
  const [resonance, setResonance] = useState(null)
  const signalColors = {
    talk_ratio: "#818cf8", speech_rate: "#5b9cf6",
    speech_acceleration: "#f472b6", pauses: "#f59e0b",
    interruptions: "#f87171", filler_words: "#fb923c",
    vocal_energy: "#0891b2", questions: "#34d399",
    monologue: "#818cf8", vocabulary_richness: "#a3e635",
    silence_ratio: "#8b89aa", pitch: "#0891b2", engagement: "#5b9cf6"
  }
  const color = signalColors[obs.signal] || "#8b89aa"

  return (
    <div style={{ border: "1px solid #1e2438", borderRadius: 10,
      padding: 16, background: "#151922", borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
        {obs.signal.replace(/_/g, " ")}
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.6, color: "#f0eeff" }}>
        {obs.observation}
      </p>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#8b89aa",
        fontStyle: "italic", lineHeight: 1.5 }}>
        💭 {obs.resonance_prompt}
      </p>
      {resonance === null ? (
        <div>
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
        <div style={{ fontSize: 12, color: "#34d399" }}>✓ Noted — thanks.</div>
      )}
    </div>
  )
}


const speakerLabel = (id) => {
  if (!id) return "Unknown"
  const num = parseInt(id.replace("SPEAKER_", ""), 10)
  return isNaN(num) ? id : `Speaker ${num + 1}`
}

const LABELS = {
  social: "Social", collaborative: "Collaborative", evaluative: "Evaluative",
  influential: "Influential", negotiation: "Negotiation", adversarial: "Adversarial",
  developmental: "Developmental", support: "Support", intimate: "Intimate",
  casual: "Casual", meeting: "Meeting", job_interview: "Job Interview",
  disagreement: "Disagreement", presentation: "Presentation",
}

export default function ResultsView({ results, onBack }) {
  const [liveResults, setLiveResults] = useState(results)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState("")
  const [showSpeakerSwitch, setShowSpeakerSwitch] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")

  const { signals, insights, dimensions, filename, detected_speaker,
          session_id, voiceprint_confidence, fingerprint } = liveResults

  const confPct = voiceprint_confidence != null ? Math.round(voiceprint_confidence * 100) : null
  const confLabel = confPct == null ? null : confPct >= 55 ? "high" : confPct >= 40 ? "medium" : "low"
  const confColor = confLabel === "high" ? "#34d399" : confLabel === "medium" ? "#f59e0b" : "#f87171"

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.round(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const talkPct = Math.round(signals.talk_ratio.user_ratio * 100)
  const duration = Math.round(signals.session_duration_s / 60)

  const totalDur = signals.session_duration_s || 1
  const userTalkPct  = Math.round((signals.talk_ratio.user_speaking_time_s  / totalDur) * 100)
  const otherTalkPct = Math.round((signals.talk_ratio.other_speaking_time_s / totalDur) * 100)
  const silencePct   = Math.max(0, 100 - userTalkPct - otherTalkPct)

  const handleReanalyze = async (newSpeaker) => {
    if (!session_id) return
    setShowSpeakerSwitch(false); setReanalyzing(true); setReanalyzeError("")
    try {
      const form = new FormData()
      form.append("confirmed_speaker", newSpeaker)
      const res = await api.post(`/api/sessions/${session_id}/reanalyze`, form)
      setLiveResults(res.data)
    } catch (e) {
      setReanalyzeError(e.response?.data?.detail || e.message || "Switch failed.")
    } finally {
      setReanalyzing(false)
    }
  }

  const tabs = ["overview", "dimensions", "coaching", "signals"]
  const otherSpeakers = (liveResults.available_speakers || []).filter(s => s !== detected_speaker)

  return (
    <div>
      <button onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#8b89aa", fontSize: 13, marginBottom: 16, padding: 0 }}>
        ← Back
      </button>

      {/* Speaker bar */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 12, minHeight: 24 }}>
        <div style={{ fontSize: 12, color: "#8b89aa" }}>
          {filename && <span style={{ marginRight: 8 }}>📁 {filename} ·</span>}
          Analysis for <strong style={{ color: "#f0eeff" }}>{speakerLabel(detected_speaker)}</strong>
          {confPct != null && (
            <span style={{ marginLeft: 8, color: confColor, fontWeight: 500 }}>
              · {confPct}% match
            </span>
          )}
        </div>
        {otherSpeakers.length > 0 && !reanalyzing && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSpeakerSwitch(v => !v)}
              style={{ fontSize: 12, color: "#8b89aa", background: "#151922",
                border: "1px solid #1e2438", borderRadius: 20,
                padding: "3px 12px", cursor: "pointer" }}>
              {reanalyzing ? "Switching…" : "Not you?"}
            </button>
            {showSpeakerSwitch && !reanalyzing && (
              <div style={{ position: "absolute", right: 0, top: "110%",
                background: "#151922", border: "1px solid #1e2438", borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)", zIndex: 10,
                minWidth: 160, overflow: "hidden" }}>
                {otherSpeakers.map(s => (
                  <button key={s} onClick={() => handleReanalyze(s)}
                    style={{ display: "block", width: "100%", padding: "10px 14px",
                      textAlign: "left", background: "none", border: "none",
                      borderBottom: "1px solid #1e2438",
                      cursor: "pointer", fontSize: 13, color: "#f0eeff" }}>
                    Switch to {speakerLabel(s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Low voiceprint confidence nudge */}
      {(confLabel === "low" || (voiceprint_confidence == null && !liveResults.speaker_confirmed)) && (
        <div style={{ background: "rgba(245,158,11,0.07)",
          border: "1px solid rgba(245,158,11,0.2)",
          borderRadius: 8, padding: "10px 14px", marginBottom: 12,
          fontSize: 12, color: "#f59e0b", lineHeight: 1.6 }}>
          ⚠ Voice match is low — insights may be based on the wrong speaker.
          {otherSpeakers.length > 0
            ? " Try switching speakers using the button above."
            : " Re-enroll your voice (Account → Retrain your voice) for better accuracy next time."}
        </div>
      )}

      {reanalyzeError && (
        <div style={{ fontSize: 12, color: "#f87171",
          background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
          borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
          ⚠️ {reanalyzeError}
        </div>
      )}

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
              padding: "8px 14px", fontSize: 13, textTransform: "capitalize",
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "#5b9cf6" : "#8b89aa" }}>
            {tab}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <Reveal>
          {/* Type chips */}
          {(() => {
            const types = insights.conversation_types || []
            if (types.length === 0) return null
            return (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap",
                marginBottom: 16, alignItems: "center" }}>
                {types.map((t, i) => (
                  <span key={t} style={{
                    fontSize: 11, fontWeight: i === 0 ? 700 : 500,
                    padding: "3px 10px", borderRadius: 20,
                    background: i === 0 ? "rgba(29,78,216,0.12)" : "#131827",
                    color: i === 0 ? "#5b9cf6" : "#8b89aa",
                    border: `1px solid ${i === 0 ? "rgba(29,78,216,0.3)" : "#1e2438"}`,
                    textTransform: "uppercase", letterSpacing: 0.4,
                  }}>
                    {LABELS[t] || t}
                  </span>
                ))}
                <span style={{ fontSize: 11, color: "#4a4865" }}>auto-detected</span>
              </div>
            )
          })()}

          {/* Conversation Summary — what it was about */}
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

          {/* Your Perspective — what the user specifically said/contributed */}
          {insights.user_perspective && (
            <div style={{ background: "rgba(59,130,246,0.05)",
              borderRadius: 12, padding: 18, marginBottom: 14,
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

          {/* Notable pattern */}
          {insights.notable_pattern && (
            <div style={{ background: "rgba(29,78,216,0.06)",
              border: "1px solid rgba(29,78,216,0.2)",
              borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600,
                color: "#5b9cf6", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: 0.5 }}>
                Notable Pattern
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "#f0eeff", lineHeight: 1.6 }}>
                {insights.notable_pattern}
              </p>
            </div>
          )}

          {/* Behavioral Observations — moved from Signals tab */}
          {insights.observations?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#8b89aa",
                textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                Behavioral Observations
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {insights.observations.map((obs, i) => (
                  <ObservationCard key={i} obs={obs} sessionId={session_id} />
                ))}
              </div>
            </div>
          )}

          {/* Key metrics — gradient numbers */}
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
            gap: 8, marginBottom: 20 }}>
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

        </Reveal>
      )}

      {/* ── DIMENSIONS TAB ── */}
      {activeTab === "dimensions" && dimensions && (
        <Reveal>
          <p style={{ fontSize: 13, color: "#8b89aa", marginBottom: 16, lineHeight: 1.6 }}>
            Scores are probabilistic proxies based on behavioral signals —
            not psychological diagnoses. Expand any card to read the interpretation.
          </p>
          {dimensions.emotional_state && (
            <DimensionCard title="Your Emotional State" icon="🧠"
              narrative={insights.dimension_narrative?.emotional_state}
              items={[
                { label: "Confidence", score: dimensions.emotional_state.confidence?.score, labelText: dimensions.emotional_state.confidence?.label },
                { label: "Nervousness", score: dimensions.emotional_state.nervousness?.score, labelText: dimensions.emotional_state.nervousness?.label },
                { label: "Emotional Intensity", score: dimensions.emotional_state.emotional_intensity?.score, labelText: dimensions.emotional_state.emotional_intensity?.label },
                { label: "Topic Comfort", score: dimensions.emotional_state.topic_comfort?.score, labelText: dimensions.emotional_state.topic_comfort?.label },
                { label: "Enthusiasm", score: dimensions.emotional_state.enthusiasm?.score, labelText: dimensions.emotional_state.enthusiasm?.label },
              ]} />
          )}
          {dimensions.relational_dynamics && (
            <DimensionCard title="Relational Dynamics" icon="🤝"
              narrative={insights.dimension_narrative?.relational_dynamics}
              items={[
                { label: "Rapport", score: dimensions.relational_dynamics.rapport?.score, labelText: dimensions.relational_dynamics.rapport?.label },
                { label: "Power Balance", score: dimensions.relational_dynamics.power_balance?.score, labelText: dimensions.relational_dynamics.power_balance?.label },
                { label: "Empathy", score: dimensions.relational_dynamics.empathy?.score, labelText: dimensions.relational_dynamics.empathy?.label },
                { label: "Respect", score: dimensions.relational_dynamics.conversational_respect?.score, labelText: dimensions.relational_dynamics.conversational_respect?.label },
                { label: "Mutual Engagement", score: dimensions.relational_dynamics.mutual_engagement?.score, labelText: dimensions.relational_dynamics.mutual_engagement?.label },
              ]} />
          )}
          {dimensions.communication_effectiveness && (
            <DimensionCard title="Communication Effectiveness" icon="💬"
              narrative={insights.dimension_narrative?.communication_effectiveness}
              items={[
                { label: "Clarity", score: dimensions.communication_effectiveness.clarity?.score, labelText: dimensions.communication_effectiveness.clarity?.label },
                { label: "Assertiveness", score: dimensions.communication_effectiveness.assertiveness?.score, labelText: dimensions.communication_effectiveness.assertiveness?.label },
                { label: "Listening Quality", score: dimensions.communication_effectiveness.listening_quality?.score, labelText: dimensions.communication_effectiveness.listening_quality?.label },
                { label: "Persuasiveness", score: dimensions.communication_effectiveness.persuasiveness?.score, labelText: dimensions.communication_effectiveness.persuasiveness?.label },
                { label: "Adaptability", score: dimensions.communication_effectiveness.adaptability?.score, labelText: dimensions.communication_effectiveness.adaptability?.label },
              ]} />
          )}

          {/* Conversation Arc — moved from Overview */}
          {dimensions?.conversation_arc && (
            <div style={{ border: "1px solid #1e2438", borderRadius: 12,
              padding: 16, background: "#151922" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#8b89aa",
                marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Conversation Arc
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { label: "Opening vs Closing", value: dimensions.conversation_arc.opening_vs_closing?.label },
                  { label: "Tension",             value: dimensions.conversation_arc.tension_arc?.label },
                  { label: "Who Drove",           value: dimensions.conversation_arc.who_drove?.label },
                  { label: "Resolution",          value: dimensions.conversation_arc.resolution_proxy?.label },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff",
                      textTransform: "capitalize" }}>{value || "—"}</div>
                  </div>
                ))}
              </div>
              {dimensions.conversation_arc.turning_point?.detected && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#8b89aa",
                  background: "#131827", padding: "8px 12px", borderRadius: 8 }}>
                  ⚡ {dimensions.conversation_arc.turning_point.detail}
                </div>
              )}
              {insights.dimension_narrative?.conversation_arc && (
                <p style={{ margin: "12px 0 0", fontSize: 13,
                  color: "#8b89aa", lineHeight: 1.6 }}>
                  {insights.dimension_narrative.conversation_arc}
                </p>
              )}
            </div>
          )}
        </Reveal>
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

      {/* ── SIGNALS TAB ── */}
      {activeTab === "signals" && (
        <Reveal>
          {signals.timeline?.length > 1 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#f0eeff" }}>
                Speech Rate Over Time
              </h3>
              <div style={{ background: "#151922", border: "1px solid #1e2438",
                borderRadius: 10, padding: 16 }}>
                <ResponsiveContainer width="100%" height={150}>
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

          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#f0eeff" }}>
            All Signals
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              { label: "Silence ratio", value: `${Math.round(signals.silence_ratio.silence_ratio * 100)}%` },
              { label: "Vocab richness", value: signals.vocabulary_richness.type_token_ratio?.toFixed(2) || "—" },
              { label: "Longest turn", value: `${signals.monologue.longest_turn_s}s` },
              { label: "Avg response latency", value: `${signals.pauses.response_latency.mean_s}s` },
              { label: "Within-turn pauses", value: signals.pauses.within_turn_pauses.count },
              { label: "Your turns", value: signals.turn_dynamics.user_turns },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: 12, border: "1px solid #1e2438",
                borderRadius: 8, background: "#151922" }}>
                <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#f0eeff" }}>{value}</div>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 11, color: "#4a4865", padding: 14, marginTop: 20,
        background: "#151922", borderRadius: 8, lineHeight: 1.7,
        border: "1px solid #1e2438" }}>
        <strong style={{ color: "#8b89aa" }}>Note:</strong> All scores and observations are
        probabilistic proxies based on acoustic and linguistic patterns. They are not validated
        psychological assessments. Use as prompts for self-reflection only.
      </div>
    </div>
  )
}
