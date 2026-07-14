import { useState, useEffect } from "react"
import api from "../lib/api"
import Reveal, { RevealItem } from "./Reveal"

// Visual identity per trigger type — independent of the (not-yet-built) per-
// dimension color palette on the You page; this is scoped to what Home's
// dimension-event cards need: a quick visual read on WHAT KIND of thing
// happened (a first discovery vs. a shift vs. something to just note), not
// WHICH of the 15 dimensions it is.
const TRIGGER_CONFIG = {
  first_time_steady: { color: "#34d399", label: "New pattern" },
  context_shift:      { color: "#22d3ee", label: "Context shift" },
  drift:              { color: "#f59e0b", label: "Shifted" },
  recurring:          { color: "#a78bfa", label: "Recurring" },
  anomaly:            { color: "#fb7185", label: "Worth noting" },
}

function recurringLabel(direction) {
  return direction === "back_to_usual" ? "Back to usual" : "New pattern"
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

function CardShell({ color, title, badge, faded, onDismiss, children }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: `3px solid ${color}`,
      opacity: faded ? 0.45 : 1,
      transition: "opacity 0.3s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f0eeff", textTransform: "capitalize" }}>
            {title}
          </span>
          {badge && (
            <span style={{ fontSize: 11, color, fontWeight: 600,
              background: `${color}15`, border: `1px solid ${color}30`,
              borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>
              {badge}
            </span>
          )}
        </div>
        <DismissButton onDismiss={onDismiss} />
      </div>
      {children}
    </div>
  )
}

function SessionRecapCard({ card, faded, onDismiss }) {
  const dateLabel = card.date ? new Date(card.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""
  return (
    <CardShell color="#818cf8" title="Session recap"
      badge={[card.context?.replace(/_/g, " "), dateLabel].filter(Boolean).join(" · ")}
      faded={faded} onDismiss={onDismiss}>
      {card.conversation_summary && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {card.conversation_summary}
        </p>
      )}

      {card.observations?.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: card.coaching_suggestions?.length ? 10 : 0 }}>
          {card.observations.map((obs, i) => (
            <div key={i}>
              <p style={{ margin: 0, fontSize: 13, color: "#c4c2d8", lineHeight: 1.6 }}>
                {obs.observation}
              </p>
              {obs.resonance_prompt && (
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b6888", fontStyle: "italic", lineHeight: 1.5 }}>
                  💭 {obs.resonance_prompt}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {card.coaching_suggestions?.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          {card.coaching_suggestions.map((s, i) => (
            <p key={i} style={{ margin: 0, fontSize: 12, color: "#8b89aa", lineHeight: 1.55 }}>
              <span style={{ color: "#a5a3c2", fontWeight: 600 }}>{s.area}: </span>
              {s.suggestion}
            </p>
          ))}
        </div>
      )}

      {card.notable_pattern && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#4a4865", lineHeight: 1.5, borderTop: "1px solid #1e2438", paddingTop: 8 }}>
          {card.notable_pattern}
        </p>
      )}
    </CardShell>
  )
}

function DimensionEventCard({ card, faded, onDismiss }) {
  const trig = TRIGGER_CONFIG[card.trigger_type] || { color: "#8b89aa", label: card.trigger_type }
  const badge = card.trigger_type === "recurring" ? recurringLabel(card.direction) : trig.label
  return (
    <CardShell color={trig.color} title={card.label} badge={badge} faded={faded} onDismiss={onDismiss}>
      {card.note && (
        <p style={{ margin: 0, fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {card.note}
        </p>
      )}
    </CardShell>
  )
}

function HomeCard({ card, i, faded, onDismiss }) {
  const dismiss = () => onDismiss(card.card_key)
  return (
    <RevealItem index={i}>
      {card.type === "dimension_event"
        ? <DimensionEventCard card={card} faded={faded} onDismiss={dismiss} />
        : <SessionRecapCard card={card} faded={faded} onDismiss={dismiss} />}
    </RevealItem>
  )
}

const VISIBLE_COUNT = 7

export default function HomeView({ active }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!active) return
    setLoading(true)
    setExpanded(false)
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
  // Backend returns the complete, newest-first, dismissed-filtered list —
  // pagination is purely a frontend rendering concern: 7 visible + an 8th
  // shown faded as a teaser, "Show more" reveals the rest uncapped.
  const hasOverflow = cards.length > VISIBLE_COUNT
  const visibleCards = expanded ? cards : cards.slice(0, VISIBLE_COUNT + 1)

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
          {visibleCards.map((card, i) => (
            <HomeCard key={card.card_key} card={card} i={i}
              faded={!expanded && hasOverflow && i === VISIBLE_COUNT}
              onDismiss={handleDismiss} />
          ))}
          {!expanded && hasOverflow && (
            <button onClick={() => setExpanded(true)}
              style={{ alignSelf: "center", marginTop: 4, background: "none",
                border: "none", cursor: "pointer", color: "#7c8fd6",
                fontSize: 13, fontWeight: 600, padding: "8px 0" }}>
              Show more
            </button>
          )}
        </div>
        </Reveal>
      )}
    </div>
  )
}
