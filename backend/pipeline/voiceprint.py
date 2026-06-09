import numpy as np
import json


class VoiceprintMatcher:
    def __init__(self, hf_token: str = None):
        try:
            from pyannote.audio import Inference, Model
            from pyannote.core import Segment

            self._Segment = Segment
            try:
                model = Model.from_pretrained(
                    "pyannote/embedding",
                    token=hf_token
                )
            except TypeError:
                model = Model.from_pretrained(
                    "pyannote/embedding",
                    use_auth_token=hf_token
                )
            self.inference = Inference(model, window="whole")
            self.available = True
        except Exception as e:
            print(f"[startup] Warning: voiceprint model unavailable — {e}")
            self.inference = None
            self._Segment = None
            self.available = False

    def extract_enrollment_embedding(self, audio_path: str) -> "np.ndarray | None":
        """Extract embedding from a single-speaker enrollment recording (whole file)."""
        if not self.available:
            return None
        try:
            emb = self.inference(audio_path)
            if emb is not None:
                return np.array(emb).flatten()
        except Exception as e:
            print(f"[enroll] Embedding failed: {e}")
        return None

    def extract_speaker_embedding(
        self,
        audio_path: str,
        segments: list
    ) -> "np.ndarray | None":
        """Return mean embedding for a speaker given their diarization segments."""
        if not self.available:
            return None

        # Prefer longer segments; cap at 10 to keep it fast
        sorted_segs = sorted(
            [s for s in segments if s["end"] - s["start"] >= 1.0],
            key=lambda s: s["end"] - s["start"],
            reverse=True
        )[:10]

        if not sorted_segs:
            return None

        embeddings = []
        for seg in sorted_segs:
            try:
                emb = self.inference(
                    audio_path,
                    excerpt=self._Segment(seg["start"], seg["end"])
                )
                if emb is not None:
                    embeddings.append(np.array(emb).flatten())
            except Exception:
                continue

        if not embeddings:
            return None

        return np.mean(embeddings, axis=0)

    def identify_speaker(
        self,
        audio_path: str,
        diarization_segments: list,
        stored_embedding: "np.ndarray"
    ) -> "tuple[str | None, float]":
        """Return (speaker_id, cosine_similarity) of the speaker closest to stored embedding."""
        if not self.available:
            return None, 0.0

        speaker_segs: dict[str, list] = {}
        for seg in diarization_segments:
            speaker_segs.setdefault(seg["speaker"], []).append(seg)

        best_speaker, best_score = None, -1.0
        for speaker_id, segs in speaker_segs.items():
            emb = self.extract_speaker_embedding(audio_path, segs)
            if emb is None:
                continue
            score = self._cosine_similarity(emb, stored_embedding)
            if score > best_score:
                best_score, best_speaker = score, speaker_id

        return best_speaker, round(float(best_score), 3)

    def get_all_embeddings(
        self,
        audio_path: str,
        diarization_segments: list
    ) -> "dict[str, np.ndarray]":
        """Extract embeddings for every speaker in the diarization."""
        if not self.available:
            return {}

        speaker_segs: dict[str, list] = {}
        for seg in diarization_segments:
            speaker_segs.setdefault(seg["speaker"], []).append(seg)

        return {
            sid: emb
            for sid, segs in speaker_segs.items()
            if (emb := self.extract_speaker_embedding(audio_path, segs)) is not None
        }

    # ── Serialization helpers ─────────────────────────────────────

    @staticmethod
    def embedding_to_json(emb: "np.ndarray") -> str:
        return json.dumps(emb.tolist())

    @staticmethod
    def embedding_from_json(json_str: str) -> "np.ndarray":
        return np.array(json.loads(json_str))

    # ── Internal ──────────────────────────────────────────────────

    @staticmethod
    def _cosine_similarity(a: "np.ndarray", b: "np.ndarray") -> float:
        a, b = a.flatten(), b.flatten()
        norm_a, norm_b = np.linalg.norm(a), np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
