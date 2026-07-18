import { useId } from "react"

// Mirror.'s "Dome / Clarity" mark — single source of truth. Meaning, per
// docs/Mirror_Canonical_Vision.md: you can't quite see yourself directly (the
// faint, dashed dome above the line), but the reflection brings you into
// focus (the solid, complete dome below, glowing brighter at its center and
// deepening toward its edges). Every in-app usage should import from here
// rather than duplicating SVG — that drift is exactly what the old bar-graph
// logo suffered (5 independently hand-maintained copies).
//
// The 7 dash coordinates below are exact, individually computed points at
// 22.5° increments around the ghost dome's arc (radius 26.8, center 50,46),
// mirrored around the crown — deliberately not a stroke-dasharray, which
// can't guarantee true bilateral symmetry.
const DASH_COORDS = [
  [24.30, 38.39, 26.45, 33.21],
  [29.17, 29.13, 33.13, 25.17],
  [37.21, 22.45, 42.39, 20.30],
  [47.20, 19.35, 52.80, 19.35],
  [57.61, 20.30, 62.79, 22.45],
  [66.87, 25.17, 70.83, 29.13],
  [73.55, 33.21, 75.70, 38.39],
]

export function DomeMark({
  size = 48,
  dashColor = "#6b6888",
  lineColor = "#8b89aa",
  domeBright = "#a5b4fc",
  domeMid = "#1d4ed8",
  domeDeep = "#1e3a8a",
}) {
  const gradientId = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <defs>
        <radialGradient id={gradientId} cx="50" cy="54" r="27" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={domeBright} />
          <stop offset="55%" stopColor={domeMid} />
          <stop offset="100%" stopColor={domeDeep} />
        </radialGradient>
      </defs>
      <g stroke={dashColor} strokeWidth="4.2" strokeLinecap="round">
        {DASH_COORDS.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <line x1="10" y1="50" x2="90" y2="50" stroke={lineColor} strokeWidth="3.2" />
      <path d="M 23 54 A 27 27 0 0 0 77 54 Z" fill={`url(#${gradientId})`} />
    </svg>
  )
}

export function LogoLockup({ markSize = 26, fontSize = 22, gap = 10 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      <DomeMark size={markSize} />
      <h1 style={{ fontSize, fontWeight: 700, margin: 0, letterSpacing: "-0.3px", color: "#f0eeff" }}>
        mirror<span style={{ color: "#1d4ed8" }}>.</span>
      </h1>
    </div>
  )
}
