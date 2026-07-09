"""Home feed card builders — replaces the old mirror_feed_synthesizer.py LLM
free-form feed. Every function here is a pure function over already-computed
data (evidence, portrait LLM notes, parsed sessions, dismissed keys) — zero new
LLM calls except the how_it_may_land note, which reuses portrait_synthesizer's
existing single LLM round-trip (see PortraitSynthesizer.synthesize).

Card types, per CLAUDE.md's Home = "stream of insight cards" description:
strength, observation (growth_area + observation framings unified), progress,
still_forming, and a zero-LLM session-level observation card. Every card is
self-relative, carries its evidence, and has a stable `card_key` for dismissal.
"""

from pipeline.evidence_gate import SIGNAL_EVIDENCE_CONFIG
from pipeline.portrait_synthesizer import _format_mean

# Shift magnitude below which a change isn't worth surfacing as a progress
# card — same threshold the old /api/trends widget used (main.py's _trend()).
_PROGRESS_SHIFT_THRESHOLD_PCT = 15
# How close to evidence-steady a signal needs to be to show up as "still forming"
# rather than being silently omitted — avoids listing every not-yet-steady signal.
_STILL_FORMING_PROXIMITY = 3
_STILL_FORMING_CAP = 2


def build_strength_cards(evidence: dict, llm_notes_by_signal: dict, dismissed: set) -> list:
    cards = []
    for signal_key, ev in evidence.get("overall", {}).items():
        if not ev.get("is_steady"):
            continue
        llm = llm_notes_by_signal.get(signal_key, {})
        if llm.get("framing") != "strength":
            continue
        card_key = f"strength:{signal_key}"
        if card_key in dismissed:
            continue
        cards.append({
            "type": "strength",
            "card_key": card_key,
            "signal_key": signal_key,
            "label": SIGNAL_EVIDENCE_CONFIG[signal_key]["label"],
            "note": llm.get("note", ""),
            "mean": ev["mean"],
            "sample_count": ev["sample_count"],
        })
    return cards


def build_observation_cards(evidence: dict, llm_notes_by_signal: dict, dismissed: set) -> list:
    """growth_area and observation framings share one card type and one
    dismissal key — dismissing commentary on a signal should hold even if the
    portrait LLM later flips which of the two framings it uses for it."""
    cards = []
    for signal_key, ev in evidence.get("overall", {}).items():
        if not ev.get("is_steady"):
            continue
        llm = llm_notes_by_signal.get(signal_key, {})
        if llm.get("framing") not in ("growth_area", "observation"):
            continue
        card_key = f"observation:{signal_key}"
        if card_key in dismissed:
            continue
        cards.append({
            "type": "observation",
            "card_key": card_key,
            "signal_key": signal_key,
            "label": SIGNAL_EVIDENCE_CONFIG[signal_key]["label"],
            "framing": llm.get("framing"),
            "note": llm.get("note", ""),
            "mean": ev["mean"],
            "sample_count": ev["sample_count"],
        })
    return cards


def build_still_forming_cards(evidence: dict, dismissed: set) -> list:
    candidates = []
    for signal_key, ev in evidence.get("overall", {}).items():
        if ev.get("is_steady"):
            continue
        remaining = ev["min_samples_required"] - ev["sample_count"]
        # remaining <= 0 means the sample floor is already met but the signal is
        # still too variable (high CV) to call steady — that's not "forming",
        # more sessions alone won't fix it. Say nothing rather than mislabel it
        # as approaching-steady forever (CLAUDE.md rule #7: silence is allowed).
        if remaining <= 0 or remaining > _STILL_FORMING_PROXIMITY:
            continue
        card_key = f"still_forming:{signal_key}"
        if card_key in dismissed:
            continue
        candidates.append({
            "type": "still_forming",
            "card_key": card_key,
            "signal_key": signal_key,
            "label": SIGNAL_EVIDENCE_CONFIG[signal_key]["label"],
            "sample_count": ev["sample_count"],
            "min_needed": ev["min_samples_required"],
            "_remaining": remaining,
        })
    candidates.sort(key=lambda c: c["_remaining"])
    for c in candidates:
        del c["_remaining"]
    return candidates[:_STILL_FORMING_CAP]


def build_progress_cards(evidence: dict, dismissed: set) -> list:
    """Scoped to by_context evidence only — recent-vs-established shift is
    only meaningful within a single context (see _compute_profile_evidence's
    compute_shift docstring for the cross-context contamination this avoids)."""
    cards = []
    for context, signals in evidence.get("by_context", {}).items():
        for signal_key, ev in signals.items():
            if not ev.get("is_steady") or ev.get("shift_pct") is None:
                continue
            if abs(ev["shift_pct"]) < _PROGRESS_SHIFT_THRESHOLD_PCT:
                continue
            direction = "up" if ev["shift_pct"] > 0 else "down"
            card_key = f"progress:{signal_key}:{direction}"
            if card_key in dismissed:
                continue
            label = SIGNAL_EVIDENCE_CONFIG[signal_key]["label"]
            cards.append({
                "type": "progress",
                "card_key": card_key,
                "signal_key": signal_key,
                "label": label,
                "context": context,
                "direction": direction,
                "note": (
                    f"Your {label} has shifted from {_format_mean(signal_key, ev['mean'])} "
                    f"to {_format_mean(signal_key, ev['recent_mean'])} over your last few "
                    f"{context.replace('_', ' ')} sessions."
                ),
            })
    return cards


def build_how_it_may_land_cards(portrait_llm: dict, dismissed: set) -> list:
    cards = []
    for entry in portrait_llm.get("how_it_may_land", []):
        signal_key = entry.get("signal_key")
        if not signal_key:
            continue
        card_key = f"how_it_may_land:{signal_key}"
        if card_key in dismissed:
            continue
        cards.append({
            "type": "how_it_may_land",
            "card_key": card_key,
            "signal_key": signal_key,
            "label": SIGNAL_EVIDENCE_CONFIG.get(signal_key, {}).get("label", signal_key),
            "note": entry.get("note", ""),
        })
    return cards


def build_session_observation_card(parsed: list, dismissed: set) -> list:
    """Zero-LLM — surfaces the most recent session's top observation, already
    generated by insight_generator.py. Self-expires: a new session produces a
    new session_id, so this card never needs its own dismissal cleanup."""
    if not parsed:
        return []
    latest = parsed[-1]
    observations = latest["ins"].get("observations", [])
    if not observations:
        return []
    obs = observations[0]
    signal = obs.get("signal", "")
    card_key = f"session_observation:{latest['id']}:{signal}"
    if card_key in dismissed:
        return []
    return [{
        "type": "session_observation",
        "card_key": card_key,
        "session_id": latest["id"],
        "context": latest["context"],
        "date": latest["date"],
        "signal": signal,
        "note": obs.get("observation", ""),
        "resonance_prompt": obs.get("resonance_prompt", ""),
    }]
