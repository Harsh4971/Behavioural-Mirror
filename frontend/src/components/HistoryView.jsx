import { useState, useEffect } from "react"
import api from "../lib/api"
import Reveal from "./Reveal"

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

const SCORE_COLORS = ["#f87171", "#fb923c", "#f59e0b", "#34d399", "#10b981"]

function MiniScoreBar({ score }) {
  if (!score || score < 1) return null
  const color = SCORE_COLORS[score - 1] || "#4a4865"
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          width: 10, height: 4, borderRadius: 2,
          background: i < score ? color : "#1e2438",
        }} />
      ))}
    </div>
  )
}

export default function HistoryView({ onSelect, active = false }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
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

  const loadSessions = () => {
    setLoading(true)
    setLoadError(false)
    api.get("/api/sessions")
      .then(res => setSessions(res.data))
      .catch(err => { console.error(err); setLoadError(true) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!active) return
    loadSessions()
  }, [active])

  if (loading) return (
    <div style={{ textAlign: "center", padding: 48, color: "#4a4865" }}>
      Loading sessions…
    </div>
  )

  if (loadError) return (
    <div style={{ textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <p style={{ color: "#f87171", fontSize: 14, marginBottom: 12 }}>
        Could not load sessions — the server may be starting up.
      </p>
      <button onClick={loadSessions} style={{
        background: "rgba(29,78,216,0.1)", border: "1px solid rgba(29,78,216,0.3)",
        borderRadius: 8, padding: "8px 20px", color: "#5b9cf6",
        fontSize: 13, fontWeight: 500, cursor: "pointer",
      }}>
        Retry
      </button>
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
                  background: isActive ? "rgba(29,78,216,0.12)" : "#151922",
                  color: isActive ? "#5b9cf6" : "#8b89aa",
                  border: isActive ? "1px solid rgba(29,78,216,0.3)" : "1px solid #1e2438",
                  transition: "all 0.15s" }}>
                {ctx === "all" ? "All" : (CONTEXT_LABELS[ctx] || ctx)}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((s, i) => {
          const dims = s.dimensions || {}
          const dimSummary = [
            { label: "Emotional", score: dims.emotional_state?.confidence?.score },
            { label: "Rapport", score: dims.relational_dynamics?.rapport?.score },
            { label: "Clarity", score: dims.communication_effectiveness?.clarity?.score },
          ].filter(d => d.score != null)
          const sessionTypes = getTypes(s)

          return (
            <Reveal key={s.session_id} delay={Math.min(i * 80, 280)}>
            <div className="card"
              style={{ border: "1px solid #1e2438", borderRadius: 12, padding: 16,
                background: "#151922", boxShadow: "0 2px 16px rgba(0,0,0,0.3)" }}>

              <div onClick={() => onSelect({
                signals: s.signals, insights: s.insights,
                dimensions: s.dimensions || {},
                filename: s.filename || "recording",
                detected_speaker: s.detected_speaker || "SPEAKER_00",
                speaker_confirmed: s.speaker_confirmed || false,
                session_id: s.session_id,
                available_speakers: s.available_speakers || [],
                fingerprint: s.fingerprint || null,
              })} style={{ cursor: "pointer" }}>

                {/* Top row */}
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {sessionTypes.map((t, i) => (
                      <span key={t} style={{
                        fontSize: 11, fontWeight: i === 0 ? 700 : 500,
                        color: i === 0 ? "#5b9cf6" : "#8b89aa",
                        textTransform: "uppercase", letterSpacing: 0.4,
                        background: i === 0 ? "rgba(29,78,216,0.1)" : "#131827",
                        border: `1px solid ${i === 0 ? "rgba(29,78,216,0.25)" : "#1e2438"}`,
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
                    borderTop: "1px solid #1e2438" }}>
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
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #1e2438",
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
            </Reveal>
          )
        })}
      </div>

      {sessions.length >= 3 && (
        <Reveal>
          <div style={{ marginTop: 20, padding: 14,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
            borderRadius: 10, fontSize: 13, color: "#34d399" }}>
            ✨ {sessions.length} sessions recorded — your behavioral profile is active.
            Check the Profile tab.
          </div>
        </Reveal>
      )}
    </div>
  )
}
