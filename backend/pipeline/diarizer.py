import torch
from pyannote.audio import Pipeline

torch.serialization.add_safe_globals([])


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

        print(f"[diarizer] result type: {type(result).__name__}, has itertracks: {hasattr(result, 'itertracks')}")

        # Unwrap whatever container pyannote returns to get the Annotation object
        if hasattr(result, 'itertracks'):
            annotation = result
        elif hasattr(result, 'diarization'):
            annotation = result.diarization
        else:
            # Last resort: namedtuple/dataclass — grab first field via iteration
            try:
                annotation = next(iter(result))
            except TypeError:
                annotation = result

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
