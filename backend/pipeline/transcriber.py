import os
import requests

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


class Transcriber:
    def __init__(self, api_key: str):
        self.api_key = api_key
        print("Deepgram Nova-3 transcriber ready.")

    def transcribe(self, audio_path: str) -> dict:
        print(f"Transcribing via Deepgram Nova-3: {audio_path}")

        with open(audio_path, "rb") as f:
            audio_bytes = f.read()

        params = {
            "model": "nova-3",
            # "multi" enables code-switching across Deepgram's 10 supported languages
            # (incl. Hindi + English) rather than locking to a single language — needed
            # for Hinglish speech, which single-language Whisper mis-transliterated.
            "language": "multi",
            "smart_format": "true",
            "punctuate": "true",
            "utterances": "true",
            # Never used to train Deepgram's models — matches the "audio used transiently,
            # never used to build a profile" privacy design.
            "mip_opt_out": "true",
        }
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "audio/wav",
        }

        response = requests.post(
            DEEPGRAM_URL, params=params, headers=headers, data=audio_bytes, timeout=300
        )
        response.raise_for_status()
        result = response.json()

        channel = result.get("results", {}).get("channels", [{}])[0]
        alternative = (channel.get("alternatives") or [{}])[0]
        utterances = result.get("results", {}).get("utterances") or []

        segments = []
        for utt in utterances:
            words = [
                {
                    "word": w.get("punctuated_word", w.get("word", "")),
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                    "score": w.get("confidence", 1.0),
                }
                for w in utt.get("words", [])
            ]
            segments.append({
                "start": round(utt["start"], 3),
                "end": round(utt["end"], 3),
                "text": utt.get("transcript", "").strip(),
                "words": words,
            })

        # Fallback for the rare case Deepgram returns words but no utterance boundaries
        # (e.g. very short clips) — treat the whole transcript as one segment.
        if not segments and alternative.get("words"):
            words = [
                {
                    "word": w.get("punctuated_word", w.get("word", "")),
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                    "score": w.get("confidence", 1.0),
                }
                for w in alternative["words"]
            ]
            segments.append({
                "start": words[0]["start"],
                "end": words[-1]["end"],
                "text": alternative.get("transcript", "").strip(),
                "words": words,
            })

        detected_language = channel.get("detected_language", "multi")
        print(f"Detected language: {detected_language}")

        return {
            "segments": segments,
            "language": detected_language,
        }
