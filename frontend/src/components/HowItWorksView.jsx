import Reveal, { RevealItem } from "./Reveal"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

const FEATURES = [
  {
    icon: "🎤",
    color: "#5b9cf6",
    title: "Real Conversation Analysis",
    body: "We read what was actually said, not just extracted numbers. The AI identifies missed questions, interrupted thoughts, and moments you talked past each other.",
  },
  {
    icon: "🔄",
    color: "#34d399",
    title: "Mirror Feed",
    body: "Patterns that only emerge across multiple sessions. After a few conversations, the mirror starts noticing what you consistently do — and don't do.",
  },
  {
    icon: "🎯",
    color: "#f59e0b",
    title: "Context-Aware Insights",
    body: "An interview is not a casual chat. We detect the type of conversation automatically and calibrate what good looks like for that specific setting.",
  },
  {
    icon: "📊",
    color: "#818cf8",
    title: "Your Behavioral Shape",
    body: "Five dimensions tracked across all your sessions — Confidence, Assertiveness, Listening Quality, Composure, and Clarity — shown as a radar you can watch shift.",
  },
  {
    icon: "🎙️",
    color: "#fb923c",
    title: "Voice Recognition",
    body: "Enroll your voice once. We identify which speaker is you across all future sessions automatically — no manual tagging needed.",
  },
  {
    icon: "🔒",
    color: "#5b9cf6",
    title: "Privacy by Design",
    body: "Your audio is processed and discarded. Transcripts are analyzed and never stored. Only your behavioral patterns are kept — never your actual words.",
  },
]

const CONTEXT_TYPES = [
  { label: "Interview & Review · High Stakes", desc: "Job interviews, performance reviews, presentations" },
  { label: "Conflict & Friction",              desc: "Disagreements, pushback, difficult conversations" },
  { label: "Collaborative",                    desc: "Team meetings, brainstorming, joint problem-solving" },
  { label: "Persuading & Pitching",            desc: "Sales calls, pitches, convincing others" },
  { label: "Negotiation",                      desc: "Deals, salary discussions, competing interests" },
  { label: "Coaching & Feedback",              desc: "Mentoring, giving criticism, guiding others" },
  { label: "Supportive Listening",             desc: "Emotional support, being there for someone" },
  { label: "Deep Personal",                    desc: "Vulnerable, emotionally open conversations" },
  { label: "Casual & Low-Stakes",              desc: "Everyday chat, catching up, informal exchanges" },
]

function Section({ label, title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 64 }}>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 700, color: "#5b9cf6",
          textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10,
          textAlign: "center" }}>
          {label}
        </div>
      )}
      {title && (
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "#f0eeff",
          margin: "0 0 10px", letterSpacing: "-0.5px", textAlign: "center",
          lineHeight: 1.25 }}>
          {title}
        </h2>
      )}
      {subtitle && (
        <p style={{ fontSize: 14, color: "#6b6888", textAlign: "center",
          margin: "0 0 32px", lineHeight: 1.75, maxWidth: 520, marginInline: "auto" }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  )
}

export default function HowItWorksView({ onBack }) {
  return (
    <div style={{ paddingBottom: 80 }} className="view-enter">

      {/* Back */}
      <button onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#4a4865", fontSize: 13, padding: 0, marginBottom: 40,
          display: "flex", alignItems: "center", gap: 5 }}>
        ← Back
      </button>

      {/* ── Hero ── */}
      <Reveal>
      <div style={{ textAlign: "center", marginBottom: 72 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <defs>
              <linearGradient id="hiw-g" x1="0" y1="0" x2="52" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1d4ed8"/><stop offset="1" stopColor="#0891b2"/>
              </linearGradient>
            </defs>
            <rect x="2"  y="20" width="6"  height="6"  rx="3" fill="url(#hiw-g)" opacity=".35"/>
            <rect x="11" y="13" width="6"  height="13" rx="3" fill="url(#hiw-g)" opacity=".6"/>
            <rect x="20" y="6"  width="8"  height="20" rx="4" fill="url(#hiw-g)"/>
            <rect x="31" y="13" width="6"  height="13" rx="3" fill="url(#hiw-g)" opacity=".6"/>
            <rect x="40" y="20" width="6"  height="6"  rx="3" fill="url(#hiw-g)" opacity=".35"/>
            <line x1="0" y1="28" x2="52" y2="28" stroke="#1e2438" strokeWidth="1.25"/>
            <rect x="2"  y="29" width="6"  height="6"  rx="3" fill="url(#hiw-g)" opacity=".15"/>
            <rect x="11" y="29" width="6"  height="13" rx="3" fill="url(#hiw-g)" opacity=".27"/>
            <rect x="20" y="29" width="8"  height="20" rx="4" fill="url(#hiw-g)" opacity=".33"/>
            <rect x="31" y="29" width="6"  height="13" rx="3" fill="url(#hiw-g)" opacity=".27"/>
            <rect x="40" y="29" width="6"  height="6"  rx="3" fill="url(#hiw-g)" opacity=".15"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 6px",
          letterSpacing: "-0.7px", lineHeight: 1.2, color: "#f0eeff" }}>
          Your conversations,
        </h1>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 20px",
          letterSpacing: "-0.7px", lineHeight: 1.2,
          background: G, WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          reflected back.
        </h1>
        <p style={{ fontSize: 14, color: "#6b6888", lineHeight: 1.85,
          maxWidth: 460, margin: "0 auto" }}>
          Most people go through hundreds of conversations without ever seeing their
          own patterns. mirror changes that — not by telling you what to say,
          but by showing you how you actually show up.
        </p>
      </div>
      </Reveal>

      {/* ── The Problem ── */}
      <Reveal>
      <Section label="The Problem" title="You can't see yourself clearly in the moment.">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            <>In every conversation you're focused on what to say next. Nobody tells you that you interrupted four times, spoke for 70% of the conversation, or always go quiet when you're challenged.</>,
            <><span style={{ color: "#c4c2d8", fontWeight: 600 }}>Good coaches cost hundreds per hour.</span> Therapy takes years. Most feedback from the people around you is filtered through politeness or filtered out entirely.</>,
            <><span style={{ color: "#c4c2d8", fontWeight: 600 }}>That's why mirror exists.</span> Upload a recording and we show you exactly what's happening — not what you think is happening.</>,
          ].map((text, i) => (
            <p key={i} style={{ margin: 0, fontSize: 14, color: "#8b89aa",
              lineHeight: 1.85, textAlign: "center", maxWidth: 540, marginInline: "auto" }}>
              {text}
            </p>
          ))}
        </div>
      </Section>
      </Reveal>

      {/* ── How It Works ── */}
      <Reveal>
      <Section label="How It Works" title="It gets smarter with every session.">
        <div style={{ display: "flex", flexDirection: "column",
          maxWidth: 520, margin: "0 auto" }}>
          {[
            {
              num: "1",
              title: "Upload a recording",
              body: "Any conversation — a meeting, a call, a catch-up. 2 to 20 minutes. Hindi or English. What you talked about doesn't matter. How you showed up does.",
            },
            {
              num: "2",
              title: "AI reads what was actually said",
              body: "Not just numbers — the actual conversation. We find what you missed, what you repeated, how you listened, and where you lost the thread.",
            },
            {
              num: "3",
              title: "Your profile builds over time",
              body: "One session gives immediate feedback. Three sessions reveals patterns. Ten sessions and the mirror knows your behavioral tendencies better than most people who know you.",
            },
          ].map(({ num, title, body }, i, arr) => (
            <div key={num} style={{ display: "flex", gap: 20, position: "relative",
              paddingBottom: i < arr.length - 1 ? 34 : 0 }}>
              {i < arr.length - 1 && (
                <div style={{ position: "absolute", left: 17, top: 42,
                  width: 2, height: "calc(100% - 14px)",
                  background: "linear-gradient(to bottom, rgba(29,78,216,0.25), transparent)" }} />
              )}
              <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: "rgba(29,78,216,0.1)", border: "1.5px solid rgba(29,78,216,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700, color: "#5b9cf6", zIndex: 1 }}>
                {num}
              </div>
              <div style={{ paddingTop: 5 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f0eeff",
                  marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.7 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      </Reveal>

      {/* ── Features Grid ── */}
      <Reveal>
      <Section label="What You Get" title="Everything the mirror sees."
        subtitle="Each session adds signal. Here's what we track and what it builds into.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {FEATURES.map(({ icon, color, title, body }, idx) => (
            <RevealItem key={title} index={idx}>
            <div className="card"
              style={{ background: "#151922",
              border: "1px solid #1e2438", borderRadius: 14, padding: "20px 18px" }}>
              <div style={{ width: 42, height: 42, borderRadius: 11,
                background: `${color}12`, border: `1px solid ${color}28`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, marginBottom: 14 }}>
                {icon}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff",
                marginBottom: 7, lineHeight: 1.35 }}>
                {title}
              </div>
              <div style={{ fontSize: 12, color: "#6b6888", lineHeight: 1.65 }}>
                {body}
              </div>
            </div>
            </RevealItem>
          ))}
        </div>
      </Section>
      </Reveal>

      {/* ── Context Types ── */}
      <Reveal>
      <Section label="Context Types" title="Every setting is different."
        subtitle="We automatically detect what kind of conversation you had and adjust the feedback. The more types you record in, the fuller the picture.">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {CONTEXT_TYPES.map(({ label, desc }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "11px 16px",
              background: "#151922", border: "1px solid #1e2438", borderRadius: 10,
              gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#c4c2d8",
                flexShrink: 0 }}>
                {label}
              </span>
              <span style={{ fontSize: 12, color: "#4a4865", textAlign: "right" }}>
                {desc}
              </span>
            </div>
          ))}
        </div>
      </Section>
      </Reveal>

      {/* ── Privacy ── */}
      <Reveal>
      <div style={{ background: "#151922", border: "1px solid #1e2438",
        borderRadius: 14, padding: "28px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 14 }}>🔒</div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: "#f0eeff",
          margin: "0 0 10px" }}>
          Privacy by design
        </h3>
        <p style={{ fontSize: 13, color: "#6b6888", lineHeight: 1.8, margin: 0,
          maxWidth: 420, marginInline: "auto" }}>
          Your audio is processed and immediately discarded. Transcripts are analyzed
          and never stored. The only thing we keep is a behavioral summary —
          never your actual words.
        </p>
      </div>
      </Reveal>

    </div>
  )
}
