import { useState, useEffect } from "react"
import api from "../lib/api"

const CONTEXT_LABELS = {
  social: "Social", collaborative: "Collaborative", evaluative: "Evaluative",
  influential: "Influential", negotiation: "Negotiation", adversarial: "Adversarial",
  developmental: "Developmental", support: "Support", intimate: "Intimate",
  casual: "Casual", meeting: "Meeting", job_interview: "Job Interview",
  disagreement: "Disagreement", presentation: "Presentation",
  sales_call: "Sales Call", feedback_conversation: "Feedback",
  coaching_call: "Coaching", first_date: "First Date",
}

const SCORE_COLORS = ["#f87171", "#fb923c", "#f59e0b", "#34d399", "#10b981"]

function MiniScoreBar({ score }) {
  if (!score || score < 1) return null
  const color = SCORE_COLORS[score - 1] || "#4a4865"
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          width: 10, height: 4, borderRadius: 2,
          background: i < score ? color : "#2a2a42",
        }} />
      ))}
    </div>
  )
}

export default function HistoryView({ onSelect, active = false }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [contextFilter, setContextFilter] = useState("all")

  const handleDelete = async (sessionId) => {
    setDeleting(true)
    try {
      await api.delete(`/api/sessions/${sessionId}`)
      setSessions(prev => prev.filter(s => s.session_id !== sessionId))
    } catch (e) {
      console.error("Delete failed:", e)
    } finally {
      setDeleting(false)
      setConfirmDeleteId(null)
    }
  }

  useEffect(() => {
    if (!active) return
    setLoading(true)
    api.get("/api/sessions")
      .then(res => setSessions(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [active])

  if (loading) return (
    <div style={{ textAlign: "center", padding: 48, color: "#4a4865" }}>
      Loading sessions…
    </div>
  )

  if (sessions.length === 0) return (
    <div style={{ textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
      <p style={{ color: "#8b89aa", fontSize: 14 }}>No sessions yet.</p>
      <p style={{ color: "#4a4865", fontSize: 13, marginTop: 4 }}>
        Upload your first conversation to get started.
      </p>
    </div>
  )

  const getTypes = (s) => s.insights?.conversation_types || [s.context]
  const contexts = ["all", ...new Set(sessions.flatMap(s => getTypes(s)))]
  const filtered = contextFilter === "all"
    ? sessions
    : sessions.filter(s => getTypes(s).includes(contextFilter))

  return (
    <div>
      {/* Header + filter */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: "#4a4865", margin: 0 }}>
          {filtered.length} of {sessions.length} session{sessions.length > 1 ? "s" : ""}
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {contexts.map(ctx => {
            const isActive = contextFilter === ctx
            return (
              <button key={ctx} onClick={() => setContextFilter(ctx)}
                style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11,
                  cursor: "pointer", fontWeight: isActive ? 600 : 400,
                  background: isActive ? "rgba(217,70,239,0.12)" : "#14141f",
                  color: isActive ? "#e879f9" : "#8b89aa",
                  border: isActive ? "1px solid rgba(217,70,239,0.3)" : "1px solid #2a2a42",
                  transition: "all 0.15s" }}>
                {ctx === "all" ? "All" : (CONTEXT_LABELS[ctx] || ctx)}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(s => {
          const dims = s.dimensions || {}
          const dimSummary = [
            { label: "Emotional", score: dims.emotional_state?.confidence?.score },
            { label: "Rapport", score: dims.relational_dynamics?.rapport?.score },
            { label: "Clarity", score: dims.communication_effectiveness?.clarity?.score },
          ].filter(d => d.score != null)
          const sessionTypes = getTypes(s)

          return (
            <div key={s.session_id}
              style={{ border: "1px solid #2a2a42", borderRadius: 12, padding: 16,
                background: "#14141f", transition: "border-color 0.15s, background 0.15s" }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "#3d3d60"
                e.currentTarget.style.background = "#1a1a2e"
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "#2a2a42"
                e.currentTarget.style.background = "#14141f"
              }}>

              <div onClick={() => onSelect({
                signals: s.signals, insights: s.insights,
                dimensions: s.dimensions || {},
                filename: s.filename || "recording",
                detected_speaker: s.detected_speaker || "SPEAKER_00",
                speaker_confirmed: s.speaker_confirmed || false,
                session_id: s.session_id,
                available_speakers: s.available_speakers || [],
                transcript: s.transcript || [],
              })} style={{ cursor: "pointer" }}>

                {/* Top row */}
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {sessionTypes.map((t, i) => (
                      <span key={t} style={{
                        fontSize: 11, fontWeight: i === 0 ? 700 : 500,
                        color: i === 0 ? "#e879f9" : "#8b89aa",
                        textTransform: "uppercase", letterSpacing: 0.4,
                        background: i === 0 ? "rgba(217,70,239,0.1)" : "#1a1a2e",
                        border: `1px solid ${i === 0 ? "rgba(217,70,239,0.25)" : "#2a2a42"}`,
                        padding: "2px 8px", borderRadius: 4,
                      }}>
                        {CONTEXT_LABELS[t] || t}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: "#4a4865" }}>
                    {new Date(s.created_at).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric"
                    })}
                  </span>
                </div>

                {/* Summary */}
                <p style={{ margin: "0 0 12px", fontSize: 13,
                  color: "#8b89aa", lineHeight: 1.5 }}>
                  {s.insights.summary_sentence}
                </p>

                {/* Signal stats */}
                <div style={{ display: "flex", gap: 20,
                  marginBottom: dimSummary.length > 0 ? 12 : 0 }}>
                  {[
                    { label: "Talk", value: `${Math.round(s.signals.talk_ratio.user_ratio * 100)}%` },
                    { label: "WPM", value: `${s.signals.speech_rate.overall_wpm}` },
                    { label: "Fillers", value: `${s.signals.filler_words.rate_per_100_words}/100w` },
                    { label: "Duration", value: `${Math.round(s.signals.session_duration_s / 60)}m` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: "#4a4865" }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#f0eeff" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Dimension score bars */}
                {dimSummary.length > 0 && (
                  <div style={{ display: "flex", gap: 18, paddingTop: 10,
                    borderTop: "1px solid #2a2a42" }}>
                    {dimSummary.map(({ label, score }) => (
                      <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 10, color: "#4a4865" }}>{label}</span>
                        <MiniScoreBar score={score} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete controls */}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2a42",
                display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                {confirmDeleteId === s.session_id ? (
                  <>
                    <span style={{ fontSize: 12, color: "#8b89aa" }}>Delete this session?</span>
                    <button onClick={() => setConfirmDeleteId(null)}
                      style={{ fontSize: 12, color: "#8b89aa", background: "none",
                        border: "none", cursor: "pointer", padding: "2px 8px" }}>
                      Cancel
                    </button>
                    <button onClick={() => handleDelete(s.session_id)} disabled={deleting}
                      style={{ fontSize: 12, color: "white", background: "#f87171",
                        border: "none", borderRadius: 5, padding: "3px 10px", fontWeight: 600,
                        cursor: deleting ? "not-allowed" : "pointer",
                        opacity: deleting ? 0.6 : 1 }}>
                      {deleting ? "Deleting…" : "Yes, delete"}
                    </button>
                  </>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(s.session_id) }}
                    style={{ fontSize: 12, color: "#4a4865", background: "none",
                      border: "none", cursor: "pointer", padding: "2px 4px" }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {sessions.length >= 3 && (
        <div style={{ marginTop: 20, padding: 14,
          background: "rgba(52,211,153,0.06)",
          border: "1px solid rgba(52,211,153,0.2)",
          borderRadius: 10, fontSize: 13, color: "#34d399" }}>
          ✨ {sessions.length} sessions recorded — your behavioral profile is active.
          Check the Profile tab.
        </div>
      )}
    </div>
  )
}
