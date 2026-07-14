import numpy as np
from collections import Counter

# Per-signal (min_samples, threshold) — see roadmap/product_decisions memory for
# the reasoning behind each value. These are starting defaults with no real
# user data yet; expect to tune once sessions accumulate.
#
# "kind" dispatches which evidence function applies:
#   "continuous"  — a numeric rate/ratio, steadiness = coefficient of variation
#                    (std/mean) at or below cv_threshold.
#   "categorical" — a string label (e.g. "accelerating"/"stable"/"decelerating"),
#                    steadiness = the most common label's share of the rolling
#                    window at or above agreement_threshold. Used for the two
#                    "arc" signals whose natural magnitude sits near zero for most
#                    people, which would make cv unstable (division by ~0).
SIGNAL_EVIDENCE_CONFIG = {
    "talk_ratio": {
        "kind": "continuous",
        "min_samples": 3,
        "cv_threshold": 0.20,
        "extract": lambda sig: sig["talk_ratio"]["user_ratio"],
        "label": "talk-share",
    },
    "curiosity": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.35,
        "extract": lambda sig: sig["curiosity"]["question_turn_rate_per_100_words"],
        "label": "curiosity",
    },
    "turn_taking_assertiveness": {
        "kind": "continuous",
        "min_samples": 4,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["interruptions"]["user_interrupt_rate_per_10_transitions"],
        "label": "turn-taking assertiveness",
    },
    "conversational_drive": {
        "kind": "continuous",
        "min_samples": 6,
        "cv_threshold": 0.35,
        "extract": lambda sig: sig["drive_vs_follow"]["drive_score"],
        "label": "conversational drive",
    },
    "hedging": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["hedging"]["rate_per_100_words"],
        "label": "hedging",
    },
    "directness": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["directness"]["rate_per_100_words"],
        "label": "directness",
    },
    "building_on_others": {
        "kind": "continuous",
        "min_samples": 6,
        "cv_threshold": 0.40,
        "extract": lambda sig: sig["building_on_others"]["building_on_rate"],
        "label": "building on others",
    },
    "pace": {
        "kind": "continuous",
        "min_samples": 3,
        "cv_threshold": 0.15,
        "extract": lambda sig: sig["speech_rate"]["overall_wpm"],
        "label": "pace",
    },
    "pacing_arc": {
        "kind": "categorical",
        "min_samples": 5,
        "agreement_threshold": 0.60,
        "extract": lambda sig: sig["speech_acceleration"]["trend"],
        "label": "pacing arc",
    },
    "vocal_expressiveness": {
        "kind": "continuous",
        "min_samples": 3,
        "cv_threshold": 0.25,
        "extract": lambda sig: sig["pitch_features"]["std_hz"],
        "label": "vocal expressiveness",
    },
    "energy_arc": {
        "kind": "categorical",
        "min_samples": 5,
        "agreement_threshold": 0.60,
        "extract": lambda sig: sig["vocal_energy"]["trend"],
        "label": "energy arc",
    },
    "turn_length": {
        "kind": "continuous",
        "min_samples": 4,
        "cv_threshold": 0.25,
        "extract": lambda sig: sig["monologue"]["avg_turn_length_s"],
        "label": "turn length",
    },
    "vocabulary_richness": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.20,
        "extract": lambda sig: sig["vocabulary_richness"]["type_token_ratio"],
        "label": "vocabulary richness",
    },
    "fillers": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.35,
        "extract": lambda sig: sig["filler_words"]["rate_per_100_words"],
        "label": "fillers",
    },
    "response_latency": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.40,
        "extract": lambda sig: sig["pauses"]["response_latency"]["mean_s"],
        "label": "pauses",
    },
}

# Sub-signals: fold into a parent dimension's card as a bonus note rather than
# getting their own dimension slot. Own evidence tracking (looser thresholds —
# each depends more on the other person's behavior than the user's own), but
# only ever fire "first_time_steady" — no drift/recurring/context_shift/anomaly
# of their own. Kept out of SIGNAL_EVIDENCE_CONFIG so profile_strength_pct and
# the You-page steady/still-forming lists stay scoped to the 15 real dimensions.
SUB_SIGNAL_EVIDENCE_CONFIG = {
    "question_pickup": {
        "kind": "continuous",
        "min_samples": 6,
        "cv_threshold": 0.45,
        "extract": lambda sig: sig["question_impact"]["pickup_rate"],
        "label": "question follow-through",
        "parent": "curiosity",
        "allowed_triggers": ["first_time_steady"],
    },
    "gets_interrupted": {
        "kind": "continuous",
        "min_samples": 6,
        "cv_threshold": 0.40,
        "extract": lambda sig: sig["interruptions"]["user_was_interrupted_rate_per_10_transitions"],
        "label": "gets interrupted",
        "parent": "turn_taking_assertiveness",
        "allowed_triggers": ["first_time_steady"],
    },
    "long_turn_rate": {
        "kind": "continuous",
        "min_samples": 6,
        "cv_threshold": 0.40,
        "extract": lambda sig: sig["monologue"]["long_turn_rate"],
        "label": "long speaking stretches",
        "parent": "turn_length",
        "allowed_triggers": ["first_time_steady"],
    },
}

# Rolling window — matches the window the old baseline logic already used, so
# "steady" is evaluated against recent behavior, not all-time history.
ROLLING_WINDOW = 10


def _cfg_for(signal_key: str) -> dict:
    """Look a key up across both the main dimension config and the sub-signal
    config, so callers don't need to know which dict a given key lives in."""
    if signal_key in SIGNAL_EVIDENCE_CONFIG:
        return SIGNAL_EVIDENCE_CONFIG[signal_key]
    return SUB_SIGNAL_EVIDENCE_CONFIG[signal_key]


def compute_signal_evidence(signal_key: str, historical_values: list, config: dict = None) -> dict:
    """Given all past values of one CONTINUOUS signal (oldest→newest) for a
    user+context, return an evidence summary: sample_count, mean, cv, is_steady.

    Pure function over already-extracted values — doesn't fetch data itself,
    so it's independently testable regardless of where the values came from.
    """
    cfg = (config or SIGNAL_EVIDENCE_CONFIG).get(signal_key) or SUB_SIGNAL_EVIDENCE_CONFIG.get(signal_key)
    # Some signals (e.g. question_pickup) legitimately have no value for a session
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


def compute_categorical_evidence(signal_key: str, historical_labels: list, config: dict = None) -> dict:
    """Given all past CATEGORICAL labels (oldest→newest) for a user+context,
    return an evidence summary based on majority agreement within the rolling
    window, not variance — see the "kind" docstring above `SIGNAL_EVIDENCE_CONFIG`
    for why (a magnitude-based cv is unstable for signals whose natural mean
    sits near zero, e.g. pacing/energy arcs for people with no strong drift).
    """
    cfg = (config or SIGNAL_EVIDENCE_CONFIG).get(signal_key) or SUB_SIGNAL_EVIDENCE_CONFIG.get(signal_key)
    labels = [v for v in historical_labels if v and v != "insufficient_data"]
    n = len(labels)
    result = {
        "signal": signal_key,
        "sample_count": n,
        "min_samples_required": cfg["min_samples"],
        "is_steady": False,
        "mode_label": None,
        "agreement_ratio": None,
    }
    if n < cfg["min_samples"]:
        return result

    window = labels[-ROLLING_WINDOW:]
    mode_label, mode_count = Counter(window).most_common(1)[0]
    agreement = mode_count / len(window)
    result["mode_label"] = mode_label
    result["agreement_ratio"] = round(agreement, 3)
    result["is_steady"] = agreement >= cfg["agreement_threshold"]
    return result


def compute_evidence(signal_key: str, historical_values: list, config: dict = None) -> dict:
    """Dispatches to the right evidence function based on the signal's "kind".
    Every caller should go through this rather than calling either function
    directly, so categorical dimensions plug in transparently everywhere."""
    cfg = _cfg_for(signal_key) if config is None else config.get(signal_key, _cfg_for(signal_key))
    if cfg["kind"] == "categorical":
        return compute_categorical_evidence(signal_key, historical_values, config)
    return compute_signal_evidence(signal_key, historical_values, config)


def extract_value(signal_key: str, signals: dict):
    """Pull this signal's tracked scalar/label out of a full `signals` dict (as
    stored in sessions.signals_json). Checks both the main dimension config and
    the sub-signal config."""
    return _cfg_for(signal_key)["extract"](signals)
