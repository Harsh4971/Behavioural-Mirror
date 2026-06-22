import { useState } from "react"
import api from "../lib/api"

const CATEGORIES = [
  { value: "bug",     label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "quality", label: "Something feels off" },
  { value: "general", label: "General feedback" },
]

export default function FeedbackModal({ onClose }) {
  const [category, setCategory] = useState("general")
  const [message,  setMessage]  = useState("")
  const [status,   setStatus]   = useState("idle") // idle | sending | sent | error

  const handleSubmit = async () => {
    if (!message.trim()) return
    setStatus("sending")
    try {
      await api.post("/api/feedback", { category, message: message.trim() })
      setStatus("sent")
    } catch {
      setStatus("error")
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.85)",
      zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#151922",
        border: "1px solid #1e2438",
        borderRadius: 16,
        width: "90%", maxWidth: 440,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "20px 24px 0",
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#f0eeff" }}>
            Send feedback
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 20, color: "#4a4d6a", lineHeight: 1,
            }}
          >×</button>
        </div>

        {status === "sent" ? (
          /* Success state */
          <div style={{ padding: "32px 24px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#f0eeff", marginBottom: 8 }}>
              Thanks for the feedback
            </div>
            <p style={{ fontSize: 13, color: "#8b89aa", lineHeight: 1.6, margin: "0 0 20px" }}>
              We read every submission and use it to shape what gets built next.
            </p>
            <button
              onClick={onClose}
              style={{
                background: "linear-gradient(135deg,#1d4ed8,#0891b2)",
                border: "none", borderRadius: 8,
                padding: "9px 24px", fontSize: 13, fontWeight: 600,
                color: "#fff", cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          /* Form */
          <div style={{ padding: "20px 24px 24px" }}>

            {/* Category */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, color: "#8b89aa", marginBottom: 6 }}>
                Category
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0d1220",
                  border: "1px solid #1e2438",
                  borderRadius: 8,
                  padding: "9px 12px",
                  fontSize: 13,
                  color: "#f0eeff",
                  cursor: "pointer",
                  outline: "none",
                  fontFamily: "inherit",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%234a4d6a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 12px center",
                }}
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Message */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "#8b89aa", marginBottom: 6 }}>
                Message
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Tell us what's on your mind…"
                rows={5}
                style={{
                  width: "100%",
                  background: "#0d1220",
                  border: "1px solid #1e2438",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  color: "#f0eeff",
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "inherit",
                  lineHeight: 1.6,
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Error */}
            {status === "error" && (
              <p style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>
                Something went wrong — please try again.
              </p>
            )}

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "1px solid #1e2438",
                  borderRadius: 8,
                  padding: "9px 18px",
                  fontSize: 13,
                  color: "#8b89aa",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || status === "sending"}
                style={{
                  background: !message.trim() || status === "sending"
                    ? "#1a2035"
                    : "linear-gradient(135deg,#1d4ed8,#0891b2)",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: !message.trim() || status === "sending" ? "#4a4d6a" : "#fff",
                  cursor: !message.trim() || status === "sending" ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {status === "sending" ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
