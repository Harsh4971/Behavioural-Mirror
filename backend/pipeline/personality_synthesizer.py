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

        session_log = ""
        if sessions_data:
            session_log = "\nSESSION LOG (the behavioral fingerprints are your PRIMARY source — use them, not just the numbers):\n"
            for i, s in enumerate(sessions_data[-10:], 1):
                notable = s.get("notable_pattern", "")
                notable_str = f' | pattern: "{notable}"' if notable else ""
                fingerprint = s.get("fingerprint", "")
                fp_str = f'\n     [{s["context"]}] {fingerprint[:350]}' if fingerprint else ""
                session_log += (
                    f"  {i}. {s['context']} | talk={s['talk_ratio_pct']}%"
                    f"{notable_str}{fp_str}\n"
                )

        return f"""You are building a behavioral personality portrait from {n} recorded conversations.

{depth_note}
{context_lines}{pattern_lines}{trend_lines}{dim_lines}{session_log}

TASK: Write a personality portrait paragraph, 5 dimension scores with labels, and one shape narrative.

PARAGRAPH RULES:
1. 3–4 sentences maximum. Write as if describing this person to someone who knows them well.
2. NO raw numbers or percentages — phrase everything qualitatively.
3. VOCABULARY: The portrait must go beyond talk dynamics. Draw from what the fingerprints actually reveal across these dimensions:
   — THINKING STYLE: Do they reframe questions before answering? Take contrarian positions? Think out loud or present polished thoughts? Big-picture or detail-driven?
   — ARGUMENT STYLE: Do they lead with logic, stories, analogies, personal experience, or principles? How do they structure a point?
   — CONVERSATION NAVIGATION: Do they drive topics, shift tone, redirect, or follow? Who owns the direction of their conversations?
   — HANDLING CHALLENGE: When pushed back on, do they get curious, defensive, or adaptive? Do they change position? What moves them?
   — CLARITY & PRECISION: Do they commit to positions or hedge constantly? Do they use concrete examples or stay abstract?
   — LISTENING & RESPONSE: Do they build on what others say, or pivot immediately to their own point? Do they ask probing questions?
   — WARMTH & RELATIONAL STYLE: Humor, validation, emotional calibration — do they connect or transact?
4. If talk ratio or dominance is already the most obvious thing, do NOT make it the centrepiece unless it is truly the most defining characteristic. If the fingerprints reveal more interesting things about thinking style, framing, or perspective — surface those instead.
5. The portrait should make the person feel SEEN as an individual — not like a generic assessment report.
6. Reference context contrasts only where the data actually supports them.
7. Use "you" / "your" — address the person directly.
8. Never write "seems to" or "appears to" — be direct about observed patterns.

SHAPE NARRATIVE RULES (one paragraph shown below all 5 scores):
1. 3–4 sentences. Synthesize what the COMBINATION of all 5 scores reveals — not a summary of each one individually.
2. Focus on what the pattern of scores means together. High assertiveness + high listening together is unusual and worth naming. High composure + low confidence is a tension worth surfacing.
3. If one score is notably higher or lower than the others, explain what that asymmetry likely means behaviourally.
4. End with one concrete thing worth paying attention to, grounded in the overall score pattern.
5. Write directly to the person ("you", "your"). Sound like a perceptive coach, not an analyst.
6. Never list the dimension names. Synthesize them into a flowing, human observation.

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
      "label": "1–3 word label matching the score"
    }},
    {{
      "key": "assertiveness",
      "name": "Assertiveness",
      "score": <integer 0-100>,
      "label": "short label"
    }},
    {{
      "key": "listening",
      "name": "Listening Quality",
      "score": <integer 0-100>,
      "label": "short label"
    }},
    {{
      "key": "composure",
      "name": "Composure",
      "score": <integer 0-100>,
      "label": "short label"
    }},
    {{
      "key": "clarity",
      "name": "Communication Clarity",
      "score": <integer 0-100>,
      "label": "short label"
    }}
  ],
  "shape_narrative": "3–4 sentences on what the combination of these 5 scores reveals. Name tensions, unusual pairings, and what the overall pattern means for how this person shows up."
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
                "shape_narrative": "",
                "dimensions": [
                    {"key": "confidence",    "name": "Confidence",            "score": _scale("confidence"),               "label": "Moderate"},
                    {"key": "assertiveness", "name": "Assertiveness",         "score": _scale("assertiveness"),            "label": "Moderate"},
                    {"key": "listening",     "name": "Listening Quality",     "score": _scale("listening_quality"),        "label": "Moderate"},
                    {"key": "composure",     "name": "Composure",             "score": _scale("nervousness", invert=True), "label": "Moderate"},
                    {"key": "clarity",       "name": "Communication Clarity", "score": _scale("clarity"),                  "label": "Moderate"},
                ],
            }
