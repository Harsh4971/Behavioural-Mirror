import numpy as np

# Per-signal (min_samples, cv_threshold) — see roadmap/product_decisions memory for
# the reasoning behind each threshold. These are starting defaults with no real
# user data yet; expect to tune once sessions accumulate.
#
# Extension point: hedging / directness / building_on_others / question_impact /
# drive_vs_follow plug in here once their extraction exists (Phase B2 follow-up).
# Same shape, nothing else in this module needs to change.
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
