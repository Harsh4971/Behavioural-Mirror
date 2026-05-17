import whisper
import subprocess
import os

class Transcriber:
    def __init__(self, model_size="base"):
        print(f"Loading Whisper model: {model_size}")
        self.model = whisper.load_model(model_size)
        print("Whisper model loaded.")

    def convert_to_wav(self, audio_path: str) -> str:
        """Convert any audio format to WAV using ffmpeg."""
        wav_path = audio_path.replace(".m4a", ".wav").replace(".mp3", ".wav").replace(".mp4", ".wav")
        if wav_path == audio_path:
            wav_path = audio_path + ".wav"

        subprocess.run([
            "ffmpeg", "-i", audio_path,
            "-ar", "16000",
            "-ac", "1",
            "-y", wav_path
        ], capture_output=True)

        return wav_path

    def transcribe(self, audio_path: str) -> dict:
        print(f"Transcribing: {audio_path}")

        # Convert to WAV if needed
        if not audio_path.endswith(".wav"):
            print("Converting to WAV...")
            wav_path = self.convert_to_wav(audio_path)
        else:
            wav_path = audio_path

        result = self.model.transcribe(
            wav_path,
            word_timestamps=True,
            verbose=False
        )

        # Clean up converted file
        if wav_path != audio_path and os.path.exists(wav_path):
            os.remove(wav_path)

        segments = []
        for seg in result["segments"]:
            words = []
            for w in seg.get("words", []):
                words.append({
                    "word": w["word"].strip(),
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                    "score": round(w.get("probability", 0), 3)
                })

            segments.append({
                "start": round(seg["start"], 3),
                "end": round(seg["end"], 3),
                "text": seg["text"].strip(),
                "words": words
            })

        return {
            "segments": segments,
            "language": result.get("language", "en")
        }



# import whisper
# import json

# class Transcriber:
#     def __init__(self, model_size="base"):
#         print(f"Loading Whisper model: {model_size}")
#         self.model = whisper.load_model(model_size)
#         print("Whisper model loaded.")

#     def transcribe(self, audio_path: str) -> dict:
#         print(f"Transcribing: {audio_path}")
#         result = self.model.transcribe(
#             audio_path,
#             word_timestamps=True,
#             verbose=False
#         )

#         segments = []
#         for seg in result["segments"]:
#             words = []
#             for w in seg.get("words", []):
#                 words.append({
#                     "word": w["word"].strip(),
#                     "start": round(w["start"], 3),
#                     "end": round(w["end"], 3),
#                     "score": round(w.get("probability", 0), 3)
#                 })

#             segments.append({
#                 "start": round(seg["start"], 3),
#                 "end": round(seg["end"], 3),
#                 "text": seg["text"].strip(),
#                 "words": words
#             })

#         return {
#             "segments": segments,
#             "language": result.get("language", "en")
#         }