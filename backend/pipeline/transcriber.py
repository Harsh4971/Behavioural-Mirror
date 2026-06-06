import os
import subprocess
from groq import Groq


class Transcriber:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)
        print("Groq Whisper transcriber ready.")

    def transcribe(self, audio_path: str) -> dict:
        print(f"Transcribing via Groq Whisper large-v3: {audio_path}")

        # WAV at 16kHz mono can be ~37MB for a 20-min session, exceeding Groq's 25MB limit.
        # Convert to MP3 at 64kbps (~9MB for 20 min) before uploading.
        mp3_path = audio_path.rsplit(".", 1)[0] + "_upload.mp3"
        subprocess.run(
            ["ffmpeg", "-i", audio_path, "-ar", "16000", "-ac", "1",
             "-b:a", "64k", "-y", mp3_path],
            capture_output=True
        )

        try:
            with open(mp3_path, "rb") as f:
                response = self.client.audio.transcriptions.create(
                    file=(os.path.basename(mp3_path), f),
                    model="whisper-large-v3",
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                    temperature=0.0,
                )
        finally:
            if os.path.exists(mp3_path):
                os.remove(mp3_path)

        # Groq verbose_json returns words at top level (not nested in segments).
        # Map each word into its parent segment by timestamp overlap.
        raw_words = getattr(response, "words", None) or []
        if raw_words and isinstance(raw_words[0], dict):
            word_list = [
                {"word": w["word"], "start": round(w["start"], 3),
                 "end": round(w["end"], 3), "score": 1.0}
                for w in raw_words
            ]
        else:
            word_list = [
                {"word": w.word, "start": round(w.start, 3),
                 "end": round(w.end, 3), "score": 1.0}
                for w in raw_words
            ]

        raw_segments = getattr(response, "segments", None) or []
        segments = []
        for seg in raw_segments:
            if isinstance(seg, dict):
                s_start, s_end, s_text = seg["start"], seg["end"], seg["text"]
            else:
                s_start, s_end, s_text = seg.start, seg.end, seg.text

            seg_words = [
                w for w in word_list
                if w["start"] >= s_start - 0.05 and w["start"] < s_end + 0.05
            ]
            segments.append({
                "start": round(s_start, 3),
                "end": round(s_end, 3),
                "text": s_text.strip(),
                "words": seg_words,
            })

        detected_language = getattr(response, "language", "unknown")
        print(f"Detected language: {detected_language}")

        return {
            "segments": segments,
            "language": detected_language,
        }
