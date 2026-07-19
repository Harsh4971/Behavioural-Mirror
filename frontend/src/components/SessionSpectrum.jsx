import { useState, useEffect } from "react"
import api from "../lib/api"
import Reveal from "./Reveal"

const GROUPS = [
  {
    title: "Delivery",
    sub: "pace & pauses — how it came out",
    composites: ["speech_style", "vocal_arousal"],
  },
  {
    title: "Relational Dynamics",
    sub: "how you engaged the room",
    composites: ["rapport", "power_balance", "turn_taking_courtesy"],
  },
  {
    title: "Communication Effectiveness",
    sub: "",
    composites: ["fluency", "responsive_engagement"],
  },
]

// Maps a continuous composite_z onto a 0–100 track position for the visual
// marker only — never printed as a number. z=0 sits at the midpoint; ±1.5
// reaches the track's ends. Purely illustrative, no claim of precision.
function zToPct(z) {
  const clamped = Math.max(-1.5, Math.min(1.5, z))
  return 50 + (clamped / 1.5) * 40
}

const STATUS_COLOR = {
  "more than usual": "#5b9cf6",
  "less than usual": "#7dd3c0",
  "about your usual": "#8b89aa",
}

function SpectrumRow({ composite }) {
  const [expanded, setExpanded] = useState(false)

  if (!composite.is_steady) {
    return (
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e2438" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "baseline", marginBottom: 9 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#8b89aa" }}>
            {composite.label}
          </span>
          <span style={{ fontSize: 11.5, color: "#4a4865", fontStyle: "italic" }}>
            still forming
          </span>
        </div>
        <div style={{ position: "relative", height: 5,
          background: "repeating-linear-gradient(90deg, #1e2438 0 6px, transparent 6px 11px)",
          borderRadius: 3 }} />
      </div>
    )
  }

  const pct = zToPct(composite.composite_z)
  const color = STATUS_COLOR[composite.position] || "#5b9cf6"

  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e2438",
      cursor: "pointer" }}
      onClick={() => setExpanded(v => !v)}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "baseline", marginBottom: 9 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#f0eeff" }}>
          {composite.label}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 500, color }}>
          {composite.position}
        </span>
      </div>
      <div style={{ position: "relative", height: 20 }}>
        <div style={{ position: "absolute", top: 8, left: 0, right: 0, height: 5,
          background: "#1e2438", borderRadius: 3 }} />
        <div style={{ position: "absolute", top: 2, width: 15, height: 15,
          borderRadius: "50%", background: color, border: "2.5px solid #0a0c12",
          left: `${pct}%`, transform: "translateX(-50%)",
          boxShadow: `0 0 0 3px ${color}30` }} />
      </div>

      {expanded && (
        <div style={{ marginTop: 12, padding: "12px 14px", background: "#131827",
          border: "1px solid #1e2438", borderRadius: 9, fontSize: 12.5,
          color: "#8b89aa", lineHeight: 1.7 }}>
          {composite.components.filter(c => c.usable).map(c => (
            <div key={c.signal} style={{ marginBottom: 4 }}>
              <span style={{ color: "#f0eeff" }}>{c.signal.replace(/_/g, " ")}</span>
              {": today "}{typeof c.today_value === "number" ? c.today_value.toFixed(2) : c.today_value}
              {", your usual "}{c.historical_mean?.toFixed(2)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SessionSpectrum({ sessionId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    api.get(`/api/sessions/${sessionId}/spectrum`)
      .then(res => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) return (
    <div style={{ textAlign: "center", padding: 32, color: "#4a4865", fontSize: 13 }}>
      Loading spectrum…
    </div>
  )

  if (error || !data) return (
    <div style={{ textAlign: "center", padding: 32, color: "#4a4865", fontSize: 13 }}>
      Could not load Session Spectrum for this session.
    </div>
  )

  return (
    <Reveal>
      <p style={{ fontSize: 13, color: "#8b89aa", marginBottom: 20, lineHeight: 1.65,
        maxWidth: "62ch" }}>
        Every mark below shows where <strong style={{ color: "#f0eeff" }}>this conversation</strong> fell
        against <strong style={{ color: "#f0eeff" }}>your own</strong> usual range — never a grade, never
        a comparison to anyone else. Signals need a handful of sessions before a range exists; until then
        you'll see <em>still forming</em>.
      </p>

      {GROUPS.map(group => (
        <div key={group.title} style={{ marginBottom: 22 }}>
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff" }}>{group.title}</span>
            {group.sub && (
              <span style={{ fontSize: 11, color: "#4a4865", marginLeft: 8 }}>{group.sub}</span>
            )}
          </div>
          <div style={{ border: "1px solid #1e2438", borderRadius: 12,
            background: "#151922", overflow: "hidden" }}>
            {group.composites.map(key => (
              <SpectrumRow key={key} composite={data.composites[key]} />
            ))}
          </div>
        </div>
      ))}
    </Reveal>
  )
}
