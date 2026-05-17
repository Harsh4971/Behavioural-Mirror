import numpy as np
import librosa
from sklearn.cluster import KMeans

class Diarizer:
    def __init__(self, hf_token: str = None):
        print("Diarizer ready (librosa-based).")

    def diarize(self, audio_path: str, num_speakers: int = 2) -> list:
        print(f"Diarizing: {audio_path}")

        audio, sr = librosa.load(audio_path, sr=16000, mono=True)

        # Split into 1-second windows with 0.5s hop
        window = sr          # 1 second
        hop = sr // 2        # 0.5 second

        embeddings = []
        timestamps = []

        for start in range(0, len(audio) - window, hop):
            chunk = audio[start:start + window]

            # Extract simple features: MFCCs
            mfcc = librosa.feature.mfcc(y=chunk, sr=sr, n_mfcc=13)
            embedding = np.concatenate([mfcc.mean(axis=1), mfcc.std(axis=1)])
            embeddings.append(embedding)
            timestamps.append({
                "start": round(start / sr, 3),
                "end": round((start + window) / sr, 3)
            })

        if len(embeddings) < num_speakers:
            # Not enough audio — assign everything to speaker 0
            return [{"speaker": "SPEAKER_00", "start": 0.0,
                     "end": round(len(audio) / sr, 3)}]

        # Cluster into num_speakers groups
        kmeans = KMeans(n_clusters=num_speakers, random_state=0, n_init=10)
        labels = kmeans.fit_predict(np.array(embeddings))

        # Build segment list
        raw_segments = []
        for ts, label in zip(timestamps, labels):
            raw_segments.append({
                "speaker": f"SPEAKER_0{label}",
                "start": ts["start"],
                "end": ts["end"]
            })

        # Merge consecutive same-speaker segments
        merged = []
        for seg in raw_segments:
            if (merged and
                merged[-1]["speaker"] == seg["speaker"] and
                seg["start"] - merged[-1]["end"] < 1.0):
                merged[-1]["end"] = seg["end"]
            else:
                merged.append(dict(seg))

        return merged

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