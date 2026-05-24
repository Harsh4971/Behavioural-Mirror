import { useState, useEffect } from "react"
import axios from "axios"

export default function HistoryView({ onSelect }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get("http://localhost:8000/api/sessions/default_user")
      .then(res => setSessions(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ textAlign: "center", padding: 48, color: "#888" }}>
      Loading sessions...
    </div>
  )

  if (sessions.length === 0) return (
    <div style={{ textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
      <p style={{ color: "#888", fontSize: 14 }}>No sessions yet.</p>
      <p style={{ color: "#aaa", fontSize: 13 }}>
        Upload your first conversation to get started.
      </p>
    </div>
  )

  return (
    <div>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
        {sessions.length} session{sessions.length > 1 ? "s" : ""} recorded
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sessions.map(s => (
          <div key={s.session_id}
            onClick={() => onSelect({
              signals: s.signals,
              insights: s.insights,
              dimensions: s.dimensions || {},
              filename: s.filename || "recording",
              detected_speaker: s.detected_speaker || "SPEAKER_00",
              speaker_confirmed: s.speaker_confirmed || false,
              session_id: s.session_id
            })}
            style={{ border: "1px solid #eee", borderRadius: 10, padding: 16,
              background: "white", cursor: "pointer",
              transition: "border-color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#111"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#eee"}>

            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600,
                textTransform: "capitalize", color: "#333" }}>
                {s.context.replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 11, color: "#aaa" }}>
                {new Date(s.created_at).toLocaleDateString("en-IN", {
                  day: "numeric", month: "short", year: "numeric"
                })}
              </span>
            </div>

            <p style={{ margin: "0 0 10px", fontSize: 13,
              color: "#555", lineHeight: 1.5 }}>
              {s.insights.summary_sentence}
            </p>

            <div style={{ display: "flex", gap: 16 }}>
              {[
                { label: "Talk ratio", value: `${Math.round(s.signals.talk_ratio.user_ratio * 100)}%` },
                { label: "Speech rate", value: `${s.signals.speech_rate.overall_wpm} wpm` },
                { label: "Duration", value: `${Math.round(s.signals.session_duration_s / 60)}m` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <span style={{ fontSize: 11, color: "#aaa" }}>{label}: </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#555" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {sessions.length >= 3 && (
        <div style={{ marginTop: 20, padding: 14, background: "#f0fdf4",
          border: "1px solid #86efac", borderRadius: 10, fontSize: 13, color: "#166534" }}>
          ✨ You have {sessions.length} sessions — baseline comparisons are now active.
          Future insights will compare against your personal patterns.
        </div>
      )}
    </div>
  )
}