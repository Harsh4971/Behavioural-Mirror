import { useState, useEffect } from "react"
import api from "../lib/api"
import Reveal, { RevealItem } from "./Reveal"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

// Mirrors ProfileView's FRAMING_CONFIG — growth_area/observation framings of a
// steady signal render with this palette; other card types get their own fixed
// color below. Kept as a separate copy rather than a shared import since the
// two views are deliberately allowed to diverge visually over time.
const FRAMING_CONFIG = {
  strength:    { color: "#34d399", label: "Strength" },
  growth_area: { color: "#fb923c", label: "Growth area" },
  observation: { color: "#818cf8", label: "Observation" },
}

const TYPE_CONFIG = {
  strength:            { color: "#34d399", label: "Strength" },
  how_it_may_land:     { color: "#22d3ee", label: "How it may land" },
  progress:            { color: "#5b9cf6", label: "Progress" },
  still_forming:       { color: "#6b6888", label: "Still forming" },
  session_observation: { color: "#818cf8", label: "From your last session" },
}

function cardVisual(card) {
  if (card.type === "observation") {
    return FRAMING_CONFIG[card.framing] || FRAMING_CONFIG.observation
  }
  return TYPE_CONFIG[card.type] || { color: "#8b89aa", label: card.type }
}

function DismissButton({ onDismiss }) {
  return (
    <button onClick={onDismiss} aria-label="Dismiss this card"
      style={{ background: "none", border: "none", cursor: "pointer",
        color: "#4a4865", fontSize: 16, lineHeight: 1, padding: "2px 4px",
        marginLeft: 8, flexShrink: 0 }}>
      ×
    </button>
  )
}

function HomeCard({ card, i, onDismiss }) {
  const cfg = cardVisual(card)
  const title = card.type === "session_observation"
    ? (card.signal || "").replace(/_/g, " ") || cfg.label
    : (card.label || cfg.label)

  return (
    <RevealItem index={i}>
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: `3px solid ${cfg.color}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff", textTransform: "capitalize" }}>
            {title}
          </span>
          <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600,
            background: `${cfg.color}15`, border: `1px solid ${cfg.color}30`,
            borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>
            {cfg.label}{card.type === "progress" && (card.direction === "up" ? " ↑" : " ↓")}
          </span>
        </div>
        <DismissButton onDismiss={() => onDismiss(card.card_key)} />
      </div>

      {card.note && (
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {card.note}
        </p>
      )}

      {card.type === "still_forming" && (
        <div style={{ marginTop: 4 }}>
          <div style={{ height: 3, background: "#1e2438", borderRadius: 2 }}>
            <div style={{ height: "100%", borderRadius: 2,
              width: `${Math.min(100, Math.round((card.sample_count / card.min_needed) * 100))}%`,
              background: "#3a3a52" }} />
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#4a4865" }}>
            {card.sample_count} of {card.min_needed} sessions
          </p>
        </div>
      )}

      {(card.type === "strength" || card.type === "observation") && card.sample_count != null && (
        <p style={{ margin: 0, fontSize: 11, color: "#4a4865" }}>
          Based on {card.sample_count} sessions
        </p>
      )}

      {card.type === "progress" && card.context && (
        <p style={{ margin: 0, fontSize: 11, color: "#4a4865" }}>
          In your {card.context.replace(/_/g, " ")} conversations
        </p>
      )}

      {card.type === "session_observation" && card.resonance_prompt && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b6888",
          fontStyle: "italic", lineHeight: 1.5 }}>
          💭 {card.resonance_prompt}
        </p>
      )}
    </div>
    </RevealItem>
  )
}

export default function HomeView({ active }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!active) return
    setLoading(true)
    api.get("/api/home")
      .then(res => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [active])

  const handleDismiss = (cardKey) => {
    // Optimistic — remove immediately, persist in the background, silent on
    // failure (same pattern as ResultsView's resonance voting: a dismiss is a
    // low-stakes preference, not something worth blocking or retrying on).
    setData(d => d ? { ...d, cards: d.cards.filter(c => c.card_key !== cardKey) } : d)
    const form = new FormData()
    form.append("card_key", cardKey)
    api.post("/api/home/dismiss", form).catch(() => {})
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#4a4865" }}>
      Loading your mirror…
    </div>
  )

  if (!data || data.insufficient_data) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "#f0eeff" }}>
          Your mirror is waiting
        </h2>
        <p style={{ fontSize: 14, color: "#8b89aa", margin: 0, lineHeight: 1.6 }}>
          Record your first Google Meet call to start building your feed.
        </p>
      </div>
    )
  }

  const cards = data.cards || []

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Reveal>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#f0eeff" }}>
          Home
        </h2>
        <span style={{ fontSize: 12, color: "#4a4865" }}>
          {data.session_count} session{data.session_count > 1 ? "s" : ""}
        </span>
      </div>
      </Reveal>

      {cards.length === 0 ? (
        <Reveal delay={80}>
        <p style={{ fontSize: 13, color: "#4a4d6a", margin: 0, lineHeight: 1.7 }}>
          Nothing new to reflect back yet — keep recording, and your feed will start
          filling in as patterns become clear.
        </p>
        </Reveal>
      ) : (
        <Reveal delay={80}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cards.map((card, i) => (
            <HomeCard key={card.card_key} card={card} i={i} onDismiss={handleDismiss} />
          ))}
        </div>
        </Reveal>
      )}
    </div>
  )
}
