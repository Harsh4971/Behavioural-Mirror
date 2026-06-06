import json
from groq import Groq

VALID_TYPES = {"pattern", "context_contrast", "trend_up", "trend_down"}


class MirrorFeedSynthesizer:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def synthesize(self, sessions: list, user_summary: str = None) -> list:
        """
        sessions: list of dicts with keys:
          context, date, fingerprint (str), notable_pattern (str)
        user_summary: consolidated behavioral summary (present after 12+ sessions)
        Returns list of mirror feed insight dicts, empty if < 2 usable sessions.
        """
        usable = [
            s for s in sessions
            if s.get("fingerprint") or s.get("notable_pattern")
        ]
        if not user_summary and len(usable) < 2:
            return []

        prompt = (
            self._build_consolidated_prompt(user_summary, usable)
            if user_summary
            else self._build_prompt(usable)
        )
        try:
            response = self.client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=1200,
            )
            return self._parse(response.choices[0].message.content)
        except Exception:
            return []

    def _build_consolidated_prompt(self, user_summary: str, recent_sessions: list) -> str:
        recent_block = ""
        if recent_sessions:
            recent_block = "\nMOST RECENT SESSIONS:\n"
            for s in recent_sessions:
                content = (s.get("fingerprint") or s.get("notable_pattern") or "").strip()
                ctx = s["context"].replace("_", " ")
                if content:
                    recent_block += f"  {s['date']} ({ctx}): {content}\n"

        return f"""You are identifying behavioral patterns for a person with an established behavioral history.

CONSOLIDATED BEHAVIORAL PROFILE (built from all past sessions):
{user_summary}
{recent_block}
TASK: Write 2–4 cross-session insights that reflect this person's established patterns and any recent shifts.

BEHAVIORAL DIMENSIONS TO DRAW FROM (pick different ones for each insight):
- Airtime & talk ratio — how much space they take vs. give
- Listening & acknowledgment — whether they receive and respond to what was said
- Emotional tone & composure — nervousness, reactivity, warmth
- Clarity & structure — how organized and clear their speech is
- Filler words & delivery confidence
- Adaptability — how they adjust when the context or conversation shifts
- Turn-taking & interruptions — how they manage conversation flow
- Trend over time — how early sessions compare to recent ones
- Context-specific vs universal tendencies

RULES:
1. Ground every insight in what the behavioral profile actually shows — no generic observations
2. CRITICAL — each insight must address a DIFFERENT behavioral dimension from the list above. If one insight covers communication dominance, the others must come from genuinely different dimensions (emotional tone, clarity, adaptation, trend over time, etc.). Never rephrase the same root behavior as multiple separate insights.
3. If only one or two strong patterns exist, write 2 insights — a focused feed beats padded repetition
4. If recent sessions differ from the established profile, name the shift explicitly
5. Write directly to the person ("you", "your")
6. Be specific and honest — the person has enough history for direct, confident observations
7. Output valid JSON only — no markdown, no code fences

Output a JSON array of 2–4 objects:
[
  {{
    "type": "pattern",
    "text": "2-3 sentences. Specific observation grounded in the behavioral history.",
    "tip": "One sentence. A concrete, actionable thing to try — include a brief example scenario so the person can picture it.",
    "signal": "short_unique_slug"
  }}
]

type must be exactly one of:
- "pattern" — behavior consistent across the history
- "context_contrast" — clear difference in behavior between contexts
- "trend_up" — something that has improved over time or in recent sessions
- "trend_down" — something that has declined or worsened"""

    def _build_prompt(self, sessions: list) -> str:
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

        return f"""You are identifying behavioral patterns across {n} conversations recorded by the same person.

SESSIONS BY CONTEXT:
{''.join(blocks)}
TASK: Write 2–4 cross-session insights. With {n} sessions, {depth_note}

BEHAVIORAL DIMENSIONS TO DRAW FROM (pick different ones for each insight):
- Airtime & talk ratio — how much space they take vs. give
- Listening & acknowledgment — whether they receive and respond to what was said
- Emotional tone & composure — nervousness, reactivity, warmth
- Clarity & structure — how organized and clear their speech is
- Filler words & delivery confidence
- Adaptability — how they adjust when the context or conversation shifts
- Turn-taking & interruptions — how they manage conversation flow
- Trend over time — how early sessions compare to recent ones
{context_diff_line}
RULES:
1. Every insight must require multiple sessions to observe — nothing you could say from one conversation alone
2. CRITICAL — each insight must address a DIFFERENT behavioral dimension from the list above. If airtime/dominance is one insight, the others must come from different dimensions (e.g. emotional tone, clarity, trend over time). Never write two insights that are both about the same root behavior rephrased differently.
3. If you can only find one strong pattern, write 2 insights total — a focused feed beats padded repetition
4. Be specific — reference what was actually observed, not generic advice
5. Write directly to the person ("you", "your")
6. With few sessions, be honest about uncertainty — say "across your sessions so far" not "you always"
7. Never refer to SPEAKER_00 or SPEAKER_01 — use "you" and "the other person"
8. Output valid JSON only — no markdown, no code fences, no extra text

Output a JSON array of 2–4 objects:
[
  {{
    "type": "pattern",
    "text": "2-3 sentences. Specific cross-session observation written directly to the person. Ground it in what was actually observed across multiple sessions.",
    "tip": "One sentence. A concrete, actionable thing to try — include a brief example scenario so the person can picture it.",
    "signal": "short_unique_slug"
  }}
]

type must be exactly one of:
- "pattern" — behavior that is consistent across multiple sessions
- "context_contrast" — behavior that noticeably differs between contexts (only use if 2+ contexts exist with a clear, observable difference)
- "trend_up" — something that has clearly improved from early sessions to recent ones
- "trend_down" — something that has declined or worsened from early to recent sessions"""

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
                if len(result) >= 4:
                    break
            return result
        except Exception:
            return []
