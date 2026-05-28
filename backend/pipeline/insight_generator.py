import json
from groq import Groq

CONTEXT_COACHING_GUIDE = {
    "job_interview": (
        "This is a job interview. Prioritize: confidence signals, response latency, "
        "conciseness. Flag long monologues — interviewers expect dialogue, not lectures. "
        "Being interrupted frequently is a red flag. Low filler rate matters more here "
        "than in casual contexts. Balanced questions (asking as well as answering) signals "
        "genuine interest."
    ),
    "disagreement": (
        "This is a disagreement or conflict conversation. Prioritize: listening quality, "
        "interruption patterns, talk ratio balance, response latency. A very high talk "
        "ratio by one person usually signals the other isn't being heard. Frequent "
        "interruptions escalate tension. Long response latency can indicate careful "
        "processing or withdrawal."
    ),
    "presentation": (
        "This is a presentation or pitch. A high talk ratio is expected and normal here — "
        "do not flag it as a problem. Prioritize: vocal energy trend, speech rate, "
        "longest monologue, vocabulary richness. Decelerating energy is a warning sign. "
        "Questions asked by the audience (other speaker) signal genuine engagement."
    ),
    "meeting": (
        "This is a meeting. Prioritize: turn dynamics, question balance, rapport, mutual "
        "engagement. Check whether one person dominated. Long silences may indicate "
        "disengagement. Vocabulary richness and conciseness matter for perceived credibility."
    ),
    "casual": (
        "This is a casual conversation. There are no strict norms to measure against. "
        "Focus on what was genuinely notable in the signals rather than applying a "
        "professional communication standard. Rapport and engagement matter most."
    ),
}


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
            dimensions or {},
            context,
            user_baseline
        )

        response = self.client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2500
        )

        return self._parse_output(response.choices[0].message.content)

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
            def _delta_pct(current, base):
                if not base or base == 0:
                    return None
                return round((current - base) / base * 100, 1)

            prepared["baseline_comparison"] = {
                "speech_rate": {
                    "current": prepared["speech_rate_wpm"],
                    "your_usual": round(baseline["avg_speech_rate_wpm"], 1),
                    "delta_pct": _delta_pct(
                        prepared["speech_rate_wpm"], baseline["avg_speech_rate_wpm"])
                },
                "filler_rate": {
                    "current": prepared["filler_rate_per_100_words"],
                    "your_usual": round(baseline["avg_filler_rate"], 2),
                    "delta_pct": _delta_pct(
                        prepared["filler_rate_per_100_words"], baseline["avg_filler_rate"])
                },
                "response_latency": {
                    "current": prepared["avg_response_latency_s"],
                    "your_usual": round(baseline["avg_response_latency_s"], 2),
                    "delta_pct": _delta_pct(
                        prepared["avg_response_latency_s"], baseline["avg_response_latency_s"])
                },
                "talk_ratio": {
                    "current": prepared["talk_ratio_user"],
                    "your_usual": round(baseline["avg_talk_ratio"], 3),
                    "delta_pp": round(
                        prepared["talk_ratio_user"] - baseline["avg_talk_ratio"], 3)
                },
            }

        return prepared

    def _build_prompt(self, data: dict, transcript_text: str,
                      notable_signals: list, dimensions: dict,
                      context: str, baseline: dict) -> str:

        # ── Baseline section (prominent, mandatory when available) ─
        baseline_section = ""
        if "baseline_comparison" in data:
            b = data["baseline_comparison"]
            sr = b["speech_rate"]
            fr = b["filler_rate"]
            rl = b["response_latency"]
            tr = b["talk_ratio"]

            def _fmt_delta(delta, unit=""):
                if delta is None:
                    return "no change"
                sign = "+" if delta > 0 else ""
                return f"{sign}{delta}{unit}"

            baseline_section = f"""
YOUR PERSONAL BASELINE COMPARISON
(You have 3+ sessions. REQUIRED: reference at least 2 of these in your observations or coaching.)
  Speech rate:      {sr['current']} wpm    vs your usual {sr['your_usual']} wpm    ({_fmt_delta(sr['delta_pct'], '%')})
  Filler rate:      {fr['current']}/100w   vs your usual {fr['your_usual']}/100w   ({_fmt_delta(fr['delta_pct'], '%')})
  Response latency: {rl['current']}s       vs your usual {rl['your_usual']}s       ({_fmt_delta(rl['delta_pct'], '%')})
  Talk ratio:       {round(tr['current']*100)}%          vs your usual {round(tr['your_usual']*100)}%          ({_fmt_delta(tr['delta_pp']*100, 'pp')})
"""

        # ── Context-specific coaching guide ───────────────────────
        coaching_guide = CONTEXT_COACHING_GUIDE.get(
            context, CONTEXT_COACHING_GUIDE["casual"])

        # ── Notable signals ───────────────────────────────────────
        notable_section = ""
        if notable_signals:
            notable_section = f"""
MOST NOTABLE SIGNALS (build your observations around these first):
{json.dumps(notable_signals, indent=2)}
"""

        # ── Dimensions ────────────────────────────────────────────
        dimensions_section = ""
        if dimensions:
            dimensions_section = f"""
BEHAVIORAL DIMENSION SCORES (1=lowest, 5=highest):
{json.dumps(dimensions, indent=2)}
"""

        # ── Transcript ────────────────────────────────────────────
        transcript_section = ""
        if transcript_text:
            transcript_section = f"""
CONVERSATION TRANSCRIPT (partial — quote from this where relevant):
{transcript_text}
"""

        return f"""You are a behavioral communication coach analyzing a real conversation.
Generate a specific, honest coaching report. Write directly to the user ("you", "your").

CONTEXT: {context.upper().replace("_", " ")}
DURATION: {data['session_duration_minutes']} minutes
{baseline_section}{notable_section}{dimensions_section}
ALL SESSION DATA:
{json.dumps({k: v for k, v in data.items() if k != "baseline_comparison"}, indent=2)}
{transcript_section}
CONTEXT-SPECIFIC COACHING GUIDE:
{coaching_guide}

LANGUAGE RULES — follow these precisely:
1. FACTS (measurements) → always direct, no hedging.
   Example: "You spoke 68% of the time." NOT "Your talk ratio may suggest dominance."
2. BEHAVIORAL INTERPRETATIONS → hedge roughly half the time. Use hedging selectively
   for genuinely uncertain inferences, not as a default safety blanket.
   Example: "At 240 wpm, you were speaking faster than most people find comfortable to follow."
   OR: "This pace may have made it harder for the other person to absorb what you were saying."
3. PSYCHOLOGICAL / EMOTIONAL CLAIMS → always hedge. We cannot know internal states.
   Example: "This pattern is often associated with discomfort." NOT "You were uncomfortable."
4. COACHING SUGGESTIONS → always direct. No hedging. These are advice, not inferences.
   Example: "Next time, pause for a full second after the other person finishes before responding."
5. Do not default to talk_ratio, speech_rate, or pauses as your primary observations
   unless they appear in MOST NOTABLE SIGNALS. Use the notable signals list.
6. Every observation must reference a specific value from the data.
7. Quote from the transcript when it illustrates your point.
8. Never use "SPEAKER_00" or "SPEAKER_01" — always "you" and "the other person".
9. Output valid JSON only — no markdown, no code fences, no extra text.

Output this exact JSON:
{{
  "conversation_summary": "3-4 sentences. What was this conversation actually about? What happened? Reference specific things said in the transcript. What was the overall tone and dynamic?",
  "summary_sentence": "One direct sentence on the overall communication pattern — how it flowed behaviorally.",
  "observations": [
    {{
      "signal": "signal_name",
      "observation": "Specific observation grounded in an actual value. Direct where factual, selectively hedged where inferring behavior or state.",
      "resonance_prompt": "A genuine reflective question — one that a thoughtful person might sit with. Not rhetorical."
    }},
    {{
      "signal": "different_signal_name",
      "observation": "Different observation on a different signal.",
      "resonance_prompt": "Different reflective question."
    }},
    {{
      "signal": "another_signal_name",
      "observation": "Third observation on a third signal.",
      "resonance_prompt": "Third reflective question."
    }}
  ],
  "coaching_suggestions": [
    {{
      "priority": 1,
      "area": "area name (e.g. Confidence, Clarity, Listening)",
      "issue": "Specific issue with actual values. What exactly was the problem?",
      "suggestion": "Exactly what to do differently next time. Concrete and immediate.",
      "why_it_matters": "Why this change improves communication in {context} conversations specifically."
    }},
    {{
      "priority": 2,
      "area": "different area",
      "issue": "Second issue.",
      "suggestion": "Second actionable suggestion.",
      "why_it_matters": "Why it matters."
    }},
    {{
      "priority": 3,
      "area": "third area",
      "issue": "Third issue.",
      "suggestion": "Third suggestion.",
      "why_it_matters": "Why it matters."
    }}
  ],
  "dimension_narrative": {{
    "emotional_state": "2 sentences. What do the emotional state scores mean for this person in this specific conversation? Be direct.",
    "relational_dynamics": "2 sentences on how the two speakers connected or didn't.",
    "communication_effectiveness": "2 sentences on how effectively they communicated.",
    "conversation_arc": "2 sentences on how the conversation evolved — beginning, middle, end."
  }},
  "notable_pattern": "The single most interesting or surprising behavioral pattern from this session. One sentence, direct.",
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
