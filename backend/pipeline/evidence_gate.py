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

# Composite-only inputs: exist purely to feed COMPOSITE_CONFIG below, never shown
# as their own card and never counted in profile_strength_pct or the You-page
# still-forming list — unlike SUB_SIGNAL_EVIDENCE_CONFIG, these have no "parent"
# dimension of their own to fold into.
COMPOSITE_INPUT_CONFIG = {
    "pause_rate": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.35,
        "extract": lambda sig: (
            round(sig["pauses"]["within_turn_pauses"]["count"] / sig["curiosity"]["total_words"] * 100, 2)
            if sig["curiosity"]["total_words"] > 0 else None
        ),
        "label": "within-turn pause rate",
    },
    "energy_variability": {
        "kind": "continuous",
        "min_samples": 4,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["vocal_energy"].get("variability"),
        "label": "vocal energy variability",
    },
    "pace_variability": {
        "kind": "continuous",
        "min_samples": 4,
        "cv_threshold": 0.30,
        "extract": lambda sig: sig["speech_rate"].get("variability"),
        "label": "pace variability",
    },
    "crosstalk": {
        "kind": "continuous",
        "min_samples": 5,
        "cv_threshold": 0.50,
        "extract": lambda sig: sig["crosstalk"]["crosstalk_ratio"],
        "label": "crosstalk",
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
    """Look a key up across the dimension, sub-signal, and composite-input
    configs, so callers don't need to know which dict a given key lives in."""
    if signal_key in SIGNAL_EVIDENCE_CONFIG:
        return SIGNAL_EVIDENCE_CONFIG[signal_key]
    if signal_key in SUB_SIGNAL_EVIDENCE_CONFIG:
        return SUB_SIGNAL_EVIDENCE_CONFIG[signal_key]
    return COMPOSITE_INPUT_CONFIG[signal_key]


def compute_signal_evidence(signal_key: str, historical_values: list, config: dict = None) -> dict:
    """Given all past values of one CONTINUOUS signal (oldest→newest) for a
    user+context, return an evidence summary: sample_count, mean, cv, is_steady.

    Pure function over already-extracted values — doesn't fetch data itself,
    so it's independently testable regardless of where the values came from.
    """
    cfg = config.get(signal_key) if config else _cfg_for(signal_key)
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
    cfg = config.get(signal_key) if config else _cfg_for(signal_key)
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


# ── Session Spectrum composites ─────────────────────────────────────────────
# Each entry is (component_signal_key, weight, mode). `weight`'s sign encodes
# direction (negative = this component pulls the composite down as it rises —
# e.g. more hedging means *less* "Speech Style"). `mode` is "signed" for the
# normal case, or "closeness" for a component where deviation in *either*
# direction should lower the composite (Responsive Engagement's response
# latency — replying unusually fast or unusually slow both read as less
# engaged than replying at your own typical pace).
COMPOSITE_CONFIG = {
    "speech_style": {
        "label": "Speech Style",
        "components": [
            ("hedging", -0.25, "signed"),
            ("pause_rate", -0.25, "signed"),
            ("directness", 0.25, "signed"),
            ("pace", 0.25, "signed"),
        ],
    },
    "vocal_arousal": {
        "label": "Vocal Arousal",
        "components": [
            ("vocal_expressiveness", 1 / 3, "signed"),
            ("energy_variability", 1 / 3, "signed"),
            ("pace_variability", 1 / 3, "signed"),
        ],
    },
    "rapport": {
        "label": "Rapport",
        "components": [
            ("building_on_others", 0.5, "signed"),
            ("question_pickup", 0.5, "signed"),
        ],
    },
    "power_balance": {
        "label": "Power Balance",
        "components": [
            ("talk_ratio", 0.5, "signed"),
            ("conversational_drive", 0.5, "signed"),
        ],
    },
    "turn_taking_courtesy": {
        "label": "Turn-taking Courtesy",
        "components": [
            ("turn_taking_assertiveness", -0.5, "signed"),
            ("crosstalk", -0.5, "signed"),
        ],
    },
    "fluency": {
        "label": "Fluency",
        "components": [
            ("hedging", -0.34, "signed"),
            ("fillers", -0.33, "signed"),
            ("vocabulary_richness", 0.33, "signed"),
        ],
    },
    "responsive_engagement": {
        "label": "Responsive Engagement",
        "components": [
            ("turn_taking_assertiveness", -0.4, "signed"),
            ("building_on_others", 0.3, "signed"),
            ("response_latency", 0.3, "closeness"),
        ],
    },
}


def _safe_extract(signal_key: str, signals: dict):
    """extract_value, but a session missing the signal group entirely (older
    data recorded before that signal existed) returns None instead of raising
    — same treatment already given to a signal that's merely null within an
    existing group (e.g. question_pickup with zero questions asked)."""
    try:
        return extract_value(signal_key, signals)
    except (KeyError, TypeError, ZeroDivisionError):
        return None


def compute_composite_position(composite_key: str, today_signals: dict, historical_signals_list: list) -> dict:
    """A composite's self-relative position (less/about/more than your usual),
    built by z-scoring each component against *its own* history first, then
    combining — never as a new raw value computed once and evidence-gated like
    a normal signal. That would require combining raw rates of very different
    natural units (e.g. hedging's rate-per-100-words against pace's
    words-per-minute) with fixed weights, which lets whichever component has
    the largest natural magnitude silently dominate the blend regardless of
    its intended weight. Z-scoring first puts every component on the same
    footing — literally "how many of its own typical swings is today away
    from this user's mean" — before the weights are applied.

    `historical_signals_list` is the list of past raw `signals` dicts (oldest→
    newest) for this user+context, same shape `_fetch_and_parse_sessions`
    already produces — no new persisted evidence-state table needed, this is
    computed fresh from data already being fetched for the profile/home pages.

    Requires *every* component to be individually steady before the composite
    is considered steady at all — a "Rapport" reading built from only one of
    its two real ingredients isn't really Rapport, just one signal in a
    costume. Stricter than any single component's own bar, deliberately.
    """
    cfg = COMPOSITE_CONFIG[composite_key]
    weighted_zs = []
    total_weight = 0.0
    component_detail = []

    for signal_key, weight, mode in cfg["components"]:
        # Real session history spans this project's whole evolution — older
        # sessions can genuinely lack a signal group entirely (e.g. recorded
        # before hedging/directness/curiosity existed), not just have a null
        # value within an existing one. _safe_extract turns that into "no
        # value" rather than an unhandled KeyError taking down the endpoint.
        historical_values = [_safe_extract(signal_key, s) for s in historical_signals_list]
        evidence = compute_evidence(signal_key, historical_values)

        if not evidence["is_steady"]:
            component_detail.append({"signal": signal_key, "steady": False})
            continue

        today_value = _safe_extract(signal_key, today_signals)
        if today_value is None:
            component_detail.append({"signal": signal_key, "steady": True, "usable": False})
            continue

        # A component with genuinely zero historical variance is rare but not
        # impossible (e.g. filler rate really is 0.0 across someone's last 10
        # sessions) — an epsilon floor avoids a literal division by zero
        # rather than assuming real data never lands exactly here.
        denom = max(evidence["cv"] * abs(evidence["mean"]), 1e-6)
        z = (today_value - evidence["mean"]) / denom
        contribution = (-abs(z) if mode == "closeness" else z) * weight

        weighted_zs.append(contribution)
        total_weight += abs(weight)
        component_detail.append({
            "signal": signal_key, "steady": True, "usable": True, "z": round(z, 3),
            "today_value": today_value, "historical_mean": evidence["mean"],
        })

    n_usable = sum(1 for c in component_detail if c.get("usable"))
    if n_usable < len(cfg["components"]):
        return {
            "composite": composite_key, "label": cfg["label"],
            "is_steady": False, "position": None, "components": component_detail,
        }

    composite_z = sum(weighted_zs) / total_weight if total_weight > 0 else 0.0
    position = "more than usual" if composite_z > 0.5 else \
               "less than usual" if composite_z < -0.5 else \
               "about your usual"

    return {
        "composite": composite_key, "label": cfg["label"], "is_steady": True,
        "composite_z": round(composite_z, 3), "position": position,
        "components": component_detail,
    }
