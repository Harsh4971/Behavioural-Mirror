import librosa
import numpy as np
import re
from collections import Counter

class SignalExtractor:

    FILLER_WORDS = ["um", "uh", "like", "you know", "basically",
                    "literally", "actually", "so", "right", "i mean",
                    "matlab", "yaani", "bas", "toh", "na", "aur",
                    "waise", "dekh", "yaar", "arre", "haan"]

    QUESTION_WORDS = ["what", "why", "how", "when", "where", "who",
                      "which", "whose", "whom", "kya", "kyun", "kaise",
                      "kab", "kahan", "kaun", "kisko", "kisne"]

    def __init__(self, audio_path: str, merged_segments: list, user_speaker_id: str):
        self.audio_path = audio_path
        self.segments = merged_segments
        self.user_speaker = user_speaker_id
        self.other_speaker = None

        speakers = set(s["speaker"] for s in merged_segments if s["speaker"] != "UNKNOWN")
        others = speakers - {user_speaker_id}
        if others:
            self.other_speaker = list(others)[0]

        self.audio, self.sr = librosa.load(audio_path, sr=16000)

    @staticmethod
    def detect_primary_speaker(audio_path: str, diarization_segments: list) -> str:
        """
        Auto-detect which speaker is likely the user based on vocal energy.
        The user is typically the one recording — usually louder/closer to mic.
        Returns speaker ID with highest average energy.
        """
        import librosa
        import numpy as np

        audio, sr = librosa.load(audio_path, sr=16000)

        speaker_energies = {}

        for seg in diarization_segments:
            speaker = seg["speaker"]
            start_sample = int(seg["start"] * sr)
            end_sample = int(seg["end"] * sr)
            chunk = audio[start_sample:end_sample]

            if len(chunk) < 100:
                continue

            rms = float(np.sqrt(np.mean(chunk ** 2)))

            if speaker not in speaker_energies:
                speaker_energies[speaker] = []
            speaker_energies[speaker].append(rms)

        if not speaker_energies:
            return "SPEAKER_00"

        # Return speaker with highest average energy
        avg_energies = {
            speaker: float(np.mean(energies))
            for speaker, energies in speaker_energies.items()
        }

        primary = max(avg_energies, key=avg_energies.get)
        print(f"Auto-detected primary speaker: {primary} "
              f"(energies: {avg_energies})")
        return primary

    def extract_all(self) -> dict:
        user_segs = [s for s in self.segments if s["speaker"] == self.user_speaker]
        other_segs = [s for s in self.segments if s["speaker"] == self.other_speaker] if self.other_speaker else []

        signals = {
            "session_duration_s": self._get_session_duration(),
            "talk_ratio": self._compute_talk_ratio(user_segs, other_segs),
            "speech_rate": self._compute_speech_rate(user_segs),
            "pauses": self._compute_pauses(user_segs, other_segs),
            "interruptions": self._compute_interruptions(user_segs, other_segs),
            "filler_words": self._compute_filler_words(user_segs),
            "turn_dynamics": self._compute_turn_dynamics(user_segs, other_segs),
            "pitch_features": self._compute_pitch_features(user_segs),
            "engagement_proxy": self._compute_engagement_proxy(other_segs),
            "vocal_energy": self._compute_vocal_energy(user_segs),
            "speech_acceleration": self._compute_speech_acceleration(user_segs),
            "questions": self._compute_questions(user_segs, other_segs),
            "monologue": self._compute_monologue(user_segs),
            "vocabulary_richness": self._compute_vocabulary_richness(user_segs),
            "silence_ratio": self._compute_silence_ratio(user_segs, other_segs),
            "timeline": self._build_timeline(user_segs)
        }

        # Add notable signals — which ones stand out most
        signals["notable_signals"] = self._identify_notable_signals(signals)

        return signals

    def _get_session_duration(self) -> float:
        if not self.segments:
            return 0.0
        return round(self.segments[-1]["end"], 2)

    def _compute_talk_ratio(self, user_segs, other_segs) -> dict:
        user_time = sum(s["end"] - s["start"] for s in user_segs)
        other_time = sum(s["end"] - s["start"] for s in other_segs)
        total = user_time + other_time
        return {
            "user_speaking_time_s": round(user_time, 2),
            "other_speaking_time_s": round(other_time, 2),
            "user_ratio": round(user_time / total, 3) if total > 0 else 0.5
        }

    def _compute_speech_rate(self, user_segs) -> dict:
        if not user_segs:
            return {"overall_wpm": 0, "segments": [], "variability": 0}

        segment_rates = []
        for seg in user_segs:
            duration_min = (seg["end"] - seg["start"]) / 60
            if duration_min < 0.05:
                continue
            words = seg.get("words", [])
            wpm = round(len(words) / duration_min, 1) if duration_min > 0 else 0
            segment_rates.append({
                "start": seg["start"],
                "end": seg["end"],
                "wpm": wpm
            })

        all_words = sum(len(s.get("words", [])) for s in user_segs)
        total_time_min = sum(s["end"] - s["start"] for s in user_segs) / 60

        return {
            "overall_wpm": round(all_words / total_time_min, 1) if total_time_min > 0 else 0,
            "segments": segment_rates,
            "variability": round(float(np.std([s["wpm"] for s in segment_rates])), 1) if segment_rates else 0
        }

    def _compute_pauses(self, user_segs, other_segs) -> dict:
        within_turn_pauses = []
        response_latencies = []

        for seg in user_segs:
            words = seg.get("words", [])
            for i in range(1, len(words)):
                gap = words[i].get("start", 0) - words[i-1].get("end", 0)
                if 0.15 < gap < 3.0:
                    within_turn_pauses.append(gap)

        other_ends = [s["end"] for s in other_segs]
        user_starts = [s["start"] for s in user_segs]

        for u_start in user_starts:
            preceding = [t for t in other_ends if t < u_start and u_start - t < 5.0]
            if preceding:
                latency = u_start - max(preceding)
                if latency > 0.1:
                    response_latencies.append(latency)

        return {
            "within_turn_pauses": {
                "count": len(within_turn_pauses),
                "mean_duration_s": round(float(np.mean(within_turn_pauses)), 3) if within_turn_pauses else 0,
                "total_pause_time_s": round(sum(within_turn_pauses), 2)
            },
            "response_latency": {
                "mean_s": round(float(np.mean(response_latencies)), 3) if response_latencies else 0,
                "max_s": round(float(max(response_latencies)), 3) if response_latencies else 0
            }
        }

    def _compute_interruptions(self, user_segs, other_segs) -> dict:
        all_turns = sorted(
            [{"speaker": self.user_speaker, "start": s["start"], "end": s["end"]} for s in user_segs] +
            [{"speaker": self.other_speaker, "start": s["start"], "end": s["end"]} for s in other_segs if self.other_speaker],
            key=lambda x: x["start"]
        )

        user_interrupts_other = 0
        other_interrupts_user = 0

        for i in range(1, len(all_turns)):
            prev = all_turns[i - 1]
            curr = all_turns[i]

            if prev["speaker"] == curr["speaker"]:
                continue

            gap = curr["start"] - prev["end"]
            prev_duration = prev["end"] - prev["start"]

            if gap < 0.3 and prev_duration > 1.5:
                if curr["speaker"] == self.user_speaker:
                    user_interrupts_other += 1
                else:
                    other_interrupts_user += 1

        return {
            "user_interrupted_other": user_interrupts_other,
            "user_was_interrupted": other_interrupts_user
        }

    def _compute_filler_words(self, user_segs) -> dict:
        all_text = " ".join(s.get("text", "").lower() for s in user_segs)
        all_words_count = sum(len(s.get("words", [])) for s in user_segs)

        filler_counts = {}
        total_fillers = 0
        for filler in self.FILLER_WORDS:
            count = len(re.findall(r'\b' + filler + r'\b', all_text))
            if count > 0:
                filler_counts[filler] = count
                total_fillers += count

        return {
            "total_count": total_fillers,
            "rate_per_100_words": round((total_fillers / all_words_count * 100), 2) if all_words_count > 0 else 0,
            "breakdown": filler_counts
        }

    def _compute_turn_dynamics(self, user_segs, other_segs) -> dict:
        user_turn_lengths = [s["end"] - s["start"] for s in user_segs]
        other_turn_lengths = [s["end"] - s["start"] for s in other_segs]

        return {
            "total_turns": len(user_segs) + len(other_segs),
            "user_turns": len(user_segs),
            "other_turns": len(other_segs),
            "avg_user_turn_length_s": round(float(np.mean(user_turn_lengths)), 2) if user_turn_lengths else 0,
            "avg_other_turn_length_s": round(float(np.mean(other_turn_lengths)), 2) if other_turn_lengths else 0
        }

    def _compute_pitch_features(self, user_segs) -> dict:
        pitches = []

        for seg in user_segs:
            start_sample = int(seg["start"] * self.sr)
            end_sample = int(seg["end"] * self.sr)
            segment_audio = self.audio[start_sample:end_sample]

            if len(segment_audio) < self.sr * 0.5:
                continue

            f0, voiced_flag, _ = librosa.pyin(
                segment_audio,
                fmin=librosa.note_to_hz('C2'),
                fmax=librosa.note_to_hz('C7'),
                sr=self.sr
            )

            voiced_f0 = f0[voiced_flag & ~np.isnan(f0)]
            if len(voiced_f0) > 0:
                pitches.extend(voiced_f0.tolist())

        if not pitches:
            return {"mean_hz": None, "std_hz": None, "range_hz": None}

        return {
            "mean_hz": round(float(np.mean(pitches)), 2),
            "std_hz": round(float(np.std(pitches)), 2),
            "range_hz": round(float(np.max(pitches) - np.min(pitches)), 2)
        }

    def _compute_engagement_proxy(self, other_segs) -> dict:
        if len(other_segs) < 4:
            return {"trend": "insufficient_data", "interpretation_note": "probabilistic proxy only"}

        first_half = other_segs[:len(other_segs)//2]
        second_half = other_segs[len(other_segs)//2:]

        first_avg = float(np.mean([s["end"] - s["start"] for s in first_half]))
        second_avg = float(np.mean([s["end"] - s["start"] for s in second_half]))

        delta = (second_avg - first_avg) / first_avg if first_avg > 0 else 0

        return {
            "other_speaker_turn_length_trend": round(delta, 3),
            "interpretation_note": "probabilistic proxy only"
        }

    # ── NEW SIGNALS ──────────────────────────────────────────────

    def _compute_vocal_energy(self, user_segs) -> dict:
        """RMS energy — how loud/intense the user's voice is."""
        energies = []

        for seg in user_segs:
            start_sample = int(seg["start"] * self.sr)
            end_sample = int(seg["end"] * self.sr)
            chunk = self.audio[start_sample:end_sample]
            if len(chunk) < 100:
                continue
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            energies.append(rms)

        if not energies:
            return {"mean_energy": None, "variability": None, "trend": None}

        # Trend: is energy increasing or decreasing over conversation?
        if len(energies) > 3:
            first_half = float(np.mean(energies[:len(energies)//2]))
            second_half = float(np.mean(energies[len(energies)//2:]))
            trend = "increasing" if second_half > first_half * 1.1 else \
                    "decreasing" if second_half < first_half * 0.9 else "stable"
        else:
            trend = "insufficient_data"

        return {
            "mean_energy": round(float(np.mean(energies)), 4),
            "variability": round(float(np.std(energies)), 4),
            "trend": trend
        }

    def _compute_speech_acceleration(self, user_segs) -> dict:
        """Is the user speeding up or slowing down as conversation progresses?"""
        segment_rates = []
        for seg in user_segs:
            duration_min = (seg["end"] - seg["start"]) / 60
            if duration_min < 0.05:
                continue
            words = seg.get("words", [])
            wpm = len(words) / duration_min if duration_min > 0 else 0
            segment_rates.append({
                "start": seg["start"],
                "wpm": wpm
            })

        if len(segment_rates) < 4:
            return {"trend": "insufficient_data", "delta_wpm": None}

        first_third = segment_rates[:len(segment_rates)//3]
        last_third = segment_rates[-len(segment_rates)//3:]

        first_avg = float(np.mean([s["wpm"] for s in first_third]))
        last_avg = float(np.mean([s["wpm"] for s in last_third]))
        delta = round(last_avg - first_avg, 1)

        trend = "accelerating" if delta > 15 else \
                "decelerating" if delta < -15 else "stable"

        return {
            "trend": trend,
            "delta_wpm": delta,
            "first_third_wpm": round(first_avg, 1),
            "last_third_wpm": round(last_avg, 1)
        }

    def _compute_questions(self, user_segs, other_segs) -> dict:
        """Count questions asked by each speaker."""
        user_text = " ".join(s.get("text", "").lower() for s in user_segs)
        other_text = " ".join(s.get("text", "").lower() for s in other_segs)

        # Count question marks
        user_questions = user_text.count("?")
        other_questions = other_text.count("?")

        # Count question words at start of sentences
        user_q_words = sum(1 for w in self.QUESTION_WORDS
                          if re.search(r'\b' + w + r'\b', user_text))
        other_q_words = sum(1 for w in self.QUESTION_WORDS
                           if re.search(r'\b' + w + r'\b', other_text))

        return {
            "user_questions_asked": user_questions,
            "other_questions_asked": other_questions,
            "user_question_word_count": user_q_words,
            "question_ratio": round(user_questions / (user_questions + other_questions), 2)
                              if (user_questions + other_questions) > 0 else 0.5
        }

    def _compute_monologue(self, user_segs) -> dict:
        """Detect long uninterrupted speaking stretches."""
        long_turns = [s for s in user_segs if (s["end"] - s["start"]) > 30]
        all_lengths = [s["end"] - s["start"] for s in user_segs]

        return {
            "long_turn_count": len(long_turns),  # turns > 30 seconds
            "longest_turn_s": round(max(all_lengths), 1) if all_lengths else 0,
            "avg_turn_length_s": round(float(np.mean(all_lengths)), 1) if all_lengths else 0
        }

    def _compute_vocabulary_richness(self, user_segs) -> dict:
        """Type-token ratio: unique words / total words. Higher = richer vocabulary."""
        all_text = " ".join(s.get("text", "").lower() for s in user_segs)
        words = re.findall(r'\b[a-zA-Z\u0900-\u097F]+\b', all_text)

        if len(words) < 10:
            return {"type_token_ratio": None, "unique_words": 0, "total_words": len(words)}

        unique = len(set(words))
        total = len(words)
        ttr = round(unique / total, 3)

        return {
            "type_token_ratio": ttr,
            "unique_words": unique,
            "total_words": total
        }

    def _compute_silence_ratio(self, user_segs, other_segs) -> dict:
        """How much of the session was silence (nobody speaking)."""
        duration = self._get_session_duration()
        if duration == 0:
            return {"silence_ratio": 0, "total_silence_s": 0}

        total_speaking = sum(s["end"] - s["start"] for s in user_segs + other_segs)
        silence = max(0, duration - total_speaking)

        return {
            "silence_ratio": round(silence / duration, 3),
            "total_silence_s": round(silence, 2)
        }

    def _identify_notable_signals(self, signals: dict) -> list:
        """
        Pick the 3-4 most notable signals based on thresholds.
        These will be passed to LLM to focus insights on.
        """
        notable = []

        # Talk ratio — notably imbalanced?
        ratio = signals["talk_ratio"]["user_ratio"]
        if ratio > 0.65 or ratio < 0.35:
            notable.append({
                "signal": "talk_ratio",
                "reason": "significantly imbalanced" if ratio > 0.65 else "user spoke much less",
                "value": ratio
            })

        # Speech rate — very fast or slow?
        wpm = signals["speech_rate"]["overall_wpm"]
        if wpm > 200 or wpm < 120:
            notable.append({
                "signal": "speech_rate",
                "reason": "notably fast" if wpm > 200 else "notably slow",
                "value": wpm
            })

        # Speech acceleration
        accel = signals["speech_acceleration"]["trend"]
        if accel in ["accelerating", "decelerating"]:
            notable.append({
                "signal": "speech_acceleration",
                "reason": accel,
                "value": signals["speech_acceleration"]["delta_wpm"]
            })

        # Filler words — high rate?
        filler_rate = signals["filler_words"]["rate_per_100_words"]
        if filler_rate > 3.0:
            notable.append({
                "signal": "filler_words",
                "reason": "high filler word usage",
                "value": filler_rate
            })

        # Interruptions — frequent?
        interrupts = signals["interruptions"]["user_interrupted_other"] + \
                     signals["interruptions"]["user_was_interrupted"]
        if interrupts >= 3:
            notable.append({
                "signal": "interruptions",
                "reason": f"frequent interruptions ({interrupts} total)",
                "value": interrupts
            })

        # Pauses — long response latency?
        latency = signals["pauses"]["response_latency"]["mean_s"]
        if latency > 1.5:
            notable.append({
                "signal": "pauses",
                "reason": "long response latency",
                "value": latency
            })

        # Vocal energy trend
        energy_trend = signals["vocal_energy"]["trend"]
        if energy_trend in ["increasing", "decreasing"]:
            notable.append({
                "signal": "vocal_energy",
                "reason": f"energy {energy_trend} over conversation",
                "value": energy_trend
            })

        # Questions — very one-sided?
        q_ratio = signals["questions"]["question_ratio"]
        if q_ratio > 0.7 or q_ratio < 0.3:
            notable.append({
                "signal": "questions",
                "reason": "question-asking heavily one-sided",
                "value": q_ratio
            })

        # Vocabulary richness — very high or low?
        ttr = signals["vocabulary_richness"]["type_token_ratio"]
        if ttr and (ttr > 0.7 or ttr < 0.4):
            notable.append({
                "signal": "vocabulary_richness",
                "reason": "notably rich" if ttr > 0.7 else "repetitive vocabulary",
                "value": ttr
            })

        # Monologue — long turns?
        if signals["monologue"]["long_turn_count"] > 0:
            notable.append({
                "signal": "monologue",
                "reason": f"{signals['monologue']['long_turn_count']} long speaking stretch(es)",
                "value": signals["monologue"]["longest_turn_s"]
            })

        # Sort by most extreme values, take top 4
        return notable[:4] if len(notable) >= 4 else notable

    def _build_timeline(self, user_segs) -> list:
        if not self.segments:
            return []

        duration = self.segments[-1]["end"]
        window_size = 60
        windows = []

        for window_start in range(0, int(duration), window_size):
            window_end = window_start + window_size
            window_segs = [s for s in user_segs
                          if s["start"] >= window_start and s["end"] <= window_end]

            if not window_segs:
                continue

            words_in_window = sum(len(s.get("words", [])) for s in window_segs)
            speaking_time = sum(s["end"] - s["start"] for s in window_segs)
            wpm = round(words_in_window / (speaking_time / 60), 1) if speaking_time > 0 else 0

            windows.append({
                "window_start_s": window_start,
                "window_end_s": min(window_end, duration),
                "speech_rate_wpm": wpm,
                "speaking_time_s": round(speaking_time, 1),
                "turn_count": len(window_segs)
            })

        return windows