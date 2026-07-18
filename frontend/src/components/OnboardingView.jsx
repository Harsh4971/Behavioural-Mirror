import { useState } from "react"
import { DomeMark } from "./Logo"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

function StepConcept() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
        <DomeMark size={48} />
      </div>
      <h1 style={{
        fontSize: 26, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 14px", lineHeight: 1.25, textAlign: "center",
        letterSpacing: "-0.4px",
      }}>
        Your conversations reveal<br />who you are
      </h1>
      <p style={{
        fontSize: 14, color: "#8b89aa", lineHeight: 1.8,
        margin: "0 0 28px", textAlign: "center",
      }}>
        Most people go through hundreds of conversations without ever seeing their
        own patterns. mirror. changes that — not by telling you what to say,
        but by reflecting how you actually show up.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          ["A behavioral portrait, built from your voice",
           "Speech pace, listening quality, confidence signals, filler words — mapped across every conversation you have."],
          ["Patterns that span multiple sessions",
           "The mirror notices what you can't — how you shift between contexts, what consistently holds you back, what's quietly improving."],
          ["Specific to you, not generic advice",
           "No templates. No benchmarks against strangers. Just an honest reflection of how you communicate, growing sharper over time."],
        ].map(([title, body]) => (
          <div key={title} style={{
            display: "flex", gap: 14, padding: "14px 16px",
            background: "#151922", border: "1px solid #1e2438", borderRadius: 10,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: G, marginTop: 5,
            }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff", marginBottom: 4 }}>
                {title}
              </div>
              <div style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.65 }}>{body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepHow() {
  return (
    <div>
      <h1 style={{
        fontSize: 24, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 10px", lineHeight: 1.3, letterSpacing: "-0.3px",
      }}>
        Two ways to feed the mirror
      </h1>
      <p style={{ fontSize: 14, color: "#6b6888", margin: "0 0 24px", lineHeight: 1.75 }}>
        Every session you add teaches it something new. Start with whatever you have.
      </p>

      {/* Path 1 — Google Meet */}
      <div style={{
        padding: "18px 18px", background: "#151922",
        border: "1px solid rgba(29,78,216,0.3)", borderRadius: 12, marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: "rgba(29,78,216,0.12)", border: "1px solid rgba(29,78,216,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>
            🎙️
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f0eeff" }}>
              Record a Google Meet
            </div>
            <div style={{ fontSize: 11, color: "#5b9cf6", fontWeight: 500 }}>
              Live — during the call
            </div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.65, margin: 0 }}>
          When you're on a Google Meet, the mirror panel detects the call and shows a
          "Start Recording" button. Hit it when the conversation begins — Mirror captures
          your audio automatically and processes it in real time as the call runs.
        </p>
      </div>

      {/* Path 2 — Upload */}
      <div style={{
        padding: "18px 18px", background: "#151922",
        border: "1px solid #1e2438", borderRadius: 12, marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: "rgba(8,145,178,0.1)", border: "1px solid rgba(8,145,178,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>
            📁
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f0eeff" }}>
              Upload a recording
            </div>
            <div style={{ fontSize: 11, color: "#0891b2", fontWeight: 500 }}>
              Any conversation · Any platform
            </div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.65, margin: 0 }}>
          Have a Zoom recording, a voice memo, or a phone call saved? Upload it from
          the Upload tab. Mirror works with any audio or video file — it extracts your
          voice, analyzes the conversation, and adds it to your profile.
        </p>
      </div>

      <div style={{
        padding: "10px 14px", background: "rgba(29,78,216,0.05)",
        border: "1px solid rgba(29,78,216,0.12)", borderRadius: 8,
        fontSize: 12, color: "#4a4865", lineHeight: 1.65,
      }}>
        Your audio is deleted immediately after analysis. Only the behavioral insights
        are stored — never the recording itself.
      </div>
    </div>
  )
}

const STEPS = [StepConcept, StepHow]

export default function OnboardingView({ onDone }) {
  const [step, setStep] = useState(0)
  const StepComponent = STEPS[step]

  function finish() {
    localStorage.setItem("bm_onboarding_v1", "1")
    onDone()
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: "32px 24px", background: "#0f1117",
    }}>
      <div style={{ maxWidth: 480, width: "100%" }}>

        {/* Step indicators */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 44 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              height: 5, borderRadius: 3,
              width: i === step ? 28 : 8,
              background: i <= step ? G : "#1e2438",
              transition: "all 0.3s ease",
            }} />
          ))}
        </div>

        <StepComponent />

        {/* Navigation */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", marginTop: 40,
        }}>
          <button onClick={finish} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 13, color: "#3a3a52", padding: 0,
          }}>
            Skip
          </button>

          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 13, color: "#6b6888", padding: 0,
              marginLeft: "auto", marginRight: 20,
            }}>
              ← Back
            </button>
          )}

          <button
            onClick={step < STEPS.length - 1 ? () => setStep(s => s + 1) : finish}
            style={{
              padding: "12px 28px", background: G, color: "white",
              border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer",
              fontWeight: 600, boxShadow: "0 0 24px rgba(29,78,216,0.25)",
            }}
          >
            {step < STEPS.length - 1 ? "Next →" : "Open the mirror →"}
          </button>
        </div>

      </div>
    </div>
  )
}
