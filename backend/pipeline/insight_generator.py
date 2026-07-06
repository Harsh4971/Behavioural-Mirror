import json
from groq import Groq

from pipeline.evidence_gate import SIGNAL_EVIDENCE_CONFIG


CONTEXT_COACHING_GUIDE = {
    "social": (
        "Casual, low-stakes social conversation. Focus on rapport, warmth, and reciprocal "
        "engagement. Avoid applying professional communication standards."
    ),
    "collaborative": (
        "Collaborative working conversation (meeting, brainstorming, planning). "
        "Balanced airtime, turn-taking, and mutual engagement matter most."
    ),
    "evaluative": (
        "Evaluative conversation — interview, presentation, or assessment. "
        "Confidence, directness, and concise responses signal competence. "
        "Evaluators expect dialogue, not lectures."
    ),
    "influential": (
        "Persuasion or influence conversation (sales, pitch). Real influence "
        "requires dialogue — monologuing is a red flag. Questions should draw out needs."
    ),
    "negotiation": (
        "Negotiation — competing interests seeking compromise. Balanced airtime, "
        "strategic pauses, and space for both sides to present their position matter."
    ),
    "adversarial": (
        "Conflict or disagreement. Listening quality and interruption patterns are "
        "critical. High talk ratio by one person usually means the other isn't being heard."
    ),
    "developmental": (
        "Coaching, mentoring, or feedback conversation. The coach should talk less, "
        "not more. Question quality and space for reflection matter most."
    ),
    "support": (
        "Emotional support conversation. Presence over performance — rushing to respond "
        "prevents real empathy. Listening ratio and open questions are key."
    ),
    "intimate": (
        "Psychologically intimate conversation. Balance of vulnerability between both "
        "speakers, thoughtful pauses, and no interruptions matter deeply."
    ),
}


class InsightGenerator:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)

    def generate(self, signals: dict, context: str, evidence: dict = None,
                 transcript_text: str = "", dimensions: dict = None,
                 session_history: list = None, resonance_calibration: dict = None,
                 conversation_types: list = None) -> dict:
        structured_input = self._prepare_input(signals, context, evidence)
        prompt = self._build_prompt(
            structured_input,
            transcript_text,
            context,
            session_history or [],
            resonance_calibration or {},
            conversation_types or [context],
        )
        response = self.client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
        )
        return self._parse_output(response.choices[0].message.content)

    def _prepare_input(self, signals: dict, context: str, evidence: dict) -> dict:
        prepared = {
            "context": context,
            "session_duration_minutes": round(signals["session_duration_s"] / 60, 1),
            "talk_ratio_user": signals["talk_ratio"]["user_ratio"],
            "speech_rate_wpm": signals["speech_rate"]["overall_wpm"],
            "filler_rate_per_100_words": signals["filler_words"]["rate_per_100_words"],
            "top_filler_words": list(signals["filler_words"]["breakdown"].keys())[:3],
            "user_interrupted_other": signals["interruptions"]["user_interrupted_other"],
            "user_was_interrupted": signals["interruptions"]["user_was_interrupted"],
            "longest_monologue_s": signals["monologue"]["longest_turn_s"],
            "user_questions_asked": signals["questions"]["user_questions_asked"],
            "other_questions_asked": signals["questions"]["other_questions_asked"],
            "avg_response_latency_s": signals["pauses"]["response_latency"]["mean_s"],
        }

        if evidence:
            # Per-signal evidence gating (CLAUDE.md rule #3): each tracked signal either
            # has enough steady evidence for a self-relative comparison, or it doesn't —
            # in which case it's listed as not-yet-steady so the prompt can explicitly
            # instruct against inventing a pattern for it. Self-relative only (rule #4) —
            # no population comparison of any kind.
            signal_current_value = {
                "talk_ratio": prepared["talk_ratio_user"],
                "questions": prepared["user_questions_asked"],
                "speech_rate": prepared["speech_rate_wpm"],
                "response_latency": prepared["avg_response_latency_s"],
            }
            steady = {}
            not_yet_steady = []
            for sig_key, sig_evidence in evidence.get("signals", {}).items():
                current = signal_current_value.get(sig_key)
                if sig_evidence["is_steady"] and current is not None:
                    delta = current - sig_evidence["mean"]
                    delta_pct = (delta / sig_evidence["mean"] * 100) if sig_evidence["mean"] else None
                    steady[sig_key] = {
                        "current": current,
                        "your_usual": round(sig_evidence["mean"], 3),
                        "delta": round(delta, 3),
                        "delta_pct": round(delta_pct, 1) if delta_pct is not None else None,
                        "sample_count": sig_evidence["sample_count"],
                    }
                else:
                    not_yet_steady.append({
                        "signal": sig_key,
                        "sample_count": sig_evidence["sample_count"],
                        "min_needed": sig_evidence["min_samples_required"],
                    })
            prepared["evidence"] = {
                "context": evidence["context"],
                "steady": steady,
                "not_yet_steady": not_yet_steady,
            }

        return prepared

    def _build_prompt(self, data: dict, transcript_text: str,
                      context: str,
                      session_history: list,
                      resonance_calibration: dict,
                      conversation_types: list) -> str:

        coaching_guide = CONTEXT_COACHING_GUIDE.get(context, CONTEXT_COACHING_GUIDE["social"])

        # ── Transcript (PRIMARY) ──────────────────────────────────────
        transcript_section = ""
        if transcript_text:
            transcript_section = f"""
CONVERSATION TRANSCRIPT:
{transcript_text}

"""

        # ── Supporting signals ────────────────────────────────────────
        fillers_str = ", ".join(data["top_filler_words"]) if data["top_filler_words"] else "none detected"
        signals_section = f"""SUPPORTING DATA (use to ground observations — do not lead with these):
  You spoke: {round(data['talk_ratio_user'] * 100)}% of the time
  Speech rate: {data['speech_rate_wpm']} wpm
  Filler words: {data['filler_rate_per_100_words']}/100 words (top: {fillers_str})
  Interruptions you gave: {data['user_interrupted_other']} | received: {data['user_was_interrupted']}
  Longest unbroken stretch: {data['longest_monologue_s']}s
  Questions you asked: {data['user_questions_asked']} | they asked: {data['other_questions_asked']}
  Response latency: {data['avg_response_latency_s']}s avg
  Duration: {data['session_duration_minutes']} minutes
"""

        # ── Evidence (self-relative only — per-signal gated, CLAUDE.md rules #3/#4) ────
        evidence_section = ""
        ev = data.get("evidence")
        if ev:
            ctx_label = ev["context"].replace("_", " ")
            lines = []
            for sig_key, c in ev["steady"].items():
                label = SIGNAL_EVIDENCE_CONFIG[sig_key]["label"]
                if c["delta"] > 0:
                    arrow = "more than"
                elif c["delta"] < 0:
                    arrow = "less than"
                else:
                    arrow = "about the same as"
                lines.append(
                    f"  {label}: {c['current']} vs your usual {c['your_usual']} "
                    f"({arrow} usual, based on {c['sample_count']} past {ctx_label} sessions)"
                )
            if lines:
                evidence_section = (
                    f"\nYOUR ESTABLISHED {ctx_label.upper()} PATTERNS "
                    f"(self-relative — compare ONLY to this user's own history, never to other people):\n"
                    + "\n".join(lines) + "\n"
                )

            not_ready = ev.get("not_yet_steady", [])
            if not_ready:
                labels = ", ".join(SIGNAL_EVIDENCE_CONFIG[n["signal"]]["label"] for n in not_ready)
                evidence_section += (
                    f"\nNOT ENOUGH EVIDENCE YET for: {labels}. "
                    f"Do NOT say \"more/less than usual\" for these — report this session's raw numbers "
                    f"as observations only, with no comparison framing. It is fine to have less to say "
                    f"here; do not invent a pattern.\n"
                )

        # ── Session history (fingerprints + anti-repetition) ─────────
        history_section = ""
        if session_history:
            n = len(session_history)
            lines = []
            for i, s in enumerate(session_history[-5:]):  # last 5 only to stay focused
                ctx = s["context"].replace("_", " ")
                fp = s.get("fingerprint") or s.get("summary", "")
                if fp:
                    lines.append(f"  Session {i+1} ({s['date']}, {ctx}): {fp[:280]}")
            if lines:
                history_section = f"""
PAST SESSION FINGERPRINTS — this is session {n + 1} for this user:
{chr(10).join(lines)}

ANTI-REPETITION DIRECTIVE — THIS IS CRITICAL:
The fingerprints above show what has already been observed and documented. Do NOT simply restate these patterns as your primary findings for this session.
— If a known pattern appears in this conversation, you may reference it in AT MOST one sentence of one observation. Then move on.
— Your primary job is to find what ELSE is true about this person — patterns and qualities not yet captured.
— Actively look past the most obvious surface signal (talk ratio, dominance) and go deeper: HOW they think, argue, reframe, navigate, connect, challenge, and respond.
— A repeat observation is a wasted observation. Surprise the user with something they haven't seen before.
"""

        # ── Resonance calibration ─────────────────────────────────────
        resonance_section = ""
        if resonance_calibration:
            avoid = resonance_calibration.get("avoid", [])
            emphasize = resonance_calibration.get("emphasize", [])
            parts = []
            if avoid:
                parts.append(f"  AVOID strong claims about: {', '.join(avoid)}")
            if emphasize:
                parts.append(f"  PRIORITIZE observations about: {', '.join(emphasize)}")
            if parts:
                resonance_section = "\nUSER FEEDBACK CALIBRATION:\n" + "\n".join(parts) + "\n"

        types_str = ", ".join(conversation_types)

        return f"""You are a behavioral communication coach. Read the conversation transcript below and provide a deep, specific analysis.

CONTEXT: {types_str} — {coaching_guide}
{transcript_section}{signals_section}{evidence_section}{history_section}{resonance_section}
WHAT TO LOOK FOR — scan the transcript across ALL of these dimensions. Do not default to the obvious:

PERSPECTIVE & THINKING STYLE
1. Do they take a conventional or contrarian view? Do they reframe the question before answering it?
2. How do they build an argument — through logic, personal experience, analogy, examples, or principles?
3. Do they think out loud (ideas forming in real time) or present already-formed positions?
4. Do they zoom to the big picture naturally, or drill into specifics? Which happens when pushed?
5. Do they introduce new angles that weren't in the conversation before, or mostly react to what's raised?

CLARITY & EXPRESSION
6. Do they simplify complex ideas, or add nuance to simple ones?
7. How precise is their language — do they commit ("this is wrong") or hedge constantly ("kind of", "I think maybe")?
8. Do they use vivid, concrete examples or stay abstract?
9. How do they structure a point — building to a conclusion, or leading with it?

CONVERSATION NAVIGATION
10. Who drives the topics in this conversation — them or the other person?
11. Do they shift the tone — lightening heavy moments, or deepening casual ones?
12. How do they transition between subjects — abruptly, with bridges, or by connecting ideas?
13. Do they circle back to things raised earlier, or let threads drop?

HANDLING CHALLENGE & PUSHBACK
14. When challenged or pushed back on, do they get curious, defensive, or simply louder?
15. Do they actually change their position during the conversation? What moves them?
16. How do they handle a question they don't want to answer or can't answer well?

LISTENING & RESPONSE QUALITY
17. Do they build on what the other person just said, or immediately pivot to their own point?
18. Do they ask follow-up questions out of genuine curiosity, or use questions rhetorically?
19. Do they acknowledge the other person's point before responding, or talk past it?
20. What's the quality of their questions — surface-level, probing, or reframing?

SELF-AWARENESS & META-COMMUNICATION
21. Do they catch themselves mid-thought, correct course, or acknowledge when they're uncertain?
22. Do they notice and adapt when the other person seems disengaged, confused, or unconvinced?
23. Do they signal clearly when they're confident vs. when they're speculating?

WARMTH, HUMOR & RELATIONAL SIGNALS
24. Are there moments of humor, warmth, or levity? How are they deployed — to connect, deflect, or ease tension?
25. Do they validate the other person's experience or viewpoint before moving on?

RULES:
1. Ground every observation in something that actually happened — quote directly (in "quotes") when it makes the point concrete
2. Never refer to speakers as SPEAKER_00 or SPEAKER_01 — use "you" and "the other person"
3. Write directly to the user ("you", "your")
4. DIVERSITY RULE: Each of the 3 observations must cover a completely different dimension cluster from the list above. Never write 3 variations of the same theme.
5. STRENGTH RULE: At least one observation must describe a genuine strength, a distinctive quality, or something interesting about how this person communicates — not just a coaching point
6. ANTI-REPETITION RULE: Already-known patterns from session history get at most one brief reference total. Find what's NEW or nuanced about THIS conversation.
7. Don't flag signals that are within normal range for this context type
8. Specific beats vague: "you dominated the conversation" is not an observation. "When they raised X, you pivoted immediately to Y without acknowledging their point" is.
9. Output valid JSON only — no markdown, no code fences

Output this exact JSON:
{{
  "conversation_summary": "2-3 sentences. What was this conversation about — the topic, the dynamic, the overall tone. Describe the situation, not the person.",
  "user_perspective": "2-3 sentences written directly to the user about THEIR specific role in this conversation. What position did they take? What did they argue or bring up? What seemed to matter to them? Reference specific things they said or moments where their voice was distinct. Make them feel seen — like someone was actually paying attention to what they contributed, not just measuring them.",
  "summary_sentence": "One direct sentence capturing the dominant behavioral pattern in this conversation.",
  "observations": [
    {{
      "signal": "signal_name",
      "observation": "Specific observation grounded in what actually happened. Quote from transcript where it makes the point concrete. Each observation must cover a DIFFERENT behavioral dimension — perspective/thinking, clarity/expression, conversation navigation, handling challenge, listening quality, self-awareness, or warmth/relational.",
      "resonance_prompt": "A genuine reflective question specific to this moment — not generic."
    }},
    {{
      "signal": "different_signal_different_cluster",
      "observation": "Second observation — must cover a dimension NOT covered by observation 1. At least one observation across the three must be about a strength or distinctive quality.",
      "resonance_prompt": "Second reflective question."
    }},
    {{
      "signal": "third_signal_third_cluster",
      "observation": "Third observation — must cover a dimension not covered by observations 1 or 2.",
      "resonance_prompt": "Third reflective question."
    }}
  ],
  "coaching_suggestions": [
    {{
      "priority": 1,
      "area": "area name",
      "issue": "What specifically happened in this conversation — quote or reference the moment.",
      "suggestion": "Exactly what to do differently next time.",
      "why_it_matters": "Why this matters in this type of conversation."
    }},
    {{
      "priority": 2,
      "area": "different area",
      "issue": "Second specific issue from this conversation.",
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
  "notable_pattern": "The single most interesting or surprising behavioral pattern from this session. One sentence.",
  "fingerprint": "200-300 words. A rich behavioral portrait of THIS {context.replace('_', ' ')} conversation covering MULTIPLE dimensions — aim for at least 4 of these 7: (1) thinking style: how they frame arguments, contrarian vs conventional, big-picture vs detail; (2) clarity and expression: language precision, use of examples, how they structure a point; (3) conversation navigation: who drove topics, tone shifts, how they transitioned; (4) handling challenge: response to pushback, whether they shifted position, what moved them; (5) listening quality: whether they built on what was said or pivoted, quality of their questions; (6) self-awareness: catching themselves, adapting mid-conversation, signaling uncertainty; (7) warmth and relational style: humor, validation, how they calibrate to the other person. Write in behavioral terms — no raw numbers. If talk ratio or dominance is already established across prior sessions, do NOT make it the centrepiece of this fingerprint — mention it briefly if relevant, then cover other dimensions. This fingerprint feeds future AI sessions and must build a richer picture each time.",
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
                "conversation_summary": "Session analyzed.",
                "user_perspective": None,
                "summary_sentence": "Session analyzed.",
                "observations": [],
                "coaching_suggestions": [],
                "notable_pattern": None,
                "fingerprint": None,
                "data_confidence": "low",
            }
