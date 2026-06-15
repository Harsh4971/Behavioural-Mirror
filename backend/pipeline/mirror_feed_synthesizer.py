import json
from groq import Groq

VALID_TYPES = {"pattern", "context_contrast", "trend_up", "trend_down"}


class MirrorFeedSynthesizer:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def synthesize(self, sessions: list, user_summary: str = None,
                   existing_feed: list = None) -> list:
        """
        sessions: list of dicts with keys:
          context, date, fingerprint (str), notable_pattern (str)
        user_summary: consolidated behavioral summary (present after 12+ sessions)
        existing_feed: previously surfaced feed items — passed as context so the
          feed grows and evolves rather than resetting on every new session.
        Returns list of mirror feed insight dicts, empty if < 2 usable sessions.
        """
        usable = [
            s for s in sessions
            if s.get("fingerprint") or s.get("notable_pattern")
        ]
        if not user_summary and len(usable) < 2:
            return []

        prompt = (
            self._build_consolidated_prompt(user_summary, usable, existing_feed or [])
            if user_summary
            else self._build_prompt(usable, existing_feed or [])
        )
        try:
            response = self.client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=1800,
            )
            return self._parse(response.choices[0].message.content)
        except Exception:
            return []

    def _build_consolidated_prompt(self, user_summary: str, recent_sessions: list,
                                   existing_feed: list) -> str:
        recent_block = ""
        if recent_sessions:
            recent_block = "\nMOST RECENT SESSIONS:\n"
            for s in recent_sessions:
                content = (s.get("fingerprint") or s.get("notable_pattern") or "").strip()
                ctx = s["context"].replace("_", " ")
                if content:
                    recent_block += f"  {s['date']} ({ctx}): {content}\n"

        existing_block = self._format_existing_feed(existing_feed)

        return f"""You are maintaining a growing behavioral feed for a person with an established behavioral history.
This feed updates every time new sessions come in — items accumulate and evolve over time, like a living log.

CONSOLIDATED BEHAVIORAL PROFILE (built from all past sessions):
{user_summary}
{recent_block}{existing_block}
BEHAVIORAL THEME CLUSTERS — each feed item must come from a DIFFERENT cluster:

CLUSTER A — Space & Listening: talk ratio, giving vs. taking space, interruptions, monologues, whether they acknowledge what was said before responding
CLUSTER B — Clarity & Expression: how they structure arguments, use of examples/analogies, language precision (hedging vs. confident assertion), how they explain complex ideas
CLUSTER C — Perspective & Thinking Style: contrarian vs. conventional views, reframing questions, big-picture vs. detail orientation, whether they introduce new angles or only react to what's raised
CLUSTER D — Conversation Navigation: who drives topics, tone shifts (lightening or deepening), how they transition between ideas, whether they redirect or follow
CLUSTER E — Handling Challenge: response to pushback or disagreement, whether they change position, how they handle questions they don't want to answer
CLUSTER F — Curiosity & Questions: quality of questions asked, whether they follow up out of genuine interest, what their questions reveal about how they engage
CLUSTER G — Self-Awareness & Adaptability: catching themselves mid-thought, acknowledging uncertainty, adapting when the other person seems confused or unconvinced
CLUSTER H — Warmth & Relational Signals: humor, validation of the other person, emotional calibration, how they establish or maintain connection
CLUSTER I — Trend over time: how behavior in recent sessions compares to earlier ones (only if clear change exists)
CLUSTER J — Context contrast: how behavior differs meaningfully between different types of conversations (only if 2+ contexts with clear difference)

THEME CLUSTER RULE: No two items may come from the same cluster. If you find yourself writing two items that are both about, say, talk ratio and dominance (both Cluster A), merge them into one and find a different cluster for the second slot. A feed covering 5 different clusters is far more valuable than one that restates the same pattern 5 ways.

TASK: Output the COMPLETE updated feed — existing items (kept or evolved) PLUS any new ones.

RULES FOR EXISTING ITEMS:
1. Keep an item if the behavior it describes is still true — carry it forward unchanged
2. Evolve an item if the behavior has changed — update the text to reflect the shift (e.g. "this was consistent early on, but recent sessions show improvement")
3. Retire an item ONLY if the behavior has clearly reversed — drop it from the output entirely
4. Reference previous observations naturally in evolved items ("as noted before…", "this pattern continues…")

RULES FOR NEW ITEMS:
5. Add 1–2 new items ONLY if a genuinely different pattern has emerged that isn't covered by existing items
6. Do not add new items just to pad the feed — a focused feed beats filler
7. Max 8 items total in the output

GENERAL RULES:
8. Ground every insight in what the behavioral profile actually shows — no generic observations
9. Write directly to the person ("you", "your")
10. Be specific and honest
11. Output valid JSON only — no markdown, no code fences

Output a JSON array (all existing + any new items):
[
  {{
    "type": "pattern",
    "text": "2-3 sentences. Specific observation grounded in the behavioral history.",
    "tip": "One sentence. A concrete, actionable thing to try.",
    "signal": "short_unique_slug — keep the same slug as before for existing items"
  }}
]

type must be exactly one of: "pattern", "context_contrast", "trend_up", "trend_down"
- "pattern" — behavior consistent across the history
- "context_contrast" — clear difference in behavior between contexts
- "trend_up" — something that has improved over time or in recent sessions
- "trend_down" — something that has declined or worsened"""

    def _build_prompt(self, sessions: list, existing_feed: list) -> str:
        n = len(sessions)

        if n <= 3:
            depth_note = (
                "you have limited data — keep observations tentative. "
                "Describe what you have noticed so far, not established patterns."
            )
        elif n <= 7:
            depth_note = "patterns are beginning to emerge. Describe them with moderate confidence."
        else:
            depth_note = (
                "you have enough data to describe established behavioral tendencies "
                "with confidence."
            )

        ctx_map: dict = {}
        for s in sessions:
            ctx_map.setdefault(s["context"], []).append(s)

        n_contexts = len(ctx_map)

        blocks = []
        for ctx, ctx_sessions in ctx_map.items():
            label = ctx.replace("_", " ").title()
            block = f"{label} ({len(ctx_sessions)} session{'s' if len(ctx_sessions) > 1 else ''}):\n"
            for s in ctx_sessions:
                content = (s.get("fingerprint") or s.get("notable_pattern") or "").strip()
                if content:
                    block += f"  {s['date']}: {content}\n"
            blocks.append(block)

        context_diff_line = (
            f"- How their behavior differs between the {n_contexts} contexts they have recorded in\n"
            if n_contexts >= 2 else ""
        )

        existing_block = self._format_existing_feed(existing_feed)

        return f"""You are maintaining a growing behavioral feed across {n} conversations recorded by the same person.
This feed updates every time new sessions come in — items accumulate and evolve over time, like a living log.

SESSIONS BY CONTEXT:
{''.join(blocks)}
{existing_block}
With {n} sessions, {depth_note}

BEHAVIORAL THEME CLUSTERS — each feed item must come from a DIFFERENT cluster:

CLUSTER A — Space & Listening: talk ratio, giving vs. taking space, interruptions, monologues, whether they acknowledge what was said before responding
CLUSTER B — Clarity & Expression: how they structure arguments, use of examples/analogies, language precision (hedging vs. confident assertion), how they explain complex ideas
CLUSTER C — Perspective & Thinking Style: contrarian vs. conventional views, reframing questions, big-picture vs. detail orientation, whether they introduce new angles or only react to what's raised
CLUSTER D — Conversation Navigation: who drives topics, tone shifts (lightening or deepening), how they transition between ideas, whether they redirect or follow
CLUSTER E — Handling Challenge: response to pushback or disagreement, whether they change position, how they handle questions they don't want to answer
CLUSTER F — Curiosity & Questions: quality of questions asked, whether they follow up out of genuine interest, what their questions reveal about how they engage
CLUSTER G — Self-Awareness & Adaptability: catching themselves mid-thought, acknowledging uncertainty, adapting when the other person seems confused or unconvinced
CLUSTER H — Warmth & Relational Signals: humor, validation of the other person, emotional calibration, how they establish or maintain connection
{context_diff_line}CLUSTER I — Trend over time: how behavior in recent sessions compares to earlier ones (only if clear change)
CLUSTER J — Context contrast: how behavior differs meaningfully between different types of conversations (only if 2+ contexts, clear difference)

THEME CLUSTER RULE: No two items may come from the same cluster. If two items are both about talk ratio and dominance (both Cluster A), merge them into one and find a different cluster for the second slot. A feed covering 5 different clusters is far more valuable than one that restates the same pattern 5 ways.

TASK: Output the COMPLETE updated feed — existing items (kept or evolved) PLUS any new ones.

RULES FOR EXISTING ITEMS:
1. Keep an item if the behavior it describes is still true — carry it forward unchanged
2. Evolve an item if the behavior has changed — update the text to reflect the shift
3. Reference previous observations naturally in evolved items ("as noted before…", "this pattern continues…")
4. Retire an item ONLY if the behavior has clearly reversed — drop it from the output entirely

RULES FOR NEW ITEMS:
5. Add 1–2 new items ONLY if a genuinely different pattern has emerged that isn't covered by existing items
6. Every new insight must require multiple sessions to observe — nothing from one conversation alone
7. Do not pad — a focused feed beats filler. Max 8 items total.

GENERAL RULES:
8. Be specific — reference what was actually observed, not generic advice
9. Write directly to the person ("you", "your")
10. With few sessions, be honest about uncertainty — say "across your sessions so far" not "you always"
11. Never refer to SPEAKER_00 or SPEAKER_01 — use "you" and "the other person"
12. Output valid JSON only — no markdown, no code fences, no extra text

Output a JSON array (all existing + any new items):
[
  {{
    "type": "pattern",
    "text": "2-3 sentences. Specific cross-session observation written directly to the person.",
    "tip": "One sentence. A concrete, actionable thing to try.",
    "signal": "short_unique_slug — keep the same slug as before for existing items"
  }}
]

type must be exactly one of:
- "pattern" — behavior consistent across multiple sessions
- "context_contrast" — behavior that noticeably differs between contexts (only if 2+ contexts, clear difference)
- "trend_up" — something that has clearly improved from early to recent sessions
- "trend_down" — something that has declined or worsened from early to recent sessions"""

    def _format_existing_feed(self, existing_feed: list) -> str:
        if not existing_feed:
            return ""
        lines = []
        for i, item in enumerate(existing_feed):
            text = item.get("text", "").strip()
            itype = item.get("type", "pattern")
            signal = item.get("signal", f"item_{i}")
            if text:
                lines.append(f'  {i+1}. [type: {itype}, signal: "{signal}"] {text}')
        if not lines:
            return ""
        return (
            "\nEXISTING FEED ITEMS (already shown to the user — keep, evolve, or retire as described):\n"
            + "\n".join(lines) + "\n"
        )

    def _parse(self, raw: str) -> list:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            data = json.loads(clean.strip())
            if not isinstance(data, list):
                return []
            result, seen = [], set()
            for item in data:
                if not isinstance(item, dict):
                    continue
                t = item.get("type", "pattern")
                if t not in VALID_TYPES:
                    t = "pattern"
                text = str(item.get("text", "")).strip()
                tip = str(item.get("tip", "")).strip()
                signal = str(item.get("signal", f"insight_{len(result)}")).strip()
                if not text or signal in seen:
                    continue
                seen.add(signal)
                entry = {"type": t, "text": text, "signal": signal}
                if tip:
                    entry["tip"] = tip
                result.append(entry)
                if len(result) >= 8:
                    break
            return result
        except Exception:
            return []
