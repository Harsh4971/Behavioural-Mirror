// A stable color per observation signal name. The LLM generates free-form
// signal labels (e.g. "topic_transition", "closure") rather than a fixed set,
// so a manual lookup table silently falls back to gray for anything unlisted
// — a hash-based pick from a curated palette instead guarantees every signal
// gets a real, distinguishable color, and the *same* signal always gets the
// *same* color everywhere it appears (Home, the session detail page, etc).
const PALETTE = [
  "#818cf8", "#5b9cf6", "#34d399", "#f59e0b", "#f87171",
  "#fb923c", "#0891b2", "#a3e635", "#22d3ee", "#f472b6",
]

export function signalColor(signal) {
  if (!signal) return "#8b89aa"
  let hash = 0
  for (let i = 0; i < signal.length; i++) {
    hash = (hash * 31 + signal.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
