import numpy as np

class DimensionScorer:
    """
    Rule-based scoring for behavioral dimensions.
    Returns scores 1-5 with labels and driving signals.
    All scores are probabilistic proxies, not psychological diagnoses.
    """

    def score_all(self, signals: dict) -> dict:
        return {
            "emotional_state": self._score_emotional_state(signals),
            "relational_dynamics": self._score_relational_dynamics(signals),
            "communication_effectiveness": self._score_communication_effectiveness(signals),
            "conversation_arc": self._score_conversation_arc(signals)
        }

    # ─── HELPERS ────────────────────────────────────────────────

    def _clamp(self, val, min_val=1, max_val=5) -> int:
        return max(min_val, min(max_val, round(val)))

    def _label(self, score: int, labels: list) -> str:
        # labels should have 5 items, index 0=lowest
        return labels[score - 1]

    # ─── DIMENSION A: EMOTIONAL STATE ───────────────────────────

    def _score_emotional_state(self, signals: dict) -> dict:
        return {
            "confidence": self._score_confidence(signals),
            "nervousness": self._score_nervousness(signals),
            "emotional_intensity": self._score_emotional_intensity(signals),
            "topic_comfort": self._score_topic_comfort(signals),
            "enthusiasm": self._score_enthusiasm(signals)
        }

    def _score_confidence(self, signals: dict) -> dict:
        score = 3  # Start neutral

        # Filler rate — lower is more confident
        filler_rate = signals["filler_words"]["rate_per_100_words"]
        if filler_rate < 1.5:
            score += 1
        elif filler_rate > 4.0:
            score -= 1

        # Speech rate stability — stable = confident
        variability = signals["speech_rate"]["variability"]
        if variability < 20:
            score += 0.5
        elif variability > 50:
            score -= 0.5

        # Response latency — quick responses suggest confidence
        latency = signals["pauses"]["response_latency"]["mean_s"]
        if latency < 0.8:
            score += 0.5
        elif latency > 2.0:
            score -= 1

        # Interruptions given vs received
        interrupted_other = signals["interruptions"]["user_interrupted_other"]
        was_interrupted = signals["interruptions"]["user_was_interrupted"]
        if interrupted_other > was_interrupted:
            score += 0.5
        elif was_interrupted > interrupted_other + 2:
            score -= 0.5

        # Vocal energy
        energy_trend = signals["vocal_energy"].get("trend", "stable")
        if energy_trend == "increasing":
            score += 0.5
        elif energy_trend == "decreasing":
            score -= 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Low", "Below Average", "Moderate", "Good", "High"]),
            "key_drivers": self._confidence_drivers(signals)
        }

    def _confidence_drivers(self, signals) -> list:
        drivers = []
        if signals["filler_words"]["rate_per_100_words"] > 4.0:
            drivers.append("high filler word usage")
        if signals["pauses"]["response_latency"]["mean_s"] > 2.0:
            drivers.append("long response latency")
        if signals["speech_rate"]["variability"] > 50:
            drivers.append("high speech rate variability")
        if signals["interruptions"]["user_was_interrupted"] > 3:
            drivers.append("frequently interrupted")
        if not drivers:
            drivers.append("stable speech patterns")
        return drivers

    def _score_nervousness(self, signals: dict) -> dict:
        score = 1  # Start low (not nervous)

        filler_rate = signals["filler_words"]["rate_per_100_words"]
        if filler_rate > 5.0:
            score += 2
        elif filler_rate > 3.0:
            score += 1

        latency = signals["pauses"]["response_latency"]["mean_s"]
        if latency > 2.5:
            score += 1.5
        elif latency > 1.5:
            score += 0.5

        pause_count = signals["pauses"]["within_turn_pauses"]["count"]
        duration = signals["session_duration_s"] / 60
        pause_rate = pause_count / duration if duration > 0 else 0
        if pause_rate > 10:
            score += 1

        pitch_std = signals["pitch_features"].get("std_hz")
        if pitch_std and pitch_std > 60:
            score += 0.5

        accel = signals["speech_acceleration"].get("trend")
        if accel == "accelerating":
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Calm", "Mostly Calm", "Mild Tension", "Noticeably Tense", "High Tension"]),
            "key_drivers": self._nervousness_drivers(signals)
        }

    def _nervousness_drivers(self, signals) -> list:
        drivers = []
        if signals["filler_words"]["rate_per_100_words"] > 3.0:
            drivers.append("elevated filler word rate")
        if signals["pauses"]["response_latency"]["mean_s"] > 1.5:
            drivers.append("extended pauses before responding")
        if signals["speech_acceleration"].get("trend") == "accelerating":
            drivers.append("speech rate accelerating over time")
        if not drivers:
            drivers.append("no strong nervousness indicators")
        return drivers

    def _score_emotional_intensity(self, signals: dict) -> dict:
        score = 2  # Start calm

        pitch_std = signals["pitch_features"].get("std_hz")
        if pitch_std:
            if pitch_std > 80:
                score += 2
            elif pitch_std > 50:
                score += 1

        energy_var = signals["vocal_energy"].get("variability", 0)
        if energy_var and energy_var > 0.02:
            score += 1

        interrupts = (signals["interruptions"]["user_interrupted_other"] +
                     signals["interruptions"]["user_was_interrupted"])
        if interrupts > 5:
            score += 1
        elif interrupts > 2:
            score += 0.5

        accel = signals["speech_acceleration"].get("trend")
        if accel == "accelerating":
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Very Calm", "Calm", "Moderate", "Intense", "Very Intense"]),
            "key_drivers": ["pitch variation", "vocal energy", "interruption frequency"]
        }

    def _score_topic_comfort(self, signals: dict) -> dict:
        score = 3

        latency = signals["pauses"]["response_latency"]["mean_s"]
        if latency < 0.8:
            score += 1
        elif latency > 2.0:
            score -= 1

        filler_rate = signals["filler_words"]["rate_per_100_words"]
        if filler_rate > 4.0:
            score -= 1
        elif filler_rate < 1.5:
            score += 0.5

        ttr = signals["vocabulary_richness"].get("type_token_ratio")
        if ttr:
            if ttr > 0.6:
                score += 0.5
            elif ttr < 0.35:
                score -= 0.5

        wpm = signals["speech_rate"]["overall_wpm"]
        if 130 <= wpm <= 180:
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Uncomfortable", "Somewhat Uncomfortable", "Neutral", "Comfortable", "Very Comfortable"]),
            "key_drivers": ["response latency", "filler usage", "vocabulary richness"]
        }

    def _score_enthusiasm(self, signals: dict) -> dict:
        score = 2

        energy_trend = signals["vocal_energy"].get("trend", "stable")
        if energy_trend == "increasing":
            score += 1.5
        elif energy_trend == "stable":
            score += 0.5
        elif energy_trend == "decreasing":
            score -= 0.5

        wpm = signals["speech_rate"]["overall_wpm"]
        if wpm > 180:
            score += 1
        elif wpm < 120:
            score -= 0.5

        q_asked = signals["questions"]["user_questions_asked"]
        if q_asked > 3:
            score += 1

        talk_ratio = signals["talk_ratio"]["user_ratio"]
        if talk_ratio > 0.55:
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Low", "Mild", "Moderate", "Engaged", "Highly Enthusiastic"]),
            "key_drivers": ["vocal energy", "speech rate", "questions asked"]
        }

    # ─── DIMENSION B: RELATIONAL DYNAMICS ───────────────────────

    def _score_relational_dynamics(self, signals: dict) -> dict:
        return {
            "rapport": self._score_rapport(signals),
            "power_balance": self._score_power_balance(signals),
            "empathy": self._score_empathy(signals),
            "conversational_respect": self._score_respect(signals),
            "mutual_engagement": self._score_mutual_engagement(signals)
        }

    def _score_rapport(self, signals: dict) -> dict:
        score = 3

        # Balanced talk ratio suggests rapport
        ratio = signals["talk_ratio"]["user_ratio"]
        if 0.4 <= ratio <= 0.6:
            score += 1
        elif ratio > 0.7 or ratio < 0.3:
            score -= 1

        # Good engagement trend
        engagement = signals["engagement_proxy"].get("other_speaker_turn_length_trend", 0)
        if engagement > 0.1:
            score += 1
        elif engagement < -0.2:
            score -= 1

        # Low interruptions suggest respect
        interrupts = (signals["interruptions"]["user_interrupted_other"] +
                     signals["interruptions"]["user_was_interrupted"])
        if interrupts == 0:
            score += 0.5
        elif interrupts > 4:
            score -= 0.5

        # Question exchange
        user_q = signals["questions"]["user_questions_asked"]
        other_q = signals["questions"]["other_questions_asked"]
        if user_q > 0 and other_q > 0:
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Poor", "Below Average", "Moderate", "Good", "Strong"]),
            "key_drivers": ["talk balance", "engagement trend", "mutual questioning"]
        }

    def _score_power_balance(self, signals: dict) -> dict:
        ratio = signals["talk_ratio"]["user_ratio"]
        interrupts_given = signals["interruptions"]["user_interrupted_other"]
        interrupts_received = signals["interruptions"]["user_was_interrupted"]
        monologue = signals["monologue"]["long_turn_count"]

        # Score represents USER's dominance level
        score = 3  # balanced

        if ratio > 0.65:
            score += 1
        elif ratio < 0.35:
            score -= 1

        if interrupts_given > interrupts_received + 2:
            score += 1
        elif interrupts_received > interrupts_given + 2:
            score -= 1

        if monologue > 2:
            score += 0.5

        label_map = {
            1: "Other-dominant",
            2: "Slightly other-led",
            3: "Balanced",
            4: "Slightly user-led",
            5: "User-dominant"
        }

        clamped = self._clamp(score)
        return {
            "score": clamped,
            "label": label_map[clamped],
            "key_drivers": ["talk ratio", "interruption pattern", "monologue frequency"]
        }

    def _score_empathy(self, signals: dict) -> dict:
        score = 3

        # Good listeners have shorter turns and more latency
        avg_turn = signals["turn_dynamics"]["avg_user_turn_length_s"]
        other_turn = signals["turn_dynamics"]["avg_other_turn_length_s"]

        if other_turn > 0 and avg_turn / other_turn < 1.2:
            score += 1  # Not dominating

        # Asking questions = showing interest
        user_q = signals["questions"]["user_questions_asked"]
        if user_q > 3:
            score += 1
        elif user_q == 0:
            score -= 1

        # Not interrupting frequently
        interrupts = signals["interruptions"]["user_interrupted_other"]
        if interrupts == 0:
            score += 0.5
        elif interrupts > 3:
            score -= 1

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Low", "Below Average", "Moderate", "Attentive", "Highly Empathetic"]),
            "key_drivers": ["listening balance", "questions asked", "interruption rate"]
        }

    def _score_respect(self, signals: dict) -> dict:
        score = 4  # Start positive

        interrupts_given = signals["interruptions"]["user_interrupted_other"]
        if interrupts_given > 4:
            score -= 2
        elif interrupts_given > 2:
            score -= 1

        # Long silences between turns = giving space
        latency = signals["pauses"]["response_latency"]["mean_s"]
        if latency > 1.0:
            score += 0.5

        monologue = signals["monologue"]["long_turn_count"]
        if monologue > 3:
            score -= 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Low", "Below Average", "Moderate", "Respectful", "Highly Respectful"]),
            "key_drivers": ["interruption count", "space-giving", "turn monopolization"]
        }

    def _score_mutual_engagement(self, signals: dict) -> dict:
        score = 3

        engagement = signals["engagement_proxy"].get("other_speaker_turn_length_trend", 0)
        if engagement > 0.15:
            score += 1.5
        elif engagement > 0:
            score += 0.5
        elif engagement < -0.2:
            score -= 1.5
        elif engagement < 0:
            score -= 0.5

        ratio = signals["talk_ratio"]["user_ratio"]
        if 0.4 <= ratio <= 0.6:
            score += 0.5

        user_q = signals["questions"]["user_questions_asked"]
        other_q = signals["questions"]["other_questions_asked"]
        total_q = user_q + other_q
        if total_q > 4:
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["One-sided", "Mostly One-sided", "Moderate", "Mutually Engaged", "Highly Engaged"]),
            "key_drivers": ["other speaker engagement trend", "talk balance", "question exchange"]
        }

    # ─── DIMENSION C: COMMUNICATION EFFECTIVENESS ───────────────

    def _score_communication_effectiveness(self, signals: dict) -> dict:
        return {
            "clarity": self._score_clarity(signals),
            "assertiveness": self._score_assertiveness(signals),
            "listening_quality": self._score_listening(signals),
            "persuasiveness": self._score_persuasiveness(signals),
            "adaptability": self._score_adaptability(signals)
        }

    def _score_clarity(self, signals: dict) -> dict:
        score = 3

        filler_rate = signals["filler_words"]["rate_per_100_words"]
        if filler_rate < 1.5:
            score += 1.5
        elif filler_rate < 3.0:
            score += 0.5
        elif filler_rate > 5.0:
            score -= 1.5
        elif filler_rate > 3.0:
            score -= 0.5

        ttr = signals["vocabulary_richness"].get("type_token_ratio")
        if ttr:
            if ttr > 0.6:
                score += 0.5
            elif ttr < 0.35:
                score -= 0.5

        wpm = signals["speech_rate"]["overall_wpm"]
        if 130 <= wpm <= 190:
            score += 0.5
        elif wpm > 220:
            score -= 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Unclear", "Below Average", "Average", "Clear", "Very Clear"]),
            "key_drivers": ["filler rate", "vocabulary variety", "speech pace"]
        }

    def _score_assertiveness(self, signals: dict) -> dict:
        score = 3

        ratio = signals["talk_ratio"]["user_ratio"]
        if ratio > 0.5:
            score += 0.5
        elif ratio < 0.35:
            score -= 1

        interrupted_other = signals["interruptions"]["user_interrupted_other"]
        was_interrupted = signals["interruptions"]["user_was_interrupted"]
        if interrupted_other >= was_interrupted:
            score += 0.5
        else:
            score -= 0.5

        monologue = signals["monologue"]["long_turn_count"]
        if monologue > 1:
            score += 0.5

        energy_trend = signals["vocal_energy"].get("trend", "stable")
        if energy_trend == "increasing":
            score += 0.5
        elif energy_trend == "decreasing":
            score -= 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Passive", "Somewhat Passive", "Balanced", "Assertive", "Highly Assertive"]),
            "key_drivers": ["talk ratio", "holding turns", "vocal energy"]
        }

    def _score_listening(self, signals: dict) -> dict:
        score = 3

        ratio = signals["talk_ratio"]["user_ratio"]
        if ratio < 0.6:
            score += 1
        elif ratio > 0.7:
            score -= 1

        latency = signals["pauses"]["response_latency"]["mean_s"]
        if 0.5 <= latency <= 1.5:
            score += 1  # Taking time to process before responding
        elif latency > 3.0:
            score -= 0.5  # Too long — may be distracted

        interrupts = signals["interruptions"]["user_interrupted_other"]
        if interrupts == 0:
            score += 0.5
        elif interrupts > 3:
            score -= 1

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Poor", "Below Average", "Average", "Good", "Excellent"]),
            "key_drivers": ["talk ratio", "response timing", "interruption rate"]
        }

    def _score_persuasiveness(self, signals: dict) -> dict:
        score = 2

        user_q = signals["questions"]["user_questions_asked"]
        if user_q > 3:
            score += 1

        energy_trend = signals["vocal_energy"].get("trend", "stable")
        if energy_trend == "increasing":
            score += 1

        wpm = signals["speech_rate"]["overall_wpm"]
        if 150 <= wpm <= 200:
            score += 1

        filler_rate = signals["filler_words"]["rate_per_100_words"]
        if filler_rate < 2.0:
            score += 0.5
        elif filler_rate > 5.0:
            score -= 1

        monologue = signals["monologue"]["long_turn_count"]
        if monologue > 0:
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Low", "Below Average", "Moderate", "Persuasive", "Highly Persuasive"]),
            "key_drivers": ["question engagement", "energy", "pace", "fluency"]
        }

    def _score_adaptability(self, signals: dict) -> dict:
        score = 3

        # High speech rate variability can indicate adapting to conversation
        variability = signals["speech_rate"]["variability"]
        if 15 <= variability <= 40:
            score += 1  # Some variability = adapting
        elif variability > 60:
            score -= 0.5  # Too variable = erratic
        elif variability < 10:
            score -= 0.5  # Too rigid

        accel = signals["speech_acceleration"].get("trend")
        if accel == "stable":
            score += 0.5

        energy_var = signals["vocal_energy"].get("variability", 0)
        if energy_var and 0.005 <= energy_var <= 0.02:
            score += 0.5

        return {
            "score": self._clamp(score),
            "label": self._label(self._clamp(score),
                ["Rigid", "Somewhat Rigid", "Moderate", "Adaptive", "Highly Adaptive"]),
            "key_drivers": ["speech rate variability", "pace shifts", "energy variability"]
        }

    # ─── DIMENSION D: CONVERSATION ARC ──────────────────────────

    def _score_conversation_arc(self, signals: dict) -> dict:
        timeline = signals.get("timeline", [])

        return {
            "opening_vs_closing": self._analyze_opening_closing(timeline, signals),
            "turning_point": self._detect_turning_point(timeline),
            "tension_arc": self._analyze_tension_arc(signals, timeline),
            "who_drove": self._analyze_driver(signals),
            "resolution_proxy": self._analyze_resolution(signals, timeline)
        }

    def _analyze_opening_closing(self, timeline, signals) -> dict:
        if len(timeline) < 3:
            return {"label": "insufficient_data", "detail": "Conversation too short to analyze arc"}

        first = timeline[0]["speech_rate_wpm"]
        last = timeline[-1]["speech_rate_wpm"]
        delta = last - first

        if delta > 20:
            label = "Accelerating close"
            detail = "Speech rate increased toward the end — may suggest growing engagement or urgency"
        elif delta < -20:
            label = "Decelerating close"
            detail = "Speech rate decreased toward the end — may suggest winding down or fatigue"
        else:
            label = "Consistent pace"
            detail = "Speech rate remained relatively stable throughout"

        return {"label": label, "detail": detail, "delta_wpm": round(delta, 1)}

    def _detect_turning_point(self, timeline) -> dict:
        if len(timeline) < 4:
            return {"detected": False, "detail": "Insufficient data"}

        rates = [w["speech_rate_wpm"] for w in timeline]
        mean_rate = np.mean(rates)
        std_rate = np.std(rates)

        # Find window where rate deviates most from mean
        max_deviation = 0
        turning_window = None

        for i, w in enumerate(timeline):
            deviation = abs(w["speech_rate_wpm"] - mean_rate)
            if deviation > max_deviation and deviation > std_rate:
                max_deviation = deviation
                turning_window = w

        if turning_window and max_deviation > std_rate * 1.5:
            minutes = turning_window["window_start_s"] // 60
            seconds = turning_window["window_start_s"] % 60
            return {
                "detected": True,
                "at_time": f"{int(minutes)}:{int(seconds):02d}",
                "detail": f"Notable shift in speech pattern detected around {int(minutes)}:{int(seconds):02d}"
            }

        return {"detected": False, "detail": "No significant turning point detected"}

    def _analyze_tension_arc(self, signals, timeline) -> dict:
        interrupts = (signals["interruptions"]["user_interrupted_other"] +
                     signals["interruptions"]["user_was_interrupted"])

        pitch_std = signals["pitch_features"].get("std_hz", 0) or 0
        filler_rate = signals["filler_words"]["rate_per_100_words"]

        tension_score = 0
        if interrupts > 3:
            tension_score += 2
        if pitch_std > 60:
            tension_score += 1
        if filler_rate > 4:
            tension_score += 1

        energy_trend = signals["vocal_energy"].get("trend", "stable")
        if energy_trend == "increasing":
            tension_score += 1

        if tension_score >= 4:
            label = "High tension"
        elif tension_score >= 2:
            label = "Some tension"
        else:
            label = "Low tension"

        return {
            "label": label,
            "score": tension_score,
            "detail": f"Based on interruption frequency, pitch variation, and vocal energy patterns"
        }

    def _analyze_driver(self, signals) -> dict:
        ratio = signals["talk_ratio"]["user_ratio"]
        user_q = signals["questions"]["user_questions_asked"]
        other_q = signals["questions"]["other_questions_asked"]
        monologue = signals["monologue"]["long_turn_count"]

        user_drive_score = 0
        if ratio > 0.55:
            user_drive_score += 2
        if user_q > other_q:
            user_drive_score += 1
        if monologue > 1:
            user_drive_score += 1

        if user_drive_score >= 3:
            label = "You drove the conversation"
        elif user_drive_score == 2:
            label = "Slightly user-led"
        elif user_drive_score == 1:
            label = "Balanced"
        else:
            label = "Other person led"

        return {
            "label": label,
            "detail": f"Based on talk ratio ({round(ratio*100)}%), questions asked, and turn patterns"
        }

    def _analyze_resolution(self, signals, timeline) -> dict:
        if len(timeline) < 3:
            return {"label": "unknown", "detail": "Insufficient data"}

        # Proxy: did energy and speech rate stabilize at the end?
        last_windows = timeline[-2:]
        avg_last_wpm = np.mean([w["speech_rate_wpm"] for w in last_windows])
        overall_wpm = signals["speech_rate"]["overall_wpm"]

        energy_trend = signals["vocal_energy"].get("trend", "stable")
        interrupts = (signals["interruptions"]["user_interrupted_other"] +
                     signals["interruptions"]["user_was_interrupted"])

        if energy_trend == "decreasing" and interrupts < 3:
            label = "Likely resolved"
            detail = "Conversation appeared to wind down calmly"
        elif energy_trend == "increasing" and interrupts > 3:
            label = "Possibly unresolved"
            detail = "Energy and interruptions remained high toward the end"
        else:
            label = "Neutral ending"
            detail = "No strong signals of resolution or tension at close"

        return {"label": label, "detail": detail}