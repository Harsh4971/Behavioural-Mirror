import { useState, useEffect } from "react"
import api from "../lib/api"
import Reveal from "./Reveal"
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts"

// Palette for up to 6 speakers
const SPEAKER_COLORS = ["#3b82f6", "#8b5cf6", "#34d399", "#f59e0b", "#f87171", "#0891b2"]

function speakerDisplayName(id, detectedSpeaker) {
  if (id === detectedSpeaker) return "You"
  const num = parseInt(id.replace("SPEAKER_", ""), 10)
  return isNaN(num) ? id : `Participant ${num}`
}

function formatMin(s) {
  return `${Math.floor(s / 60)}m`
}

function SpeakerTimeline({ speakersTimeline, detectedSpeaker }) {
  const speakers = Object.keys(speakersTimeline || {})
  if (!speakers.length) return null

  // Merge all per-speaker windows into a unified time axis
  const windowMap = {}
  for (const sp of speakers) {
    for (const w of speakersTimeline[sp]) {
      const key = w.window_start_s
      if (!windowMap[key]) windowMap[key] = { t: key }
      windowMap[key][sp] = w.speech_rate_wpm
    }
  }
  const chartData = Object.values(windowMap).sort((a, b) => a.t - b.t)
  if (chartData.length < 2) return null

  return (
    <div style={{ marginTop: 14, padding: "14px 0 4px",
      borderTop: "1px solid #1e2438" }}>
      <div style={{ fontSize: 11, color: "#4a4865", marginBottom: 10,
        textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
        Who spoke when — speech rate (wpm)
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={chartData}>
          <XAxis dataKey="t" tickFormatter={formatMin} fontSize={10}
            tick={{ fill: "#4a4865" }} axisLine={{ stroke: "#1e2438" }}
            tickLine={false} />
          <YAxis fontSize={10} width={28}
            tick={{ fill: "#4a4865" }} axisLine={{ stroke: "#1e2438" }}
            tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#151922", border: "1px solid #1e2438",
              borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#8b89aa" }}
            itemStyle={{ color: "#f0eeff" }}
            labelFormatter={v => `at ${formatMin(v)}`}
            formatter={(v, name) => [`${Math.round(v)} wpm`,
              speakerDisplayName(name, detectedSpeaker)]}
          />
          <Legend
            formatter={name => speakerDisplayName(name, detectedSpeaker)}
            wrapperStyle={{ fontSize: 11, color: "#8b89aa" }}
          />
          {speakers.map((sp, i) => (
            <Line key={sp} type="monotone" dataKey={sp}
              stroke={SPEAKER_COLORS[i % SPEAKER_COLORS.length]}
              strokeWidth={sp === detectedSpeaker ? 2.5 : 1.5}
              dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

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

function SessionCard({ s, index, onSelect, confirmDeleteId, setConfirmDeleteId, handleDelete, deleting }) {
  const [showTimeline, setShowTimeline] = useState(false)

  const dims = s.dimensions || {}
  const dimSummary = [
    { label: "Emotional", score: dims.emotional_state?.confidence?.score },
    { label: "Rapport",   score: dims.relational_dynamics?.rapport?.score },
    { label: "Clarity",   score: dims.communication_effectiveness?.clarity?.score },
  ].filter(d => d.score != null)
  const sessionTypes = (s.insights?.conversation_types || [s.context])
  const hasTimeline = s.speakers_timeline && Object.keys(s.speakers_timeline).length > 0

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
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#8b89aa", lineHeight: 1.5 }}>
          {s.insights.summary_sentence}
        </p>

        {/* Signal stats */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap",
          marginBottom: dimSummary.length > 0 ? 12 : 0 }}>
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

      {/* Speaker timeline toggle */}
      {hasTimeline && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #1e2438" }}>
          <button onClick={() => setShowTimeline(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer",
              fontSize: 11, color: "#4a4865", padding: 0, display: "flex",
              alignItems: "center", gap: 5 }}>
            <span style={{ display: "inline-block",
              transform: showTimeline ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s" }}>▶</span>
            {showTimeline ? "Hide" : "Show"} speaker timeline
          </button>
          {showTimeline && (
            <SpeakerTimeline
              speakersTimeline={s.speakers_timeline}
              detectedSpeaker={s.detected_speaker || "SPEAKER_00"}
            />
          )}
        </div>
      )}

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
        const { sessions: newSessions, total: t } = res.data
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
            Check the Profile tab.
          </div>
        </Reveal>
      )}
    </div>
  )
}
