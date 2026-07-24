import { useState } from "react"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

function MirrorLogo({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id="onb-g" x1="0" y1="0" x2="52" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1d4ed8"/><stop offset="1" stopColor="#0891b2"/>
        </linearGradient>
      </defs>
      <rect x="2"  y="20" width="6"  height="6"  rx="3" fill="url(#onb-g)" opacity=".35"/>
      <rect x="11" y="13" width="6"  height="13" rx="3" fill="url(#onb-g)" opacity=".6"/>
      <rect x="20" y="6"  width="8"  height="20" rx="4" fill="url(#onb-g)"/>
      <rect x="31" y="13" width="6"  height="13" rx="3" fill="url(#onb-g)" opacity=".6"/>
      <rect x="40" y="20" width="6"  height="6"  rx="3" fill="url(#onb-g)" opacity=".35"/>
      <line x1="0" y1="28" x2="52" y2="28" stroke="#1e2438" strokeWidth="1.25"/>
      <rect x="2"  y="29" width="6"  height="6"  rx="3" fill="url(#onb-g)" opacity=".15"/>
      <rect x="11" y="29" width="6"  height="13" rx="3" fill="url(#onb-g)" opacity=".27"/>
      <rect x="20" y="29" width="8"  height="20" rx="4" fill="url(#onb-g)" opacity=".33"/>
      <rect x="31" y="29" width="6"  height="13" rx="3" fill="url(#onb-g)" opacity=".3"/>
      <rect x="40" y="29" width="6"  height="6"  rx="3" fill="url(#onb-g)" opacity=".15"/>
    </svg>
  )
}

function StepConcept() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
        <MirrorLogo />
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
        own patterns. mirror changes that — not by telling you what to say,
        but by reflecting how you actually show up.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          ["How you show up varies",
           "Confident in some rooms, hesitant in others. The mirror maps both."],
          ["Your signals are consistent",
           "Speech pace, filler words, how you listen, when you push — they form a pattern whether you notice it or not."],
          ["Seeing it clearly is rare",
           "Most people only get this from years of therapy or a very honest coach. This is a faster mirror."],
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
  const steps = [
    ["Record a Google Meet call",
     "Hit Start Recording in the side panel when your conversation begins — mirror captures your voice automatically, right there in the room."],
    ["We extract your patterns",
     "Speech pace, confidence signals, how you listen, when you interrupt, how your energy shifts — all mapped to the type of conversation."],
    ["Your portrait builds",
     "Your first profile appears after 3 sessions. After 10, the mirror knows your patterns better than people who've known you for years."],
  ]
  return (
    <div>
      <h1 style={{
        fontSize: 24, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 10px", lineHeight: 1.3, letterSpacing: "-0.3px",
      }}>
        It gets smarter with every session
      </h1>
      <p style={{ fontSize: 14, color: "#6b6888", margin: "0 0 28px", lineHeight: 1.75 }}>
        Each conversation you record teaches the mirror something new about you.
        The first few sessions are setup — after that, it starts talking back.
      </p>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {steps.map(([title, body], i) => (
          <div key={title} style={{ display: "flex", gap: 16, position: "relative",
            paddingBottom: i < steps.length - 1 ? 26 : 0 }}>
            {i < steps.length - 1 && (
              <div style={{ position: "absolute", left: 16, top: 34,
                width: 2, height: "calc(100% - 8px)",
                background: "#1e2438" }} />
            )}
            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
              background: "rgba(29,78,216,0.1)", border: "1px solid rgba(29,78,216,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#5b9cf6", zIndex: 1 }}>
              {i + 1}
            </div>
            <div style={{ paddingTop: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f0eeff", marginBottom: 5 }}>
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

function StepPreview() {
  const reflected = [
    ["#5b9cf6", "pace", "brisk, steady 170 wpm across your sessions"],
    ["#c084fc", "vocabulary richness", "varied — about 66% unique words"],
  ]
  return (
    <div>
      <h1 style={{
        fontSize: 24, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 10px", lineHeight: 1.3, letterSpacing: "-0.3px",
      }}>
        Here's what you'll see
      </h1>
      <p style={{ fontSize: 14, color: "#6b6888", margin: "0 0 18px", lineHeight: 1.75 }}>
        After a few sessions, your portrait starts to look something like this — specific
        to you, not generic advice.
      </p>

      <div style={{
        background: "#151922", border: "1px solid #1e2438", borderRadius: 12,
        padding: "18px 20px", position: "relative",
      }}>
        <div style={{ position: "absolute", top: 12, right: 14, fontSize: 10,
          color: "#3a3a52", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>
          Example
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <MirrorLogo size={16} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>Your Portrait</span>
        </div>

        <p style={{
          fontSize: 13.5, color: "#dcdaf0", fontStyle: "italic", lineHeight: 1.85,
          margin: "0 0 14px",
        }}>
          "You tend to hedge more and speak more carefully in high-stakes reviews, but that
          caution disappears almost entirely in casual conversations — where your pace
          picks up and you build on what others say far more often."
        </p>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
          {["context-sensitive", "measured under pressure", "collaborative when relaxed"].map(tag => (
            <span key={tag} style={{
              fontSize: 10.5, fontWeight: 600, color: "#5b9cf6",
              background: "rgba(91,156,246,0.1)", border: "1px solid rgba(91,156,246,0.3)",
              borderRadius: 9, padding: "3px 10px",
            }}>{tag}</span>
          ))}
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, color: "#4a4865",
          textTransform: "uppercase", letterSpacing: 0.6, margin: "16px 0 8px" }}>
          Already reflected back
        </div>
        {reflected.map(([color, name, body], i) => (
          <div key={name} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "9px 0",
            borderTop: i > 0 ? "1px solid #131722" : "none",
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: color }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "#f0eeff", flexShrink: 0 }}>{name}</div>
            <div style={{ color: "#3a3a52", flexShrink: 0 }}>·</div>
            <div style={{ fontSize: 11.5, color: "#5a5878", lineHeight: 1.4 }}>{body}</div>
          </div>
        ))}

        <div style={{
          marginTop: 16, padding: "12px 14px", background: "#131722",
          border: "1px dashed #1e2438", borderRadius: 8, display: "flex", gap: 12,
        }}>
          <div style={{ fontSize: 13, color: "#4a4865", flexShrink: 0 }}>?</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4865",
              textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>
              What the mirror can't see yet
            </div>
            <div style={{ fontSize: 12, color: "#3a3a52", lineHeight: 1.6 }}>
              You haven't recorded an evaluative conversation yet — some patterns only
              show up in high-stakes settings.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepTrust() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12,
          background: "rgba(29,78,216,0.1)", border: "1px solid rgba(29,78,216,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
          🔒
        </div>
      </div>
      <h1 style={{
        fontSize: 24, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 10px", lineHeight: 1.3, textAlign: "center", letterSpacing: "-0.3px",
      }}>
        What happens to your recording
      </h1>
      <p style={{ fontSize: 14, color: "#6b6888", margin: "0 0 24px", lineHeight: 1.75, textAlign: "center" }}>
        Two things are true every single time, no exceptions.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          ["Deleted the instant it's processed",
           "Your audio is analyzed and permanently deleted the moment that finishes — never stored, never replayed, never shared with anyone, including us."],
          ["We remember you. No one else.",
           "Only your own patterns are kept. Anyone else on the call is never profiled, never stored, never analyzed individually — the mirror reflects you, not the room."],
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

const STEPS = [StepConcept, StepHow, StepPreview, StepTrust]

export default function OnboardingView({ onDone }) {
  const [step, setStep] = useState(0)
  const StepComponent = STEPS[step]

  function finish() {
    // Persisting the "done" flag (scoped to the signed-in account) is
    // App.jsx's job — it's the one that knows which user is currently
    // signed in, this component doesn't need to.
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
