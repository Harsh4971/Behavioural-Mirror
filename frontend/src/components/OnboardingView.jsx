import { useState } from "react"

const G = "linear-gradient(135deg, #d946ef 0%, #f97316 100%)"

const MOCK_DIMENSIONS = [
  { name: "Confidence",           score: 68, label: "Assured"   },
  { name: "Listening Quality",    score: 81, label: "Attentive" },
  { name: "Composure",            score: 54, label: "Steady"    },
]

function MockDimBar({ name, score, label }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#f0eeff" }}>{name}</span>
          <span style={{ fontSize: 11, color: "#4a4865" }}>{label}</span>
        </div>
        <span style={{ fontSize: 14, fontWeight: 700,
          background: G, WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          {score}
        </span>
      </div>
      <div style={{ height: 4, background: "#2a2a42", borderRadius: 2 }}>
        <div style={{ height: "100%", borderRadius: 2,
          width: `${score}%`, background: G }} />
      </div>
    </div>
  )
}

function StepConcept() {
  return (
    <div>
      <div style={{ fontSize: 44, textAlign: "center", marginBottom: 18 }}>🪞</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 14px", lineHeight: 1.25, textAlign: "center",
        letterSpacing: "-0.4px" }}>
        Your conversations reveal<br />who you are
      </h1>
      <p style={{ fontSize: 14, color: "#8b89aa", lineHeight: 1.8,
        margin: "0 0 28px", textAlign: "center" }}>
        Most people go through hundreds of conversations without ever seeing their
        own patterns. Behavioural Mirror changes that — not by telling you what to
        say, but by reflecting how you actually show up.
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
          <div key={title} style={{ display: "flex", gap: 14, padding: "14px 16px",
            background: "#14141f", border: "1px solid #2a2a42", borderRadius: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: G, marginTop: 5 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff",
                marginBottom: 4 }}>{title}</div>
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
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 10px", lineHeight: 1.3, letterSpacing: "-0.3px" }}>
        It gets smarter with every session
      </h1>
      <p style={{ fontSize: 14, color: "#6b6888", margin: "0 0 30px", lineHeight: 1.75 }}>
        Each conversation you upload teaches the mirror something new about you.
        The first three sessions are setup — after that, it starts talking back.
      </p>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {[
          {
            num: "1",
            title: "Upload a conversation",
            body: "Any recording works — a meeting, a call, a catch-up. What you talked about doesn't matter. How you showed up does.",
          },
          {
            num: "2",
            title: "We extract your patterns",
            body: "Speech pace, confidence signals, how you listen, when you interrupt, how your energy shifts — all mapped to the type of conversation.",
          },
          {
            num: "3",
            title: "Your portrait builds",
            body: "Your first profile appears after 3 sessions. After 10, the mirror knows your patterns better than people who've known you for years.",
          },
        ].map(({ num, title, body }, i, arr) => (
          <div key={num} style={{ display: "flex", gap: 16, position: "relative" }}>
            {i < arr.length - 1 && (
              <div style={{ position: "absolute", left: 16, top: 38,
                width: 2, height: "calc(100% - 12px)",
                background: "#2a2a42", zIndex: 0 }} />
            )}
            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
              background: "rgba(217,70,239,0.1)",
              border: "1px solid rgba(217,70,239,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#e879f9", zIndex: 1 }}>
              {num}
            </div>
            <div style={{ paddingBottom: i < arr.length - 1 ? 26 : 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f0eeff",
                marginBottom: 5, marginTop: 6 }}>{title}</div>
              <div style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.65 }}>{body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepPreview() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f0eeff",
        margin: "0 0 10px", lineHeight: 1.3, letterSpacing: "-0.3px" }}>
        Here's what you'll see
      </h1>
      <p style={{ fontSize: 14, color: "#6b6888", margin: "0 0 18px", lineHeight: 1.75 }}>
        After a few sessions, your profile looks something like this — specific to you,
        not generic advice.
      </p>

      <div style={{ background: "#14141f", border: "1px solid #2a2a42",
        borderRadius: 12, padding: "18px 20px", position: "relative" }}>
        <div style={{ position: "absolute", top: 12, right: 14, fontSize: 10,
          color: "#3a3a52", textTransform: "uppercase", letterSpacing: 0.6,
          fontWeight: 600 }}>
          Example
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>🪞</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff" }}>The Mirror</span>
        </div>

        <p style={{ fontSize: 13, color: "#c4c2d8", lineHeight: 1.85,
          margin: "0 0 18px", borderLeft: "2px solid rgba(217,70,239,0.35)",
          paddingLeft: 12 }}>
          You lead conversations confidently in collaborative settings, but pull back
          noticeably when you're being assessed. Your listening quality is consistently
          high — you rarely interrupt and give others room to finish. Under pressure,
          your filler rate climbs, suggesting tension you don't always show outwardly.
        </p>

        <div>
          {MOCK_DIMENSIONS.map(d => <MockDimBar key={d.name} {...d} />)}
        </div>

        <div style={{ marginTop: 14, padding: "12px 14px",
          background: "#0e0e1a", border: "1px dashed #2a2a42", borderRadius: 8,
          display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ fontSize: 13, color: "#4a4865", flexShrink: 0 }}>?</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4865",
              textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>
              What the mirror can't see yet
            </div>
            <div style={{ fontSize: 12, color: "#3a3a52", lineHeight: 1.6 }}>
              You've never uploaded an evaluative conversation. Your confidence score
              only reflects low-stakes settings so far.
            </div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "#4a4865", margin: "12px 0 0",
        textAlign: "center", lineHeight: 1.6 }}>
        The more sessions you add, the sharper and more specific it gets.
      </p>
    </div>
  )
}

const STEPS = [StepConcept, StepHow, StepPreview]

export default function OnboardingView({ onDone }) {
  const [step, setStep] = useState(0)
  const StepComponent = STEPS[step]

  function finish() {
    localStorage.setItem("bm_onboarding_v1", "1")
    onDone()
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: "32px 24px", background: "#09090f" }}>
      <div style={{ maxWidth: 500, width: "100%" }}>

        {/* Step indicators */}
        <div style={{ display: "flex", justifyContent: "center",
          gap: 8, marginBottom: 44 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              height: 6, borderRadius: 3,
              width: i === step ? 24 : 8,
              background: i <= step
                ? G
                : "#2a2a42",
              transition: "all 0.3s ease",
            }} />
          ))}
        </div>

        <StepComponent />

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginTop: 40 }}>
          <button onClick={finish}
            style={{ background: "none", border: "none", cursor: "pointer",
              fontSize: 13, color: "#3a3a52", padding: 0 }}>
            Skip
          </button>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: "#6b6888", padding: 0, marginLeft: "auto",
                marginRight: 20 }}>
              ← Back
            </button>
          )}
          <button
            onClick={step < STEPS.length - 1 ? () => setStep(s => s + 1) : finish}
            style={{ padding: "12px 28px", background: G, color: "white",
              border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer",
              fontWeight: 600, boxShadow: "0 0 24px rgba(217,70,239,0.25)" }}>
            {step < STEPS.length - 1 ? "Next →" : "Get started →"}
          </button>
        </div>

      </div>
    </div>
  )
}
