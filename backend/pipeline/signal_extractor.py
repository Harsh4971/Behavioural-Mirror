import librosa
import numpy as np
import re
from collections import Counter

class SignalExtractor:

    # True hesitation fillers only — "so"/"like"/"right"/"actually" and Hindi
    # "aur"/"toh"/"na"/"haan"/"bas"/"yaar"/"arre"/"waise"/"dekh"/"matlab"/"yaani" are
    # ordinary discourse/address words, not filler sounds, and must not be counted.
    FILLER_WORDS = ["um", "uh", "you know", "basically", "literally", "i mean"]

    QUESTION_WORDS = ["what", "why", "how", "when", "where", "who",
                      "which", "whose", "whom", "kya", "kyun", "kaise",
                      "kab", "kahan", "kaun", "kisko", "kisne"]

    # Hedging phrases only — genuine uncertainty markers, not ordinary connectors.
    HEDGING_PHRASES = ["i think", "i guess", "maybe", "perhaps", "kind of", "sort of",
                        "i feel like", "probably", "possibly", "it seems", "i suppose",
                        "shayad", "lagta hai"]

    # Assertive/definitive markers. Known limitation: "always"/"never" are overloaded
    # in casual speech ("I never really thought about it that way" isn't assertive) —
    # an accepted v1 approximation of a keyword-list approach, not an oversight.
    DIRECT_MARKERS = ["i will", "definitely", "certainly", "always", "never",
                       "must", "let's", "we should", "you need to"]

    # Explicit continuation/agreement markers for "building on others' points".
    # Deliberately English-only for now — candidate Hindi phrases ("iske alawa",
    # "isi baat ko aage badhate hue") read as too formal/written-register for
    # spontaneous code-switched speech, so they're left out rather than shipped on
    # an unverified guess. The lexical-overlap component below is language-agnostic
    # and carries more weight for Hindi-heavy sessions as a result.
    BUILDING_ON_MARKERS = ["building on that", "to add to what", "yes, and",
                            "exactly, and", "adding to that"]

    # Small stopword list for the lexical-overlap component only — content words
    # shared between two consecutive turns, not a general-purpose NLP stopword list.
    STOPWORDS = {"the", "and", "that", "this", "with", "have", "were", "they",
                 "what", "when", "where", "which", "there", "their", "your",
                 "about", "would", "could", "should", "just", "like", "from"}

    def __init__(self, audio_path: str, merged_segments: list, user_speaker_id: str):
        self.audio_path = audio_path
        self.segments = merged_segments
        self.user_speaker = user_speaker_id
        self.other_speaker = None

        speakers = set(s["speaker"] for s in merged_segments if s["speaker"] != "UNKNOWN")
        others = speakers - {user_speaker_id}
        if others:
            # Dyadic partner for the handful of signals that need exactly one
            # (pauses, turn_dynamics, questions, engagement_proxy, crosstalk) —
            # whoever the user actually shared the most airtime with, not an
            # arbitrary pick off Python's set ordering (meaningless in 3+-person
            # meetings). Room-wide signals (talk_ratio, interruptions, etc.)
            # don't use this at all — see all_other_segs in extract_all().
            duration_by_speaker = {}
            for s in merged_segments:
                if s["speaker"] in others:
                    duration_by_speaker[s["speaker"]] = duration_by_speaker.get(s["speaker"], 0) + (s["end"] - s["start"])
            self.other_speaker = max(duration_by_speaker, key=duration_by_speaker.get)

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
        # Primary "other" speaker used for dyadic metrics (interruptions, pauses, engagement)
        other_segs = [s for s in self.segments if s["speaker"] == self.other_speaker] if self.other_speaker else []
        # ALL non-user speakers — used for talk ratio and silence so multi-speaker meetings
        # (and Meet's duplicate-track issue) don't inflate the user's share.
        all_other_segs = [s for s in self.segments if s["speaker"] not in {self.user_speaker, "UNKNOWN"}]

        turn_dynamics = self._compute_turn_dynamics(user_segs, other_segs)
        questions = self._compute_questions(user_segs, other_segs)
        # Room-wide (all_other_segs), not dyadic — otherwise this collapses a
        # multi-party meeting to one arbitrary "other" (CLAUDE.md forbids this).
        # Computed before drive_vs_follow so its interruption_asymmetry input
        # can reuse this result instead of computing interruptions twice.
        interruptions = self._compute_interruptions(user_segs, all_other_segs)

        signals = {
            "session_duration_s": self._get_session_duration(),
            "talk_ratio": self._compute_talk_ratio(user_segs, all_other_segs),
            "speech_rate": self._compute_speech_rate(user_segs),
            "pauses": self._compute_pauses(user_segs, other_segs),
            "interruptions": interruptions,
            "filler_words": self._compute_filler_words(user_segs),
            "turn_dynamics": turn_dynamics,
            "pitch_features": self._compute_pitch_features(user_segs),
            "engagement_proxy": self._compute_engagement_proxy(other_segs),
            "vocal_energy": self._compute_vocal_energy(user_segs),
            "speech_acceleration": self._compute_speech_acceleration(user_segs),
            "questions": questions,
            "curiosity": self._compute_curiosity(user_segs, all_other_segs),
            "monologue": self._compute_monologue(user_segs),
            "vocabulary_richness": self._compute_vocabulary_richness(user_segs),
            "silence_ratio": self._compute_silence_ratio(user_segs, all_other_segs),
            "crosstalk": self._compute_crosstalk(user_segs, other_segs),
            "timeline": self._build_timeline(user_segs),
            "hedging": self._compute_hedging(user_segs),
            "directness": self._compute_directness(user_segs),
            "question_impact": self._compute_question_impact(user_segs, all_other_segs),
            "drive_vs_follow": self._compute_drive_vs_follow(
                user_segs, other_segs, all_other_segs, turn_dynamics, questions, interruptions
            ),
            "building_on_others": self._compute_building_on_others(user_segs, all_other_segs),
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

    def _build_all_turns(self, user_segs, other_segs) -> list:
        """Chronologically ordered turn sequence across speakers.

        Pass `other_segs` (the single dyadic partner) for dyadic-only signals, to
        match existing behavior — or `all_other_segs` for room-wide signals. Each
        turn carries its segment's real `speaker` label (never collapsed to
        `self.other_speaker`), so this stays correct for multi-speaker meetings —
        CLAUDE.md: never collapse a multi-party meeting to one arbitrary "other".
        """
        turns = [{"speaker": self.user_speaker, "start": s["start"], "end": s["end"],
                  "text": s.get("text", ""), "words": s.get("words", [])} for s in user_segs]
        turns += [{"speaker": s["speaker"], "start": s["start"], "end": s["end"],
                   "text": s.get("text", ""), "words": s.get("words", [])} for s in other_segs]
        return sorted(turns, key=lambda x: x["start"])

    def _compute_interruptions(self, user_segs, other_segs) -> dict:
        """`other_segs` should be the room-wide `all_other_segs` (not just the
        primary dyadic partner) — otherwise this silently collapses a
        multi-party meeting to one arbitrary "other", which CLAUDE.md forbids."""
        all_turns = self._build_all_turns(user_segs, other_segs)

        user_interrupts_other = 0
        other_interrupts_user = 0
        transitions = 0

        for i in range(1, len(all_turns)):
            prev = all_turns[i - 1]
            curr = all_turns[i]

            if prev["speaker"] == curr["speaker"]:
                continue
            transitions += 1

            gap = curr["start"] - prev["end"]
            prev_duration = prev["end"] - prev["start"]

            if gap < 0.3 and prev_duration > 1.5:
                if curr["speaker"] == self.user_speaker:
                    user_interrupts_other += 1
                else:
                    other_interrupts_user += 1

        return {
            "user_interrupted_other": user_interrupts_other,
            "user_was_interrupted": other_interrupts_user,
            "total_transitions": transitions,
            "user_interrupt_rate_per_10_transitions": round(user_interrupts_other / transitions * 10, 2) if transitions else None,
            "user_was_interrupted_rate_per_10_transitions": round(other_interrupts_user / transitions * 10, 2) if transitions else None,
        }

    def _compute_hedging(self, user_segs) -> dict:
        all_text = " ".join(s.get("text", "").lower() for s in user_segs)
        all_words_count = sum(len(s.get("words", [])) for s in user_segs)

        hedge_counts = {}
        total_hedges = 0
        for phrase in self.HEDGING_PHRASES:
            count = len(re.findall(r'\b' + phrase + r'\b', all_text))
            if count > 0:
                hedge_counts[phrase] = count
                total_hedges += count

        return {
            "total_count": total_hedges,
            "rate_per_100_words": round((total_hedges / all_words_count * 100), 2) if all_words_count > 0 else 0,
            "breakdown": hedge_counts
        }

    def _compute_directness(self, user_segs) -> dict:
        all_text = " ".join(s.get("text", "").lower() for s in user_segs)
        all_words_count = sum(len(s.get("words", [])) for s in user_segs)

        marker_counts = {}
        total_markers = 0
        for marker in self.DIRECT_MARKERS:
            count = len(re.findall(r'\b' + marker + r'\b', all_text))
            if count > 0:
                marker_counts[marker] = count
                total_markers += count

        return {
            "total_count": total_markers,
            "rate_per_100_words": round((total_markers / all_words_count * 100), 2) if all_words_count > 0 else 0,
            "breakdown": marker_counts
        }

    @staticmethod
    def _is_question_turn(text: str) -> bool:
        """A turn counts as a question if it contains '?' or a question-word
        (English or Hindi). Shared by _compute_question_impact and
        _compute_curiosity so both count "a question" the same way."""
        text = text.lower()
        return "?" in text or any(
            re.search(r'\b' + w + r'\b', text) for w in SignalExtractor.QUESTION_WORDS
        )

    def _compute_curiosity(self, user_segs, all_other_segs) -> dict:
        """Rate of the user's turns that are questions, per 100 words spoken —
        a rate rather than _compute_questions' raw "?"-count, so it's comparable
        across sessions of different length. Uses the same per-turn question
        test as _compute_question_impact for consistency between the two."""
        all_turns = self._build_all_turns(user_segs, all_other_segs)

        user_turns = 0
        question_turns = 0
        for turn in all_turns:
            if turn["speaker"] != self.user_speaker:
                continue
            user_turns += 1
            if self._is_question_turn(turn["text"]):
                question_turns += 1

        total_words = sum(len(s.get("words", [])) for s in user_segs)
        rate = round(question_turns / total_words * 100, 2) if total_words > 0 else None

        return {
            "question_turn_count": question_turns,
            "user_turns": user_turns,
            "total_words": total_words,
            "question_turn_rate_per_100_words": rate,
        }

    def _compute_question_impact(self, user_segs, all_other_segs) -> dict:
        """Did the room pick up the user's questions? Uses the room-wide turn
        sequence (any participant, not just the primary dyadic partner)."""
        all_turns = self._build_all_turns(user_segs, all_other_segs)

        total_questions = 0
        picked_up = 0
        pickup_latencies = []

        for i, turn in enumerate(all_turns):
            if turn["speaker"] != self.user_speaker:
                continue
            if not self._is_question_turn(turn["text"]):
                continue
            total_questions += 1

            # Next turn from a different speaker, within the same 5.0s window
            # _compute_pauses's response_latency already uses.
            for later in all_turns[i + 1:]:
                if later["speaker"] == self.user_speaker:
                    continue
                gap = later["start"] - turn["end"]
                if gap >= 5.0:
                    break
                if gap < 0:
                    continue
                # Substantive reply — more than a one-word backchannel ("yeah"/"haan").
                if len(later.get("words", [])) >= 4:
                    picked_up += 1
                    pickup_latencies.append(gap)
                break

        return {
            "total_user_questions": total_questions,
            "questions_picked_up": picked_up,
            "pickup_rate": round(picked_up / total_questions, 3) if total_questions > 0 else None,
            "avg_pickup_latency_s": round(float(np.mean(pickup_latencies)), 3) if pickup_latencies else None,
        }

    def _compute_drive_vs_follow(self, user_segs, other_segs, all_other_segs, turn_dynamics,
                                  questions, interruptions) -> dict:
        """Composite of four already-computed signals — a single proxy (e.g. just
        "turns not preceded by a question") is too thin on its own; three of these
        inputs match dimension_scorer.py's _analyze_driver, and interruption_asymmetry
        is added as a 4th, more direct signal of assertiveness (pure timing, not an
        inferred proxy). Weighted equally (0.25 each) — the original 0.4/0.3/0.3
        weights were never empirically validated, so there's no principled reason to
        keep favoring one input now that a 4th is added."""
        all_turns = self._build_all_turns(user_segs, all_other_segs)

        user_turns_total = 0
        user_turns_initiated = 0
        for i, turn in enumerate(all_turns):
            if turn["speaker"] != self.user_speaker:
                continue
            user_turns_total += 1
            prev = all_turns[i - 1] if i > 0 else None
            preceded_by_question = bool(
                prev and prev["speaker"] != self.user_speaker and "?" in prev["text"].lower()
            )
            if not preceded_by_question:
                user_turns_initiated += 1

        initiation_fraction = round(user_turns_initiated / user_turns_total, 3) if user_turns_total > 0 else 0.5

        avg_user_len = turn_dynamics.get("avg_user_turn_length_s", 0)
        avg_other_len = turn_dynamics.get("avg_other_turn_length_s", 0)
        total_len = avg_user_len + avg_other_len
        turn_length_asymmetry = round(avg_user_len / total_len, 3) if total_len > 0 else 0.5

        user_q = questions.get("user_questions_asked", 0)
        other_q = questions.get("other_questions_asked", 0)
        total_q = user_q + other_q
        question_asymmetry = round(user_q / total_q, 3) if total_q > 0 else 0.5

        ui = interruptions.get("user_interrupted_other", 0)
        uwi = interruptions.get("user_was_interrupted", 0)
        total_i = ui + uwi
        interruption_asymmetry = round(ui / total_i, 3) if total_i > 0 else 0.5

        drive_score = round(
            0.25 * initiation_fraction + 0.25 * turn_length_asymmetry +
            0.25 * question_asymmetry + 0.25 * interruption_asymmetry, 3
        )

        return {
            "drive_score": drive_score,
            "initiation_fraction": initiation_fraction,
            "turn_length_asymmetry": turn_length_asymmetry,
            "question_asymmetry": question_asymmetry,
            "interruption_asymmetry": interruption_asymmetry,
        }

    def _compute_building_on_others(self, user_segs, all_other_segs) -> dict:
        """Approximate proxy — marker phrases + lexical overlap with the immediately
        preceding other-speaker turn, not semantic reasoning. Two components combined
        via union (either counts), since a user could do one without the other."""
        all_turns = self._build_all_turns(user_segs, all_other_segs)

        total_user_turns = 0
        eligible_turns = 0  # user turns immediately following an other-speaker turn —
                            # the only turns where the lexical-overlap check can fire
        marker_matches = 0
        overlap_matches = 0
        building_on_count = 0

        for i, turn in enumerate(all_turns):
            if turn["speaker"] != self.user_speaker:
                continue
            total_user_turns += 1
            text = turn["text"].lower()
            prev = all_turns[i - 1] if i > 0 else None
            is_eligible = bool(prev and prev["speaker"] != self.user_speaker)
            if is_eligible:
                eligible_turns += 1

            has_marker = any(text.startswith(m) for m in self.BUILDING_ON_MARKERS)
            if has_marker:
                marker_matches += 1

            has_overlap = False
            if is_eligible:
                prev_words = {
                    w for w in re.findall(r"[a-z']+", prev["text"].lower())
                    if len(w) > 3 and w not in self.STOPWORDS
                }
                curr_words = {
                    w for w in re.findall(r"[a-z']+", text)
                    if len(w) > 3 and w not in self.STOPWORDS
                }
                if len(prev_words & curr_words) >= 2:
                    has_overlap = True
                    overlap_matches += 1

            if has_marker or has_overlap:
                building_on_count += 1

        return {
            # Denominator is eligible_turns (turns that could structurally show
            # overlap), not total_user_turns — turns following your own prior
            # turn can only ever match via has_marker, so counting them in the
            # denominator quietly diluted the rate.
            "building_on_rate": round(building_on_count / eligible_turns, 3) if eligible_turns > 0 else 0,
            "marker_matches": marker_matches,
            "lexical_overlap_matches": overlap_matches,
            "total_user_turns": total_user_turns,
            "eligible_turns": eligible_turns,
            "interpretation_note": "approximate proxy — marker phrases + lexical overlap, not semantic reasoning",
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
        """RMS energy per speaker turn — trend via linear regression."""
        energies = []
        for seg in user_segs:
            start_sample = int(seg["start"] * self.sr)
            end_sample = int(seg["end"] * self.sr)
            chunk = self.audio[start_sample:end_sample]
            if len(chunk) < 160:  # skip < 10ms
                continue
            energies.append(float(np.sqrt(np.mean(chunk ** 2))))

        if not energies:
            return {"mean_energy": None, "variability": None, "trend": "stable"}

        mean_e = float(np.mean(energies))

        if len(energies) >= 3:
            x = np.arange(len(energies), dtype=float)
            slope, _ = np.polyfit(x, energies, 1)
            # Relative change across the full conversation
            relative_change = (slope * (len(energies) - 1)) / (mean_e + 1e-9)
            trend = "increasing" if relative_change > 0.05 else \
                    "decreasing" if relative_change < -0.05 else "stable"
        else:
            trend = "stable"

        return {
            "mean_energy": round(mean_e, 4),
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
        total_turns = len(user_segs)

        return {
            "long_turn_count": len(long_turns),  # turns > 30 seconds
            "longest_turn_s": round(max(all_lengths), 1) if all_lengths else 0,
            "avg_turn_length_s": round(float(np.mean(all_lengths)), 1) if all_lengths else 0,
            "long_turn_rate": round(len(long_turns) / total_turns, 3) if total_turns > 0 else None,
        }

    # First N words only \u2014 type-token ratio mechanically decreases as text gets
    # longer (common words get reused more), which would confound a whole-session
    # TTR with session length rather than actual vocabulary behavior. A fixed
    # window makes every session's TTR comparable regardless of how long it ran.
    VOCAB_WINDOW_WORDS = 150

    def _compute_vocabulary_richness(self, user_segs) -> dict:
        """Type-token ratio over a fixed-size window: unique words / total words
        in the first VOCAB_WINDOW_WORDS words spoken. Higher = richer vocabulary."""
        all_text = " ".join(s.get("text", "").lower() for s in user_segs)
        words = re.findall(r'\b[a-zA-Z\u0900-\u097F]+\b', all_text)

        if len(words) < self.VOCAB_WINDOW_WORDS:
            return {"type_token_ratio": None, "unique_words": 0, "total_words": len(words)}

        window = words[:self.VOCAB_WINDOW_WORDS]
        unique = len(set(window))
        ttr = round(unique / len(window), 3)

        return {
            "type_token_ratio": ttr,
            "unique_words": unique,
            "total_words": len(words),  # full-session count, kept for display \u2014 TTR itself is windowed
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

        # Pitch variance — notably monotone or very expressive?
        pitch_std = signals["pitch_features"].get("std_hz")
        if pitch_std is not None:
            if pitch_std < 20:
                notable.append({
                    "signal": "pitch",
                    "reason": "very monotone delivery (low pitch variance)",
                    "value": pitch_std
                })
            elif pitch_std > 60:
                notable.append({
                    "signal": "pitch",
                    "reason": "highly expressive delivery (high pitch variance)",
                    "value": pitch_std
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

        # Crosstalk — high simultaneous speech?
        crosstalk = signals["crosstalk"]["crosstalk_ratio"]
        if crosstalk > 0.05:
            notable.append({
                "signal": "crosstalk",
                "reason": "high simultaneous speech" if crosstalk > 0.1 else "noticeable crosstalk",
                "value": crosstalk
            })

        # Sort by most extreme values, take top 4
        return notable[:4] if len(notable) >= 4 else notable

    def _compute_crosstalk(self, user_segs, other_segs) -> dict:
        """Simultaneous speech — both speakers talking at the same time."""
        duration = self._get_session_duration()
        if not duration or not other_segs:
            return {"crosstalk_ratio": 0.0, "crosstalk_s": 0.0}

        total_overlap = 0.0
        for u in user_segs:
            for o in other_segs:
                overlap = min(u["end"], o["end"]) - max(u["start"], o["start"])
                if overlap > 0:
                    total_overlap += overlap

        return {
            "crosstalk_ratio": round(total_overlap / duration, 3),
            "crosstalk_s": round(total_overlap, 2),
        }

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