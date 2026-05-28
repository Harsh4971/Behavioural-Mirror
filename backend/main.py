from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import os, shutil, uuid, json, time, subprocess, asyncio, threading
import queue as stdlib_queue
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from dotenv import load_dotenv
import numpy as np

load_dotenv()

from pipeline.transcriber import Transcriber
from pipeline.diarizer import Diarizer
from pipeline.signal_extractor import SignalExtractor
from pipeline.insight_generator import InsightGenerator
from pipeline.dimension_scorer import DimensionScorer
from pipeline.voiceprint import VoiceprintMatcher
from db.database import SessionLocal, Session, UserVoiceprint, Base, engine, run_migrations

Base.metadata.create_all(bind=engine)
run_migrations(engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"]
)

UPLOAD_DIR = "/tmp/behavioral_mirror"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory store for prepare → finalize handoff.
# Shape: { session_id: { audio_path, transcript, diarization, merged,
#                        context, user_id, filename, detected_speaker, created_at } }
_prepare_cache: dict = {}
_CACHE_TTL = 1800  # 30 minutes

# SSE job queues: { job_key: stdlib_queue.Queue }
_jobs: dict = {}


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _cleanup_stale_cache():
    """Delete cache entries older than TTL and remove their audio files."""
    now = time.time()
    stale = [sid for sid, d in _prepare_cache.items()
             if now - d["created_at"] > _CACHE_TTL]
    for sid in stale:
        path = _prepare_cache[sid].get("audio_path", "")
        if path and os.path.exists(path):
            os.remove(path)
        del _prepare_cache[sid]


print("Loading models... this may take a minute on first run.")
transcriber = Transcriber(model_size="small")
diarizer = Diarizer(hf_token=os.getenv("HF_TOKEN"))
insight_gen = InsightGenerator(api_key=os.getenv("GROQ_API_KEY"))
dimension_scorer = DimensionScorer()
voiceprint_matcher = VoiceprintMatcher(hf_token=os.getenv("HF_TOKEN"))
print("All models loaded. Server ready.")


# ── Health ────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "Behavioral Mirror API is running"}


# ── Step 1: Transcribe + Diarize ─────────────────────────────────

@app.post("/api/prepare")
async def prepare_session(
    audio: UploadFile = File(...),
    context: str = Form("casual"),
    num_speakers: int = Form(2),
    user_id: str = Form("default_user"),
    filename: str = Form("recording")
):
    """
    Run Whisper + pyannote. Returns per-speaker transcript samples so the
    user can confirm which speaker they are before analysis begins.
    """
    _cleanup_stale_cache()

    session_id = str(uuid.uuid4())
    audio_path = f"{UPLOAD_DIR}/{session_id}.wav"

    # Save upload and convert to 16 kHz mono WAV
    temp_path = f"{UPLOAD_DIR}/{session_id}_temp"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    subprocess.run(
        ["ffmpeg", "-i", temp_path, "-ar", "16000", "-ac", "1", "-y", audio_path],
        capture_output=True
    )
    os.remove(temp_path)

    try:
        print(f"[{session_id}] Transcribing...")
        transcript = transcriber.transcribe(audio_path)

        print(f"[{session_id}] Diarizing...")
        diarization = diarizer.diarize(audio_path, num_speakers=num_speakers)

        # Merge now so we have speaker-labelled text for the picker
        merged = diarizer.merge_transcript_with_speakers(
            transcript["segments"], diarization
        )

        # Energy-based primary speaker detection (existing heuristic)
        energy_speaker = SignalExtractor.detect_primary_speaker(audio_path, diarization)

        # Voiceprint-based identification (if user has a stored print)
        voiceprint_match = None
        voiceprint_confidence = None

        db = SessionLocal()
        stored_vp = db.query(UserVoiceprint).filter(
            UserVoiceprint.user_id == user_id
        ).first()
        db.close()

        if stored_vp and voiceprint_matcher.available:
            stored_emb = VoiceprintMatcher.embedding_from_json(stored_vp.embedding_json)
            vp_speaker, vp_confidence = voiceprint_matcher.identify_speaker(
                audio_path, diarization, stored_emb
            )
            # Only trust it above a conservative threshold
            if vp_confidence >= 0.75:
                voiceprint_match = vp_speaker
                voiceprint_confidence = vp_confidence
                print(f"[{session_id}] Voiceprint matched: {vp_speaker} "
                      f"(confidence {vp_confidence:.2f})")

        # Voiceprint match wins over energy detection when confident
        detected_speaker = voiceprint_match or energy_speaker

        _prepare_cache[session_id] = {
            "audio_path": audio_path,
            "transcript": transcript,
            "diarization": diarization,
            "merged": merged,
            "context": context,
            "user_id": user_id,
            "filename": filename,
            "detected_speaker": detected_speaker,
            "created_at": time.time(),
        }

        return {
            "session_id": session_id,
            "speakers": _build_speaker_samples(merged, diarization),
            "detected_speaker": detected_speaker,
            "voiceprint_match": voiceprint_match,
            "voiceprint_confidence": voiceprint_confidence,
        }

    except Exception as e:
        if os.path.exists(audio_path):
            os.remove(audio_path)
        print(f"[{session_id}] Prepare error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Step 2: Signals + Insights ────────────────────────────────────

@app.post("/api/finalize")
async def finalize_session(
    session_id: str = Form(...),
    confirmed_speaker: str = Form(...)
):
    """
    Given the user-confirmed speaker ID, run signal extraction, dimension
    scoring, and LLM insight generation. Updates the user's voiceprint.
    """
    cached = _prepare_cache.get(session_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Session not found or expired. Please re-upload the audio."
        )

    audio_path = cached["audio_path"]
    merged = cached["merged"]
    diarization = cached["diarization"]
    context = cached["context"]
    user_id = cached["user_id"]
    filename = cached["filename"]

    try:
        # Compute signals for ALL speakers while audio is still available.
        # This enables instant re-analysis (no re-upload) if user switches speaker later.
        print(f"[{session_id}] Extracting signals for all speakers...")
        all_speaker_ids = list({s["speaker"] for s in diarization if s["speaker"] != "UNKNOWN"})
        all_speakers_signals = {}
        for sp in all_speaker_ids:
            all_speakers_signals[sp] = SignalExtractor(audio_path, merged, sp).extract_all()

        signals = all_speakers_signals.get(confirmed_speaker)
        if signals is None:
            # fallback: confirmed_speaker wasn't in diarization (shouldn't happen)
            signals = SignalExtractor(audio_path, merged, confirmed_speaker).extract_all()

        db = SessionLocal()
        baseline = _get_user_baseline(db, user_id)

        print(f"[{session_id}] Scoring dimensions...")
        dimensions = dimension_scorer.score_all(signals)

        print(f"[{session_id}] Generating insights...")
        transcript_text = " ".join(
            f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
            for s in merged[:60]
        )
        insights = insight_gen.generate(
            signals, context, baseline, transcript_text, dimensions
        )

        # Update voiceprint with this confirmed speaker's audio
        _update_voiceprint(db, user_id, audio_path, diarization, confirmed_speaker)

        _save_session(
            db, session_id, user_id, signals, insights, dimensions,
            context, filename, confirmed_speaker,
            speaker_confirmed=True,
            merged=merged,
            all_speakers_signals=all_speakers_signals
        )
        db.close()

        # Clean up audio and cache entry
        if os.path.exists(audio_path):
            os.remove(audio_path)
        del _prepare_cache[session_id]

        print(f"[{session_id}] Done.")
        return {
            "session_id": session_id,
            "signals": signals,
            "insights": insights,
            "dimensions": dimensions,
            "filename": filename,
            "detected_speaker": confirmed_speaker,
            "speaker_confirmed": True,
        }

    except Exception as e:
        if os.path.exists(audio_path):
            os.remove(audio_path)
        _prepare_cache.pop(session_id, None)
        print(f"[{session_id}] Finalize error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── SSE Step 1: Start prepare job ────────────────────────────────

@app.post("/api/prepare/start")
async def start_prepare_session(
    audio: UploadFile = File(...),
    context: str = Form("casual"),
    num_speakers: int = Form(2),
    user_id: str = Form("default_user"),
    filename: str = Form("recording")
):
    _cleanup_stale_cache()

    session_id = str(uuid.uuid4())
    audio_path = f"{UPLOAD_DIR}/{session_id}.wav"
    temp_path = f"{UPLOAD_DIR}/{session_id}_temp"

    contents = await audio.read()
    with open(temp_path, "wb") as f:
        f.write(contents)

    subprocess.run(
        ["ffmpeg", "-i", temp_path, "-ar", "16000", "-ac", "1", "-y", audio_path],
        capture_output=True
    )
    os.remove(temp_path)

    job_q: stdlib_queue.Queue = stdlib_queue.Queue()
    _jobs[session_id] = job_q

    threading.Thread(
        target=_run_prepare_job,
        args=(session_id, audio_path, context, num_speakers, user_id, filename),
        daemon=True
    ).start()

    print(f"[{session_id}] Prepare job started (SSE)")
    return {"job_id": session_id}


def _run_prepare_job(session_id, audio_path, context, num_speakers, user_id, filename):
    def emit(step, message):
        if session_id in _jobs:
            _jobs[session_id].put({"event": "progress", "step": step, "message": message})

    try:
        print(f"[{session_id}] Transcribing and diarizing in parallel...")
        emit("transcribing", "Transcribing audio with Whisper…")

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_transcript = pool.submit(transcriber.transcribe, audio_path)
            f_diarization = pool.submit(diarizer.diarize, audio_path, num_speakers)
            transcript = f_transcript.result()
            emit("diarizing", "Identifying speakers…")
            diarization = f_diarization.result()

        merged = diarizer.merge_transcript_with_speakers(
            transcript["segments"], diarization
        )

        emit("detecting", "Detecting your voice…")
        energy_speaker = SignalExtractor.detect_primary_speaker(audio_path, diarization)

        voiceprint_match = None
        voiceprint_confidence = None
        db = SessionLocal()
        stored_vp = db.query(UserVoiceprint).filter(
            UserVoiceprint.user_id == user_id
        ).first()
        db.close()

        if stored_vp and voiceprint_matcher.available:
            stored_emb = VoiceprintMatcher.embedding_from_json(stored_vp.embedding_json)
            vp_speaker, vp_confidence = voiceprint_matcher.identify_speaker(
                audio_path, diarization, stored_emb
            )
            if vp_confidence >= 0.75:
                voiceprint_match = vp_speaker
                voiceprint_confidence = vp_confidence
                print(f"[{session_id}] Voiceprint matched: {vp_speaker} "
                      f"(confidence {vp_confidence:.2f})")

        detected_speaker = voiceprint_match or energy_speaker

        _prepare_cache[session_id] = {
            "audio_path": audio_path,
            "transcript": transcript,
            "diarization": diarization,
            "merged": merged,
            "context": context,
            "user_id": user_id,
            "filename": filename,
            "detected_speaker": detected_speaker,
            "created_at": time.time(),
        }

        result_data = {
            "session_id": session_id,
            "speakers": _build_speaker_samples(merged, diarization),
            "detected_speaker": detected_speaker,
            "voiceprint_match": voiceprint_match,
            "voiceprint_confidence": voiceprint_confidence,
        }

        if session_id in _jobs:
            _jobs[session_id].put({"event": "done", "data": result_data})
        print(f"[{session_id}] Prepare job done.")

    except Exception as e:
        if os.path.exists(audio_path):
            os.remove(audio_path)
        print(f"[{session_id}] Prepare error: {e}")
        if session_id in _jobs:
            _jobs[session_id].put({"event": "error", "message": str(e)})


@app.get("/api/prepare/{job_id}/stream")
async def stream_prepare_progress(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or already completed.")

    async def generator():
        loop = asyncio.get_running_loop()
        job_q = _jobs[job_id]
        while True:
            try:
                item = await loop.run_in_executor(
                    None, lambda: job_q.get(block=True, timeout=30)
                )
                yield f"data: {json.dumps(item)}\n\n"
                if item["event"] in ("done", "error"):
                    _jobs.pop(job_id, None)
                    await asyncio.sleep(0.15)  # flush buffer before closing
                    break
            except stdlib_queue.Empty:
                yield f"data: {json.dumps({'event': 'ping'})}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ── SSE Step 2: Start finalize job ───────────────────────────────

@app.post("/api/finalize/start")
async def start_finalize_session(
    session_id: str = Form(...),
    confirmed_speaker: str = Form(...)
):
    cached = _prepare_cache.get(session_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Session not found or expired. Please re-upload the audio."
        )

    job_key = f"finalize_{session_id}"
    job_q: stdlib_queue.Queue = stdlib_queue.Queue()
    _jobs[job_key] = job_q

    threading.Thread(
        target=_run_finalize_job,
        args=(session_id, confirmed_speaker),
        daemon=True
    ).start()

    print(f"[{session_id}] Finalize job started (SSE)")
    return {"job_id": session_id}


def _run_finalize_job(session_id, confirmed_speaker):
    job_key = f"finalize_{session_id}"

    def emit(step, message):
        if job_key in _jobs:
            _jobs[job_key].put({"event": "progress", "step": step, "message": message})

    cached = _prepare_cache.get(session_id)
    if not cached:
        if job_key in _jobs:
            _jobs[job_key].put({"event": "error", "message": "Session expired."})
        return

    audio_path = cached["audio_path"]
    merged = cached["merged"]
    diarization = cached["diarization"]
    context = cached["context"]
    user_id = cached["user_id"]
    filename = cached["filename"]

    try:
        print(f"[{session_id}] Extracting signals for all speakers...")
        emit("extracting", "Extracting behavioral signals…")
        all_speaker_ids = list({s["speaker"] for s in diarization if s["speaker"] != "UNKNOWN"})
        all_speakers_signals = {}
        for sp in all_speaker_ids:
            all_speakers_signals[sp] = SignalExtractor(audio_path, merged, sp).extract_all()

        signals = all_speakers_signals.get(confirmed_speaker)
        if signals is None:
            signals = SignalExtractor(audio_path, merged, confirmed_speaker).extract_all()

        db = SessionLocal()
        baseline = _get_user_baseline(db, user_id)

        print(f"[{session_id}] Scoring dimensions...")
        emit("scoring", "Scoring behavioral dimensions…")
        dimensions = dimension_scorer.score_all(signals)

        print(f"[{session_id}] Generating insights...")
        emit("generating", "Generating insights with AI…")
        transcript_text = " ".join(
            f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
            for s in merged[:60]
        )
        insights = insight_gen.generate(
            signals, context, baseline, transcript_text, dimensions
        )

        _update_voiceprint(db, user_id, audio_path, diarization, confirmed_speaker)
        _save_session(
            db, session_id, user_id, signals, insights, dimensions,
            context, filename, confirmed_speaker,
            speaker_confirmed=True,
            merged=merged,
            all_speakers_signals=all_speakers_signals
        )
        db.close()

        if os.path.exists(audio_path):
            os.remove(audio_path)
        del _prepare_cache[session_id]

        print(f"[{session_id}] Done.")
        result_data = {
            "session_id": session_id,
            "signals": signals,
            "insights": insights,
            "dimensions": dimensions,
            "filename": filename,
            "detected_speaker": confirmed_speaker,
            "speaker_confirmed": True,
        }

        if job_key in _jobs:
            _jobs[job_key].put({"event": "done", "data": result_data})

    except Exception as e:
        if os.path.exists(audio_path):
            os.remove(audio_path)
        _prepare_cache.pop(session_id, None)
        print(f"[{session_id}] Finalize error: {e}")
        if job_key in _jobs:
            _jobs[job_key].put({"event": "error", "message": str(e)})


@app.get("/api/finalize/{job_id}/stream")
async def stream_finalize_progress(job_id: str):
    job_key = f"finalize_{job_id}"
    if job_key not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or already completed.")

    async def generator():
        loop = asyncio.get_running_loop()
        job_q = _jobs[job_key]
        while True:
            try:
                item = await loop.run_in_executor(
                    None, lambda: job_q.get(block=True, timeout=30)
                )
                yield f"data: {json.dumps(item)}\n\n"
                if item["event"] in ("done", "error"):
                    _jobs.pop(job_key, None)
                    await asyncio.sleep(0.15)  # flush buffer before closing
                    break
            except stdlib_queue.Empty:
                yield f"data: {json.dumps({'event': 'ping'})}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ── Step 3 (optional): Re-analyze with different speaker ─────────

@app.post("/api/sessions/{session_id}/reanalyze")
async def reanalyze_session(session_id: str, confirmed_speaker: str = Form(...)):
    """
    Switch the analyzed speaker for an existing session without re-uploading audio.
    Requires all_speakers_signals_json to be stored (sessions from the new two-step flow).
    Re-runs dimension scoring + LLM insights only — no Whisper, no pyannote, no audio.
    """
    db = SessionLocal()
    session = db.query(Session).filter(Session.id == session_id).first()

    if not session:
        db.close()
        raise HTTPException(status_code=404, detail="Session not found.")

    if not session.all_speakers_signals_json:
        db.close()
        raise HTTPException(
            status_code=400,
            detail="Re-analysis data not available for this session. Please re-upload the audio."
        )

    all_speakers_signals = json.loads(session.all_speakers_signals_json)

    if confirmed_speaker not in all_speakers_signals:
        available = list(all_speakers_signals.keys())
        db.close()
        raise HTTPException(
            status_code=400,
            detail=f"No data for speaker '{confirmed_speaker}'. Available: {available}"
        )

    signals = all_speakers_signals[confirmed_speaker]
    context = session.context
    user_id = session.user_id

    print(f"[{session_id}] Re-analyzing as {confirmed_speaker}...")

    baseline = _get_user_baseline(db, user_id)
    dimensions = dimension_scorer.score_all(signals)

    merged = json.loads(session.merged_json) if session.merged_json else []
    transcript_text = " ".join(
        f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
        for s in merged[:60]
    )
    insights = insight_gen.generate(signals, context, baseline, transcript_text, dimensions)

    # Update session record with new speaker's data
    session.detected_speaker = confirmed_speaker
    session.speaker_confirmed = True
    session.signals_json = json.dumps(signals)
    session.insights_json = json.dumps(insights)
    session.dimensions_json = json.dumps(dimensions)
    db.commit()
    db.close()

    print(f"[{session_id}] Re-analysis done.")
    return {
        "session_id": session_id,
        "signals": signals,
        "insights": insights,
        "dimensions": dimensions,
        "filename": session.filename or "recording",
        "detected_speaker": confirmed_speaker,
        "speaker_confirmed": True,
    }


# ── Session history ───────────────────────────────────────────────

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
            "dimensions": json.loads(s.dimensions_json) if s.dimensions_json else {},
        }
        for s in sessions
    ]


@app.post("/api/sessions/{session_id}/confirm-speaker")
async def confirm_speaker(session_id: str, confirmed: bool = Form(True)):
    db = SessionLocal()
    session = db.query(Session).filter(Session.id == session_id).first()
    if session:
        session.speaker_confirmed = confirmed
        db.commit()
    db.close()
    return {"status": "ok"}


# ── Internal helpers ──────────────────────────────────────────────

def _build_speaker_samples(merged: list, diarization: list) -> dict:
    """Per-speaker talk stats and up to 3 transcript snippets for the UI picker."""
    speakers: dict = {}

    for seg in diarization:
        sp = seg["speaker"]
        if sp not in speakers:
            speakers[sp] = {"samples": [], "talk_time_s": 0.0, "turn_count": 0}
        speakers[sp]["talk_time_s"] += seg["end"] - seg["start"]
        speakers[sp]["turn_count"] += 1

    for seg in merged:
        sp = seg.get("speaker", "UNKNOWN")
        if sp not in speakers:
            continue
        text = seg.get("text", "").strip()
        if len(text) > 15 and len(speakers[sp]["samples"]) < 3:
            speakers[sp]["samples"].append(text)

    for sp in speakers:
        speakers[sp]["talk_time_s"] = round(speakers[sp]["talk_time_s"], 1)

    return speakers


def _update_voiceprint(
    db, user_id: str, audio_path: str,
    diarization: list, confirmed_speaker: str
):
    """Store or update the user's speaker embedding after confirmed selection."""
    if not voiceprint_matcher.available:
        return

    speaker_segs = [s for s in diarization if s["speaker"] == confirmed_speaker]
    new_emb = voiceprint_matcher.extract_speaker_embedding(audio_path, speaker_segs)
    if new_emb is None:
        return

    existing = db.query(UserVoiceprint).filter(
        UserVoiceprint.user_id == user_id
    ).first()

    if existing:
        # Blend: 70% existing, 30% new — keeps the print stable across sessions
        old_emb = VoiceprintMatcher.embedding_from_json(existing.embedding_json)
        blended = 0.7 * old_emb + 0.3 * new_emb
        blended /= np.linalg.norm(blended)
        existing.embedding_json = VoiceprintMatcher.embedding_to_json(blended)
        existing.updated_at = _utcnow()
    else:
        norm_emb = new_emb / np.linalg.norm(new_emb)
        db.add(UserVoiceprint(
            user_id=user_id,
            embedding_json=VoiceprintMatcher.embedding_to_json(norm_emb),
        ))

    db.commit()


def _get_user_baseline(db, user_id: str):
    sessions = db.query(Session).filter(Session.user_id == user_id).all()
    if len(sessions) < 3:
        return None

    all_signals = [json.loads(s.signals_json) for s in sessions[-10:]]
    return {
        "avg_speech_rate_wpm": float(np.mean(
            [s["speech_rate"]["overall_wpm"] for s in all_signals])),
        "avg_talk_ratio": float(np.mean(
            [s["talk_ratio"]["user_ratio"] for s in all_signals])),
        "avg_filler_rate": float(np.mean(
            [s["filler_words"]["rate_per_100_words"] for s in all_signals])),
        "avg_response_latency_s": float(np.mean(
            [s["pauses"]["response_latency"]["mean_s"] for s in all_signals])),
    }


def _save_session(
    db, session_id, user_id, signals, insights, dimensions,
    context, filename="recording", detected_speaker="SPEAKER_00",
    speaker_confirmed=True, merged=None, all_speakers_signals=None
):
    db.add(Session(
        id=session_id,
        user_id=user_id,
        context=context,
        filename=filename,
        detected_speaker=detected_speaker,
        speaker_confirmed=speaker_confirmed,
        signals_json=json.dumps(signals),
        insights_json=json.dumps(insights),
        dimensions_json=json.dumps(dimensions),
        merged_json=json.dumps(merged) if merged else None,
        all_speakers_signals_json=json.dumps(all_speakers_signals) if all_speakers_signals else None,
    ))
    db.commit()
