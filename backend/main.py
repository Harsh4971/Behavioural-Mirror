from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os, shutil, uuid, json
from dotenv import load_dotenv
import numpy as np

load_dotenv()

from pipeline.transcriber import Transcriber
from pipeline.diarizer import Diarizer
from pipeline.signal_extractor import SignalExtractor
from pipeline.insight_generator import InsightGenerator
from pipeline.dimension_scorer import DimensionScorer
from db.database import SessionLocal, Session, Base, engine

Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"]
)

UPLOAD_DIR = "/tmp/behavioral_mirror"
os.makedirs(UPLOAD_DIR, exist_ok=True)

print("Loading models... this may take a minute on first run.")
transcriber = Transcriber(model_size="small")
diarizer = Diarizer(hf_token=os.getenv("HF_TOKEN"))
insight_gen = InsightGenerator(api_key=os.getenv("GROQ_API_KEY"))
dimension_scorer = DimensionScorer()
print("All models loaded. Server ready.")


@app.get("/")
def root():
    return {"status": "Behavioral Mirror API is running"}


@app.post("/api/analyze")
async def analyze_session(
    audio: UploadFile = File(...),
    context: str = Form("casual"),
    user_speaker: str = Form("SPEAKER_00"),
    num_speakers: int = Form(2),
    user_id: str = Form("default_user"),
    filename: str = Form("recording")
):
    session_id = str(uuid.uuid4())
    audio_path = f"{UPLOAD_DIR}/{session_id}.wav"

    # Save uploaded file temporarily
    temp_path = f"{UPLOAD_DIR}/{session_id}_temp"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    # Convert to proper WAV format using ffmpeg
    import subprocess
    subprocess.run([
        "ffmpeg", "-i", temp_path,
        "-ar", "16000",
        "-ac", "1",
        "-y", audio_path
    ], capture_output=True)
    os.remove(temp_path)

    try:
        # Step 1: Transcribe
        print(f"[{session_id}] Transcribing...")
        transcript = transcriber.transcribe(audio_path)

        # Step 2: Diarize
        print(f"[{session_id}] Diarizing...")
        diarization = diarizer.diarize(audio_path, num_speakers=num_speakers)

        # Step 3: Auto-detect primary speaker
        print(f"[{session_id}] Detecting primary speaker...")
        auto_speaker = SignalExtractor.detect_primary_speaker(audio_path, diarization)
        effective_speaker = auto_speaker if user_speaker == "SPEAKER_00" else user_speaker
        print(f"[{session_id}] Using speaker: {effective_speaker}")

        # Step 4: Merge
        print(f"[{session_id}] Merging transcript and speakers...")
        merged = diarizer.merge_transcript_with_speakers(
            transcript["segments"],
            diarization
        )

        # Step 5: Extract signals
        print(f"[{session_id}] Extracting signals...")
        extractor = SignalExtractor(audio_path, merged, effective_speaker)
        signals = extractor.extract_all()

        # Step 6: Get baseline
        db = SessionLocal()
        baseline = get_user_baseline(db, user_id)

        # Step 7: Score dimensions
        print(f"[{session_id}] Scoring behavioral dimensions...")
        dimensions = dimension_scorer.score_all(signals)

        # Step 8: Generate insights
        print(f"[{session_id}] Generating insights...")
        transcript_text = " ".join([
            f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
            for s in merged[:60]
        ])
        insights = insight_gen.generate(
            signals, context, baseline, transcript_text, dimensions
        )

        # Step 9: Save session
        save_session(
            db, session_id, user_id, signals, insights,
            dimensions, context, filename, effective_speaker
        )
        db.close()

        # Delete audio immediately after processing
        os.remove(audio_path)
        print(f"[{session_id}] Done.")

        return {
            "session_id": session_id,
            "signals": signals,
            "insights": insights,
            "dimensions": dimensions,
            "filename": filename,
            "detected_speaker": effective_speaker,
            "speaker_confirmed": False
        }

    except Exception as e:
        if os.path.exists(audio_path):
            os.remove(audio_path)
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sessions/{session_id}/confirm-speaker")
async def confirm_speaker(session_id: str, confirmed: bool = Form(True)):
    db = SessionLocal()
    session = db.query(Session).filter(Session.id == session_id).first()
    if session:
        session.speaker_confirmed = confirmed
        db.commit()
    db.close()
    return {"status": "ok"}


@app.get("/api/sessions/{user_id}")
def get_sessions(user_id: str):
    db = SessionLocal()
    sessions = db.query(Session).filter(
        Session.user_id == user_id
    ).order_by(Session.created_at.desc()).all()
    db.close()

    return [
        {
            "session_id": s.id,
            "context": s.context,
            "filename": s.filename or "recording",
            "detected_speaker": s.detected_speaker or "SPEAKER_00",
            "speaker_confirmed": s.speaker_confirmed or False,
            "created_at": s.created_at.isoformat(),
            "insights": json.loads(s.insights_json),
            "signals": json.loads(s.signals_json),
            "dimensions": json.loads(s.dimensions_json) if s.dimensions_json else {}
        }
        for s in sessions
    ]


def get_user_baseline(db, user_id: str):
    sessions = db.query(Session).filter(Session.user_id == user_id).all()
    if len(sessions) < 3:
        return None

    all_signals = [json.loads(s.signals_json) for s in sessions[-10:]]

    return {
        "avg_speech_rate_wpm": float(np.mean([s["speech_rate"]["overall_wpm"] for s in all_signals])),
        "avg_talk_ratio": float(np.mean([s["talk_ratio"]["user_ratio"] for s in all_signals])),
        "avg_filler_rate": float(np.mean([s["filler_words"]["rate_per_100_words"] for s in all_signals])),
        "avg_response_latency_s": float(np.mean([s["pauses"]["response_latency"]["mean_s"] for s in all_signals]))
    }


def save_session(db, session_id, user_id, signals, insights, dimensions,
                 context, filename="recording", detected_speaker="SPEAKER_00"):
    session = Session(
        id=session_id,
        user_id=user_id,
        context=context,
        filename=filename,
        detected_speaker=detected_speaker,
        speaker_confirmed=False,
        signals_json=json.dumps(signals),
        insights_json=json.dumps(insights),
        dimensions_json=json.dumps(dimensions)
    )
    db.add(session)
    db.commit()