import torch
from pyannote.audio import Pipeline
from pyannote.core import Annotation

torch.serialization.add_safe_globals([])


def _extract_annotation(result) -> Annotation:
    """Extract pyannote Annotation from whatever the pipeline returns."""
    if isinstance(result, Annotation):
        return result
    # Scan named attributes (handles dataclasses and namedtuples)
    for attr in dir(result):
        if attr.startswith('_'):
            continue
        try:
            val = getattr(result, attr)
            if isinstance(val, Annotation):
                return val
        except Exception:
            pass
    # Try positional iteration (plain tuples / namedtuples)
    try:
        for item in result:
            if isinstance(item, Annotation):
                return item
    except TypeError:
        pass
    raise RuntimeError(
        f"Cannot find Annotation in diarization result: "
        f"{type(result).__name__} attrs={[a for a in dir(result) if not a.startswith('_')]}"
    )


class Diarizer:
    def __init__(self, hf_token: str = None):
        try:
            self.pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                token=hf_token
            )
        except TypeError:
            self.pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=hf_token
            )

    def diarize(self, audio_path: str) -> list:
        with torch.no_grad():
            result = self.pipeline(audio_path, min_speakers=1, max_speakers=6)

        annotation = _extract_annotation(result)

        return [
            {"speaker": speaker, "start": round(turn.start, 3), "end": round(turn.end, 3)}
            for turn, _, speaker in annotation.itertracks(yield_label=True)
        ]

    def merge_transcript_with_speakers(
        self,
        transcript_segments: list,
        diarization_segments: list
    ) -> list:
        merged = []
        for t_seg in transcript_segments:
            t_mid = (t_seg["start"] + t_seg["end"]) / 2
            assigned_speaker = "SPEAKER_00"
            for d_seg in diarization_segments:
                if d_seg["start"] <= t_mid <= d_seg["end"]:
                    assigned_speaker = d_seg["speaker"]
                    break
            merged.append({**t_seg, "speaker": assigned_speaker})
        return merged
