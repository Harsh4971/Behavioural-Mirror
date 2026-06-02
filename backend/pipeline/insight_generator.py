import json
from groq import Groq

CONTEXT_COACHING_GUIDE = {
    "social": (
        "This is a casual, low-stakes social conversation. There are no strict norms to measure "
        "against. Focus on what was genuinely notable — rapport, warmth, and reciprocal engagement "
        "matter most. Avoid applying professional communication standards."
    ),
    "collaborative": (
        "This is a collaborative working conversation (meeting, brainstorming, planning). "
        "Prioritize: balanced airtime, turn-taking, question quality, and whether one person "
        "dominated. Mutual engagement and shared goal orientation matter. Long silences may "
        "indicate disengagement."
    ),
    "evaluative": (
        "This is an evaluative conversation — interview, presentation, performance review, or "
        "assessment. Prioritize: confidence signals, response latency, conciseness. Flag long "
        "monologues — evaluators expect dialogue, not lectures. Low filler rate matters here "
        "more than in casual contexts. Concise, direct answers signal competence."
    ),
    "influential": (
        "This is a persuasion or influence conversation (sales, pitch, convincing someone). "
        "Prioritize: whether the other person was engaged or passive, question quality (do "
        "questions draw out needs?), and clarity of the core argument. Monologuing is a red "
        "flag — real influence requires dialogue, not broadcasting."
    ),
    "negotiation": (
        "This is a negotiation — competing interests seeking compromise. Prioritize: balance of "
        "airtime, interruption patterns, response latency (strategic pauses matter here), and "
        "whether both parties had space to present their position. High interruptions and rushed "
        "responses signal a power struggle rather than a deal-making mindset."
    ),
    "adversarial": (
        "This is a conflict or disagreement conversation. Prioritize: listening quality, "
        "interruption patterns, talk ratio balance, response latency. A very high talk ratio "
        "by one person usually signals the other isn't being heard. Frequent interruptions "
        "escalate tension. Long response latency can indicate careful processing or withdrawal."
    ),
    "developmental": (
        "This is a coaching, mentoring, or feedback conversation. Prioritize: question quality "
        "(do questions provoke genuine reflection?), listening-to-talking balance, and whether "
        "the person being developed had space to think. The coach or mentor should talk less, "
        "not more — high talk ratio by the coach is often a red flag."
    ),
    "support": (
        "This is an emotional support or empathy-led conversation. A high talk ratio by the "
        "listener is a red flag — support requires presence, not performance. Prioritize: "
        "listening ratio, response latency (rushing to respond prevents real empathy), question "
        "quality (open vs. closed), and whether the supported person felt genuinely heard."
    ),
    "intimate": (
        "This is a psychologically intimate conversation — deep personal sharing, mutual "
        "vulnerability, or emotional connection. Prioritize: balance of vulnerability between "
        "both speakers, response latency (thoughtful pauses signal processing, not disengagement), "
        "interruption patterns (interruptions feel like ruptures here), and whether both people "
        "had equal space to go deep."
    ),
}


class InsightGenerator:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def generate(self, signals: dict, context: str, user_baseline: dict = None,
                 transcript_text: str = "", dimensions: dict = None,
                 session_history: list = None, resonance_calibration: dict = None,
                 conversation_types: list = None) -> dict:
        structured_input = self._prepare_input(signals, context, user_baseline)
        prompt = self._build_prompt(
            structured_input,
            transcript_text,
            signals.get("notable_signals", []),
            dimensions or {},
            context,
            user_baseline,
            session_history or [],
            resonance_calibration or {},
            conversation_types or [context],
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
            "pitch_mean_hz": signals["pitch_features"].get("mean_hz"),
            "pitch_std_hz": signals["pitch_features"].get("std_hz"),
            "vocal_energy_trend": signals["vocal_energy"].get("trend"),
            "speech_acceleration_trend": signals["speech_acceleration"].get("trend"),
            "speech_delta_wpm": signals["speech_acceleration"].get("delta_wpm"),
            "user_questions_asked": signals["questions"]["user_questions_asked"],
            "other_questions_asked": signals["questions"]["other_questions_asked"],
            "longest_monologue_s": signals["monologue"]["longest_turn_s"],
            "vocabulary_richness_ttr": signals["vocabulary_richness"]["type_token_ratio"],
            "silence_ratio": signals["silence_ratio"]["silence_ratio"],
            "crosstalk_ratio": signals["crosstalk"]["crosstalk_ratio"],
        }

        if baseline:
            source = baseline.get("source")

            def _delta_pct(current, base):
                if not base or base == 0:
                    return None
                return round((current - base) / base * 100, 1)

            if source == "personal_context":
                prepared["baseline_comparison"] = {
                    "type": "personal_context",
                    "context": baseline["context"],
                    "session_count": baseline["session_count"],
                    "speech_rate": {
                        "current": prepared["speech_rate_wpm"],
                        "context_avg": round(baseline["avg_speech_rate_wpm"], 1),
                        "delta_pct": _delta_pct(prepared["speech_rate_wpm"], baseline["avg_speech_rate_wpm"]),
                    },
                    "filler_rate": {
                        "current": prepared["filler_rate_per_100_words"],
                        "context_avg": round(baseline["avg_filler_rate"], 2),
                        "delta_pct": _delta_pct(prepared["filler_rate_per_100_words"], baseline["avg_filler_rate"]),
                    },
                    "response_latency": {
                        "current": prepared["avg_response_latency_s"],
                        "context_avg": round(baseline["avg_response_latency_s"], 2),
                        "delta_pct": _delta_pct(prepared["avg_response_latency_s"], baseline["avg_response_latency_s"]),
                    },
                    "talk_ratio": {
                        "current": prepared["talk_ratio_user"],
                        "context_avg": round(baseline["avg_talk_ratio"], 3),
                        "delta_pp": round(prepared["talk_ratio_user"] - baseline["avg_talk_ratio"], 3),
                    },
                }

            elif source == "population_norm":
                norms = baseline["norms"]

                def _norm_check(val, key, scale=1.0):
                    if key not in norms:
                        return None, None, ""
                    lo, hi, note = norms[key]
                    return (lo <= val <= hi), (round(lo * scale), round(hi * scale)), note

                tr_in, tr_range, tr_note = _norm_check(prepared["talk_ratio_user"], "avg_talk_ratio", scale=100)
                fr_in, fr_range, fr_note = _norm_check(prepared["filler_rate_per_100_words"], "avg_filler_rate")
                rl_in, rl_range, rl_note = _norm_check(prepared["avg_response_latency_s"], "avg_response_latency_s")
                wpm_in, wpm_range, wpm_note = _norm_check(prepared["speech_rate_wpm"], "avg_speech_rate_wpm")

                prepared["baseline_comparison"] = {
                    "type": "population_norm",
                    "context": baseline["context"],
                    "talk_ratio":       {"current_pct": round(prepared["talk_ratio_user"] * 100), "expected_range": tr_range,  "within_norm": tr_in,  "note": tr_note},
                    "filler_rate":      {"current": prepared["filler_rate_per_100_words"],         "expected_range": fr_range,  "within_norm": fr_in,  "note": fr_note},
                    "response_latency": {"current": prepared["avg_response_latency_s"],            "expected_range": rl_range,  "within_norm": rl_in,  "note": rl_note},
                    "speech_rate":      {"current": prepared["speech_rate_wpm"],                   "expected_range": wpm_range, "within_norm": wpm_in, "note": wpm_note},
                }

        return prepared

    def _build_prompt(self, data: dict, transcript_text: str,
                      notable_signals: list, dimensions: dict,
                      context: str, baseline: dict,
                      session_history: list = None,
                      resonance_calibration: dict = None,
                      conversation_types: list = None) -> str:

        # ── Baseline section ──────────────────────────────────────
        baseline_section = ""
        if "baseline_comparison" in data:
            b = data["baseline_comparison"]
            btype = b.get("type")

            def _fmt_delta(delta, unit=""):
                if delta is None:
                    return "no change"
                sign = "+" if delta > 0 else ""
                return f"{sign}{delta}{unit}"

            if btype == "personal_context":
                n = b["session_count"]
                ctx = b["context"].replace("_", " ")
                sr, fr, rl, tr = b["speech_rate"], b["filler_rate"], b["response_latency"], b["talk_ratio"]
                baseline_section = f"""
YOUR {ctx.upper()} BASELINE (from your {n} previous {ctx} sessions):
REQUIRED: reference at least 2 of these comparisons in your observations or coaching.
  Speech rate:      {sr['current']} wpm    vs your {ctx} avg {sr['context_avg']} wpm    ({_fmt_delta(sr['delta_pct'], '%')})
  Filler rate:      {fr['current']}/100w   vs your {ctx} avg {fr['context_avg']}/100w   ({_fmt_delta(fr['delta_pct'], '%')})
  Response latency: {rl['current']}s       vs your {ctx} avg {rl['context_avg']}s       ({_fmt_delta(rl['delta_pct'], '%')})
  Talk ratio:       {round(tr['current']*100)}%          vs your {ctx} avg {round(tr['context_avg']*100)}%          ({_fmt_delta(tr['delta_pp']*100, 'pp')})
"""

            elif btype == "population_norm":
                ctx = b["context"].replace("_", " ")
                tr, fr, rl, sr = b["talk_ratio"], b["filler_rate"], b["response_latency"], b["speech_rate"]

                def _norm_line(label, val_str, entry, range_unit=""):
                    if entry["expected_range"] is None:
                        return ""
                    lo, hi = entry["expected_range"]
                    mark = "✓" if entry["within_norm"] else "✗"
                    note = f"  — {entry['note']}" if entry["note"] else ""
                    return f"  {label}: {val_str} (expected {lo}–{hi}{range_unit}) {mark}{note}"

                lines = [
                    _norm_line("Talk ratio",       f"{tr['current_pct']}%",    tr, "%"),
                    _norm_line("Filler rate",       f"{fr['current']}/100w",    fr, "/100w"),
                    _norm_line("Response latency",  f"{rl['current']}s",        rl, "s"),
                    _norm_line("Speech rate",       f"{sr['current']} wpm",     sr, " wpm"),
                ]
                lines = [l for l in lines if l]

                baseline_section = f"""
CONTEXT NORMS FOR {ctx.upper()} CONVERSATIONS:
IMPORTANT: Do NOT flag ✓ signals as issues — they are within the expected range for this context.
Coach only on ✗ signals. Adjust all observations and suggestions accordingly.
{chr(10).join(lines)}
"""

        # ── Session history ───────────────────────────────────────
        history_section = ""
        if session_history:
            n = len(session_history)
            lines = [
                f"  Session {i+1} ({s['date']}, {s['context'].replace('_',' ')}): "
                f"talk={s['signals']['talk_ratio_pct']}%, "
                f"wpm={s['signals']['wpm']}, "
                f"fillers={s['signals']['filler_rate']}/100w, "
                f"interruptions={s['signals']['interruptions_given']} — "
                f"\"{s['summary']}\""
                + (f" | coached on: {', '.join(s['top_coaching_areas'])}" if s['top_coaching_areas'] else "")
                for i, s in enumerate(session_history)
            ]
            from collections import Counter
            all_areas = [a for s in session_history for a in s.get("top_coaching_areas", [])]
            repeated = [area for area, cnt in Counter(all_areas).most_common() if cnt >= 2]
            repeat_note = (
                f"\n  RECURRING ISSUES (flagged in multiple sessions): {', '.join(repeated)}"
                if repeated else ""
            )
            history_section = f"""
SESSION HISTORY — this is session {n + 1} for this user.
REQUIRED: mention at least one thing that changed or stayed the same vs previous sessions.
{chr(10).join(lines)}{repeat_note}
"""

        # ── Resonance calibration ─────────────────────────────────
        resonance_section = ""
        if resonance_calibration:
            avoid = resonance_calibration.get("avoid", [])
            emphasize = resonance_calibration.get("emphasize", [])
            parts = []
            if avoid:
                parts.append(f"  AVOID making strong claims about: {', '.join(avoid)}")
            if emphasize:
                parts.append(f"  PRIORITIZE observations about: {', '.join(emphasize)}")
            if parts:
                resonance_section = "\nUSER FEEDBACK CALIBRATION:\n" + "\n".join(parts) + "\n"

        # ── Context-specific coaching guide ───────────────────────
        coaching_guide = CONTEXT_COACHING_GUIDE.get(context, CONTEXT_COACHING_GUIDE["social"])

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

        types_str = ", ".join(conversation_types or [context])

        return f"""You are a behavioral communication coach analyzing a real conversation.
Generate a specific, honest coaching report. Write directly to the user ("you", "your").

CONVERSATION TYPES: {types_str}
DURATION: {data['session_duration_minutes']} minutes
{baseline_section}{history_section}{resonance_section}{notable_section}{dimensions_section}
ALL SESSION DATA:
{json.dumps({k: v for k, v in data.items() if k != "baseline_comparison"}, indent=2)}
{transcript_section}
CONTEXT-SPECIFIC COACHING GUIDE (primary type: {context}):
{coaching_guide}

LANGUAGE RULES — follow these precisely:
1. FACTS (measurements) → always direct, no hedging.
2. BEHAVIORAL INTERPRETATIONS → hedge roughly half the time for genuinely uncertain inferences.
3. PSYCHOLOGICAL / EMOTIONAL CLAIMS → always hedge.
4. COACHING SUGGESTIONS → always direct. No hedging.
5. Do not default to talk_ratio, speech_rate, or pauses unless they appear in MOST NOTABLE SIGNALS.
6. Every observation must reference a specific value from the data.
7. Quote from the transcript when it illustrates your point.
8. Never use "SPEAKER_00" or "SPEAKER_01" — always "you" and "the other person".
9. Output valid JSON only — no markdown, no code fences, no extra text.

Output this exact JSON:
{{
  "conversation_types": {json.dumps(conversation_types or [context])},
  "conversation_summary": "3-4 sentences. What was this conversation actually about? What happened? Reference specific things said. What was the overall tone and dynamic?",
  "summary_sentence": "One direct sentence on the overall communication pattern.",
  "observations": [
    {{
      "signal": "signal_name",
      "observation": "Specific observation grounded in an actual value.",
      "resonance_prompt": "A genuine reflective question."
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
      "area": "area name",
      "issue": "Specific issue with actual values.",
      "suggestion": "Exactly what to do differently next time.",
      "why_it_matters": "Why this change improves communication in this type of conversation."
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
    "emotional_state": "2 sentences on emotional state scores for this person in this conversation.",
    "relational_dynamics": "2 sentences on how the two speakers connected or didn't.",
    "communication_effectiveness": "2 sentences on how effectively they communicated.",
    "conversation_arc": "2 sentences on how the conversation evolved."
  }},
  "notable_pattern": "The single most interesting behavioral pattern from this session. One sentence.",
  "data_confidence": "high"
}}"""

    def generate_reflection_questions(self, signals: dict, insights: dict,
                                      transcript_text: str, context: str) -> list:
        prompt = self._build_reflection_prompt(signals, insights, transcript_text, context)
        try:
            response = self.client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.5,
                max_tokens=800,
            )
            return self._parse_reflection(response.choices[0].message.content)
        except Exception:
            return []

    def _build_reflection_prompt(self, signals: dict, insights: dict,
                                  transcript_text: str, context: str) -> str:
        coaching_areas = [c.get("area", "") for c in insights.get("coaching_suggestions", [])[:3]]
        observations_text = "\n".join(
            f"- {o['observation']}" for o in insights.get("observations", [])[:3]
        )
        talkpct = round(signals.get("talk_ratio", {}).get("user_ratio", 0.5) * 100)
        fillers = signals.get("filler_words", {}).get("rate_per_100_words", 0)

        return f"""You are a behavioral coach. A person just finished a {context.replace("_", " ")} conversation.
Generate 3 reflection questions grounded in what actually happened in this session.

Session data:
- Talk ratio: {talkpct}% (you spoke)
- Filler rate: {fillers}/100 words
- Coaching areas flagged: {", ".join(coaching_areas)}

Key observations:
{observations_text}

Transcript sample:
{transcript_text[:600] if transcript_text else "Not available"}

Rules:
1. Each question must be specific to THIS conversation — not generic self-improvement advice.
2. The answer explains what the data reveals and what it might mean. 2-3 sentences.
3. Reference specific moments or patterns from the data/transcript where possible.
4. Write directly to the person ("you", "your").

Output valid JSON only — no markdown, no code fences:
[
  {{
    "question": "A specific, non-generic reflection question grounded in this conversation.",
    "answer": "2-3 sentences explaining what the data shows and what it might mean. Reference something specific."
  }},
  {{
    "question": "Second reflection question addressing a different aspect.",
    "answer": "2-3 sentences on what the data reveals."
  }},
  {{
    "question": "Third question — surface something they might not have noticed.",
    "answer": "2-3 sentences on the insight."
  }}
]"""

    def _parse_reflection(self, raw: str) -> list:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            result = json.loads(clean.strip())
            if isinstance(result, list):
                return result
            return []
        except Exception:
            return []

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
                "conversation_types": ["social"],
                "conversation_summary": "Session analyzed successfully.",
                "summary_sentence": "Session analyzed successfully.",
                "observations": [],
                "coaching_suggestions": [],
                "dimension_narrative": {},
                "notable_pattern": None,
                "data_confidence": "low"
            }
