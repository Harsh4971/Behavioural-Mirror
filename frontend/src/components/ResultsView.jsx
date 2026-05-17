import { useState } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

export default function ResultsView({ results, onBack }) {
  const { signals, insights } = results

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.round(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const talkPct = Math.round(signals.talk_ratio.user_ratio * 100)
  const duration = Math.round(signals.session_duration_s / 60)

  return (
    <div>
      <button onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#666", fontSize: 13, marginBottom: 20, padding: 0 }}>
        ← Back
      </button>

      {/* Summary */}
      <div style={{ background: "#f8f9fa", borderRadius: 12,
        padding: 20, marginBottom: 24, borderLeft: "4px solid #111" }}>
        <p style={{ fontSize: 15, lineHeight: 1.7, margin: 0, color: "#333" }}>
          {insights.summary_sentence}
        </p>
      </div>

      {/* Key metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 10, marginBottom: 28 }}>
        {[
          { label: "Duration", value: `${duration}m`, sub: "total" },
          { label: "You spoke", value: `${talkPct}%`, sub: "of the time" },
          { label: "Speech rate", value: `${signals.speech_rate.overall_wpm}`, sub: "words/min" },
          { label: "Filler words", value: `${signals.filler_words.rate_per_100_words}`, sub: "per 100 words" },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ textAlign: "center", padding: "14px 8px",
            border: "1px solid #eee", borderRadius: 10, background: "white" }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
            <div style={{ fontSize: 11, color: "#888" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Speech rate timeline */}
      {signals.timeline?.length > 1 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#333" }}>
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
        </div>
      )}

      {/* Interruptions & turns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 10, marginBottom: 28 }}>
        <div style={{ padding: 16, border: "1px solid #eee",
          borderRadius: 10, background: "white" }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Interruptions</div>
          <div style={{ fontSize: 13 }}>
            You interrupted: <strong>{signals.interruptions.user_interrupted_other}x</strong>
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            You were interrupted: <strong>{signals.interruptions.user_was_interrupted}x</strong>
          </div>
        </div>
        <div style={{ padding: 16, border: "1px solid #eee",
          borderRadius: 10, background: "white" }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Turn Dynamics</div>
          <div style={{ fontSize: 13 }}>
            Your turns: <strong>{signals.turn_dynamics.user_turns}</strong>
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Avg length: <strong>{signals.turn_dynamics.avg_user_turn_length_s}s</strong>
          </div>
        </div>
      </div>

      {/* Observations */}
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        Behavioral Observations
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
        {insights.observations?.map((obs, i) => (
          <ObservationCard key={i} obs={obs} />
        ))}
      </div>

      {/* Notable pattern */}
      {insights.notable_pattern && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 10, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>
            Notable Pattern
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#78350f" }}>
            {insights.notable_pattern}
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 11, color: "#999", padding: 14,
        background: "#fafafa", borderRadius: 8, lineHeight: 1.7 }}>
        <strong>Note:</strong> These observations are probabilistic patterns from audio signals,
        not validated psychological assessments. Use them as prompts for self-reflection only.
      </div>
    </div>
  )
}

function ObservationCard({ obs }) {
  const [resonance, setResonance] = useState(null)

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10,
      padding: 16, background: "white" }}>
      <div style={{ fontSize: 11, color: "#888", fontWeight: 600,
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
        <div style={{ fontSize: 12, color: "#888" }}>
          ✓ Noted — thanks for the feedback.
        </div>
      )}
    </div>
  )
}