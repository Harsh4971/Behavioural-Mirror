import json
from anthropic import Anthropic

from pipeline.llm_utils import extract_text

CONTEXT_TYPES = {
    "social":        "Casual chat, catching up, small talk, low-stakes relationship maintenance",
    "collaborative": "Team meetings, brainstorming, planning, group problem-solving",
    "evaluative":    "Job interviews, performance reviews, presentations, demos — being assessed or assessing",
    "influential":   "Sales calls, pitches, persuasion — trying to change someone's decision or position",
    "negotiation":   "Deal-making, bargaining, competing interests seeking compromise",
    "adversarial":   "Arguments, disagreements, conflict, tense confrontations, defensive dynamics",
    "developmental": "Coaching, mentoring, feedback sessions — one person deliberately growing another",
    "support":       "Emotional support, venting, empathy-led listening, therapy-adjacent conversations",
    "intimate":      "Deep personal sharing, mutual vulnerability, psychological connection",
}


class ContextDetector:
    def __init__(self, api_key: str):
        self.client = Anthropic(api_key=api_key)

    def detect(self, transcript_text: str) -> list:
        types_list = "\n".join(f"- {k}: {v}" for k, v in CONTEXT_TYPES.items())
        prompt = f"""Analyze this conversation transcript and classify it into 1–3 conversation types.

TYPES:
{types_list}

TRANSCRIPT:
{transcript_text[:3000]}

Return ONLY a JSON array of 1–3 type keys, ordered by relevance (most relevant first).
Example: ["evaluative", "adversarial"]
Use only the exact keys listed above. No explanation, no markdown."""

        try:
            response = self.client.messages.create(
                model="claude-sonnet-5",
                max_tokens=50,
                thinking={"type": "disabled"},
                messages=[{"role": "user", "content": prompt}],
            )
            raw = extract_text(response).strip()
            if "```" in raw:
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw.strip())
            valid = [t for t in result if t in CONTEXT_TYPES]
            return valid[:3] if valid else ["social"]
        except Exception:
            return ["social"]
