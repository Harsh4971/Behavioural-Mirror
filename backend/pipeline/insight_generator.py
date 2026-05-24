import json
from groq import Groq

class InsightGenerator:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def generate(self, signals: dict, context: str, user_baseline: dict = None,
                 transcript_text: str = "", dimensions: dict = None) -> dict:
        structured_input = self._prepare_input(signals, context, user_baseline)
        prompt = self._build_prompt(
            structured_input,
            transcript_text,
            signals.get("notable_signals", []),
            dimensions or {}
        )

        response = self.client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2500
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
            "vocal_energy_trend": signals["vocal_energy"].get("trend"),
            "speech_acceleration_trend": signals["speech_acceleration"].get("trend"),
            "speech_delta_wpm": signals["speech_acceleration"].get("delta_wpm"),
            "user_questions_asked": signals["questions"]["user_questions_asked"],
            "other_questions_asked": signals["questions"]["other_questions_asked"],
            "longest_monologue_s": signals["monologue"]["longest_turn_s"],
            "vocabulary_richness_ttr": signals["vocabulary_richness"]["type_token_ratio"],
            "silence_ratio": signals["silence_ratio"]["silence_ratio"],
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

    def _build_prompt(self, data: dict, transcript_text: str,
                      notable_signals: list, dimensions: dict) -> str:

        transcript_section = ""
        if transcript_text:
            transcript_section = f"""
CONVERSATION TRANSCRIPT (partial):
{transcript_text}
"""
        notable_section = ""
        if notable_signals:
            notable_section = f"""
MOST NOTABLE SIGNALS:
{json.dumps(notable_signals, indent=2)}
"""
        dimensions_section = ""
        if dimensions:
            dimensions_section = f"""
BEHAVIORAL DIMENSION SCORES (1=lowest, 5=highest):
{json.dumps(dimensions, indent=2)}
"""

        return f"""You are an expert behavioral communication coach. Analyze this conversation and generate a coaching report.

STRICT RULES:
1. Never diagnose — use probabilistic language: "may suggest", "could indicate", "appeared to"
2. Never say "you are nervous/arrogant/rude" — say "patterns associated with X were observed"
3. Be specific — reference actual signal values in your observations
4. Coaching suggestions must be concrete and immediately actionable
5. Output must be valid JSON only — no markdown, no code fences, no extra text
6. NEVER use "SPEAKER_00" or "SPEAKER_01" in your output — always say "you" for the user and "the other person" for the other speaker
7. The user is always the person being analyzed — write directly to them in second person ("you", "your")
{transcript_section}{notable_section}{dimensions_section}
ALL SESSION DATA:
{json.dumps(data, indent=2)}

Output this exact JSON:
{{
  "conversation_summary": "3-4 sentences. What was this conversation actually about? What happened? Be specific using the transcript. What was the overall tone and dynamic?",
  "summary_sentence": "One sentence on the overall communication pattern — how it flowed behaviorally.",
  "observations": [
    {{
      "signal": "signal_name",
      "observation": "Specific observation grounded in actual values. Non-judgmental.",
      "resonance_prompt": "Gentle reflective question for the user."
    }},
    {{
      "signal": "different_signal",
      "observation": "Different observation on different signal.",
      "resonance_prompt": "Different reflective question."
    }},
    {{
      "signal": "another_signal",
      "observation": "Third unique observation.",
      "resonance_prompt": "Third reflective question."
    }}
  ],
  "coaching_suggestions": [
    {{
      "priority": 1,
      "area": "area name (e.g. Confidence, Clarity, Listening)",
      "issue": "Specific issue observed in this conversation with actual values.",
      "suggestion": "Concrete, immediately actionable suggestion. What exactly should they do differently next time?",
      "why_it_matters": "Why this change would improve their communication."
    }},
    {{
      "priority": 2,
      "area": "different area",
      "issue": "Second specific issue.",
      "suggestion": "Second actionable suggestion.",
      "why_it_matters": "Why this matters."
    }},
    {{
      "priority": 3,
      "area": "third area",
      "issue": "Third specific issue.",
      "suggestion": "Third actionable suggestion.",
      "why_it_matters": "Why this matters."
    }}
  ],
  "dimension_narrative": {{
    "emotional_state": "2 sentences interpreting the emotional state scores in plain language. What do these scores mean for this person in this conversation?",
    "relational_dynamics": "2 sentences on the relational dynamic. How did the two speakers connect or not connect?",
    "communication_effectiveness": "2 sentences on how effectively they communicated.",
    "conversation_arc": "2 sentences on how the conversation evolved — beginning, middle, end."
  }},
  "notable_pattern": "The single most interesting or important behavioral pattern from this conversation.",
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
                "conversation_summary": "Session analyzed successfully.",
                "summary_sentence": "Session analyzed successfully.",
                "observations": [],
                "coaching_suggestions": [],
                "dimension_narrative": {},
                "notable_pattern": None,
                "data_confidence": "low"
            }