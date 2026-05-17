import json
from groq import Groq

class InsightGenerator:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def generate(self, signals: dict, context: str, user_baseline: dict = None) -> dict:
        structured_input = self._prepare_input(signals, context, user_baseline)
        prompt = self._build_prompt(structured_input)

        response = self.client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1500
        )

        raw_output = response.choices[0].message.content
        return self._parse_output(raw_output)

    def _prepare_input(self, signals: dict, context: str, baseline: dict) -> dict:
        prepared = {
            "context": context,
            "session_duration_minutes": round(signals["session_duration_s"] / 60, 1),
            "talk_ratio_user": signals["talk_ratio"]["user_ratio"],
            "speech_rate_wpm": signals["speech_rate"]["overall_wpm"],
            "speech_rate_variability": signals["speech_rate"]["variability"],
            "avg_response_latency_s": signals["pauses"]["response_latency"]["mean_s"],
            "within_turn_pause_count": signals["pauses"]["within_turn_pauses"]["count"],
            "user_interrupted_other": signals["interruptions"]["user_interrupted_other"],
            "user_was_interrupted": signals["interruptions"]["user_was_interrupted"],
            "filler_rate_per_100_words": signals["filler_words"]["rate_per_100_words"],
            "top_filler_words": list(signals["filler_words"]["breakdown"].keys())[:3],
            "pitch_std_hz": signals["pitch_features"].get("std_hz"),
            "other_engagement_trend": signals["engagement_proxy"].get("other_speaker_turn_length_trend")
        }

        if baseline:
            def pct_delta(current, base):
                if not base or base == 0:
                    return None
                return round((current - base) / base * 100, 1)

            prepared["baseline_comparison"] = {
                "speech_rate_delta_pct": pct_delta(
                    prepared["speech_rate_wpm"],
                    baseline.get("avg_speech_rate_wpm")
                ),
                "filler_rate_delta_pct": pct_delta(
                    prepared["filler_rate_per_100_words"],
                    baseline.get("avg_filler_rate")
                ),
                "response_latency_delta_pct": pct_delta(
                    prepared["avg_response_latency_s"],
                    baseline.get("avg_response_latency_s")
                ),
                "talk_ratio_delta": round(
                    prepared["talk_ratio_user"] - baseline.get("avg_talk_ratio", 0.5), 3
                )
            }

        return prepared

    def _build_prompt(self, data: dict) -> str:
        return f"""You are a behavioral communication analyst. Generate reflective, non-judgmental observations about conversational behavior patterns.

STRICT RULES:
1. Never diagnose or make personality claims
2. Always use probabilistic language: "may suggest", "could indicate", "appeared to", "was observed"
3. Never say things like "you are nervous", "you are dominant", "you lack confidence"
4. Observations must be grounded in the specific signals provided
5. Generate exactly 3 observations
6. Output must be valid JSON only — no extra text, no markdown, no code fences

SESSION DATA:
{json.dumps(data, indent=2)}

Output this exact JSON structure:
{{
  "summary_sentence": "One sentence describing the overall conversational pattern.",
  "observations": [
    {{
      "signal": "talk_ratio",
      "observation": "Behavioral observation in non-judgmental language.",
      "resonance_prompt": "A gentle reflective question for the user."
    }},
    {{
      "signal": "speech_rate",
      "observation": "Behavioral observation in non-judgmental language.",
      "resonance_prompt": "A gentle reflective question for the user."
    }},
    {{
      "signal": "pauses",
      "observation": "Behavioral observation in non-judgmental language.",
      "resonance_prompt": "A gentle reflective question for the user."
    }}
  ],
  "notable_pattern": "One sentence about the most notable pattern, or null.",
  "data_confidence": "high"
}}"""

    def _parse_output(self, raw: str) -> dict:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            return json.loads(clean.strip())
        except Exception:
            return {
                "summary_sentence": "Session analyzed successfully.",
                "observations": [],
                "notable_pattern": None,
                "data_confidence": "low"
            }