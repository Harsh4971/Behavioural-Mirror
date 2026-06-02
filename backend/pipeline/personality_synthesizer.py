import json
from groq import Groq


class PersonalitySynthesizer:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def synthesize(self, profile_data: dict, dim_averages: dict,
                   sessions_data: list = None) -> dict:
        prompt = self._build_prompt(profile_data, dim_averages, sessions_data or [])
        response = self.client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=2000,
        )
        return self._parse(response.choices[0].message.content, dim_averages)

    def _build_prompt(self, profile_data: dict, dim_avgs: dict,
                      sessions_data: list) -> str:
        n = profile_data["session_count"]
        by_context = profile_data.get("by_context", {})
        patterns = profile_data.get("patterns", [])
        trends = profile_data.get("trends", [])

        # Paragraph depth instruction scales with session count
        if n <= 5:
            depth_note = (
                "You have limited data (few sessions). Keep the portrait observational — "
                "describe what you've seen so far without overstating certainty."
            )
        elif n <= 10:
            depth_note = (
                "You have moderate data. Patterns are becoming clear. Describe them with "
                "reasonable confidence, noting where context shifts behaviour."
            )
        else:
            depth_note = (
                "You have substantial data. Describe this person's established behavioural "
                "character with confidence — these are consistent patterns, not guesses."
            )

        context_lines = ""
        if by_context:
            context_lines = "\nBEHAVIOR BY CONTEXT (averages where 2+ sessions exist):\n"
            for ctx, data in by_context.items():
                context_lines += f"  {ctx}: talk={data['talk_ratio']}%, fillers={data['filler_rate']}/100w ({data['count']} sessions)\n"

        pattern_lines = ""
        if patterns:
            pattern_lines = "\nCONSISTENT PATTERNS:\n"
            for p in patterns:
                pattern_lines += f"  - {p['detail']}\n"

        trend_lines = ""
        if trends:
            trend_lines = "\nTRENDS OVER TIME:\n"
            for t in trends:
                trend_lines += f"  - {t['signal']}: {t['direction']} ({t['old']} → {t['new']}{t['unit']})\n"

        dim_lines = "\nDIMENSION AVERAGES (1–5 scale):\n"
        for k, v in dim_avgs.items():
            dim_lines += f"  {k}: {v}\n"

        # Per-session log for grounding narratives in specific conversations
        session_log = ""
        if sessions_data:
            session_log = "\nSESSION LOG (use these to ground dimension narratives — reference by context type):\n"
            for i, s in enumerate(sessions_data[-10:], 1):
                scores = ", ".join(f"{k}={v}" for k, v in s.get("dim_scores", {}).items())
                notable = s.get("notable_pattern", "")
                notable_str = f' | pattern: "{notable}"' if notable else ""
                quotes = s.get("sample_quotes", [])
                quotes_str = ""
                if quotes:
                    q_list = "  /  ".join(f'"{q}"' for q in quotes[:2])
                    quotes_str = f'\n     quotes: {q_list}'
                session_log += (
                    f"  {i}. {s['context']} | {scores} "
                    f"| fillers={s['filler_rate']}/100w | talk={s['talk_ratio_pct']}%"
                    f"{notable_str}{quotes_str}\n"
                )

        return f"""You are building a behavioral personality portrait from {n} recorded conversations.

{depth_note}
{context_lines}{pattern_lines}{trend_lines}{dim_lines}{session_log}

TASK: Write a personality portrait paragraph and 5 dimension narratives.

PARAGRAPH RULES:
1. 3–4 sentences maximum. Write as if describing this person to someone who knows them.
2. NO raw numbers or percentages. No "57% of the time" or "211 WPM".
   Only use numbers if they describe a striking contrast — and even then, phrase it qualitatively ("nearly double", "significantly slower").
3. Focus on behavioural character: how they show up, what their tendencies are, what makes them distinct.
4. Reference context contrasts only where the data actually supports them.
5. Use "you" / "your" — address the person directly.
6. Never write "seems to" or "appears to" — be direct about observed patterns.

DIMENSION NARRATIVE RULES:
1. Each narrative must be 2–3 sentences.
2. Reference context types to ground the narrative — not specific dates.
   Format: "In your [context type] conversations, ..." or "When you're in [context type] settings, ..."
   If only one context type exists, describe the pattern within it.
3. Explain what behavioural pattern drives the score — what actually happens in those settings.
4. Do not repeat the score number in the narrative. The score is shown separately.
5. Keep it human — write like a perceptive coach, not an analyst.
6. If a session quote from the log illustrates the pattern, embed it inline using curly quotes — e.g.
   'You tend to take charge — "let me explain how this works" is characteristic of how you steer conversations.'
   Use at most one quote per narrative. Only use it if it genuinely supports the point.

SCORING — derive dimension scores (integers 0–100) from the averages:
- confidence: map confidence avg (1–5) → (avg-1)/4*100, reduce by 5pts per filler point above 3.0/100w
- assertiveness: map assertiveness avg (1–5) → (avg-1)/4*100
- listening: average of listening_quality and empathy avgs, map to 0–100
- composure: INVERT nervousness → (5-nervousness_avg)/4*100
- clarity: average of clarity and adaptability avgs, map to 0–100

Output valid JSON only — no markdown, no code fences, no extra text:
{{
  "paragraph": "3–4 sentence behavioral portrait. No raw numbers. Grounded in observed patterns.",
  "dimensions": [
    {{
      "key": "confidence",
      "name": "Confidence",
      "score": <integer 0-100>,
      "label": "1–3 word label matching the score",
      "narrative": "2–3 sentences. References a specific session from the log. Explains what happened."
    }},
    {{
      "key": "assertiveness",
      "name": "Assertiveness",
      "score": <integer 0-100>,
      "label": "short label",
      "narrative": "2–3 sentences referencing specific session(s)."
    }},
    {{
      "key": "listening",
      "name": "Listening Quality",
      "score": <integer 0-100>,
      "label": "short label",
      "narrative": "2–3 sentences referencing specific session(s)."
    }},
    {{
      "key": "composure",
      "name": "Composure",
      "score": <integer 0-100>,
      "label": "short label",
      "narrative": "2–3 sentences referencing specific session(s)."
    }},
    {{
      "key": "clarity",
      "name": "Communication Clarity",
      "score": <integer 0-100>,
      "label": "short label",
      "narrative": "2–3 sentences referencing specific session(s)."
    }}
  ]
}}"""

    def _parse(self, raw: str, dim_avgs: dict) -> dict:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            return json.loads(clean.strip())
        except Exception:
            def _scale(key, invert=False):
                v = dim_avgs.get(key, 3.0)
                if invert:
                    v = 6.0 - v
                return max(0, min(100, int((v - 1) / 4 * 100)))

            return {
                "paragraph": "Your behavioral profile is being built. Upload more sessions for deeper insights.",
                "dimensions": [
                    {"key": "confidence",    "name": "Confidence",           "score": _scale("confidence"),                "label": "Moderate", "narrative": ""},
                    {"key": "assertiveness", "name": "Assertiveness",        "score": _scale("assertiveness"),             "label": "Moderate", "narrative": ""},
                    {"key": "listening",     "name": "Listening Quality",    "score": _scale("listening_quality"),         "label": "Moderate", "narrative": ""},
                    {"key": "composure",     "name": "Composure",            "score": _scale("nervousness", invert=True),  "label": "Moderate", "narrative": ""},
                    {"key": "clarity",       "name": "Communication Clarity","score": _scale("clarity"),                   "label": "Moderate", "narrative": ""},
                ],
            }
