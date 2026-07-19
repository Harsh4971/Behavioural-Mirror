"""Trigger-detection engine for the Home feed's dimension-maturation cards.

Diffs a user's per-dimension evidence — computed fresh after a session just
finalized — against the last known persisted state, and writes any newly
fired event into `dimension_events` (the frozen, append-only log the Home
feed reads). Also upserts `signal_evidence_state` (the "last known state"
row) every run, whether or not anything fires.

Five trigger types, per dimension+scope:
  - first_time_steady: not steady -> steady, for the first time ever (overall scope)
  - context_shift:      same as above, but for a specific conversation-type scope
  - recurring:          was steady, lost steadiness, regained it (direction
                        distinguishes "back to usual" from a fresh drift found
                        via the regain)
  - drift:              already steady, established mean/mode has moved beyond
                        the dimension's own noise band
  - anomaly:            a single session's raw value contradicts an already-
                        established baseline — independent of the above, can
                        co-fire alongside any of them

Deliberately does NOT run from `reanalyze_session` (main.py) — retroactively
correcting which speaker is the user after evidence has already accumulated
on the wrong speaker's data is a reconciliation problem (would need to
un-fire/re-fire historical events) explicitly out of scope for this pass.
"""
import json

from db.database import supabase_admin
from pipeline.evidence_gate import (
    SIGNAL_EVIDENCE_CONFIG, SUB_SIGNAL_EVIDENCE_CONFIG,
    compute_evidence, extract_value,
)

COOLDOWN_SESSIONS = 2       # minimum sessions between any two fired events for the same dimension+scope
ANOMALY_BAND_MULTIPLIER = 2.5  # anomaly band = this many x the dimension's own cv_threshold
STRONG_MODE_AGREEMENT = 0.80   # categorical anomaly requires an established mode at least this strong


def run_trigger_detection(user_id: str, session_id: str, context: str) -> list:
    """Entry point — call right after _save_session() succeeds in main.py's
    finalize flow. Re-fetches all parsed sessions (now including the
    just-saved one) rather than taking `signals` as a param, so it reasons
    over the exact same shape _compute_profile_evidence does. Returns the
    list of newly fired events (for logging) — never raises; callers should
    still wrap this in try/except so a bug here can never break finalize."""
    from main import _fetch_and_parse_sessions  # local import — avoids a circular import at module load

    parsed = _fetch_and_parse_sessions(user_id)
    if not parsed:
        return []

    fired = []

    # Pooled ("overall") + this session's own context, for the 15 main dimensions.
    for dimension_key, cfg in SIGNAL_EVIDENCE_CONFIG.items():
        for scope in ("overall", context):
            fired += _check_dimension(user_id, session_id, dimension_key, scope, parsed,
                                       cfg, SIGNAL_EVIDENCE_CONFIG)

    # Sub-signals: overall scope only, first_time_steady only (see their
    # "allowed_triggers" in evidence_gate.SUB_SIGNAL_EVIDENCE_CONFIG).
    for sub_key, cfg in SUB_SIGNAL_EVIDENCE_CONFIG.items():
        fired += _check_dimension(user_id, session_id, sub_key, "overall", parsed,
                                   cfg, SUB_SIGNAL_EVIDENCE_CONFIG,
                                   allowed_triggers=cfg.get("allowed_triggers"))

    return fired


def _scoped_values(parsed: list, signal_key: str, scope: str, config: dict) -> list:
    """Oldest->newest values for this signal, filtered to `scope` ('overall'
    or a specific context string). Config-agnostic — works for both the main
    15 dimensions and the 3 sub-signals via extract_value's dual-dict lookup."""
    values = []
    for p in parsed:
        if scope != "overall" and p["context"] != scope:
            continue
        try:
            values.append(extract_value(signal_key, p["sig"]))
        except (KeyError, TypeError):
            pass
    return values


def _fetch_state(user_id: str, dimension_key: str, scope: str) -> dict:
    res = supabase_admin.table("signal_evidence_state").select("*").eq(
        "user_id", user_id
    ).eq("dimension_key", dimension_key).eq("scope", scope).execute()
    return res.data[0] if res.data else {}


def _upsert_state(user_id, dimension_key, scope, kind, is_steady, has_ever_been_steady,
                   last_steady_mean, last_steady_mode_label, last_steady_agreement_ratio,
                   sample_count, last_fired_trigger_type, last_fired_session_id,
                   last_fired_sample_count):
    supabase_admin.table("signal_evidence_state").upsert({
        "user_id": user_id, "dimension_key": dimension_key, "scope": scope, "kind": kind,
        "is_steady": is_steady, "has_ever_been_steady": has_ever_been_steady,
        "last_steady_mean": last_steady_mean,
        "last_steady_mode_label": last_steady_mode_label,
        "last_steady_agreement_ratio": last_steady_agreement_ratio,
        "sample_count": sample_count,
        "last_fired_trigger_type": last_fired_trigger_type,
        "last_fired_session_id": last_fired_session_id,
        "last_fired_sample_count": last_fired_sample_count,
    }, on_conflict="user_id,dimension_key,scope").execute()


def _insert_event(user_id, session_id, dimension_key, scope, trigger_type, direction,
                   value_at_trigger, previous_value, label_at_trigger, previous_label,
                   sample_count, card_copy: dict) -> dict:
    row = {
        "user_id": user_id, "session_id": session_id, "dimension_key": dimension_key,
        "scope": scope, "trigger_type": trigger_type, "direction": direction,
        "value_at_trigger": value_at_trigger, "previous_value": previous_value,
        "label_at_trigger": label_at_trigger, "previous_label": previous_label,
        "sample_count": sample_count, "card_copy_json": json.dumps(card_copy),
    }
    res = supabase_admin.table("dimension_events").insert(row).execute()
    return res.data[0] if res.data else row


def _has_drifted(is_categorical: bool, prior: dict, current: dict, cfg: dict) -> bool:
    if is_categorical:
        prev_label = prior.get("last_steady_mode_label")
        return prev_label is not None and current.get("mode_label") != prev_label
    prev_mean = prior.get("last_steady_mean")
    if prev_mean is None or abs(prev_mean) < 1e-9:
        return False
    relative_change = abs(current["mean"] - prev_mean) / abs(prev_mean)
    return relative_change > cfg["cv_threshold"]


def _recurring_direction(is_categorical: bool, prior: dict, current: dict, cfg: dict) -> str:
    """Distinguishes 'back_to_usual' (regained the SAME value) from a fresh
    drift discovered via the regain — same underlying content as `drift`,
    just framed as acknowledging the instability first."""
    return "drift" if _has_drifted(is_categorical, prior, current, cfg) else "back_to_usual"


def _check_anomaly(is_categorical: bool, prior: dict, values: list, cfg: dict):
    """This session's raw value vs. the established baseline. Returns
    (direction, value_or_label) or None. `values` is oldest->newest for this
    dimension+scope — the last entry is this session's own raw value."""
    if not values or values[-1] is None:
        return None
    this_value = values[-1]

    if is_categorical:
        established_label = prior.get("last_steady_mode_label")
        established_agreement = prior.get("last_steady_agreement_ratio") or 0
        if not established_label or established_agreement < STRONG_MODE_AGREEMENT:
            return None
        if this_value == established_label:
            return None
        return ("contradicts_established", this_value)

    established_mean = prior.get("last_steady_mean")
    if established_mean is None or abs(established_mean) < 1e-9:
        return None
    band = ANOMALY_BAND_MULTIPLIER * cfg["cv_threshold"]
    relative_change = (this_value - established_mean) / abs(established_mean)
    if relative_change > band:
        return ("up", this_value)
    if relative_change < -band:
        return ("down", this_value)
    return None


def _value_str(dimension_key: str, value) -> str:
    if value is None:
        return "n/a"
    try:
        from pipeline.portrait_synthesizer import _format_mean
        return _format_mean(dimension_key, value)
    except Exception:
        return f"{value}"


def _range_str(dimension_key: str, mean: float, cv: float) -> str:
    """The actual mean±std band behind a continuous signal's steady value —
    e.g. "between 155 and 185" for a pace whose mean is 170 and cv is ~0.09.
    No unit repeated here — curr_str right before it already states the unit
    once. Grounded in data already computed to decide steadiness — not a new
    measurement."""
    try:
        from pipeline.portrait_synthesizer import _SIGNAL_FORMAT
        scale, fmt, _unit = _SIGNAL_FORMAT[dimension_key]
        std = cv * abs(mean)
        low, high = fmt.format((mean - std) * scale), fmt.format((mean + std) * scale)
        return f"typically between {low} and {high}"
    except (ImportError, KeyError):
        return ""


def _agreement_str(current: dict) -> str:
    """How many of the recent sessions actually showed this — e.g. "8 of
    your last 10 sessions" for a categorical trend's agreement_ratio, which
    is already computed to decide steadiness, just never surfaced before."""
    window_n = min(current["sample_count"], 10)  # matches evidence_gate.py's ROLLING_WINDOW
    agreement_ratio = current.get("agreement_ratio")
    if agreement_ratio is None or window_n == 0:
        return ""
    agree_count = round(agreement_ratio * window_n)
    return f"showing up in {agree_count} of your last {window_n} sessions"


def _extra_clause(dimension_key: str, current: dict, is_categorical: bool) -> str:
    """The one added fact — a real range for continuous signals, a real
    session count for categorical ones — never an interpretation of what it
    means, just more of what was already measured."""
    if is_categorical:
        extra = _agreement_str(current)
    else:
        extra = (_range_str(dimension_key, current["mean"], current["cv"])
                 if current.get("cv") is not None else "")
    return f" ({extra})" if extra else ""


def _phrase_event(dimension_key, label, trigger_type, direction, prior, current, cfg, scope) -> dict:
    """Deterministic string templates, no LLM call — matches home_feed.py's
    existing f-string convention (e.g. the old build_progress_cards)."""
    is_categorical = cfg["kind"] == "categorical"
    n = current["sample_count"]
    scope_phrase = "" if scope == "overall" else f" in your {scope.replace('_', ' ')} conversations"
    curr_str = current["mode_label"] if is_categorical else _value_str(dimension_key, current["mean"])
    extra = _extra_clause(dimension_key, current, is_categorical)

    if trigger_type == "first_time_steady":
        note = (f"Over your last {n} sessions, your {label} has settled into a steady "
                 f"pattern — {curr_str}{extra}.")
    elif trigger_type == "context_shift":
        note = (f"Your {label} has also settled into a steady pattern specifically"
                 f"{scope_phrase} — {curr_str}{extra}.")
    elif trigger_type == "recurring" and direction == "back_to_usual":
        note = (f"Your {label} had been varying more than usual for a bit, but it's "
                 f"settled back to your usual {curr_str}{extra}.")
    elif trigger_type == "recurring":  # direction == "drift"
        note = (f"After a stretch of inconsistency, your {label} has settled into a new "
                 f"pattern — {curr_str}{extra}.")
    elif trigger_type == "drift":
        prev_str = (prior.get("last_steady_mode_label") if is_categorical
                    else _value_str(dimension_key, prior.get("last_steady_mean")))
        note = f"Your {label} has shifted — from {prev_str} to {curr_str}{extra} over your last {n} sessions."
    else:
        note = f"Your {label} showed a new pattern this session."

    return {"label": label, "note": note}


def _phrase_anomaly(dimension_key, label, direction, prior, this_value, this_label, cfg) -> dict:
    is_categorical = cfg["kind"] == "categorical"
    if is_categorical:
        established = prior.get("last_steady_mode_label", "n/a")
        note = (f"Unlike your usual pattern of {established} {label}, this session was "
                 f"{this_label} — worth noting, not necessarily a new pattern yet.")
    else:
        established = _value_str(dimension_key, prior.get("last_steady_mean"))
        this_str = _value_str(dimension_key, this_value)
        word = "higher" if direction == "up" else "lower"
        note = (f"This session your {label} was notably {word} than usual — {this_str} vs "
                 f"your typical {established}. Worth noting, not necessarily a new pattern yet.")
    return {"label": label, "note": note}


def _check_dimension(user_id, session_id, dimension_key, scope, parsed, cfg, config_dict,
                      allowed_triggers=None) -> list:
    """Returns the list of newly fired events for this (dimension, scope) this run."""
    is_categorical = cfg["kind"] == "categorical"
    label = cfg["label"]
    values = _scoped_values(parsed, dimension_key, scope, config_dict)
    current = compute_evidence(dimension_key, values, config_dict)

    prior = _fetch_state(user_id, dimension_key, scope)
    prior_is_steady = bool(prior.get("is_steady"))
    has_ever_been_steady = bool(prior.get("has_ever_been_steady"))
    last_fired_sample_count = prior.get("last_fired_sample_count")

    def allowed(trigger_type):
        return allowed_triggers is None or trigger_type in allowed_triggers

    cooldown_clear = (
        last_fired_sample_count is None or
        current["sample_count"] - last_fired_sample_count >= COOLDOWN_SESSIONS
    )

    candidates = []  # list of (trigger_type, direction)
    if current["is_steady"] and not prior_is_steady:
        if not has_ever_been_steady:
            candidates.append(("first_time_steady" if scope == "overall" else "context_shift", None))
        else:
            candidates.append(("recurring", _recurring_direction(is_categorical, prior, current, cfg)))
    elif current["is_steady"] and prior_is_steady:
        if _has_drifted(is_categorical, prior, current, cfg):
            candidates.append(("drift", None))
    # steady -> not-steady, not-steady -> not-steady: no candidate from this branch.

    anomaly = None
    if scope == "overall" and prior_is_steady:
        anomaly = _check_anomaly(is_categorical, prior, values, cfg)
        if anomaly:
            candidates.append(("anomaly", anomaly[0]))

    fired = []
    for trigger_type, direction in candidates:
        if not allowed(trigger_type) or not cooldown_clear:
            continue
        if trigger_type == "anomaly":
            _, anomaly_value_or_label = anomaly
            this_value = None if is_categorical else anomaly_value_or_label
            this_label = anomaly_value_or_label if is_categorical else None
            copy = _phrase_anomaly(dimension_key, label, direction, prior, this_value, this_label, cfg)
            fired.append(_insert_event(
                user_id, session_id, dimension_key, scope, "anomaly", direction,
                this_value, prior.get("last_steady_mean"), this_label, prior.get("last_steady_mode_label"),
                current["sample_count"], copy,
            ))
        else:
            copy = _phrase_event(dimension_key, label, trigger_type, direction, prior, current, cfg, scope)
            fired.append(_insert_event(
                user_id, session_id, dimension_key, scope, trigger_type, direction,
                current.get("mean"), prior.get("last_steady_mean"),
                current.get("mode_label"), prior.get("last_steady_mode_label"),
                current["sample_count"], copy,
            ))

    # Always update state — freeze last_steady_* while not steady, so a later
    # drift/anomaly check compares against the last REAL steady baseline, not
    # noise from an unsteady stretch.
    if current["is_steady"]:
        last_steady_mean = current.get("mean")
        last_steady_mode_label = current.get("mode_label")
        last_steady_agreement_ratio = current.get("agreement_ratio")
    else:
        last_steady_mean = prior.get("last_steady_mean")
        last_steady_mode_label = prior.get("last_steady_mode_label")
        last_steady_agreement_ratio = prior.get("last_steady_agreement_ratio")

    any_fired = len(fired) > 0
    _upsert_state(
        user_id, dimension_key, scope, cfg["kind"],
        current["is_steady"], has_ever_been_steady or current["is_steady"],
        last_steady_mean, last_steady_mode_label, last_steady_agreement_ratio,
        current["sample_count"],
        last_fired_trigger_type=(fired[-1]["trigger_type"] if any_fired else prior.get("last_fired_trigger_type")),
        last_fired_session_id=(session_id if any_fired else prior.get("last_fired_session_id")),
        last_fired_sample_count=(current["sample_count"] if any_fired else last_fired_sample_count),
    )

    return fired
