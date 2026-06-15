import { useState, useRef } from "react"
import api from "../lib/api"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"
const MIN_SECONDS = 20
const MAX_SECONDS = 60

const ROUND_CONFIG = [
  {
    type: "scripted",
    badge: "Calm baseline",
    description: "Read each sentence aloud at a comfortable, natural pace.",
    tip: "Speak clearly — this establishes your baseline voice sample.",
    content: [
      "I usually start my mornings by checking my messages and planning what I need to get done.",
      "In meetings, I try to listen carefully before sharing my perspective on the topic.",
      "One thing I've noticed about myself is that I tend to think through problems out loud.",
      "I find it easier to explain complex ideas when I break them down step by step.",
      "At the end of the day, I like to reflect on what went well and what I could improve.",
    ],
  },
  {
    type: "freeform",
    badge: "Natural conversation",
    description: "Talk freely about the prompt below. No script — just speak as you normally would.",
    tip: "Pretend you're catching up with a friend. Natural pace, natural words.",
    content: "Tell me about something you did or experienced recently — a conversation, a meeting, a trip, or just something that happened. Explain it as you'd tell a friend, with as much detail as you like.",
  },
  {
    type: "expressive",
    badge: "Expressive speech",
    description: "Share a genuine opinion or give advice. Let your natural energy come through.",
    tip: "This captures your voice when engaged or passionate — the most important style for accurate recognition.",
    content: "Talk about something you strongly believe in, disagree with, or find exciting. It could be advice you'd give someone, an opinion you hold, or a recommendation. Don't hold back — speak the way you do when you actually care about what you're saying.",
  },
]

export default function EnrollView({ onEnrolled, onSkip }) {
  const [state, setState] = useState("idle")
  const [round, setRound] = useState(1)
  const [blobs, setBlobs] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState("")

  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const roundConfig = ROUND_CONFIG[round - 1]

  const startRecording = async () => {
    setError("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRef.current = { recorder, stream }
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timerRef.current)
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        setBlobs(prev => [...prev, blob])
        setState("round_done")
      }
      recorder.start()
      setState("recording")
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          if (prev + 1 >= MAX_SECONDS) { stopRecording(); return MAX_SECONDS }
          return prev + 1
        })
      }, 1000)
    } catch {
      setError("Microphone access denied. Please allow microphone access and try again.")
    }
  }

  const stopRecording = () => {
    const { recorder } = mediaRef.current || {}
    if (recorder && recorder.state !== "inactive") recorder.stop()
    clearInterval(timerRef.current)
  }

  const continueToNext = () => { setRound(r => r + 1); setElapsed(0); setState("idle") }

  const submitAll = async (allBlobs) => {
    setState("uploading")
    try {
      const form = new FormData()
      allBlobs.forEach((blob, i) => form.append(`audio${i + 1}`, blob, `enrollment_${i + 1}.webm`))
      await api.post("/api/enroll", form, { headers: { "Content-Type": "multipart/form-data" } })
      setState("complete")
    } catch (e) {
      setError(e.response?.data?.detail || "Enrollment failed. Please try again.")
      setState("idle"); setRound(1); setBlobs([])
    }
  }

  const handleRoundDone = () => round < 3 ? continueToNext() : submitAll(blobs)

  if (state === "complete") {
    return (
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "#f0eeff" }}>
          Voice enrolled
        </h2>
        <p style={{ color: "#8b89aa", fontSize: 14, margin: "0 0 32px", lineHeight: 1.6 }}>
          We recorded 3 rounds of your voice to build a robust voiceprint.<br />
          You'll now be automatically recognized in future conversations.
        </p>
        <button onClick={onEnrolled}
          style={{ padding: "12px 40px", background: G, color: "white",
            border: "none", borderRadius: 8, fontSize: 15, cursor: "pointer",
            fontWeight: 600, boxShadow: "0 0 24px rgba(29,78,216,0.3)" }}>
          Continue to app
        </button>
      </div>
    )
  }

  const progressPct = Math.min((elapsed / MAX_SECONDS) * 100, 100)
  const canStop = elapsed >= MIN_SECONDS

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "48px 24px" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
            Train your voice
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={onSkip} disabled={state === "recording"}
              style={{ background: "none", border: "none", cursor: state === "recording" ? "not-allowed" : "pointer",
                fontSize: 12, color: "#4a4865", padding: 0, textDecoration: "underline" }}>
              Skip
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3].map(r => (
                <div key={r} style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: r < round ? G : r === round ? "rgba(29,78,216,0.35)" : "#1e2438",
                  boxShadow: r <= round ? "0 0 6px rgba(29,78,216,0.35)" : "none",
                  transition: "all 0.3s",
                }} />
              ))}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 14, color: "#8b89aa", margin: 0, lineHeight: 1.65 }}>
          Round <strong style={{ color: "#f0eeff" }}>{round} of 3</strong> — {roundConfig.description}
        </p>
      </div>

      {/* Round content */}
      <div style={{ background: "#151922", borderRadius: 12, padding: 20,
        marginBottom: 14, border: "1px solid #1e2438" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8b89aa",
            textTransform: "uppercase", letterSpacing: 0.5 }}>
            Round {round}
          </span>
          <span style={{ fontSize: 11, background: "rgba(29,78,216,0.1)",
            color: "#5b9cf6", border: "1px solid rgba(29,78,216,0.25)",
            borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
            {roundConfig.badge}
          </span>
        </div>

        {roundConfig.type === "scripted" ? (
          roundConfig.content.map((sentence, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10,
              alignItems: "flex-start" }}>
              <span style={{ fontSize: 12, color: "#4a4865", fontWeight: 600,
                minWidth: 16, paddingTop: 2 }}>{i + 1}</span>
              <p style={{ margin: 0, fontSize: 14, color: "#8b89aa", lineHeight: 1.6 }}>
                {sentence}
              </p>
            </div>
          ))
        ) : (
          <p style={{ margin: "0 0 4px", fontSize: 14, color: "#8b89aa", lineHeight: 1.7,
            background: "#131827", border: "1px solid #1e2438", borderRadius: 8,
            padding: "12px 14px" }}>
            {roundConfig.content}
          </p>
        )}

        <p style={{ fontSize: 12, color: "#4a4865", margin: "14px 0 0" }}>{roundConfig.tip}</p>
      </div>

      {/* Recording area */}
      <div style={{ background: "#151922", borderRadius: 14, padding: 28,
        marginBottom: 18, textAlign: "center", border: "1px solid #1e2438" }}>

        {state === "idle" && (
          <>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🎤</div>
            <p style={{ fontSize: 13, color: "#8b89aa", margin: 0, lineHeight: 1.6 }}>
              Click <strong style={{ color: "#5b9cf6" }}>Start recording</strong>,
              then read the sentences above clearly.
            </p>
          </>
        )}

        {state === "recording" && (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔴</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#f0eeff",
              fontVariantNumeric: "tabular-nums" }}>
              {elapsed}s
            </div>
            <div style={{ height: 5, background: "#1e2438", borderRadius: 3,
              margin: "14px 0 10px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: canStop ? "#34d399" : G,
                boxShadow: canStop ? "0 0 8px rgba(52,211,153,0.5)"
                  : "0 0 8px rgba(29,78,216,0.4)",
                width: `${progressPct}%`,
                transition: "width 0.8s linear, background 0.4s",
              }} />
            </div>
            <p style={{ fontSize: 12, margin: 0, fontWeight: canStop ? 600 : 400,
              color: canStop ? "#34d399" : "#8b89aa" }}>
              {canStop ? "✓ You can stop now"
                : `Keep speaking… ${MIN_SECONDS - elapsed}s more minimum`}
            </p>
          </>
        )}

        {state === "round_done" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#f0eeff", margin: "0 0 4px" }}>
              Round {round} done!
            </p>
            <p style={{ fontSize: 13, color: "#8b89aa", margin: 0 }}>
              {round < 3
                ? `${3 - round} more round${3 - round > 1 ? "s" : ""} to go.`
                : "All 3 rounds complete — submitting your voiceprint…"}
            </p>
          </>
        )}

        {state === "uploading" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⏳</div>
            <p style={{ color: "#8b89aa", fontSize: 14, margin: 0 }}>
              Processing all 3 rounds…
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

      {state === "idle" && (
        <button onClick={startRecording}
          style={{ width: "100%", padding: "13px 24px", background: G,
            color: "white", border: "none", borderRadius: 8, fontSize: 15,
            cursor: "pointer", fontWeight: 600, marginBottom: 10,
            boxShadow: "0 0 24px rgba(29,78,216,0.3)" }}>
          Start recording
        </button>
      )}

      {state === "recording" && (
        <button onClick={stopRecording} disabled={!canStop}
          style={{ width: "100%", padding: "13px 24px",
            background: canStop ? G : "#151922",
            color: canStop ? "white" : "#1e2438",
            border: canStop ? "none" : "1px solid #1e2438",
            borderRadius: 8, fontSize: 15,
            cursor: canStop ? "pointer" : "not-allowed",
            fontWeight: 600, marginBottom: 10,
            boxShadow: canStop ? "0 0 24px rgba(29,78,216,0.3)" : "none",
            transition: "all 0.3s" }}>
          {canStop ? `Stop — save round ${round}` : `Stop (${MIN_SECONDS - elapsed}s left)`}
        </button>
      )}

      {state === "round_done" && (
        <button onClick={handleRoundDone}
          style={{ width: "100%", padding: "13px 24px", background: G,
            color: "white", border: "none", borderRadius: 8, fontSize: 15,
            cursor: "pointer", fontWeight: 600, marginBottom: 10,
            boxShadow: "0 0 24px rgba(29,78,216,0.3)" }}>
          {round < 3 ? `Continue to Round ${round + 1} →` : "Submit voice enrollment"}
        </button>
      )}

      {(state === "idle" || state === "recording") && (
        <button onClick={onSkip} disabled={state === "recording"}
          style={{ width: "100%", padding: "10px 24px", background: "none",
            color: state === "recording" ? "#1e2438" : "#4a4865",
            border: "none", fontSize: 13,
            cursor: state === "recording" ? "not-allowed" : "pointer" }}>
          Skip for now — analysis will still work, speaker detection may be less accurate
        </button>
      )}
    </div>
  )
}
