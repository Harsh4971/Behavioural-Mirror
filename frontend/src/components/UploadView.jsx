import { useState } from "react"
import axios from "axios"

const CONTEXTS = [
  { value: "casual", label: "Casual Conversation" },
  { value: "job_interview", label: "Job Interview" },
  { value: "disagreement", label: "Disagreement / Conflict" },
  { value: "presentation", label: "Presentation / Pitch" },
  { value: "meeting", label: "Meeting" },
]

const STAGES = [
  "Transcribing audio...",
  "Identifying speakers...",
  "Extracting behavioral signals...",
  "Generating reflective insights..."
]

export default function UploadView({ onResults }) {
  const [file, setFile] = useState(null)
  const [context, setContext] = useState("casual")
  const [numSpeakers, setNumSpeakers] = useState(2)
  const [loading, setLoading] = useState(false)
  const [stageIndex, setStageIndex] = useState(0)
  const [error, setError] = useState("")

  const handleSubmit = async () => {
    if (!file) return
    setLoading(true)
    setError("")
    setStageIndex(0)

    const interval = setInterval(() => {
      setStageIndex(prev => Math.min(prev + 1, STAGES.length - 1))
    }, 15000)

    try {
      const form = new FormData()
      form.append("audio", file)
      form.append("context", context)
      form.append("num_speakers", numSpeakers)
      form.append("user_id", "default_user")
      form.append("filename", file.name)

      const { data } = await axios.post(
        "http://localhost:8000/api/analyze",
        form,
        { headers: { "Content-Type": "multipart/form-data" }, timeout: 600000 }
      )

      clearInterval(interval)
      onResults(data)
    } catch (e) {
      clearInterval(interval)
      setError(e.response?.data?.detail || "Something went wrong. Check the backend terminal.")
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <p style={{ fontWeight: 500, fontSize: 16 }}>{STAGES[stageIndex]}</p>
      <p style={{ fontSize: 13, color: "#999", marginTop: 8 }}>
        This takes 1–3 minutes depending on audio length
      </p>
      <div style={{ marginTop: 24, background: "#f0f0f0", borderRadius: 8,
        height: 4, overflow: "hidden" }}>
        <div style={{ background: "#111", height: "100%", borderRadius: 8,
          width: `${((stageIndex + 1) / STAGES.length) * 100}%`,
          transition: "width 0.5s ease" }} />
      </div>
    </div>
  )

  return (
    <div>
      {/* File upload area */}
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

      {/* Context selector */}
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

      {/* Speakers selector */}
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

      {/* Error */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5",
          borderRadius: 8, padding: 12, marginBottom: 16,
          fontSize: 13, color: "#991b1b" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Submit */}
      <button onClick={handleSubmit} disabled={!file}
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