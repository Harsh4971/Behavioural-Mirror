import { useState } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

const SCORE_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981"]
const SCORE_BG = ["#fef2f2", "#fff7ed", "#fffbeb", "#f0fdf4", "#ecfdf5"]

function ScoreBar({ score, max = 5 }) {
  const color = SCORE_COLORS[score - 1] || "#94a3b8"
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} style={{
          width: 20, height: 8, borderRadius: 4,
          background: i < score ? color : "#e5e7eb"
        }} />
      ))}
    </div>
  )
}

function DimensionCard({ title, icon, items, narrative }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12,
      background: "white", marginBottom: 12, overflow: "hidden" }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ padding: "14px 16px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        </div>
        <span style={{ color: "#888", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Always show summary scores */}
      <div style={{ padding: "0 16px 14px", display: "flex", flexWrap: "wrap", gap: 10 }}>
        {items.map(({ label, score, labelText }) => (
          <div key={label} style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{label}</div>
            <ScoreBar score={score} />
            <div style={{ fontSize: 11, fontWeight: 600,
              color: SCORE_COLORS[score - 1], marginTop: 3 }}>
              {labelText}
            </div>
          </div>
        ))}
      </div>

      {/* Expanded: narrative */}
      {expanded && narrative && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid #f0f0f0",
          background: "#fafafa", fontSize: 13, color: "#444", lineHeight: 1.7 }}>
          {narrative}
        </div>
      )}
    </div>
  )
}

function CoachingCard({ suggestion }) {
  const priorityColors = { 1: "#ef4444", 2: "#f97316", 3: "#3b82f6" }
  const color = priorityColors[suggestion.priority] || "#666"

  return (
    <div style={{ border: `1px solid ${color}20`, borderRadius: 12,
      padding: 16, background: "white", borderLeft: `4px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color,
          textTransform: "uppercase", letterSpacing: 0.5 }}>
          #{suggestion.priority} — {suggestion.area}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 8,
        fontStyle: "italic" }}>
        {suggestion.issue}
      </div>
      <div style={{ fontSize: 14, color: "#111", marginBottom: 8,
        lineHeight: 1.6, fontWeight: 500 }}>
        💡 {suggestion.suggestion}
      </div>
      <div style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>
        <strong>Why it matters:</strong> {suggestion.why_it_matters}
      </div>
    </div>
  )
}

function ObservationCard({ obs }) {
  const [resonance, setResonance] = useState(null)
  const signalColors = {
    talk_ratio: "#3b82f6", speech_rate: "#8b5cf6",
    speech_acceleration: "#ec4899", pauses: "#f59e0b",
    interruptions: "#ef4444", filler_words: "#f97316",
    vocal_energy: "#06b6d4", questions: "#10b981",
    monologue: "#6366f1", vocabulary_richness: "#84cc16",
    silence_ratio: "#94a3b8", pitch: "#a855f7", engagement: "#14b8a6"
  }
  const color = signalColors[obs.signal] || "#111"

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10,
      padding: 16, background: "white", borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 11, color, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {obs.signal.replace(/_/g, " ")}
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.6, color: "#222" }}>
        {obs.observation}
      </p>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#555",
        fontStyle: "italic", lineHeight: 1.5 }}>
        💭 {obs.resonance_prompt}
      </p>
      {resonance === null ? (
        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
            Does this resonate?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Yes", "Somewhat", "No"].map(label => (
              <button key={label} onClick={() => setResonance(label)}
                style={{ padding: "5px 14px", border: "1px solid #ddd",
                  borderRadius: 20, background: "white", cursor: "pointer",
                  fontSize: 12, color: "#333" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#888" }}>✓ Noted — thanks.</div>
      )}
    </div>
  )
}

export default function ResultsView({ results, onBack, onReanalyze }) {
  const { signals, insights, dimensions, filename, detected_speaker, speaker_confirmed, session_id } = results
  const [activeTab, setActiveTab] = useState("overview")
  const [speakerConfirmed, setSpeakerConfirmed] = useState(speaker_confirmed || false)
  const [showSpeakerCheck, setShowSpeakerCheck] = useState(!speaker_confirmed)

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.round(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const talkPct = Math.round(signals.talk_ratio.user_ratio * 100)
  const duration = Math.round(signals.session_duration_s / 60)

  const tabs = ["overview", "dimensions", "coaching", "signals"]

  return (
    <div>
      <button onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#666", fontSize: 13, marginBottom: 16, padding: 0 }}>
        ← Back
      </button>

      {filename && (
        <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          📁 {filename}
        </div>
      )}

      {/* Speaker confirmation */}
      {showSpeakerCheck && !speakerConfirmed && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", marginBottom: 8 }}>
            ⚡ Quick check — are you the right speaker?
          </div>
          <div style={{ fontSize: 13, color: "#78350f", marginBottom: 12 }}>
            We auto-detected you as <strong>{detected_speaker || "SPEAKER_00"}</strong>.
            Is this correct?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={async () => {
                setSpeakerConfirmed(true)
                setShowSpeakerCheck(false)
                // Save confirmation so it never asks again
                if (session_id) {
                  try {
                    const form = new FormData()
                    form.append("confirmed", "true")
                    await fetch(
                      `http://localhost:8000/api/sessions/${session_id}/confirm-speaker`,
                      { method: "POST", body: form }
                    )
                  } catch (e) {
                    console.error("Failed to save speaker confirmation", e)
                  }
                }
              }}
              style={{ padding: "6px 16px", background: "#111", color: "white",
                border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
              Yes, that's me
            </button>
            <button
              onClick={() => {
                setShowSpeakerCheck(false)
                if (onReanalyze) {
                  const otherSpeaker = detected_speaker === "SPEAKER_00"
                    ? "SPEAKER_01" : "SPEAKER_00"
                  onReanalyze(otherSpeaker)
                }
              }}
              style={{ padding: "6px 16px", background: "white", color: "#111",
                border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
              No, switch speaker
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20,
        borderBottom: "1px solid #eee", paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ background: "none", border: "none", cursor: "pointer",
              padding: "8px 14px", fontSize: 13, textTransform: "capitalize",
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "#111" : "#888",
              borderBottom: activeTab === tab ? "2px solid #111" : "2px solid transparent" }}>
            {tab}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <div>
          {/* Conversation Summary */}
          {insights.conversation_summary && (
            <div style={{ background: "#f0f7ff", borderRadius: 12,
              padding: 20, marginBottom: 16, borderLeft: "4px solid #3b82f6" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#1d4ed8",
                marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Conversation Summary
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, color: "#1e3a5f" }}>
                {insights.conversation_summary}
              </p>
            </div>
          )}

          {/* Communication Pattern */}
          <div style={{ background: "#f8f9fa", borderRadius: 12,
            padding: 20, marginBottom: 20, borderLeft: "4px solid #111" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#555",
              marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Communication Pattern
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, color: "#333" }}>
              {insights.summary_sentence}
            </p>
          </div>

          {/* Key metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 10, marginBottom: 10 }}>
            {[
              { label: "Duration", value: `${duration}m`, sub: "total" },
              { label: "You spoke", value: `${talkPct}%`, sub: "of the time" },
              { label: "Speech rate", value: `${signals.speech_rate.overall_wpm}`, sub: "wpm" },
              { label: "Fillers", value: `${signals.filler_words.rate_per_100_words}`, sub: "per 100 words" },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ textAlign: "center", padding: "14px 8px",
                border: "1px solid #eee", borderRadius: 10, background: "white" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{sub}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 10, marginBottom: 20 }}>
            {[
              { label: "Interruptions given", value: `${signals.interruptions.user_interrupted_other}x` },
              { label: "Interruptions received", value: `${signals.interruptions.user_was_interrupted}x` },
              { label: "Questions asked", value: `${signals.questions.user_questions_asked}` },
              { label: "Energy trend", value: signals.vocal_energy.trend === "insufficient_data" ? "—" : signals.vocal_energy.trend },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: "center", padding: "14px 8px",
                border: "1px solid #eee", borderRadius: 10, background: "white" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, textTransform: "capitalize" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Notable pattern */}
          {insights.notable_pattern && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a",
              borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600,
                color: "#92400e", marginBottom: 4 }}>Notable Pattern</div>
              <p style={{ margin: 0, fontSize: 14, color: "#78350f" }}>
                {insights.notable_pattern}
              </p>
            </div>
          )}

          {/* Conversation Arc summary */}
          {dimensions?.conversation_arc && (
            <div style={{ border: "1px solid #eee", borderRadius: 12,
              padding: 16, background: "white" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555",
                marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Conversation Arc
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: 10 }}>
                {[
                  { label: "Opening vs Closing", value: dimensions.conversation_arc.opening_vs_closing?.label },
                  { label: "Tension", value: dimensions.conversation_arc.tension_arc?.label },
                  { label: "Who Drove", value: dimensions.conversation_arc.who_drove?.label },
                  { label: "Resolution", value: dimensions.conversation_arc.resolution_proxy?.label },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#333",
                      textTransform: "capitalize" }}>{value || "—"}</div>
                  </div>
                ))}
              </div>
              {dimensions.conversation_arc.turning_point?.detected && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#666",
                  background: "#f8f9fa", padding: 8, borderRadius: 6 }}>
                  ⚡ {dimensions.conversation_arc.turning_point.detail}
                </div>
              )}
              {insights.dimension_narrative?.conversation_arc && (
                <p style={{ margin: "10px 0 0", fontSize: 13,
                  color: "#555", lineHeight: 1.6 }}>
                  {insights.dimension_narrative.conversation_arc}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DIMENSIONS TAB ── */}
      {activeTab === "dimensions" && dimensions && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.6 }}>
            Scores are probabilistic proxies based on behavioral signals —
            not psychological diagnoses. Tap any card to read the interpretation.
          </p>

          {/* Emotional State */}
          {dimensions.emotional_state && (
            <DimensionCard
              title="Your Emotional State"
              icon="🧠"
              narrative={insights.dimension_narrative?.emotional_state}
              items={[
                {
                  label: "Confidence",
                  score: dimensions.emotional_state.confidence?.score,
                  labelText: dimensions.emotional_state.confidence?.label
                },
                {
                  label: "Nervousness",
                  score: dimensions.emotional_state.nervousness?.score,
                  labelText: dimensions.emotional_state.nervousness?.label
                },
                {
                  label: "Emotional Intensity",
                  score: dimensions.emotional_state.emotional_intensity?.score,
                  labelText: dimensions.emotional_state.emotional_intensity?.label
                },
                {
                  label: "Topic Comfort",
                  score: dimensions.emotional_state.topic_comfort?.score,
                  labelText: dimensions.emotional_state.topic_comfort?.label
                },
                {
                  label: "Enthusiasm",
                  score: dimensions.emotional_state.enthusiasm?.score,
                  labelText: dimensions.emotional_state.enthusiasm?.label
                },
              ]}
            />
          )}

          {/* Relational Dynamics */}
          {dimensions.relational_dynamics && (
            <DimensionCard
              title="Relational Dynamics"
              icon="🤝"
              narrative={insights.dimension_narrative?.relational_dynamics}
              items={[
                {
                  label: "Rapport",
                  score: dimensions.relational_dynamics.rapport?.score,
                  labelText: dimensions.relational_dynamics.rapport?.label
                },
                {
                  label: "Power Balance",
                  score: dimensions.relational_dynamics.power_balance?.score,
                  labelText: dimensions.relational_dynamics.power_balance?.label
                },
                {
                  label: "Empathy",
                  score: dimensions.relational_dynamics.empathy?.score,
                  labelText: dimensions.relational_dynamics.empathy?.label
                },
                {
                  label: "Respect",
                  score: dimensions.relational_dynamics.conversational_respect?.score,
                  labelText: dimensions.relational_dynamics.conversational_respect?.label
                },
                {
                  label: "Mutual Engagement",
                  score: dimensions.relational_dynamics.mutual_engagement?.score,
                  labelText: dimensions.relational_dynamics.mutual_engagement?.label
                },
              ]}
            />
          )}

          {/* Communication Effectiveness */}
          {dimensions.communication_effectiveness && (
            <DimensionCard
              title="Communication Effectiveness"
              icon="💬"
              narrative={insights.dimension_narrative?.communication_effectiveness}
              items={[
                {
                  label: "Clarity",
                  score: dimensions.communication_effectiveness.clarity?.score,
                  labelText: dimensions.communication_effectiveness.clarity?.label
                },
                {
                  label: "Assertiveness",
                  score: dimensions.communication_effectiveness.assertiveness?.score,
                  labelText: dimensions.communication_effectiveness.assertiveness?.label
                },
                {
                  label: "Listening Quality",
                  score: dimensions.communication_effectiveness.listening_quality?.score,
                  labelText: dimensions.communication_effectiveness.listening_quality?.label
                },
                {
                  label: "Persuasiveness",
                  score: dimensions.communication_effectiveness.persuasiveness?.score,
                  labelText: dimensions.communication_effectiveness.persuasiveness?.label
                },
                {
                  label: "Adaptability",
                  score: dimensions.communication_effectiveness.adaptability?.score,
                  labelText: dimensions.communication_effectiveness.adaptability?.label
                },
              ]}
            />
          )}
        </div>
      )}

      {/* ── COACHING TAB ── */}
      {activeTab === "coaching" && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.6 }}>
            Specific suggestions based on patterns observed in this conversation.
            Ranked by potential impact.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {insights.coaching_suggestions?.map((s, i) => (
              <CoachingCard key={i} suggestion={s} />
            ))}
            {(!insights.coaching_suggestions || insights.coaching_suggestions.length === 0) && (
              <div style={{ textAlign: "center", padding: 32, color: "#888" }}>
                No coaching suggestions generated for this session.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SIGNALS TAB ── */}
      {activeTab === "signals" && (
        <div>
          {/* Speech Rate Timeline */}
          {signals.timeline?.length > 1 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                Speech Rate Over Time
              </h3>
              <div style={{ background: "white", border: "1px solid #eee",
                borderRadius: 10, padding: 16 }}>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={signals.timeline}>
                    <XAxis dataKey="window_start_s"
                      tickFormatter={formatTime} fontSize={11} />
                    <YAxis domain={["auto", "auto"]} fontSize={11} width={35} />
                    <Tooltip
                      labelFormatter={v => `At ${formatTime(v)}`}
                      formatter={v => [`${Math.round(v)} wpm`, "Speech rate"]} />
                    <Line type="monotone" dataKey="speech_rate_wpm"
                      stroke="#111" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {signals.speech_acceleration.trend !== "insufficient_data" && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                  Trend: <strong>{signals.speech_acceleration.trend}</strong>
                  {signals.speech_acceleration.delta_wpm &&
                    ` (${signals.speech_acceleration.delta_wpm > 0 ? "+" : ""}${signals.speech_acceleration.delta_wpm} wpm)`}
                </div>
              )}
            </div>
          )}

          {/* Raw signal observations */}
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            Behavioral Observations
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            {insights.observations?.map((obs, i) => (
              <ObservationCard key={i} obs={obs} />
            ))}
          </div>

          {/* Signal grid */}
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            All Signals
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 10, marginBottom: 16 }}>
            {[
              { label: "Silence ratio", value: `${Math.round(signals.silence_ratio.silence_ratio * 100)}%` },
              { label: "Vocab richness", value: signals.vocabulary_richness.type_token_ratio?.toFixed(2) || "—" },
              { label: "Longest turn", value: `${signals.monologue.longest_turn_s}s` },
              { label: "Avg response latency", value: `${signals.pauses.response_latency.mean_s}s` },
              { label: "Within-turn pauses", value: signals.pauses.within_turn_pauses.count },
              { label: "Your turns", value: signals.turn_dynamics.user_turns },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: 12, border: "1px solid #eee",
                borderRadius: 8, background: "white" }}>
                <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 11, color: "#999", padding: 14,
        background: "#fafafa", borderRadius: 8, lineHeight: 1.7, marginTop: 16 }}>
        <strong>Note:</strong> All scores and observations are probabilistic proxies
        based on acoustic and linguistic patterns. They are not validated psychological
        assessments. Use as prompts for self-reflection only.
      </div>
    </div>
  )
}