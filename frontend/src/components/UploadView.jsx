import { useState, useEffect, useRef } from "react"
import axios from "axios"

const CONTEXTS = [
  { value: "casual", label: "Casual Conversation" },
  { value: "job_interview", label: "Job Interview" },
  { value: "disagreement", label: "Disagreement / Conflict" },
  { value: "presentation", label: "Presentation / Pitch" },
  { value: "meeting", label: "Meeting" },
]

const PREPARE_STEPS = [
  { key: "transcribing", label: "Transcribing audio" },
  { key: "diarizing", label: "Identifying speakers" },
  { key: "detecting", label: "Detecting your voice" },
]

const FINALIZE_STEPS = [
  { key: "extracting", label: "Extracting behavioral signals" },
  { key: "scoring", label: "Scoring dimensions" },
  { key: "generating", label: "Generating AI insights" },
]

// ── Step progress UI ──────────────────────────────────────────────

function StepProgress({ steps, currentStep, title }) {
  const currentIdx = steps.findIndex(s => s.key === currentStep)

  return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <p style={{ fontWeight: 600, fontSize: 16, margin: "0 0 32px", color: "#111" }}>
        {title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 18,
        maxWidth: 320, margin: "0 auto", textAlign: "left" }}>
        {steps.map((step, idx) => {
          const isDone = currentIdx > idx
          const isCurrent = currentIdx === idx

          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                background: isDone ? "#111" : "white",
                border: `2px solid ${isDone || isCurrent ? "#111" : "#ddd"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {isDone && <span style={{ color: "white", fontSize: 12, lineHeight: 1 }}>✓</span>}
                {isCurrent && <div style={{ width: 8, height: 8, background: "#111", borderRadius: "50%" }} />}
              </div>
              <div>
                <span style={{
                  fontSize: 14,
                  color: isDone ? "#999" : isCurrent ? "#111" : "#ccc",
                  fontWeight: isCurrent ? 600 : 400,
                }}>
                  {step.label}
                </span>
                {isCurrent && (
                  <span style={{ fontSize: 12, color: "#999", marginLeft: 6 }}>— in progress…</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 12, color: "#bbb", marginTop: 32 }}>
        You can browse History while this runs
      </p>
    </div>
  )
}

// ── Speaker picker ────────────────────────────────────────────────

function SpeakerPicker({ prepareData, onConfirm, onBack, error, loading }) {
  const { speakers = {}, detected_speaker, voiceprint_match, voiceprint_confidence } = prepareData
  const speakerIds = Object.keys(speakers).sort()
  const defaultSpeaker = detected_speaker || speakerIds[0] || null
  const [selected, setSelected] = useState(defaultSpeaker)

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#666", fontSize: 13, marginBottom: 20, padding: 0 }}>
        ← Back
      </button>

      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>
        Who are you in this conversation?
      </h2>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 20px", lineHeight: 1.6 }}>
        We detected {speakerIds.length} speaker{speakerIds.length !== 1 ? "s" : ""}.
        Select yourself so the analysis focuses on your communication patterns.
      </p>

      {voiceprint_match && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac",
          borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "#166534" }}>
          ✓ Voice recognized — matched to <strong>{voiceprint_match}</strong> based on your
          voice history (confidence {Math.round(voiceprint_confidence * 100)}%).
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {speakerIds.map((speakerId, idx) => {
          const info = speakers[speakerId]
          const isSelected = selected === speakerId
          const isAuto = detected_speaker === speakerId

          return (
            <div
              key={speakerId}
              onClick={() => setSelected(speakerId)}
              style={{
                border: isSelected ? "2px solid #111" : "1px solid #ddd",
                borderRadius: 12,
                padding: 16,
                cursor: "pointer",
                background: isSelected ? "#f8f9fa" : "white",
                transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Speaker {idx + 1}</span>
                  {isAuto && (
                    <span style={{ fontSize: 11, background: "#f0fdf4", color: "#166534",
                      padding: "2px 8px", borderRadius: 20, fontWeight: 500 }}>
                      auto-detected
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: "#888" }}>
                  {info.talk_time_s}s · {info.turn_count} turn{info.turn_count !== 1 ? "s" : ""}
                </span>
              </div>

              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.65 }}>
                {info.samples.length > 0 ? (
                  info.samples.slice(0, 2).map((text, i) => (
                    <div key={i} style={{ fontStyle: "italic", marginBottom: 3 }}>
                      "{text.length > 90 ? text.slice(0, 90) + "…" : text}"
                    </div>
                  ))
                ) : (
                  <span style={{ color: "#bbb" }}>No transcript available</span>
                )}
              </div>

              {isSelected && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, background: "#111", borderRadius: "50%" }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>This is me</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5",
          borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "#991b1b" }}>
          ⚠️ {error}
        </div>
      )}

      <button
        onClick={() => selected && onConfirm(selected)}
        disabled={!selected || loading}
        style={{ width: "100%", padding: "13px 24px",
          background: selected && !loading ? "#111" : "#ccc", color: "white",
          border: "none", borderRadius: 8, fontSize: 15,
          cursor: selected && !loading ? "pointer" : "not-allowed", fontWeight: 500 }}>
        {loading ? "Analyzing…" : "Analyze as this speaker"}
      </button>
    </div>
  )
}

// ── Main upload view ──────────────────────────────────────────────

export default function UploadView({ onResults, userId = "default_user", onActivate }) {
  const [file, setFile] = useState(null)
  const [context, setContext] = useState("casual")
  const [numSpeakers, setNumSpeakers] = useState(2)

  // step: "idle" | "preparing" | "confirming" | "finalizing"
  const [step, setStep] = useState("idle")
  const [prepareData, setPrepareData] = useState(null)
  const [error, setError] = useState("")
  const [progressStep, setProgressStep] = useState(null)

  const esRef = useRef(null)

  useEffect(() => {
    return () => { esRef.current?.close() }
  }, [])

  const handlePrepare = async () => {
    if (!file) return
    setStep("preparing")
    setError("")
    setProgressStep(null)

    try {
      const form = new FormData()
      form.append("audio", file)
      form.append("context", context)
      form.append("num_speakers", numSpeakers)
      form.append("user_id", userId)
      form.append("filename", file.name)

      const { data: { job_id } } = await axios.post(
        "http://localhost:8000/api/prepare/start",
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      )

      const es = new EventSource(`http://localhost:8000/api/prepare/${job_id}/stream`)
      esRef.current = es

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.event === "progress") {
          setProgressStep(msg.step)
        } else if (msg.event === "done") {
          es.close()
          esRef.current = null
          console.log("[prepare] response:", msg.data)
          setPrepareData(msg.data)
          setStep("confirming")
          onActivate?.()
        } else if (msg.event === "error") {
          es.close()
          esRef.current = null
          setError(msg.message || "Preparation failed.")
          setStep("idle")
        }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        setError("Connection lost. Please try again.")
        setStep("idle")
      }

    } catch (e) {
      console.error("[prepare] error:", e)
      setError(e.response?.data?.detail || "Preparation failed. Check the backend terminal.")
      setStep("idle")
    }
  }

  const handleFinalize = async (confirmedSpeaker) => {
    setStep("finalizing")
    setError("")
    setProgressStep(null)

    try {
      const form = new FormData()
      form.append("session_id", prepareData.session_id)
      form.append("confirmed_speaker", confirmedSpeaker)

      const { data: { job_id } } = await axios.post(
        "http://localhost:8000/api/finalize/start",
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      )

      const es = new EventSource(`http://localhost:8000/api/finalize/${job_id}/stream`)
      esRef.current = es

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.event === "progress") {
          setProgressStep(msg.step)
        } else if (msg.event === "done") {
          es.close()
          esRef.current = null
          setStep("idle")
          setFile(null)
          setPrepareData(null)
          onResults(msg.data)
        } else if (msg.event === "error") {
          es.close()
          esRef.current = null
          setError(msg.message || "Analysis failed.")
          setStep("confirming")
        }
      }

      es.onerror = async () => {
        es.close()
        esRef.current = null
        // Backend may have finished and saved the session even though the SSE
        // connection dropped. Wait briefly then check history before giving up.
        try {
          await new Promise(r => setTimeout(r, 1200))
          const res = await fetch(`http://localhost:8000/api/sessions/${userId}`)
          const sessions = await res.json()
          const saved = sessions.find(s => s.session_id === prepareData?.session_id)
          if (saved) {
            setStep("idle")
            setFile(null)
            setPrepareData(null)
            onResults({
              signals: saved.signals,
              insights: saved.insights,
              dimensions: saved.dimensions || {},
              filename: saved.filename,
              detected_speaker: saved.detected_speaker,
              speaker_confirmed: saved.speaker_confirmed,
              session_id: saved.session_id,
            })
            return
          }
        } catch {}
        setError("Connection lost during analysis. Please try again.")
        setStep("confirming")
      }

    } catch (e) {
      console.error("[finalize] error:", e)
      setError(e.response?.data?.detail || "Analysis failed. Check the backend terminal.")
      setStep("confirming")
    }
  }

  // ── Progress screens ───────────────────────────────────────────

  if (step === "preparing") return (
    <StepProgress
      steps={PREPARE_STEPS}
      currentStep={progressStep || "transcribing"}
      title="Analyzing your conversation…"
    />
  )

  if (step === "finalizing") return (
    <StepProgress
      steps={FINALIZE_STEPS}
      currentStep={progressStep || "extracting"}
      title="Building your behavioral profile…"
    />
  )

  // ── Speaker picker ─────────────────────────────────────────────

  if (step === "confirming" && prepareData) return (
    <SpeakerPicker
      prepareData={prepareData}
      onConfirm={handleFinalize}
      onBack={() => { setStep("idle"); setPrepareData(null); setError("") }}
      error={error}
      loading={false}
    />
  )

  // ── Upload form (idle) ─────────────────────────────────────────

  return (
    <div>
      <div
        onClick={() => document.getElementById("file-input").click()}
        style={{ border: "2px dashed #ddd", borderRadius: 12, padding: 40,
          textAlign: "center", marginBottom: 20, cursor: "pointer",
          background: file ? "#f0fdf4" : "#fafafa",
          borderColor: file ? "#86efac" : "#ddd",
          transition: "all 0.2s" }}>
        <input id="file-input" type="file" accept="*/*"
          style={{ display: "none" }}
          onChange={e => setFile(e.target.files[0])} />
        {file ? (
          <>
            <div style={{ fontSize: 32 }}>✅</div>
            <p style={{ fontWeight: 600, marginTop: 8 }}>{file.name}</p>
            <p style={{ fontSize: 12, color: "#666" }}>
              {(file.size / 1024 / 1024).toFixed(1)} MB · Click to change
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 36 }}>🎙️</div>
            <p style={{ fontWeight: 500, marginTop: 8 }}>Upload audio or video</p>
            <p style={{ fontSize: 12, color: "#999" }}>MP3, WAV, MP4, M4A · Max 100MB</p>
          </>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13,
          fontWeight: 500, marginBottom: 6, color: "#333" }}>
          What kind of conversation was this?
        </label>
        <select value={context} onChange={e => setContext(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8,
            border: "1px solid #ddd", fontSize: 14, background: "white" }}>
          {CONTEXTS.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: 13,
          fontWeight: 500, marginBottom: 6, color: "#333" }}>
          Number of speakers
        </label>
        <select value={numSpeakers} onChange={e => setNumSpeakers(Number(e.target.value))}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8,
            border: "1px solid #ddd", fontSize: 14, background: "white" }}>
          <option value={2}>2 speakers</option>
          <option value={3}>3 speakers</option>
          <option value={4}>4 speakers</option>
        </select>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5",
          borderRadius: 8, padding: 12, marginBottom: 16,
          fontSize: 13, color: "#991b1b" }}>
          ⚠️ {error}
        </div>
      )}

      <button onClick={handlePrepare} disabled={!file}
        style={{ width: "100%", padding: "13px 24px",
          background: file ? "#111" : "#ccc", color: "white",
          border: "none", borderRadius: 8, fontSize: 15,
          cursor: file ? "pointer" : "not-allowed", fontWeight: 500 }}>
        Analyze Conversation
      </button>

      <p style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 10 }}>
        🔒 Audio is deleted immediately after analysis. Only behavioral signals are stored.
      </p>
    </div>
  )
}
