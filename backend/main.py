from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
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
from pipeline.context_detector import ContextDetector
from pipeline.personality_synthesizer import PersonalitySynthesizer
from db.database import supabase_admin

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
_prepare_cache: dict = {}
_CACHE_TTL = 1800  # 30 minutes

# SSE job queues: { job_key: stdlib_queue.Queue }
_jobs: dict = {}


def _utcnow():
    return datetime.now(timezone.utc).isoformat()


def _cleanup_stale_cache():
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
context_detector = ContextDetector(api_key=os.getenv("GROQ_API_KEY"))
dimension_scorer = DimensionScorer()
voiceprint_matcher = VoiceprintMatcher(hf_token=os.getenv("HF_TOKEN"))
personality_synth = PersonalitySynthesizer(api_key=os.getenv("GROQ_API_KEY"))
print("All models loaded. Server ready.")

# In-memory personality cache: key = "{user_id}:{session_count}"
_personality_cache: dict = {}


CONTEXT_POPULATION_NORMS: dict = {
    # (expected_min, expected_max, note)
    # avg_talk_ratio as 0.0–1.0 | avg_filler_rate as /100w | avg_response_latency_s in seconds | avg_speech_rate_wpm in wpm
    "evaluative": {
        "avg_talk_ratio":         (0.55, 0.80, "You're being assessed — longer answers are expected"),
        "avg_filler_rate":        (0.0,  3.5,  "Fillers undermine credibility here more than anywhere else"),
        "avg_response_latency_s": (0.8,  3.5,  "Brief pause before answering reads as thoughtful, not hesitant"),
        "avg_speech_rate_wpm":    (115,  180,  "Measured, clear pace aids comprehension under assessment"),
    },
    "collaborative": {
        "avg_talk_ratio":         (0.30, 0.55, "Balanced airtime — one person dominating stifles collaboration"),
        "avg_filler_rate":        (0.0,  6.0,  "Moderate fillers are acceptable in working conversations"),
        "avg_response_latency_s": (0.3,  2.0,  "Quick engagement signals active participation"),
        "avg_speech_rate_wpm":    (110,  185,  "Natural working pace"),
    },
    "social": {
        "avg_talk_ratio":         (0.35, 0.65, "Balanced sharing — conversations, not monologues"),
        "avg_filler_rate":        (0.0,  9.0,  "Fillers are natural and accepted in casual speech"),
        "avg_response_latency_s": (0.2,  2.0,  "Natural conversational pace"),
        "avg_speech_rate_wpm":    (110,  200,  "Natural social pace — varies widely"),
    },
    "influential": {
        "avg_talk_ratio":         (0.48, 0.68, "You lead but must create dialogue — monologuing loses the room"),
        "avg_filler_rate":        (0.0,  4.0,  "Fillers undermine credibility when persuading"),
        "avg_response_latency_s": (0.5,  2.5,  ""),
        "avg_speech_rate_wpm":    (115,  175,  "Clear, deliberate pace aids persuasion"),
    },
    "negotiation": {
        "avg_talk_ratio":         (0.35, 0.55, "Balance creates space for counter-offers and signals respect"),
        "avg_filler_rate":        (0.0,  4.0,  "Fillers signal uncertainty — costly in negotiations"),
        "avg_response_latency_s": (1.0,  4.0,  "Strategic pauses are a tool — don't rush responses"),
        "avg_speech_rate_wpm":    (105,  160,  "Slower pace signals confidence and deliberateness"),
    },
    "adversarial": {
        "avg_talk_ratio":         (0.35, 0.55, "Dominating airtime escalates conflict — balance de-escalates"),
        "avg_filler_rate":        (0.0,  6.0,  ""),
        "avg_response_latency_s": (0.8,  4.0,  "Pausing before responding signals self-control"),
        "avg_speech_rate_wpm":    (105,  165,  "Measured pace signals emotional control"),
    },
    "developmental": {
        "avg_talk_ratio":         (0.25, 0.45, "The other person should speak more — high ratio is a red flag in coaching"),
        "avg_filler_rate":        (0.0,  5.0,  ""),
        "avg_response_latency_s": (1.0,  4.0,  "Pausing after questions creates space for genuine reflection"),
        "avg_speech_rate_wpm":    (100,  165,  "Measured pace aids comprehension"),
    },
    "support": {
        "avg_talk_ratio":         (0.15, 0.40, "Your role is to listen — high talk ratio means you're not supporting"),
        "avg_filler_rate":        (0.0,  7.0,  ""),
        "avg_response_latency_s": (1.0,  5.0,  "Longer pauses show you're processing, not rushing to fix"),
        "avg_speech_rate_wpm":    (85,   155,  "Slower pace signals presence and care"),
    },
    "intimate": {
        "avg_talk_ratio":         (0.35, 0.60, "Equal sharing of space and vulnerability"),
        "avg_filler_rate":        (0.0,  8.0,  "Natural in emotionally open conversations"),
        "avg_response_latency_s": (1.0,  5.0,  "Thoughtful pauses signal you're really processing what was shared"),
        "avg_speech_rate_wpm":    (85,   160,  "Slower pace deepens connection"),
    },
}


def _compute_dim_averages(parsed: list) -> dict:
    score_lists: dict = {k: [] for k in (
        "confidence", "nervousness", "assertiveness",
        "listening_quality", "empathy", "clarity", "adaptability",
    )}
    paths = {
        "confidence":      ("emotional_state",            "confidence"),
        "nervousness":     ("emotional_state",            "nervousness"),
        "assertiveness":   ("communication_effectiveness","assertiveness"),
        "listening_quality":("communication_effectiveness","listening_quality"),
        "empathy":         ("relational_dynamics",        "empathy"),
        "clarity":         ("communication_effectiveness","clarity"),
        "adaptability":    ("communication_effectiveness","adaptability"),
    }
    for p in parsed:
        dims = p["dims"]
        for key, (group, sub) in paths.items():
            try:
                score_lists[key].append(dims[group][sub]["score"])
            except (KeyError, TypeError):
                pass
    return {k: round(sum(v) / len(v), 2) if v else 3.0 for k, v in score_lists.items()}


_CONTEXT_BLIND_SPOTS: dict = {
    "evaluative":    (1, "High-stakes settings",
        "You've never uploaded an interview, presentation, or review. Your confidence and "
        "composure scores are based on lower-stakes conversations — they may look very "
        "different when you're being assessed."),
    "adversarial":   (2, "Conflict & pushback",
        "No conflict or disagreement recordings yet. We can't tell how you respond when "
        "challenged or when there's real friction in the room."),
    "collaborative": (3, "Group & team dynamics",
        "No team meetings or brainstorming sessions uploaded. Your listening and "
        "assertiveness scores come from 1-on-1 conversations only."),
    "influential":   (4, "Persuasion & pitching",
        "No pitch or sales conversations yet. We can't see how you hold an argument or "
        "move someone toward a decision."),
    "negotiation":   (5, "Negotiation",
        "No negotiation recordings. How your composure and assertiveness hold under "
        "competing interests is still unmeasured."),
    "developmental": (6, "Giving feedback",
        "No coaching or feedback sessions recorded. We can't see how you structure or "
        "deliver criticism."),
    "support":       (7, "Empathy-led listening",
        "No support conversations yet. Your empathy dimension has no direct evidence."),
    "intimate":      (8, "Deep personal conversations",
        "No emotionally intimate conversations uploaded. Your expressiveness score may "
        "be incomplete."),
    "social":        (9, "Casual & social",
        "No casual social conversations recorded. We can't see your natural, low-stakes "
        "communication style yet."),
}


def _compute_blind_spots(recorded_contexts: set) -> list:
    gaps = []
    for ctx, (priority, label, message) in _CONTEXT_BLIND_SPOTS.items():
        if ctx not in recorded_contexts:
            gaps.append({"context": ctx, "label": label, "message": message, "priority": priority})
    gaps.sort(key=lambda x: x["priority"])
    return [{"context": g["context"], "label": g["label"], "message": g["message"]}
            for g in gaps[:3]]


def _compute_session_delta(old: dict, new: dict) -> dict | None:
    if not old or not new:
        return None
    old_scores = {d["key"]: d["score"] for d in old.get("dimensions", [])}
    changes = []
    for dim in new.get("dimensions", []):
        old_score = old_scores.get(dim["key"])
        if old_score is None:
            continue
        diff = dim["score"] - old_score
        if abs(diff) >= 8:
            changes.append({
                "dimension": dim["name"],
                "old_score": old_score,
                "new_score": dim["score"],
                "diff": diff,
                "direction": "up" if diff > 0 else "down",
            })
    if not changes:
        return None
    changes.sort(key=lambda x: abs(x["diff"]), reverse=True)
    return {"changes": changes[:3]}


def _extract_mirror_highlights(insights: dict, n: int = 3) -> list:
    """Pull the N most significant observations from a session's insights."""
    highlights = []

    if insights.get("notable_pattern"):
        highlights.append(insights["notable_pattern"])

    for s in insights.get("coaching_suggestions", []):
        if len(highlights) >= n:
            break
        issue = (s.get("issue") or "").strip()
        if issue and issue not in highlights:
            highlights.append(issue)

    for obs in insights.get("observations", []):
        if len(highlights) >= n:
            break
        text = (obs.get("observation") or "").strip()
        if text and text not in highlights:
            highlights.append(text)

    return highlights[:n]


def _build_sessions_data(parsed: list, dim_paths: dict) -> list:
    sessions = []
    for p in parsed:
        try:
            from datetime import datetime as _dt
            date_str = _dt.fromisoformat(p["date"].replace("Z", "+00:00")).strftime("%b %d")
        except Exception:
            date_str = "recent"

        dim_scores = {}
        for key, (group, sub) in dim_paths.items():
            try:
                dim_scores[key] = p["dims"][group][sub]["score"]
            except (KeyError, TypeError):
                pass

        # Extract 2-3 sample user quotes (5-20 words, spread across the conversation)
        sample_quotes = []
        merged = p.get("merged", [])
        detected_speaker = p.get("detected_speaker", "SPEAKER_00")
        if merged:
            user_turns = [
                seg.get("text", "").strip()
                for seg in merged
                if seg.get("speaker") == detected_speaker
                and 5 <= len(seg.get("text", "").split()) <= 20
            ]
            if len(user_turns) >= 3:
                mid = len(user_turns) // 2
                sample_quotes = [user_turns[0], user_turns[mid], user_turns[-1]]
            elif user_turns:
                sample_quotes = user_turns[:3]

        sessions.append({
            "date":            date_str,
            "context":         p["context"],
            "dim_scores":      dim_scores,
            "filler_rate":     p["sig"]["filler_words"]["rate_per_100_words"],
            "talk_ratio_pct":  round(p["sig"]["talk_ratio"]["user_ratio"] * 100),
            "notable_pattern": p["ins"].get("notable_pattern", ""),
            "sample_quotes":   sample_quotes,
        })
    return sessions


def _get_or_synthesize_personality(user_id: str, session_count: int,
                                   profile_data: dict, dim_averages: dict,
                                   sessions_data: list = None) -> dict:
    _SYNTHESIS_VERSION = 4  # bump when prompt changes to invalidate old cache
    cache_key = f"{user_id}:{session_count}:v{_SYNTHESIS_VERSION}"

    if cache_key in _personality_cache:
        return _personality_cache[cache_key]

    old_personality = None

    # Try Supabase persistence (table: user_profiles)
    try:
        result = supabase_admin.table("user_profiles") \
            .select("personality_json, session_count_at_synthesis") \
            .eq("user_id", user_id).execute()
        if result.data:
            row = result.data[0]
            if row["session_count_at_synthesis"] == session_count * _SYNTHESIS_VERSION:
                personality = json.loads(row["personality_json"])
                _personality_cache[cache_key] = personality
                return personality
            else:
                # Session count changed — preserve old synthesis for delta
                old_personality = json.loads(row["personality_json"])
    except Exception:
        pass

    personality = personality_synth.synthesize(profile_data, dim_averages, sessions_data)

    delta = _compute_session_delta(old_personality, personality)
    if delta:
        personality["last_delta"] = delta

    _personality_cache[cache_key] = personality

    try:
        supabase_admin.table("user_profiles").upsert({
            "user_id": user_id,
            "session_count_at_synthesis": session_count * _SYNTHESIS_VERSION,
            "personality_json": json.dumps(personality),
            "updated_at": _utcnow(),
        }).execute()
    except Exception:
        pass

    return personality


# ── Auth ──────────────────────────────────────────────────────────

async def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization token provided.")
    try:
        token = authorization.replace("Bearer ", "")
        response = supabase_admin.auth.get_user(token)
        return str(response.user.id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


# ── Health ────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "Behavioral Mirror API is running"}


# ── SSE Step 1: Start prepare job ────────────────────────────────

@app.post("/api/prepare/start")
async def start_prepare_session(
    audio: UploadFile = File(...),
    filename: str = Form("recording"),
    user_id: str = Depends(get_current_user)
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
        args=(session_id, audio_path, user_id, filename),
        daemon=True
    ).start()

    print(f"[{session_id}] Prepare job started (SSE)")
    return {"job_id": session_id}


def _run_prepare_job(session_id, audio_path, user_id, filename):
    def emit(step, message):
        if session_id in _jobs:
            _jobs[session_id].put({"event": "progress", "step": step, "message": message})
        if session_id in _prepare_cache:
            _prepare_cache[session_id]["current_step"] = step

    try:
        print(f"[{session_id}] Transcribing and diarizing in parallel...")
        emit("transcribing", "Transcribing audio with Whisper…")

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_transcript = pool.submit(transcriber.transcribe, audio_path)
            f_diarization = pool.submit(diarizer.diarize, audio_path)
            transcript = f_transcript.result()
            emit("diarizing", "Identifying speakers…")
            diarization = f_diarization.result()

        merged = diarizer.merge_transcript_with_speakers(
            transcript["segments"], diarization
        )

        emit("detecting", "Detecting your voice…")

        voiceprint_match = None
        voiceprint_confidence = None

        res = supabase_admin.table("user_voiceprints").select("embedding_json").eq(
            "user_id", user_id
        ).execute()
        stored_vp = res.data[0] if res.data else None

        speaker_ids = sorted({s["speaker"] for s in diarization if s["speaker"] != "UNKNOWN"})

        if stored_vp and voiceprint_matcher.available:
            # Support both old format (single embedding) and new format (list of embeddings)
            raw = json.loads(stored_vp["embedding_json"])
            stored_embs = [np.array(e) for e in raw] if isinstance(raw[0], list) else [np.array(raw)]

            # Build per-speaker segments and talk-time map
            speaker_segs_map: dict = {}
            for seg in diarization:
                if seg["speaker"] != "UNKNOWN":
                    speaker_segs_map.setdefault(seg["speaker"], []).append(seg)

            talk_times = {
                sp: sum(s["end"] - s["start"] for s in segs)
                for sp, segs in speaker_segs_map.items()
            }
            total_time = sum(talk_times.values()) or 1

            # Score each speaker: max similarity across all stored embeddings
            vp_scores: dict = {}
            for sp, segs in speaker_segs_map.items():
                emb = voiceprint_matcher.extract_speaker_embedding(audio_path, segs)
                if emb is not None:
                    vp_scores[sp] = max(
                        VoiceprintMatcher._cosine_similarity(emb, ref)
                        for ref in stored_embs
                    )

            if vp_scores:
                print(f"[{session_id}] Voiceprint scores: { {k: round(v,3) for k,v in vp_scores.items()} }")
                print(f"[{session_id}] Talk-time shares: { {k: round(talk_times[k]/total_time,3) for k in talk_times} }")
                best_vp = max(vp_scores, key=vp_scores.get)
                best_score = vp_scores[best_vp]

                if best_score >= 0.55:
                    # Confident match — trust the voiceprint
                    voiceprint_match = best_vp
                    voiceprint_confidence = best_score
                    print(f"[{session_id}] Voiceprint matched: {best_vp} "
                          f"(confidence {best_score:.2f})")
                else:
                    # Low confidence (e.g. advice-giving voice ≠ quiet enrollment recording).
                    # Blend voiceprint score 60% with talk-time share 40% to break the tie.
                    combined = {
                        sp: 0.6 * vp_scores[sp] + 0.4 * (talk_times.get(sp, 0) / total_time)
                        for sp in vp_scores
                    }
                    best_combined = max(combined, key=combined.get)
                    voiceprint_match = best_combined
                    voiceprint_confidence = best_score
                    print(f"[{session_id}] Low-confidence voiceprint ({best_score:.2f}), "
                          f"blending with talk-time → {best_combined}")

        # Fall back to first speaker by ID if voiceprint not enrolled or model unavailable
        detected_speaker = voiceprint_match or (speaker_ids[0] if speaker_ids else "SPEAKER_00")

        _prepare_cache[session_id] = {
            "audio_path": audio_path,
            "transcript": transcript,
            "diarization": diarization,
            "merged": merged,
            "user_id": user_id,
            "filename": filename,
            "detected_speaker": detected_speaker,
            "voiceprint_confidence": voiceprint_confidence,
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


@app.get("/api/prepare/{session_id}/status")
async def get_prepare_status(
    session_id: str,
    user_id: str = Depends(get_current_user)
):
    """Return cached prepare result if available — used by frontend to recover after SSE drop."""
    cached = _prepare_cache.get(session_id)
    if not cached or cached.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Prepare result not found or expired.")
    return {
        "session_id": session_id,
        "speakers": _build_speaker_samples(cached["merged"], cached["diarization"]),
        "detected_speaker": cached.get("detected_speaker"),
        "voiceprint_match": None,
        "voiceprint_confidence": None,
        "current_step": cached.get("current_step"),
    }


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
                    await asyncio.sleep(0.15)
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
    confirmed_speaker: str = Form(...),
    user_id: str = Depends(get_current_user)
):
    cached = _prepare_cache.get(session_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Session not found or expired. Please re-upload the audio."
        )
    if cached["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized.")

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
    user_id = cached["user_id"]
    filename = cached["filename"]
    voiceprint_confidence = cached.get("voiceprint_confidence")

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

        baseline = _get_context_baseline(user_id, primary_context)
        session_history = _get_user_session_history(user_id)
        resonance_calibration = _get_resonance_calibration(user_id)

        print(f"[{session_id}] Scoring dimensions...")
        emit("scoring", "Scoring behavioral dimensions…")
        dimensions = dimension_scorer.score_all(signals)

        print(f"[{session_id}] Detecting conversation type and generating insights...")
        emit("generating", "Generating insights with AI…")
        transcript_text = _sample_transcript(merged)
        conversation_types = context_detector.detect(transcript_text)
        primary_context = conversation_types[0]
        print(f"[{session_id}] Detected conversation types: {conversation_types}")

        insights = insight_gen.generate(
            signals, primary_context, baseline, transcript_text, dimensions,
            session_history=session_history,
            resonance_calibration=resonance_calibration,
            conversation_types=conversation_types,
        )

        emit("reflecting", "Generating reflection questions…")
        reflection_questions = insight_gen.generate_reflection_questions(
            signals, insights, transcript_text, primary_context
        )
        if reflection_questions:
            insights["reflection_questions"] = reflection_questions

        _update_voiceprint(user_id, audio_path, diarization, confirmed_speaker)
        _save_session(
            session_id, user_id, signals, insights, dimensions,
            primary_context, filename, confirmed_speaker,
            speaker_confirmed=True,
            merged=merged,
            all_speakers_signals=all_speakers_signals
        )

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
            "available_speakers": all_speaker_ids,
            "voiceprint_confidence": voiceprint_confidence,
            "transcript": merged,
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
                    await asyncio.sleep(0.15)
                    break
            except stdlib_queue.Empty:
                yield f"data: {json.dumps({'event': 'ping'})}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ── Reanalyze ─────────────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/reanalyze")
async def reanalyze_session(
    session_id: str,
    confirmed_speaker: str = Form(...),
    user_id: str = Depends(get_current_user)
):
    res = supabase_admin.table("sessions").select("*").eq("id", session_id).eq(
        "user_id", user_id
    ).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Session not found.")

    session = res.data[0]
    if not session.get("all_speakers_signals_json"):
        raise HTTPException(
            status_code=400,
            detail="Re-analysis data not available for this session. Please re-upload the audio."
        )

    all_speakers_signals = json.loads(session["all_speakers_signals_json"])
    if confirmed_speaker not in all_speakers_signals:
        available = list(all_speakers_signals.keys())
        raise HTTPException(
            status_code=400,
            detail=f"No data for speaker '{confirmed_speaker}'. Available: {available}"
        )

    signals = all_speakers_signals[confirmed_speaker]
    primary_context = session["context"]
    existing_insights = json.loads(session["insights_json"]) if session.get("insights_json") else {}
    conversation_types = existing_insights.get("conversation_types", [primary_context])

    print(f"[{session_id}] Re-analyzing as {confirmed_speaker}...")
    baseline = _get_context_baseline(user_id, primary_context)
    session_history = _get_user_session_history(user_id)
    resonance_calibration = _get_resonance_calibration(user_id)
    dimensions = dimension_scorer.score_all(signals)

    merged = json.loads(session["merged_json"]) if session.get("merged_json") else []
    transcript_text = " ".join(
        f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
        for s in merged[:60]
    )
    insights = insight_gen.generate(
        signals, primary_context, baseline, transcript_text, dimensions,
        session_history=session_history,
        resonance_calibration=resonance_calibration,
        conversation_types=conversation_types,
    )

    reflection_questions = insight_gen.generate_reflection_questions(
        signals, insights, transcript_text, primary_context
    )
    if reflection_questions:
        insights["reflection_questions"] = reflection_questions

    supabase_admin.table("sessions").update({
        "detected_speaker": confirmed_speaker,
        "speaker_confirmed": True,
        "signals_json": json.dumps(signals),
        "insights_json": json.dumps(insights),
        "dimensions_json": json.dumps(dimensions),
    }).eq("id", session_id).execute()

    print(f"[{session_id}] Re-analysis done.")
    return {
        "session_id": session_id,
        "signals": signals,
        "insights": insights,
        "dimensions": dimensions,
        "filename": session.get("filename") or "recording",
        "detected_speaker": confirmed_speaker,
        "speaker_confirmed": True,
        "available_speakers": list(all_speakers_signals.keys()),
        "transcript": merged,
    }


# ── Session history ───────────────────────────────────────────────

@app.get("/api/sessions")
def get_sessions(user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("sessions").select("*").eq(
        "user_id", user_id
    ).order("created_at", desc=True).execute()

    return [
        {
            "session_id": s["id"],
            "context": s["context"],
            "filename": s.get("filename") or "recording",
            "detected_speaker": s.get("detected_speaker") or "SPEAKER_00",
            "speaker_confirmed": s.get("speaker_confirmed") or False,
            "created_at": s["created_at"],
            "insights": json.loads(s["insights_json"]),
            "signals": json.loads(s["signals_json"]),
            "dimensions": json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {},
            "available_speakers": list(json.loads(s["all_speakers_signals_json"]).keys())
                if s.get("all_speakers_signals_json") else [],
            "transcript": json.loads(s["merged_json"]) if s.get("merged_json") else [],
        }
        for s in res.data
    ]


@app.get("/api/trends")
def get_trends(user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("sessions").select(
        "id, context, created_at, signals_json, dimensions_json"
    ).eq("user_id", user_id).order("created_at", desc=False).execute()

    points = []
    for s in res.data:
        try:
            sig = json.loads(s["signals_json"])
            dims = json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {}
            point = {
                "session_id": s["id"],
                "context": s["context"],
                "date": s["created_at"],
                "talk_ratio": round(sig["talk_ratio"]["user_ratio"] * 100, 1),
                "wpm": sig["speech_rate"]["overall_wpm"],
                "filler_rate": sig["filler_words"]["rate_per_100_words"],
                "silence_ratio": round(sig["silence_ratio"]["silence_ratio"] * 100, 1),
                "interruptions_given": sig["interruptions"]["user_interrupted_other"],
                "interruptions_received": sig["interruptions"]["user_was_interrupted"],
                "response_latency": sig["pauses"]["response_latency"]["mean_s"],
                "vocab_richness": sig["vocabulary_richness"].get("type_token_ratio"),
                "dimensions": {},
            }
            for dim, dim_data in dims.items():
                if isinstance(dim_data, dict):
                    point["dimensions"][dim] = {
                        sub: v.get("score")
                        for sub, v in dim_data.items()
                        if isinstance(v, dict) and "score" in v
                    }
            points.append(point)
        except Exception:
            continue

    return {"data": points, "count": len(points)}


@app.get("/api/profile")
def get_profile(user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("sessions").select(
        "id, context, created_at, signals_json, dimensions_json, insights_json, merged_json, detected_speaker"
    ).eq("user_id", user_id).order("created_at", desc=False).execute()

    if len(res.data) < 3:
        return {
            "insufficient_data": True,
            "session_count": len(res.data),
            "sessions_needed": 3,
        }

    parsed = []
    for s in res.data:
        try:
            sig = json.loads(s["signals_json"])
            dims = json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {}
            ins = json.loads(s["insights_json"])
            merged = json.loads(s["merged_json"]) if s.get("merged_json") else []
            parsed.append({
                "context": s["context"], "date": s["created_at"],
                "sig": sig, "dims": dims, "ins": ins,
                "merged": merged,
                "detected_speaker": s.get("detected_speaker") or "SPEAKER_00",
            })
        except Exception:
            continue

    n = len(parsed)

    def _avg(fn):
        vals = [v for v in (fn(p) for p in parsed) if v is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    overall = {
        "talk_ratio":           _avg(lambda p: p["sig"]["talk_ratio"]["user_ratio"] * 100),
        "wpm":                  _avg(lambda p: p["sig"]["speech_rate"]["overall_wpm"]),
        "filler_rate":          _avg(lambda p: p["sig"]["filler_words"]["rate_per_100_words"]),
        "interruptions_given":  _avg(lambda p: p["sig"]["interruptions"]["user_interrupted_other"]),
        "silence_ratio":        _avg(lambda p: p["sig"]["silence_ratio"]["silence_ratio"] * 100),
        "response_latency":     _avg(lambda p: p["sig"]["pauses"]["response_latency"]["mean_s"]),
        "vocab_richness":       _avg(lambda p: p["sig"]["vocabulary_richness"].get("type_token_ratio")),
    }

    # Context-stratified averages (only contexts with 2+ sessions)
    from collections import defaultdict as _dd
    ctx_map: dict = _dd(list)
    for p in parsed:
        ctx_map[p["context"]].append(p)

    by_context = {}
    for ctx, items in ctx_map.items():
        if len(items) >= 2:
            by_context[ctx] = {
                "count": len(items),
                "talk_ratio":  round(sum(p["sig"]["talk_ratio"]["user_ratio"] * 100 for p in items) / len(items), 1),
                "wpm":         round(sum(p["sig"]["speech_rate"]["overall_wpm"] for p in items) / len(items), 0),
                "filler_rate": round(sum(p["sig"]["filler_words"]["rate_per_100_words"] for p in items) / len(items), 2),
            }

    # Pattern detection
    patterns = []
    talk_ratios = [p["sig"]["talk_ratio"]["user_ratio"] * 100 for p in parsed]
    high_talk = sum(1 for r in talk_ratios if r > 60)
    low_talk  = sum(1 for r in talk_ratios if r < 40)
    if high_talk >= n * 0.7:
        patterns.append({"signal": "talk_ratio", "type": "consistently_high",
                          "detail": f"You speak over 60% of the time in {high_talk}/{n} sessions."})
    elif low_talk >= n * 0.7:
        patterns.append({"signal": "talk_ratio", "type": "consistently_low",
                          "detail": f"You speak under 40% of the time in {low_talk}/{n} sessions."})

    filler_rates = [p["sig"]["filler_words"]["rate_per_100_words"] for p in parsed]
    avg_filler = sum(filler_rates) / len(filler_rates)
    if avg_filler > 5:
        patterns.append({"signal": "filler_words", "type": "consistently_high",
                          "detail": f"Average filler rate {round(avg_filler, 1)}/100 words across all sessions."})

    interruption_counts = [p["sig"]["interruptions"]["user_interrupted_other"] for p in parsed]
    avg_interrupts = sum(interruption_counts) / len(interruption_counts)
    if avg_interrupts >= 3:
        patterns.append({"signal": "interruptions", "type": "consistently_high",
                          "detail": f"You average {round(avg_interrupts, 1)} interruptions per session."})

    # Trend detection across first vs last third (needs 6+ sessions)
    trends = []
    if n >= 6:
        third = n // 3
        oldest = parsed[:third]
        newest = parsed[n - third:]

        def _trend(fn, label, unit="", lower_is_better=False):
            old_v = sum(fn(p) for p in oldest) / len(oldest)
            new_v = sum(fn(p) for p in newest) / len(newest)
            if old_v == 0:
                return
            change_pct = (new_v - old_v) / old_v * 100
            if abs(change_pct) < 15:
                return
            improved = (new_v < old_v) if lower_is_better else (new_v > old_v)
            trends.append({
                "signal": label,
                "direction": "improved" if improved else "declined",
                "old": round(old_v, 2),
                "new": round(new_v, 2),
                "change_pct": round(change_pct, 1),
                "unit": unit,
            })

        _trend(lambda p: p["sig"]["filler_words"]["rate_per_100_words"], "filler_rate", "/100w", lower_is_better=True)
        _trend(lambda p: p["sig"]["speech_rate"]["overall_wpm"], "wpm", "wpm")
        _trend(lambda p: p["sig"]["talk_ratio"]["user_ratio"] * 100, "talk_ratio", "%")

    # Recurring coaching areas
    from collections import Counter as _Counter
    coaching_areas = []
    for p in parsed:
        coaching_areas.extend([c.get("area") for c in p["ins"].get("coaching_suggestions", [])[:2] if c.get("area")])
    recurring_coaching = [{"area": a, "count": c} for a, c in _Counter(coaching_areas).most_common(3) if c >= 2]

    # Personality synthesis
    _dim_paths = {
        "confidence":       ("emotional_state",             "confidence"),
        "nervousness":      ("emotional_state",             "nervousness"),
        "assertiveness":    ("communication_effectiveness", "assertiveness"),
        "listening_quality":("communication_effectiveness", "listening_quality"),
        "empathy":          ("relational_dynamics",         "empathy"),
        "clarity":          ("communication_effectiveness", "clarity"),
        "adaptability":     ("communication_effectiveness", "adaptability"),
    }
    dim_averages  = _compute_dim_averages(parsed)
    sessions_data = _build_sessions_data(parsed, _dim_paths)
    profile_payload = {
        "session_count": n,
        "overall": overall,
        "by_context": by_context,
        "patterns": patterns,
        "trends": trends,
    }
    personality = _get_or_synthesize_personality(user_id, n, profile_payload,
                                                 dim_averages, sessions_data)

    # Blind spots — contexts the mirror hasn't seen yet
    recorded_contexts = set(p["context"] for p in parsed)
    blind_spots = _compute_blind_spots(recorded_contexts)

    # Profile completeness: 60% from session depth, 40% from context variety
    session_score  = min(n / 10, 1.0) * 60
    context_score  = min(len(recorded_contexts) / 5, 1.0) * 40
    completeness   = round(session_score + context_score)
    if completeness < 25:   completeness_label = "Just starting"
    elif completeness < 50: completeness_label = "Building"
    elif completeness < 75: completeness_label = "Developing"
    elif completeness < 90: completeness_label = "Established"
    else:                   completeness_label = "Deep mirror"

    # Mirror Feed: 3 highlights per session, last 7 sessions newest-first
    session_highlights = []
    for p in reversed(parsed[-7:]):
        try:
            from datetime import datetime as _dt2
            date_str = _dt2.fromisoformat(p["date"].replace("Z", "+00:00")).strftime("%b %d")
        except Exception:
            date_str = "recent"
        hl = _extract_mirror_highlights(p["ins"])
        if hl:
            session_highlights.append({
                "date": date_str,
                "context": p["context"],
                "highlights": hl,
            })

    return {
        "insufficient_data": False,
        "session_count": n,
        "overall": overall,
        "by_context": by_context,
        "patterns": patterns,
        "trends": trends,
        "recurring_coaching": recurring_coaching,
        "personality": personality,
        "blind_spots": blind_spots,
        "completeness": completeness,
        "completeness_label": completeness_label,
        "session_highlights": session_highlights,
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user_id: str = Depends(get_current_user)
):
    res = supabase_admin.table("sessions").delete().eq("id", session_id).eq(
        "user_id", user_id
    ).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"status": "deleted"}


@app.post("/api/sessions/{session_id}/resonance")
async def save_resonance(
    session_id: str,
    signal: str = Form(...),
    response: str = Form(...),
    user_id: str = Depends(get_current_user)
):
    if response not in ("yes", "somewhat", "no"):
        raise HTTPException(status_code=422, detail="response must be yes, somewhat, or no")
    res = supabase_admin.table("sessions").select("id").eq("id", session_id).eq(
        "user_id", user_id
    ).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Session not found.")
    supabase_admin.table("resonance_feedback").upsert({
        "session_id": session_id,
        "user_id": user_id,
        "signal": signal,
        "response": response,
    }, on_conflict="session_id,signal").execute()
    return {"status": "saved"}


@app.delete("/api/account")
async def delete_account(user_id: str = Depends(get_current_user)):
    """Permanently delete all user data and the auth account."""
    supabase_admin.table("sessions").delete().eq("user_id", user_id).execute()
    supabase_admin.table("user_voiceprints").delete().eq("user_id", user_id).execute()
    supabase_admin.auth.admin.delete_user(user_id)
    return {"status": "deleted"}


@app.post("/api/sessions/{session_id}/confirm-speaker")
async def confirm_speaker(
    session_id: str,
    confirmed: bool = Form(True),
    user_id: str = Depends(get_current_user)
):
    supabase_admin.table("sessions").update({
        "speaker_confirmed": confirmed
    }).eq("id", session_id).eq("user_id", user_id).execute()
    return {"status": "ok"}


# ── Voice enrollment ──────────────────────────────────────────────

@app.get("/api/voiceprint/status")
def voiceprint_status(user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("user_voiceprints").select("user_id").eq(
        "user_id", user_id
    ).execute()
    return {"enrolled": len(res.data) > 0}


@app.post("/api/enroll")
async def enroll_voice(
    audio1: UploadFile = File(...),
    audio2: UploadFile = File(None),
    audio3: UploadFile = File(None),
    user_id: str = Depends(get_current_user)
):
    """Extract and store the user's voiceprint from 1–3 enrollment recordings."""
    if not voiceprint_matcher.available:
        raise HTTPException(status_code=503, detail="Voiceprint model not available.")

    audio_files = [f for f in [audio1, audio2, audio3] if f is not None]
    embeddings = []

    for i, audio in enumerate(audio_files):
        enroll_path = f"{UPLOAD_DIR}/enroll_{user_id}_{i}.wav"
        temp_path = f"{UPLOAD_DIR}/enroll_{user_id}_{i}_temp"
        try:
            contents = await audio.read()
            with open(temp_path, "wb") as f:
                f.write(contents)
            subprocess.run(
                ["ffmpeg", "-i", temp_path, "-ar", "16000", "-ac", "1", "-y", enroll_path],
                capture_output=True
            )
            if os.path.exists(temp_path):
                os.remove(temp_path)
            emb = voiceprint_matcher.extract_enrollment_embedding(enroll_path)
            if emb is not None:
                embeddings.append(emb / np.linalg.norm(emb))
        finally:
            if os.path.exists(enroll_path):
                os.remove(enroll_path)
            if os.path.exists(temp_path):
                os.remove(temp_path)

    if not embeddings:
        raise HTTPException(
            status_code=422,
            detail="Could not extract voice embeddings. Speak clearly for at least 20 seconds per round."
        )

    # Store each round's embedding separately so detection can match any style
    emb_json = json.dumps([emb.tolist() for emb in embeddings])

    res = supabase_admin.table("user_voiceprints").select("user_id").eq(
        "user_id", user_id
    ).execute()
    if res.data:
        supabase_admin.table("user_voiceprints").update({
            "embedding_json": emb_json,
            "updated_at": _utcnow()
        }).eq("user_id", user_id).execute()
    else:
        supabase_admin.table("user_voiceprints").insert({
            "user_id": user_id,
            "embedding_json": emb_json,
        }).execute()

    return {"status": "enrolled", "rounds": len(embeddings)}


# ── Internal helpers ──────────────────────────────────────────────

def _build_speaker_samples(merged: list, diarization: list) -> dict:
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


def _update_voiceprint(user_id: str, audio_path: str, diarization: list, confirmed_speaker: str):
    if not voiceprint_matcher.available:
        return

    speaker_segs = [s for s in diarization if s["speaker"] == confirmed_speaker]
    new_emb = voiceprint_matcher.extract_speaker_embedding(audio_path, speaker_segs)
    if new_emb is None:
        return

    res = supabase_admin.table("user_voiceprints").select("embedding_json").eq(
        "user_id", user_id
    ).execute()
    existing = res.data[0] if res.data else None

    if existing:
        raw = json.loads(existing["embedding_json"])
        stored = [np.array(e) for e in raw] if isinstance(raw[0], list) else [np.array(raw)]
        norm_new = new_emb / np.linalg.norm(new_emb)
        stored.append(norm_new)
        stored = stored[-10:]  # keep at most 10 most recent
        supabase_admin.table("user_voiceprints").update({
            "embedding_json": json.dumps([e.tolist() for e in stored]),
            "updated_at": _utcnow()
        }).eq("user_id", user_id).execute()
    else:
        norm_emb = new_emb / np.linalg.norm(new_emb)
        supabase_admin.table("user_voiceprints").insert({
            "user_id": user_id,
            "embedding_json": json.dumps([norm_emb.tolist()]),
        }).execute()


def _get_user_baseline(user_id: str):
    res = supabase_admin.table("sessions").select("signals_json").eq(
        "user_id", user_id
    ).execute()
    sessions = res.data
    if len(sessions) < 3:
        return None

    all_signals = [json.loads(s["signals_json"]) for s in sessions[-10:]]
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


def _get_context_baseline(user_id: str, context: str) -> dict | None:
    """Return context-specific baseline.
    Priority: personal context average (3+ same-context sessions) → population norms → None.
    """
    res = supabase_admin.table("sessions").select("signals_json").eq(
        "user_id", user_id
    ).eq("context", context).execute()

    context_sessions = [s for s in res.data if s.get("signals_json")]

    if len(context_sessions) >= 3:
        all_signals = [json.loads(s["signals_json"]) for s in context_sessions[-10:]]
        return {
            "source": "personal_context",
            "context": context,
            "session_count": len(context_sessions),
            "avg_speech_rate_wpm":    float(np.mean([s["speech_rate"]["overall_wpm"] for s in all_signals])),
            "avg_talk_ratio":         float(np.mean([s["talk_ratio"]["user_ratio"] for s in all_signals])),
            "avg_filler_rate":        float(np.mean([s["filler_words"]["rate_per_100_words"] for s in all_signals])),
            "avg_response_latency_s": float(np.mean([s["pauses"]["response_latency"]["mean_s"] for s in all_signals])),
        }

    norms = CONTEXT_POPULATION_NORMS.get(context)
    if norms:
        return {"source": "population_norm", "context": context, "norms": norms}

    return None


def _get_user_session_history(user_id: str, limit: int = 10) -> list:
    """Return last N sessions in chronological order for cross-session prompting."""
    res = supabase_admin.table("sessions").select(
        "id, context, created_at, signals_json, insights_json, dimensions_json"
    ).eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()

    history = []
    for s in reversed(res.data):  # oldest first
        try:
            signals = json.loads(s["signals_json"])
            insights = json.loads(s["insights_json"])
            dimensions = json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {}
            history.append({
                "context": s["context"],
                "date": s["created_at"][:10],
                "summary": insights.get("summary_sentence", ""),
                "signals": {
                    "talk_ratio_pct": round(signals["talk_ratio"]["user_ratio"] * 100, 1),
                    "wpm": signals["speech_rate"]["overall_wpm"],
                    "filler_rate": signals["filler_words"]["rate_per_100_words"],
                    "interruptions_given": signals["interruptions"]["user_interrupted_other"],
                    "silence_ratio_pct": round(signals["silence_ratio"]["silence_ratio"] * 100, 1),
                },
                "top_coaching_areas": [
                    c.get("area") for c in insights.get("coaching_suggestions", [])[:2]
                    if c.get("area")
                ],
            })
        except Exception:
            continue
    return history


def _get_resonance_calibration(user_id: str) -> dict:
    """Return signals to avoid/emphasize based on user's Yes/No resonance feedback."""
    from collections import Counter
    res = supabase_admin.table("resonance_feedback").select(
        "signal, response"
    ).eq("user_id", user_id).execute()

    votes: dict = {}
    for row in res.data:
        sig, resp = row["signal"], row["response"]
        votes.setdefault(sig, Counter())[resp] += 1

    avoid = [
        sig for sig, c in votes.items()
        if c.get("no", 0) >= 2 and c.get("no", 0) > c.get("yes", 0)
    ]
    emphasize = [
        sig for sig, c in votes.items()
        if c.get("yes", 0) >= 2 and c.get("yes", 0) > c.get("no", 0)
    ]
    return {"avoid": avoid, "emphasize": emphasize}


def _sample_transcript(merged: list, max_segments: int = 60) -> str:
    """Return a transcript string covering the full conversation.
    If <= max_segments, use all. Otherwise take evenly-spaced thirds with no overlap."""
    n = len(merged)
    if n <= max_segments:
        selected = merged
    else:
        third = max_segments // 3
        start_idx = list(range(third))
        mid_start = max(third, n // 2 - third // 2)
        mid_idx = list(range(mid_start, min(mid_start + third, n - third)))
        end_idx = list(range(n - third, n))
        seen, indices = set(), []
        for i in start_idx + mid_idx + end_idx:
            if i not in seen:
                seen.add(i)
                indices.append(i)
        selected = [merged[i] for i in sorted(indices)]
    return " ".join(
        f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
        for s in selected
    )


def _save_session(
    session_id, user_id, signals, insights, dimensions,
    context, filename="recording", detected_speaker="SPEAKER_00",
    speaker_confirmed=True, merged=None, all_speakers_signals=None
):
    supabase_admin.table("sessions").insert({
        "id": session_id,
        "user_id": user_id,
        "context": context,
        "filename": filename,
        "detected_speaker": detected_speaker,
        "speaker_confirmed": speaker_confirmed,
        "signals_json": json.dumps(signals),
        "insights_json": json.dumps(insights),
        "dimensions_json": json.dumps(dimensions),
        "merged_json": json.dumps(merged) if merged else None,
        "all_speakers_signals_json": json.dumps(all_speakers_signals) if all_speakers_signals else None,
    }).execute()
