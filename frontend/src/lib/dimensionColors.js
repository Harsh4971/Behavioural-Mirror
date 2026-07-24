// Fixed color per dimension — shared between the You page (Reflected Back,
// Context Shift, Coaching cards) and the Home feed's dimension-event cards,
// so a dimension's color is consistent everywhere it appears in the app.
export const SIGNAL_COLORS = {
  talk_ratio: "#818cf8", curiosity: "#34d399", pace: "#5b9cf6", response_latency: "#f59e0b",
  hedging: "#a78bfa", directness: "#f472b6", conversational_drive: "#fb7185",
  building_on_others: "#2dd4bf", turn_taking_assertiveness: "#22d3ee", pacing_arc: "#38bdf8",
  vocal_expressiveness: "#e879f9", energy_arc: "#f97316", turn_length: "#94a3b8",
  vocabulary_richness: "#c084fc", fillers: "#71717a",
}

export function dimensionColor(key) {
  return SIGNAL_COLORS[key] || "#8b89aa"
}
