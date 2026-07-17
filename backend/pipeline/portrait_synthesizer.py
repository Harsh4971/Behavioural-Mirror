import json
from anthropic import Anthropic

from pipeline.evidence_gate import SIGNAL_EVIDENCE_CONFIG
from pipeline.llm_utils import extract_text

# How to format each signal's raw mean into human-readable text for the prompt.
# (value * scale) formatted with `fmt`, followed by `unit`. Categorical signals
# (pacing_arc, energy_arc) aren't listed here — they have no numeric mean to
# scale, see the branch in _format_mean below.
_SIGNAL_FORMAT = {
    "talk_ratio":               (100, "{:.0f}", "% of speaking time"),
    "curiosity":                (1,   "{:.2f}", " question-turns per 100 words"),
    "turn_taking_assertiveness": (1,  "{:.1f}", " interruptions per 10 speaker changes"),
    "conversational_drive":     (100, "{:.0f}", "% drive score (higher = initiates more, lower = follows more)"),
    "hedging":                  (1,   "{:.1f}", " hedging phrases per 100 words"),
    "directness":               (1,   "{:.1f}", " direct/assertive phrases per 100 words"),
    "building_on_others":       (100, "{:.0f}", "% of your turns build on someone else's point"),
    "pace":                     (1,   "{:.0f}", " words per minute"),
    "vocal_expressiveness":     (1,   "{:.1f}", " Hz of pitch variation"),
    "turn_length":              (1,   "{:.1f}", "s per turn on average"),
    "vocabulary_richness":      (100, "{:.0f}", "% unique words in a typical stretch of speech"),
    "fillers":                  (1,   "{:.2f}", " filler words per 100 words"),
    "response_latency":         (1,   "{:.1f}", "s before responding"),
}


def _format_mean(signal_key: str, value) -> str:
    """Formats a continuous signal's numeric mean, or a categorical signal's
    string mode label, into human-readable text for the prompt."""
    if SIGNAL_EVIDENCE_CONFIG.get(signal_key, {}).get("kind") == "categorical":
        return f"consistently {value}"
    scale, fmt, unit = _SIGNAL_FORMAT[signal_key]
    return fmt.format(value * scale) + unit


class PortraitSynthesizer:
    """Replaces PersonalitySynthesizer's role for the You page's standing portrait.
    Unlike the old system, this never invents a dimension or assigns a numeric
    score — it only phrases signals that are already evidence-steady (CLAUDE.md
    rule #3), always self-relative (rule #4), and classifies each qualitatively
    (strength / growth_area / observation) rather than grading the person.
    """

    def __init__(self, api_key: str):
        self.client = Anthropic(api_key=api_key)

    def synthesize(self, evidence: dict, blind_spots: list, session_count: int,
                    sub_evidence: dict = None) -> dict:
        overall = evidence.get("overall", {})
        by_context = evidence.get("by_context", {})

        steady_overall = {
            k: v for k, v in overall.items() if v.get("is_steady")
        }

        # Signals steady in 2+ different contexts — candidates for "how you shift
        # by context". Self-relative: comparing the person's own behavior across
        # their own contexts, never against other people.
        context_shift_candidates = {}
        for signal_key in SIGNAL_EVIDENCE_CONFIG:
            is_categorical = SIGNAL_EVIDENCE_CONFIG[signal_key]["kind"] == "categorical"
            value_field = "mode_label" if is_categorical else "mean"
            steady_contexts = {
                ctx: data[signal_key][value_field]
                for ctx, data in by_context.items()
                if data.get(signal_key, {}).get("is_steady")
            }
            if len(steady_contexts) >= 2:
                context_shift_candidates[signal_key] = steady_contexts

        if not steady_overall and not context_shift_candidates:
            return {"signals": [], "context_shifts": [], "how_it_may_land": []}

        prompt = self._build_prompt(steady_overall, context_shift_candidates, session_count,
                                     sub_evidence or {})
        response = self.client.messages.create(
            model="claude-sonnet-5",
            max_tokens=1800,
            thinking={"type": "disabled"},
            messages=[{"role": "user", "content": prompt}],
        )
        return self._parse(extract_text(response))

    def _build_prompt(self, steady_overall: dict, context_shift_candidates: dict,
                      session_count: int, sub_evidence: dict) -> str:
        signal_lines = []
        for signal_key, ev in steady_overall.items():
            label = SIGNAL_EVIDENCE_CONFIG[signal_key]["label"]
            is_categorical = SIGNAL_EVIDENCE_CONFIG[signal_key]["kind"] == "categorical"
            value = ev["mode_label"] if is_categorical else ev["mean"]
            desc = f"  {label} ({signal_key}): established at {_format_mean(signal_key, value)}, " \
                   f"based on {ev['sample_count']} sessions"
            signal_lines.append(desc)

        # question_pickup is a sub-signal (folded into "curiosity" on Home, see
        # evidence_gate.SUB_SIGNAL_EVIDENCE_CONFIG) — not part of steady_overall,
        # so its own evidence dict is passed in separately.
        wants_how_it_may_land = sub_evidence.get("question_pickup", {}).get("is_steady", False)

        context_lines = []
        for signal_key, by_ctx in context_shift_candidates.items():
            label = SIGNAL_EVIDENCE_CONFIG[signal_key]["label"]
            parts = ", ".join(
                f"{ctx.replace('_', ' ')}: {_format_mean(signal_key, value)}"
                for ctx, value in by_ctx.items()
            )
            context_lines.append(f"  {label} ({signal_key}) — {parts}")

        how_it_may_land_task = (
            "\nALSO: \"question follow-through\" is established. Write ONE "
            "additional sentence describing how this person's questions tend to LAND in the room — "
            "effect-on-others phrasing, e.g. \"your questions tend to get picked up and built on by "
            "the room\" — still self-relative (this person's own tendency), never a claim about what "
            "any specific other person did.\n"
            if wants_how_it_may_land else ""
        )
        how_it_may_land_schema = (
            ',\n  "how_it_may_land": [\n'
            '    {"signal_key": "curiosity", "note": "one sentence"}\n  ]'
            if wants_how_it_may_land else ""
        )

        return f"""You are writing the "You" standing portrait for a communication-coaching app. This
person has recorded {session_count} conversations. Below are ONLY the signals with enough
accumulated evidence to describe as an established tendency — do not discuss anything not
listed here, and do not invent numbers.

ESTABLISHED SIGNALS (self-relative — this person's own average, never compared to other people):
{chr(10).join(signal_lines) if signal_lines else "  (none yet)"}

SIGNALS THAT SHIFT BY CONTEXT (same signal, compared across this person's own different conversation types):
{chr(10).join(context_lines) if context_lines else "  (none yet)"}

TASK: For each established signal, write ONE sentence describing it as an observed tendency —
self-relative language only ("you tend to...", never "you are a [trait] person"). Classify it as:
  - "strength": a tendency that generally serves this person well in the contexts it showed up in
  - "growth_area": a tendency that might be worth this person's attention — phrase gently, as a
    possibility ("this may be worth noticing"), never as a verdict or a flaw
  - "observation": a tendency that's simply true and notable, with no clear positive/negative read
    (e.g. pace, which is a style choice, not a strength or weakness on its own)

Rules:
- NEVER invent a number, score, or grade. Only use the numbers given above.
- NEVER use personality-trait labels ("confident", "assertive person", "a natural leader") — describe
  the BEHAVIOR, not the person's character.
- Keep each note to one sentence, warm and specific, like a perceptive coach — not a report.
- It is fine and expected to have fewer strengths than growth_areas or vice versa — do not force balance.

For each context-shift signal, write ONE sentence comparing how it shows up differently across this
person's own contexts (e.g. "You tend to ask more questions in collaborative settings than in
evaluative ones") — self-relative only, never implying one context's version is objectively better.
{how_it_may_land_task}
Output valid JSON only — no markdown, no code fences, no extra text:
{{
  "signals": [
    {{"signal_key": "<one of the signal_key values above>", "framing": "strength" | "growth_area" | "observation", "note": "one sentence"}}
  ],
  "context_shifts": [
    {{"signal_key": "<one of the signal_key values above>", "note": "one sentence"}}
  ]{how_it_may_land_schema}
}}"""

    def _parse(self, raw: str) -> dict:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            parsed = json.loads(clean.strip())
            return {
                "signals": parsed.get("signals", []),
                "context_shifts": parsed.get("context_shifts", []),
                "how_it_may_land": parsed.get("how_it_may_land", []),
            }
        except Exception:
            return {"signals": [], "context_shifts": [], "how_it_may_land": []}

    def synthesize_paragraph(self, evidence: dict, previous_paragraph: str, session_count: int) -> dict:
        """Standing narrative paragraph + short tag chips for the You page.
        Self-referential (unlike synthesize() above) — includes the previous
        paragraph's own text when one exists, so the LLM revises rather than
        rewrites from scratch on every refresh. Tags are generated in this
        same call rather than separately, so they never contradict a
        paragraph built from different evidence. Gated the same way as the
        rest of the portrait: needs at least one steady overall signal.
        """
        overall = evidence.get("overall", {})
        steady_overall = {k: v for k, v in overall.items() if v.get("is_steady")}
        if not steady_overall:
            return {"text": None, "tags": []}

        signal_lines = []
        for signal_key, ev in steady_overall.items():
            label = SIGNAL_EVIDENCE_CONFIG[signal_key]["label"]
            is_categorical = SIGNAL_EVIDENCE_CONFIG[signal_key]["kind"] == "categorical"
            value = ev["mode_label"] if is_categorical else ev["mean"]
            signal_lines.append(
                f"  {label} ({signal_key}): established at {_format_mean(signal_key, value)}, "
                f"based on {ev['sample_count']} sessions"
            )

        previous_section = (
            f"\nYour previously-written paragraph (revise it, don't ignore it — keep continuity "
            f"of voice, but genuinely update anything the new evidence below changes; don't just "
            f"reword the same sentence):\n\"{previous_paragraph}\"\n"
            if previous_paragraph else ""
        )

        prompt = f"""You are writing the standing narrative paragraph for the "You" page of a
communication-coaching app. This person has recorded {session_count} conversations. Below are
ONLY the signals with enough accumulated evidence to describe as an established tendency.
{previous_section}
ESTABLISHED SIGNALS (self-relative — this person's own average, never compared to other people):
{chr(10).join(signal_lines)}

TASK 1 — Write a short (2-4 sentence) narrative paragraph that weaves together several of these
established signals into one coherent read of how this person tends to communicate — connective
tissue between signals, not a list of individual facts (those already exist elsewhere on the
page). Self-relative language only ("you tend to..."), never personality-trait labels
("confident", "a natural leader") — describe behavior, not character.

TASK 2 — Pick the 3-4 MOST DISTINCTIVE of the signals above (not necessarily all of them) and
phrase each as a short (2-4 word) verb-first behavioral chip — punchy and specific, but strictly
about action/behavior, never an identity label. Good: "Holds ground", "Questions first", "Rarely
interrupts". Forbidden: "Confident", "Direct", "Curious" (identity/trait words, not behavior).

Rules:
- NEVER invent a number, score, or grade. Only use the numbers given above.
- NEVER use personality-trait labels anywhere in either output.
- It's fine to have fewer than 4 tags if fewer signals are truly distinctive — don't pad.

Output valid JSON only — no markdown, no code fences, no extra text:
{{
  "text": "2-4 sentence paragraph",
  "tags": ["short tag", "short tag", ...]
}}"""

        response = self.client.messages.create(
            model="claude-sonnet-5",
            max_tokens=600,
            thinking={"type": "disabled"},
            messages=[{"role": "user", "content": prompt}],
        )
        return self._parse_paragraph(extract_text(response))

    def _parse_paragraph(self, raw: str) -> dict:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            parsed = json.loads(clean.strip())
            return {"text": parsed.get("text"), "tags": parsed.get("tags", [])}
        except Exception:
            return {"text": None, "tags": []}

    def synthesize_coaching(self, grouped_suggestions: dict, session_count: int) -> dict:
        """"Where You Might Grow" — distills recurring coaching_suggestions
        (already grouped by dimension_key and pre-filtered to >=2 recurrences
        by the caller) into a small standing set. Different input class from
        synthesize()/synthesize_paragraph() above — raw per-session text
        grounded in specific transcript moments, not evidence-gated numeric
        means — kept as a separate call rather than folded in, so this call's
        input never mixes with the evidence-only discipline of the others.
        """
        if not grouped_suggestions:
            return {"items": []}

        group_blocks = []
        for dimension_key, instances in grouped_suggestions.items():
            label = SIGNAL_EVIDENCE_CONFIG.get(dimension_key, {}).get("label", dimension_key)
            instance_lines = "\n".join(
                f"    - issue: {inst['issue']}\n      suggestion: {inst['suggestion']}\n      why_it_matters: {inst['why_it_matters']}"
                for inst in instances
            )
            group_blocks.append(
                f"DIMENSION: {label} ({dimension_key}) — appeared in {len(instances)} separate sessions\n{instance_lines}"
            )

        prompt = f"""You are writing the "Where You Might Grow" section for a communication-coaching
app's standing "You" page. This person has recorded {session_count} conversations. Below are
growth-area coaching suggestions that recurred across MULTIPLE separate sessions — each block is
one theme that came up more than once, with the specific instance it was noted in each time.

{chr(10).join(f"{chr(10)}{block}" for block in group_blocks)}

TASK: For each dimension block, write ONE distilled entry describing the STANDING pattern across
these instances — not a repeat of any single instance, the recurring theme itself. Self-relative,
gentle, possibility-framed language only ("this may be worth noticing"), never a verdict.

Rules:
- Ground the "pattern" in what's actually common across the instances, don't invent anything new.
- "suggestion" should be one concrete, actionable thing to try — not vague ("communicate better").
- NEVER use personality-trait labels — describe the behavior, not the person's character.

Output valid JSON only — no markdown, no code fences, no extra text:
{{
  "items": [
    {{"dimension_key": "<the dimension_key from above>", "pattern": "the recurring theme, one sentence", "suggestion": "one concrete thing to try", "why_it_matters": "one sentence"}}
  ]
}}"""

        response = self.client.messages.create(
            model="claude-sonnet-5",
            max_tokens=1200,
            thinking={"type": "disabled"},
            messages=[{"role": "user", "content": prompt}],
        )
        return self._parse_coaching(extract_text(response), grouped_suggestions)

    def _parse_coaching(self, raw: str, grouped_suggestions: dict) -> dict:
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            parsed = json.loads(clean.strip())
            items = []
            for item in parsed.get("items", []):
                dimension_key = item.get("dimension_key")
                if dimension_key not in grouped_suggestions:
                    continue
                items.append({
                    "dimension_key": dimension_key,
                    "pattern": item.get("pattern"),
                    "suggestion": item.get("suggestion"),
                    "why_it_matters": item.get("why_it_matters"),
                    "recurrence_count": len(grouped_suggestions[dimension_key]),
                })
            return {"items": items}
        except Exception:
            return {"items": []}
