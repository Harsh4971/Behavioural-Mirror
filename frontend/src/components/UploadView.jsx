import { useState, useEffect, useRef } from "react"
import api from "../lib/api"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"
const G = "linear-gradient(135deg, #d946ef 0%, #f97316 100%)"

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

function StepProgress({ steps, currentStep, title, onCancel }) {
  const currentIdx = steps.findIndex(s => s.key === currentStep)

  return (
    <div style={{ textAlign: "center", padding: "56px 0" }}>
      <p style={{ fontWeight: 700, fontSize: 17, margin: "0 0 6px", color: "#f0eeff" }}>
        {title}
      </p>
      <p style={{ fontSize: 13, color: "#4a4865", margin: "0 0 44px" }}>
        This usually takes 1–3 minutes
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 22,
        maxWidth: 300, margin: "0 auto", textAlign: "left" }}>
        {steps.map((step, idx) => {
          const isDone = currentIdx > idx
          const isCurrent = currentIdx === idx
          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: isDone ? G : isCurrent ? "rgba(217,70,239,0.1)" : "#14141f",
                border: `2px solid ${isDone ? "transparent" : isCurrent ? "#d946ef" : "#2a2a42"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: isCurrent ? "0 0 16px rgba(217,70,239,0.4)" : "none",
                transition: "all 0.3s",
              }}>
                {isDone && <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>✓</span>}
                {isCurrent && <div style={{ width: 8, height: 8, background: "#d946ef",
                  borderRadius: "50%" }} />}
              </div>
              <div>
                <span style={{
                  fontSize: 14,
                  color: isDone ? "#4a4865" : isCurrent ? "#f0eeff" : "#2a2a42",
                  fontWeight: isCurrent ? 600 : 400,
                }}>
                  {step.label}
                </span>
                {isCurrent && (
                  <span style={{ fontSize: 12, color: "#e879f9", marginLeft: 6 }}>
                    — in progress…
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 12, color: "#4a4865", marginTop: 40 }}>
        You can browse History while this runs
      </p>
      {onCancel && (
        <button onClick={onCancel}
          style={{ marginTop: 12, background: "none", border: "1px solid #2a2a42",
            borderRadius: 6, padding: "6px 18px", fontSize: 12, color: "#4a4865",
            cursor: "pointer" }}>
          Cancel
        </button>
      )}
    </div>
  )
}

export default function UploadView({ onResults, onActivate }) {
  const [file, setFile] = useState(null)
  const [step, setStep] = useState("idle")
  const [error, setError] = useState("")
  const [progressStep, setProgressStep] = useState(null)

  const esRef = useRef(null)
  const pollRef = useRef(null)
  const finalizeStartedRef = useRef(false)

  const handleFinalize = async (sessionId, confirmedSpeaker) => {
    setStep("finalizing")
    setError("")
    setProgressStep(null)
    onActivate?.()

    try {
      const form = new FormData()
      form.append("session_id", sessionId)
      form.append("confirmed_speaker", confirmedSpeaker)

      const { data: { job_id } } = await api.post(
        "/api/finalize/start", form,
        { headers: { "Content-Type": "multipart/form-data" } }
      )

      const es = new EventSource(`${API_URL}/api/finalize/${job_id}/stream`)
      esRef.current = es

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.event === "progress") {
          setProgressStep(msg.step)
        } else if (msg.event === "done") {
          es.close(); esRef.current = null
          sessionStorage.removeItem("pending_finalize_session")
          setStep("idle"); setFile(null)
          onResults(msg.data)
        } else if (msg.event === "error") {
          es.close(); esRef.current = null
          sessionStorage.removeItem("pending_finalize_session")
          setError(msg.message || "Analysis failed."); setStep("idle")
        }
      }

      es.onerror = async () => {
        es.close(); esRef.current = null
        try {
          await new Promise(r => setTimeout(r, 1200))
          const res = await api.get("/api/sessions")
          const saved = res.data.find(s => s.session_id === sessionId)
          if (saved) {
            sessionStorage.removeItem("pending_finalize_session")
            setStep("idle"); setFile(null)
            onResults({
              signals: saved.signals, insights: saved.insights,
              dimensions: saved.dimensions || {}, filename: saved.filename,
              detected_speaker: saved.detected_speaker,
              speaker_confirmed: saved.speaker_confirmed,
              session_id: saved.session_id,
              available_speakers: saved.available_speakers || [],
            })
            return
          }
        } catch {}
        sessionStorage.removeItem("pending_finalize_session")
        setError("Connection lost during analysis. Please try again.")
        setStep("idle")
      }
    } catch (e) {
      sessionStorage.removeItem("pending_finalize_session")
      setError(e.response?.data?.detail || "Analysis failed.")
      setStep("idle")
    }
  }

  const cancelRecovery = () => {
    clearInterval(pollRef.current); pollRef.current = null
    esRef.current?.close(); esRef.current = null
    sessionStorage.removeItem("pending_prepare_job")
    sessionStorage.removeItem("pending_finalize_session")
    setStep("idle")
  }

  useEffect(() => {
    const savedFinalize = sessionStorage.getItem("pending_finalize_session")
    if (savedFinalize) {
      const { session_id, detected_speaker } = JSON.parse(savedFinalize)
      setStep("finalizing"); onActivate?.()
      handleFinalize(session_id, detected_speaker)
      return
    }
    const saved = sessionStorage.getItem("pending_prepare_job")
    if (!saved) return
    const { job_id } = JSON.parse(saved)
    setStep("preparing"); onActivate?.()
    api.get(`/api/prepare/${job_id}/status`)
      .then(res => {
        sessionStorage.removeItem("pending_prepare_job")
        handleFinalize(res.data.session_id, res.data.detected_speaker || "SPEAKER_00")
      })
      .catch(() => {
        clearInterval(pollRef.current)
        pollRef.current = setInterval(async () => {
          try {
            const res = await api.get(`/api/prepare/${job_id}/status`)
            clearInterval(pollRef.current); pollRef.current = null
            sessionStorage.removeItem("pending_prepare_job")
            handleFinalize(res.data.session_id, res.data.detected_speaker || "SPEAKER_00")
          } catch (e) {
            if (e.response?.status && e.response.status !== 404) cancelRecovery()
          }
        }, 10000)
      })
  }, [])

  useEffect(() => {
    return () => { esRef.current?.close(); clearInterval(pollRef.current) }
  }, [])

  const handlePrepare = async () => {
    if (!file) return
    setStep("preparing"); setError(""); setProgressStep(null)
    finalizeStartedRef.current = false

    try {
      const form = new FormData()
      form.append("audio", file)
      form.append("filename", file.name)

      const { data: { job_id } } = await api.post(
        "/api/prepare/start", form,
        { headers: { "Content-Type": "multipart/form-data" } }
      )

      sessionStorage.setItem("pending_prepare_job", JSON.stringify({ job_id }))

      const handlePrepareDone = (data) => {
        if (finalizeStartedRef.current) return
        finalizeStartedRef.current = true
        clearInterval(pollRef.current); pollRef.current = null
        sessionStorage.removeItem("pending_prepare_job")
        sessionStorage.setItem("pending_finalize_session", JSON.stringify({
          session_id: data.session_id,
          detected_speaker: data.detected_speaker || "SPEAKER_00",
        }))
        handleFinalize(data.session_id, data.detected_speaker || "SPEAKER_00")
      }

      const startPolling = () => {
        clearInterval(pollRef.current)
        pollRef.current = setInterval(async () => {
          try {
            const res = await api.get(`/api/prepare/${job_id}/status`)
            if (res.data.current_step) setProgressStep(res.data.current_step)
            handlePrepareDone(res.data)
          } catch (e) {
            if (e.response?.status && e.response.status !== 404) {
              clearInterval(pollRef.current); pollRef.current = null
              setError("Something went wrong. Please try again."); setStep("idle")
            }
          }
        }, 10000)
      }

      const es = new EventSource(`${API_URL}/api/prepare/${job_id}/stream`)
      esRef.current = es

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.event === "progress") setProgressStep(msg.step)
        else if (msg.event === "done") { es.close(); esRef.current = null; handlePrepareDone(msg.data) }
        else if (msg.event === "error") {
          es.close(); esRef.current = null
          sessionStorage.removeItem("pending_prepare_job")
          setError(msg.message || "Preparation failed."); setStep("idle")
        }
      }

      es.onerror = async () => {
        es.close(); esRef.current = null
        await new Promise(r => setTimeout(r, 1500))
        try {
          const res = await api.get(`/api/prepare/${job_id}/status`)
          if (res.data.current_step) setProgressStep(res.data.current_step)
          handlePrepareDone(res.data); return
        } catch {}
        startPolling()
      }

    } catch (e) {
      setError(e.response?.data?.detail || "Preparation failed."); setStep("idle")
    }
  }

  if (step === "preparing") return (
    <StepProgress steps={PREPARE_STEPS} currentStep={progressStep || "transcribing"}
      title="Analyzing your conversation…" onCancel={cancelRecovery} />
  )

  if (step === "finalizing") return (
    <StepProgress steps={FINALIZE_STEPS} currentStep={progressStep || "extracting"}
      title="Building your behavioral profile…" />
  )

  const hasFile = !!file

  return (
    <div>
      {/* Drop zone */}
      <div
        onClick={() => document.getElementById("file-input").click()}
        style={{
          border: `2px dashed ${hasFile ? "#d946ef" : "#2a2a42"}`,
          borderRadius: 16, padding: "52px 32px",
          textAlign: "center", marginBottom: 20, cursor: "pointer",
          background: hasFile ? "rgba(217,70,239,0.04)" : "#14141f",
          transition: "all 0.2s",
          boxShadow: hasFile ? "inset 0 0 40px rgba(217,70,239,0.04)" : "none",
        }}>
        <input id="file-input" type="file" accept="*/*"
          style={{ display: "none" }}
          onChange={e => setFile(e.target.files[0])} />
        {hasFile ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🎵</div>
            <p style={{ fontWeight: 600, margin: "0 0 4px", color: "#f0eeff", fontSize: 15 }}>
              {file.name}
            </p>
            <p style={{ fontSize: 13, color: "#8b89aa", margin: 0 }}>
              {(file.size / 1024 / 1024).toFixed(1)} MB · Click to change
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 44, marginBottom: 14 }}>🎙️</div>
            <p style={{ fontWeight: 600, margin: "0 0 6px", color: "#f0eeff", fontSize: 16 }}>
              Drop audio or video here
            </p>
            <p style={{ fontSize: 13, color: "#4a4865", margin: 0 }}>
              .mp3 · .wav · .m4a · .mp4 · up to 100 MB
            </p>
          </>
        )}
      </div>

      {error && (
        <div style={{ background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.25)",
          borderRadius: 8, padding: 12, marginBottom: 16,
          fontSize: 13, color: "#f87171" }}>
          ⚠️ {error}
        </div>
      )}

      <button onClick={handlePrepare} disabled={!hasFile}
        style={{ width: "100%", padding: "15px 24px",
          background: hasFile ? G : "#14141f",
          color: hasFile ? "white" : "#2a2a42",
          border: hasFile ? "none" : "1px solid #2a2a42",
          borderRadius: 10, fontSize: 15,
          cursor: hasFile ? "pointer" : "not-allowed", fontWeight: 600,
          boxShadow: hasFile ? "0 0 28px rgba(217,70,239,0.3)" : "none",
          transition: "all 0.2s" }}>
        Analyze Conversation
      </button>

      <p style={{ fontSize: 11, color: "#4a4865", textAlign: "center", marginTop: 12 }}>
        🔒 Audio is deleted immediately after analysis. Only behavioral signals are stored.
      </p>
    </div>
  )
}
