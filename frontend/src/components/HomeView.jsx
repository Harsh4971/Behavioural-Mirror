import { useState, useEffect } from "react"
import api from "../lib/api"
import Reveal, { RevealItem } from "./Reveal"
import { signalColor } from "../lib/signalColor"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

// Matches ProfileView.jsx's SectionLabel exactly, for the same "eyebrow above
// a subheading" pattern used across You/History — Home didn't have one yet.
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 1.4,
      textTransform: "uppercase", marginBottom: 4,
      background: G, WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent", backgroundClip: "text",
    }}>
      {children}
    </div>
  )
}

// Visual identity per trigger type — independent of the (not-yet-built) per-
// dimension color palette on the You page; this is scoped to what Home's
// dimension-event cards need: a quick visual read on WHAT KIND of thing
// happened (a first discovery vs. a shift vs. something to just note), not
// WHICH of the 15 dimensions it is.
// icon is a fixed glyph per trigger type — it marks WHAT KIND of event this
// is and never changes. Direction (below) is a separate, dynamic ↑/↓ suffix
// only added when the backend has a real measured direction for this event.
const TRIGGER_CONFIG = {
  first_time_steady: { color: "#f59e0b", label: "New pattern", icon: "●" },
  context_shift:      { color: "#22d3ee", label: "Context shift", icon: "↕" },
  drift:              { color: "#34d399", label: "Shifted", icon: "↗" },
  recurring:          { color: "#a78bfa", label: "Recurring", icon: "↻" },
  anomaly:            { color: "#fb7185", label: "Worth noting", icon: "✦" },
}

function recurringLabel(direction) {
  return direction === "back_to_usual" ? "Back to usual" : "New pattern"
}

// The ONLY values that ever mean a real up/down movement are the literal
// strings "up"/"down" — every other trigger type's `direction` field means
// something else entirely (recurring's is a state name, categorical
// anomaly's is "contradicts_established"), so this can't misfire on them.
function directionArrow(direction) {
  if (direction === "up") return "↑"
  if (direction === "down") return "↓"
  return ""
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

// Dims a hex color's RGB channels — used so the icon GLYPH itself sits a
// notch below the badge pill's full-saturation color, rather than competing
// with it at the same brightness.
function darken(hex, amount) {
  const num = parseInt(hex.slice(1), 16)
  const r = Math.round(((num >> 16) & 0xff) * (1 - amount))
  const g = Math.round(((num >> 8) & 0xff) * (1 - amount))
  const b = Math.round((num & 0xff) * (1 - amount))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

function IconBadge({ icon, color }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
      background: `${color}18`, border: `1px solid ${color}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12.6, color: darken(color, 0.15), marginTop: 1,
    }}>
      {icon}
    </div>
  )
}

// `icon` is optional — only DimensionEventCard passes one. SessionRecapCard
// never does, so it keeps its current left-border-only look, untouched.
function CardShell({ color, icon, title, badge, faded, onDismiss, children }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "#151922", border: "1px solid #1e2438",
      borderLeft: icon ? "1px solid #1e2438" : `3px solid ${color}`,
      opacity: faded ? 0.45 : 1,
      transition: "opacity 0.3s ease",
      display: "flex", gap: 12,
    }}>
      {icon && <IconBadge icon={icon} color={color} />}
      <div style={{ flex: 1, minWidth: 0 }}>
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
    </div>
  )
}

function SessionRecapCard({ card, faded, onDismiss, onOpenSession }) {
  const dateLabel = card.date ? new Date(card.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""
  const obs = card.observation

  return (
    <CardShell color="#818cf8" title="Session recap"
      badge={[card.context?.replace(/_/g, " "), dateLabel].filter(Boolean).join(" · ")}
      faded={faded} onDismiss={onDismiss}>
      {card.conversation_summary && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {card.conversation_summary}
        </p>
      )}

      {/* Exactly one observation, backend-ranked — the other two + their tips
          (and the resonance vote) live on the full session detail page */}
      {obs && (
        <div style={{ marginBottom: card.tip ? 10 : 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: signalColor(obs.signal),
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
            {obs.signal.replace(/_/g, " ")}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#c4c2d8", lineHeight: 1.6 }}>
            {obs.observation}
          </p>

          {obs.resonance_prompt && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b6888", fontStyle: "italic", lineHeight: 1.5 }}>
              💭 {obs.resonance_prompt}
            </p>
          )}
        </div>
      )}

      {card.tip && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#8b89aa", lineHeight: 1.55 }}>
          💡 {card.tip}
        </p>
      )}

      <button onClick={() => onOpenSession(card.session_id)}
        style={{ background: "none", border: "none", cursor: "pointer",
          color: "#5b9cf6", fontSize: 12, fontWeight: 500, padding: 0,
          marginTop: 2 }}>
        View full session →
      </button>
    </CardShell>
  )
}

function DimensionEventCard({ card, faded, onDismiss }) {
  const trig = TRIGGER_CONFIG[card.trigger_type] || { color: "#8b89aa", label: card.trigger_type, icon: "●" }
  const baseLabel = card.trigger_type === "recurring" ? recurringLabel(card.direction) : trig.label
  const arrow = card.trigger_type === "recurring" ? "" : directionArrow(card.direction)
  const badge = arrow ? `${baseLabel} ${arrow}` : baseLabel
  return (
    <CardShell color={trig.color} icon={trig.icon} title={card.label} badge={badge} faded={faded} onDismiss={onDismiss}>
      {card.note && (
        <p style={{ margin: 0, fontSize: 13, color: "#c4c2d8", lineHeight: 1.65 }}>
          {card.note}
        </p>
      )}
    </CardShell>
  )
}

// A real DimensionEventCard rendered with fabricated content, shown only in
// the empty state so a brand-new user sees what their feed becomes instead
// of just reading about it. `onDismiss` is a no-op — there's no real card
// behind this to persist a dismissal for.
function ExampleCard() {
  const sampleCard = {
    label: "Curiosity",
    trigger_type: "first_time_steady",
    direction: null,
    note: "You asked more follow-up questions than usual across your last two calls — steady enough now to call it a pattern.",
  }
  return (
    <div style={{ position: "relative" }}>
      <span style={{
        position: "absolute", top: -9, left: 14, zIndex: 1,
        fontSize: 9.5, fontWeight: 700, letterSpacing: 1,
        textTransform: "uppercase", color: "#0d0f16",
        background: "#8b89aa", borderRadius: 20, padding: "2px 8px",
      }}>
        Example
      </span>
      <DimensionEventCard card={sampleCard} faded={false} onDismiss={() => {}} />
    </div>
  )
}

function HomeCard({ card, i, faded, onDismiss, onOpenSession }) {
  const dismiss = () => onDismiss(card.card_key)
  return (
    <RevealItem index={i}>
      {card.type === "dimension_event"
        ? <DimensionEventCard card={card} faded={faded} onDismiss={dismiss} />
        : <SessionRecapCard card={card} faded={faded} onDismiss={dismiss} onOpenSession={onOpenSession} />}
    </RevealItem>
  )
}

const VISIBLE_COUNT = 7

export default function HomeView({ active, onOpenSession }) {
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
      <div style={{ textAlign: "center", padding: "60px 20px 20px" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "#f0eeff" }}>
          Your mirror is waiting
        </h2>
        <p style={{ fontSize: 14, color: "#8b89aa", margin: "0 0 24px", lineHeight: 1.6 }}>
          Record your first Google Meet call to start building your feed.
        </p>
        <a href="https://meet.google.com/" target="_blank" rel="noreferrer"
          style={{ display: "inline-block", padding: "12px 28px", background: G,
            color: "white", border: "none", borderRadius: 8, fontSize: 14,
            fontWeight: 600, textDecoration: "none",
            boxShadow: "0 0 24px rgba(29,78,216,0.25)" }}>
          Open Google Meet →
        </a>

        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
          textTransform: "uppercase", color: "#4a4865", margin: "48px 0 12px" }}>
          What a card looks like
        </p>
        <div style={{ textAlign: "left", maxWidth: 420, margin: "0 auto" }}>
          <ExampleCard />
        </div>
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
        <SectionLabel>Your Feed</SectionLabel>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px", color: "#f0eeff" }}>
          Mirror Feed
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
              onDismiss={handleDismiss} onOpenSession={onOpenSession} />
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
