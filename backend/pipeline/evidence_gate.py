import numpy as np

# Per-signal (min_samples, cv_threshold) — see roadmap/product_decisions memory for
# the reasoning behind each threshold. These are starting defaults with no real
# user data yet; expect to tune once sessions accumulate.
SIGNAL_EVIDENCE_CONFIG = {
    "talk_ratio": {
        "min_samples": 5,
        "cv_threshold": 0.20,
        "extract": lambda sig: sig["talk_ratio"]["user_ratio"],
        "label": "talk-share",
    },
    "questions": {
        "min_samples": 5,
        "cv_threshold": 0.35,
        "extract": lambda sig: sig["questions"]["user_questions_asked"],
        "label": "curiosity",
    },
    "speech_rate": {
        "min_samples": 5,
        "cv_threshold": 0.15,
        "extract": lambda sig: sig["speech_rate"]["overall_wpm"],
        "label": "pace",
    },
    "response_latency": {
        "min_samples": 5,
        "cv_threshold": 0.40,
        "extract": lambda sig: sig["pauses"]["response_latency"]["mean_s"],
        "label": "pauses",
    },
    "hedging": {
        "min_samples": 5,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["hedging"]["rate_per_100_words"],
        "label": "hedging",
    },
    "directness": {
        "min_samples": 5,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["directness"]["rate_per_100_words"],
        "label": "directness",
    },
    "question_impact": {
        "min_samples": 6,
        "cv_threshold": 0.45,
        "extract": lambda sig: sig["question_impact"]["pickup_rate"],
        "label": "question follow-through",
    },
    "drive_vs_follow": {
        "min_samples": 6,
        "cv_threshold": 0.35,
        "extract": lambda sig: sig["drive_vs_follow"]["drive_score"],
        "label": "conversational drive",
    },
    "building_on_others": {
        "min_samples": 6,
        "cv_threshold": 0.40,
        "extract": lambda sig: sig["building_on_others"]["building_on_rate"],
        "label": "building on others",
    },
}

# Rolling window — matches the window the old baseline logic already used, so
# "steady" is evaluated against recent behavior, not all-time history.
ROLLING_WINDOW = 10


def compute_signal_evidence(signal_key: str, historical_values: list) -> dict:
    """Given all past values of one signal (oldest→newest) for a user+context,
    return an evidence summary: sample_count, mean, cv, is_steady.

    Pure function over already-extracted values — doesn't fetch data itself,
    so it's independently testable regardless of where the values came from.
    """
    cfg = SIGNAL_EVIDENCE_CONFIG[signal_key]
    # Some signals (e.g. question_impact) legitimately have no value for a session
    # (zero questions asked) — None, not a fake 0, so drop it rather than let it
    # pollute the mean/cv or crash np.mean.
    historical_values = [v for v in historical_values if v is not None]
    n = len(historical_values)
    result = {
        "signal": signal_key,
        "sample_count": n,
        "min_samples_required": cfg["min_samples"],
        "is_steady": False,
        "mean": None,
        "cv": None,
    }
    if n < cfg["min_samples"]:
        return result

    window = historical_values[-ROLLING_WINDOW:]
    mean = float(np.mean(window))
    result["mean"] = mean
    if abs(mean) < 1e-9:
        return result
    cv = float(np.std(window) / abs(mean))
    result["cv"] = round(cv, 3)
    result["is_steady"] = cv <= cfg["cv_threshold"]
    return result


def extract_value(signal_key: str, signals: dict):
    """Pull this signal's tracked scalar out of a full `signals` dict (as stored
    in sessions.signals_json)."""
    return SIGNAL_EVIDENCE_CONFIG[signal_key]["extract"](signals)
