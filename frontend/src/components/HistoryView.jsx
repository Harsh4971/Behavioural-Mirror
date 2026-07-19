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

function SessionCard({ s, index, onSelect, confirmDeleteId, setConfirmDeleteId, handleDelete, deleting }) {
  const sessionTypes = (s.insights?.conversation_types || [s.context])

  // Talk split percentages
  const dur = s.signals.session_duration_s || 1
  const userPct   = Math.round((s.signals.talk_ratio.user_speaking_time_s  / dur) * 100)
  const otherPct  = Math.round((s.signals.talk_ratio.other_speaking_time_s / dur) * 100)
  const silPct    = Math.max(0, 100 - userPct - otherPct)

  return (
    <Reveal delay={Math.min(index * 80, 280)}>
    <div className="card"
      style={{ border: "1px solid #1e2438", borderRadius: 12, padding: 16,
        background: "#151922", boxShadow: "0 2px 16px rgba(0,0,0,0.3)" }}>

      <div onClick={() => onSelect({
        signals: s.signals, insights: s.insights,
        dimensions: s.dimensions || {},
        filename: s.filename || "recording",
        detected_speaker: s.detected_speaker || "SPEAKER_00",
        session_id: s.session_id,
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
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#8b89aa", lineHeight: 1.5 }}>
          {s.insights.summary_sentence}
        </p>

        {/* Signal stats */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap",
          marginBottom: s.highlight ? 12 : 0 }}>
          {[
            { label: "You",      value: `${userPct}%`  },
            { label: "Others",   value: `${otherPct}%` },
            { label: "Silence",  value: `${silPct}%`   },
            { label: "WPM",      value: `${s.signals.speech_rate.overall_wpm}` },
            { label: "Fillers",  value: `${s.signals.filler_words.rate_per_100_words}/100w` },
            { label: "Duration", value: `${Math.round(dur / 60)}m` },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: "#4a4865" }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f0eeff" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Self-relative highlight — one steady composite, "more/less than your
            usual", never a number, never a grade. None shown if nothing is
            steady yet for this user+context (honest, not padded). */}
        {s.highlight && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, paddingTop: 10,
            borderTop: "1px solid #1e2438" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#818cf8" }}>
              {s.highlight.label}
            </span>
            <span style={{ fontSize: 12, color: "#8b89aa" }}>
              {s.highlight.position}
            </span>
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
}

const PAGE_SIZE = 10

export default function HistoryView({ onSelect, active = false }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [contextFilter, setContextFilter] = useState("all")
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const handleDelete = async (sessionId) => {
    setDeleting(true)
    try {
      await api.delete(`/api/sessions/${sessionId}`)
      setSessions(prev => prev.filter(s => s.session_id !== sessionId))
      setTotal(prev => prev - 1)
    } catch (e) {
      console.error("Delete failed:", e)
    } finally {
      setDeleting(false)
      setConfirmDeleteId(null)
    }
  }

  const loadSessions = (pageNum = 0) => {
    if (pageNum === 0) {
      setLoading(true)
      setLoadError(false)
      setSessions([])
      setPage(0)
    } else {
      setLoadingMore(true)
    }
    api.get(`/api/sessions?page=${pageNum}&page_size=${PAGE_SIZE}`)
      .then(res => {
        const data = res.data
        const newSessions = Array.isArray(data) ? data : (data.sessions ?? [])
        const t = Array.isArray(data) ? data.length : (data.total ?? 0)
        setSessions(prev => pageNum === 0 ? newSessions : [...prev, ...newSessions])
        setTotal(t)
        setPage(pageNum)
      })
      .catch(err => {
        console.error(err)
        if (pageNum === 0) setLoadError(true)
      })
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }

  useEffect(() => {
    if (!active) return
    loadSessions(0)
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
        Record your first meeting to get started.
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
          {sessions.length < total
            ? `${sessions.length} of ${total} sessions loaded`
            : `${filtered.length} of ${total} session${total !== 1 ? "s" : ""}`}
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
        {filtered.map((s, i) => (
          <SessionCard
            key={s.session_id}
            s={s}
            index={i}
            onSelect={onSelect}
            confirmDeleteId={confirmDeleteId}
            setConfirmDeleteId={setConfirmDeleteId}
            handleDelete={handleDelete}
            deleting={deleting}
          />
        ))}
      </div>

      {/* Load more */}
      {sessions.length < total && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button
            onClick={() => loadSessions(page + 1)}
            disabled={loadingMore}
            style={{
              background: "none",
              border: "1px solid #1e2438",
              borderRadius: 8,
              padding: "9px 24px",
              fontSize: 13,
              color: loadingMore ? "#4a4865" : "#8b89aa",
              cursor: loadingMore ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={e => { if (!loadingMore) { e.currentTarget.style.borderColor = "#2e3464"; e.currentTarget.style.color = "#f0eeff" } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e2438"; e.currentTarget.style.color = loadingMore ? "#4a4865" : "#8b89aa" }}
          >
            {loadingMore
              ? "Loading…"
              : `Load ${Math.min(PAGE_SIZE, total - sessions.length)} more`}
          </button>
          <p style={{ fontSize: 11, color: "#4a4865", marginTop: 8 }}>
            {total - sessions.length} more session{total - sessions.length !== 1 ? "s" : ""} not shown
          </p>
        </div>
      )}

      {sessions.length >= 3 && sessions.length >= total && (
        <Reveal>
          <div style={{ marginTop: 20, padding: 14,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
            borderRadius: 10, fontSize: 13, color: "#34d399" }}>
            ✨ {total} sessions recorded — your behavioral profile is active.
            Check the You tab.
          </div>
        </Reveal>
      )}
    </div>
  )
}
