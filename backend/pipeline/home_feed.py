"""Home feed card builders — v2: a single interleaved timeline of two card
sources, replacing the earlier v1 (5 static per-signal card types built fresh
from evidence on every read, no event history, no triggers).

  - Session recap cards: one unconditional card per session, dated to that
    session, built straight from insight_generator's existing output — zero
    new LLM cost.
  - Dimension event cards: one card per row in `dimension_events` (written by
    pipeline/trigger_detector.py at finalize time) — frozen content, dated to
    the session that triggered them, so they interleave genuinely by date
    alongside recap cards rather than always sorting as "now".

Both card types share the existing `dismissed_cards` dismissal mechanism.
`build_how_it_may_land_cards` is kept (not currently called from /api/home)
pending its future home on the You page's "how it may land" section.
"""

from pipeline.evidence_gate import SIGNAL_EVIDENCE_CONFIG


def build_session_recap_cards(parsed: list, dismissed: set) -> list:
    """One card per session, unconditional. Uses insight_generator's
    conversation_summary in full, plus exactly ONE observation (the LLM's own
    first-ranked one) and its matched tip — the other observations/tips and
    notable_pattern live on the full session detail page instead (View full
    session), not duplicated here. See history_session_detail_redesign memory
    doc for why: the old version showed all 3 observations + all 3 coaching
    tips + notable_pattern in one card, which was too much for a feed card and
    fully redundant with the detail page underneath it."""
    cards = []
    for p in parsed:
        card_key = f"session_recap:{p['id']}"
        if card_key in dismissed:
            continue
        ins = p.get("ins") or {}
        observations = ins.get("observations") or []
        top_observation = observations[0] if observations else None
        suggestions = ins.get("coaching_suggestions") or []
        tip = None
        if top_observation:
            tip = next(
                (s["suggestion"] for s in suggestions if s.get("dimension_key") == top_observation.get("signal")),
                None,
            )
        cards.append({
            "type": "session_recap",
            "card_key": card_key,
            "session_id": p["id"],
            "context": p["context"],
            "date": p["date"],
            "conversation_summary": ins.get("conversation_summary", ""),
            "observation": top_observation,
            "tip": tip,
        })
    return cards


def build_dimension_event_cards(events: list, dismissed: set) -> list:
    """`events` = rows fetched from the `dimension_events` table by main.py.
    Content is frozen at fire-time (card_copy_json) — never regenerated here,
    even if the underlying evidence has since shifted again (a new event
    fires separately instead)."""
    import json

    cards = []
    for e in events:
        card_key = f"dimension_event:{e['id']}"
        if card_key in dismissed:
            continue
        try:
            copy = json.loads(e["card_copy_json"])
        except (KeyError, TypeError, ValueError):
            copy = {}
        cards.append({
            "type": "dimension_event",
            "card_key": card_key,
            "dimension_key": e["dimension_key"],
            "scope": e["scope"],
            "trigger_type": e["trigger_type"],
            "direction": e.get("direction"),
            "session_id": e["session_id"],
            "date": e["created_at"],
            "label": copy.get("label", SIGNAL_EVIDENCE_CONFIG.get(e["dimension_key"], {}).get("label", e["dimension_key"])),
            "note": copy.get("note", ""),
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
