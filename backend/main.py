from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from typing import Optional
import os, shutil, uuid, json, time, subprocess, asyncio, threading
import queue as stdlib_queue
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from dotenv import load_dotenv
import numpy as np

load_dotenv()

import warnings, logging
warnings.filterwarnings("ignore")
logging.getLogger("pytorch_lightning").setLevel(logging.ERROR)
logging.getLogger("lightning_fabric").setLevel(logging.ERROR)
logging.getLogger("pyannote").setLevel(logging.ERROR)

logger = logging.getLogger("mirror")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

# Maximum speakers to extract detailed signals for per session.
# Prevents OOM on HF Spaces when a large meeting produces many speaker labels.
MAX_SPEAKERS_TO_ANALYZE = 4

from pipeline.transcriber import Transcriber
from pipeline.diarizer import Diarizer
from pipeline.signal_extractor import SignalExtractor
from pipeline.insight_generator import InsightGenerator
from pipeline.dimension_scorer import DimensionScorer
from pipeline.voiceprint import VoiceprintMatcher
from pipeline.context_detector import ContextDetector
from pipeline.personality_synthesizer import PersonalitySynthesizer
from pipeline.mirror_feed_synthesizer import MirrorFeedSynthesizer
from db.database import supabase_admin

app = FastAPI()

_ALLOWED_ORIGINS = [o for o in [
    "http://localhost:5173",
    "http://localhost:5174",
    os.getenv("FRONTEND_URL", ""),
] if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "/tmp/mirror"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory store for prepare → finalize handoff.
_prepare_cache: dict = {}
_CACHE_TTL = 1800  # 30 minutes

# SSE job queues: { job_key: stdlib_queue.Queue }
_jobs: dict = {}

# Cancelled sessions — background threads check this and bail early
_cancelled: set = set()


def _sid(session_id: str) -> str:
    return session_id[:8]


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


print("[startup] Loading models...")
transcriber = Transcriber(api_key=os.getenv("GROQ_API_KEY"))
diarizer = Diarizer(hf_token=os.getenv("HF_TOKEN"))
insight_gen = InsightGenerator(api_key=os.getenv("GROQ_API_KEY"))
context_detector = ContextDetector(api_key=os.getenv("GROQ_API_KEY"))
dimension_scorer = DimensionScorer()
voiceprint_matcher = VoiceprintMatcher(hf_token=os.getenv("HF_TOKEN"))
personality_synth = PersonalitySynthesizer(api_key=os.getenv("GROQ_API_KEY"))
mirror_feed_synth = MirrorFeedSynthesizer(api_key=os.getenv("GROQ_API_KEY"))
print("[startup] All models loaded. Server ready.")

# In-memory caches — cleared on server restart, Supabase is the durable layer
_personality_cache: dict = {}   # key = "{user_id}:{session_count}:v{version}"
_mirror_feed_cache: dict = {}   # key = "{user_id}:{session_count}"


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
    "evaluative":    (1, "Interview & Review · High Stakes",
        "No interview, presentation, or review recordings yet. Your confidence and "
        "composure scores are built from lower-stakes conversations — they may shift "
        "significantly when you're being assessed."),
    "adversarial":   (2, "Conflict & Friction",
        "No conflict or disagreement recordings yet. We can't tell how you respond when "
        "challenged or when there's real friction in the room."),
    "collaborative": (3, "Collaborative",
        "No team meetings or brainstorming sessions uploaded. Your listening and "
        "assertiveness scores come from 1-on-1 conversations only."),
    "influential":   (4, "Persuading & Pitching",
        "No pitch or persuasion conversations yet. We can't see how you hold an argument "
        "or move someone toward a decision."),
    "negotiation":   (5, "Negotiation",
        "No negotiation recordings yet. How your composure and assertiveness hold under "
        "competing interests is still unmeasured."),
    "developmental": (6, "Coaching & Feedback",
        "No coaching or feedback sessions recorded. We can't see how you structure or "
        "deliver guidance to others."),
    "support":       (7, "Supportive Listening",
        "No support conversations yet. Your empathy dimension has no direct evidence."),
    "intimate":      (8, "Deep Personal",
        "No emotionally open conversations uploaded. Your expressiveness and warmth "
        "scores may be incomplete."),
    "social":        (9, "Casual & Low-Stakes",
        "No casual social conversations recorded. We can't see your natural, "
        "low-pressure communication style yet."),
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

        sessions.append({
            "date":            date_str,
            "context":         p["context"],
            "dim_scores":      dim_scores,
            "filler_rate":     p["sig"]["filler_words"]["rate_per_100_words"],
            "talk_ratio_pct":  round(p["sig"]["talk_ratio"]["user_ratio"] * 100),
            "notable_pattern": p["ins"].get("notable_pattern", ""),
            "fingerprint":     p.get("fingerprint") or "",
        })
    return sessions


def _get_or_synthesize_personality(user_id: str, session_count: int,
                                   profile_data: dict, dim_averages: dict,
                                   sessions_data: list = None) -> dict:
    _SYNTHESIS_VERSION = 5  # bump when prompt changes to invalidate old cache
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
            raw_pj = row.get("personality_json")
            if raw_pj and row.get("session_count_at_synthesis") == session_count * _SYNTHESIS_VERSION:
                personality = json.loads(raw_pj)
                _personality_cache[cache_key] = personality
                return personality
            elif raw_pj:
                # Session count changed — preserve old synthesis for delta calculation
                try:
                    old_personality = json.loads(raw_pj)
                except Exception:
                    pass
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
@app.head("/")
def root():
    return {"status": "mirror. API is running"}


@app.get("/health")
@app.head("/health")
def health():
    return {"status": "ok"}


@app.get("/privacy", response_class=HTMLResponse)
def privacy_policy():
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — Mirror: Voice Insights</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f1117;
      color: #c4c2d8;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 15px;
      line-height: 1.7;
      padding: 48px 24px 80px;
    }
    .wrap { max-width: 720px; margin: 0 auto; }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 48px; }
    .logo h1 { font-size: 22px; font-weight: 700; color: #f0eeff; letter-spacing: -0.3px; }
    .logo span { color: #1d4ed8; }
    h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px;
         color: #1d4ed8; margin: 40px 0 12px; }
    p { margin-bottom: 12px; color: #9d9bba; }
    ul { padding-left: 20px; margin-bottom: 12px; }
    li { margin-bottom: 6px; color: #9d9bba; }
    strong { color: #c4c2d8; }
    .highlight {
      background: rgba(29,78,216,0.08);
      border: 1px solid rgba(29,78,216,0.2);
      border-radius: 10px;
      padding: 16px 20px;
      margin: 24px 0;
      color: #a5b4fc;
      font-size: 14px;
    }
    .meta { color: #4a4d6a; font-size: 13px; margin-top: 60px; padding-top: 24px;
            border-top: 1px solid #1e2438; }
    a { color: #5b9cf6; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
<div class="wrap">

  <div class="logo">
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#1d4ed8"/><stop offset="1" stop-color="#0891b2"/>
        </linearGradient>
      </defs>
      <rect x="2"  y="12" width="4" height="4"  rx="2" fill="url(#g)" opacity=".4"/>
      <rect x="8"  y="8"  width="4" height="8"  rx="2" fill="url(#g)" opacity=".65"/>
      <rect x="14" y="4"  width="4" height="12" rx="2" fill="url(#g)"/>
      <rect x="20" y="8"  width="4" height="8"  rx="2" fill="url(#g)" opacity=".65"/>
      <rect x="26" y="12" width="4" height="4"  rx="2" fill="url(#g)" opacity=".4"/>
      <line x1="0" y1="17.5" x2="32" y2="17.5" stroke="#1e2438" stroke-width="1"/>
      <rect x="2"  y="18" width="4" height="4"  rx="2" fill="url(#g)" opacity=".18"/>
      <rect x="8"  y="18" width="4" height="8"  rx="2" fill="url(#g)" opacity=".3"/>
      <rect x="14" y="18" width="4" height="12" rx="2" fill="url(#g)" opacity=".38"/>
      <rect x="20" y="18" width="4" height="8"  rx="2" fill="url(#g)" opacity=".3"/>
      <rect x="26" y="18" width="4" height="4"  rx="2" fill="url(#g)" opacity=".18"/>
    </svg>
    <h1>mirror<span>.</span></h1>
  </div>

  <h1 style="font-size:28px;font-weight:700;color:#f0eeff;letter-spacing:-0.5px;margin-bottom:8px;">
    Privacy Policy
  </h1>
  <p style="color:#4a4d6a;font-size:14px;">Mirror: Voice Insights &nbsp;·&nbsp; Effective 9 June 2026</p>

  <div class="highlight">
    <strong>The short version:</strong> Your audio is processed to generate insights and deleted immediately afterwards. We never store, sell, or share your recordings.
  </div>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Email address</strong> — used solely for account authentication via Supabase.</li>
    <li><strong>Audio recordings</strong> — uploaded by you for analysis. Deleted from our servers immediately after processing is complete. Never stored long-term.</li>
    <li><strong>Behavioural analysis results</strong> — transcripts, speaker patterns, dimension scores, and insights generated from your recordings. Stored in your account so you can track trends over time.</li>
    <li><strong>Voiceprint embedding</strong> — a mathematical representation of your voice (not a recording) used to identify which speaker is you across sessions. Stored encrypted in your account and can be deleted at any time.</li>
  </ul>

  <h2>What we do not collect</h2>
  <ul>
    <li>We do not record or store raw audio beyond the duration of analysis.</li>
    <li>We do not sell, rent, or share your data with third parties for advertising or marketing.</li>
    <li>We do not track your browsing activity or behaviour outside of the Mirror extension.</li>
  </ul>

  <h2>How your data is processed</h2>
  <p>When you upload a recording, it is sent securely to our processing server. The following steps occur:</p>
  <ul>
    <li>Audio is transcribed using the <strong>Groq Whisper API</strong> (Groq's privacy policy applies to transcription).</li>
    <li>Speaker diarization and voice analysis are performed using <strong>pyannote.audio</strong> models running on our server.</li>
    <li>Behavioural insights are generated using <strong>Groq's language model API</strong>.</li>
    <li>The audio file is permanently deleted from our server once processing is complete.</li>
  </ul>
  <p>Analysis results (not the audio) are stored in your account database hosted on <strong>Supabase</strong>, a GDPR-compliant cloud database provider.</p>

  <h2>Google Meet integration</h2>
  <p>When using Mirror with Google Meet, the extension can capture audio from your meeting tab only when you explicitly click the Record button. Audio is never captured automatically or without your knowledge. The same data handling rules apply: audio is processed and deleted; only the resulting insights are stored.</p>

  <h2>Third-party services</h2>
  <ul>
    <li><strong>Supabase</strong> — authentication and database storage. <a href="https://supabase.com/privacy" target="_blank">Privacy policy</a>.</li>
    <li><strong>Groq</strong> — speech transcription and language model inference. <a href="https://groq.com/privacy-policy/" target="_blank">Privacy policy</a>.</li>
    <li><strong>HuggingFace</strong> — model hosting and inference infrastructure. <a href="https://huggingface.co/privacy" target="_blank">Privacy policy</a>.</li>
  </ul>

  <h2>Your rights</h2>
  <p>You can delete all your data at any time from within the extension: open the Mirror popup → Account → Delete account. This permanently removes your analysis history, voiceprint, and account from our systems. You can also contact us directly to request data deletion.</p>

  <h2>Data security</h2>
  <p>All data is transmitted over HTTPS. Account authentication uses industry-standard JWT tokens managed by Supabase. Audio files are stored in temporary server memory only during processing and are never written to persistent disk storage.</p>

  <h2>Changes to this policy</h2>
  <p>If we make material changes to how we handle your data, we will update the effective date of this policy. Continued use of Mirror after changes are posted constitutes acceptance of the updated policy.</p>

  <h2>Contact</h2>
  <p>Questions or data requests: <a href="mailto:harsh200415@gmail.com">harsh200415@gmail.com</a></p>

  <p class="meta">Mirror: Voice Insights &nbsp;·&nbsp; Privacy Policy &nbsp;·&nbsp; Last updated 9 June 2026</p>

</div>
</body>
</html>"""


# ── SSE Step 1: Start prepare job ────────────────────────────────

@app.post("/api/prepare/start")
async def start_prepare_session(
    audio: UploadFile = File(...),
    filename: str = Form("recording"),
    speaker_timeline: Optional[str] = Form(None),
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

    import wave
    with wave.open(audio_path, "r") as _wf:
        _duration_s = _wf.getnframes() / _wf.getframerate()
    if _duration_s > 1200:
        os.remove(audio_path)
        raise HTTPException(
            status_code=400,
            detail="Recording exceeds the 20-minute limit. Please trim and re-upload."
        )

    # Parse WebRTC speaker timeline if provided (skips pyannote diarization)
    parsed_timeline = None
    if speaker_timeline:
        try:
            parsed_timeline = json.loads(speaker_timeline)
            print(f"[{_sid(session_id)}] ▶ WebRTC speaker timeline provided ({len(parsed_timeline)} events)")
        except Exception:
            parsed_timeline = None

    job_q: stdlib_queue.Queue = stdlib_queue.Queue()
    _jobs[session_id] = job_q

    threading.Thread(
        target=_run_prepare_job,
        args=(session_id, audio_path, user_id, filename, _duration_s, parsed_timeline),
        daemon=True
    ).start()

    print(f"[{_sid(session_id)}] ▶ Upload received — starting analysis")
    return {"job_id": session_id}


def _fill_speaker_gaps(diarization: list, total_duration: float, user_label: str = "SPEAKER_00") -> list:
    """Merge WebRTC speaker events into a continuous timeline.

    Two modes:
    - Explicit user VAD present (user_label already in timeline): the injector captured
      the local mic, so we have ground-truth user speaking segments. Just sort the timeline
      and return — gaps are silence, NOT the user. Gap-filling would inflate the user's
      talk ratio by attributing silence between remote speakers to the user.
    - No explicit user VAD (user_label absent): fall back to the original gap-fill
      behaviour — attribute all gaps between remote speakers to the user (heuristic for
      when getUserMedia was not intercepted by the injector).
    """
    if not diarization:
        logger.warning("[gap-fill] Empty diarization — attributing entire duration to %s", user_label)
        return [{"speaker": user_label, "start": 0.0, "end": total_duration}]

    has_user_vad = any(s["speaker"] == user_label for s in diarization)

    if has_user_vad:
        # User's mic VAD events are explicit. Trust them — don't add synthetic user segments.
        # Gaps between events are silence periods; merge_transcript_with_speakers will default
        # unmatched transcript segments to SPEAKER_00 anyway for the actual analysis.
        sorted_segs = sorted(diarization, key=lambda x: x["start"])
        logger.info(
            "[gap-fill] Explicit %s VAD found — returning sorted timeline (%d segs, no gap-fill). "
            "Speakers: %s",
            user_label,
            len(sorted_segs),
            sorted({s["speaker"] for s in sorted_segs}),
        )
        return sorted_segs

    # ── No explicit user VAD — gap-fill with user_label (heuristic) ──────────────
    logger.warning(
        "[gap-fill] No %s events in timeline — gaps between remote speakers will be attributed to %s. "
        "This means getUserMedia was NOT intercepted (mic joined before injector ran). "
        "Talk ratio for user may be inflated.",
        user_label, user_label,
    )
    filled = []
    prev_end = 0.0
    for seg in sorted(diarization, key=lambda x: x["start"]):
        if seg["start"] > prev_end + 0.5:
            filled.append({"speaker": user_label, "start": round(prev_end, 3), "end": round(seg["start"], 3)})
        filled.append(seg)
        prev_end = max(prev_end, seg["end"])

    if prev_end < total_duration - 0.5:
        filled.append({"speaker": user_label, "start": round(prev_end, 3), "end": round(total_duration, 3)})

    return filled


def _run_prepare_job(session_id, audio_path, user_id, filename, audio_duration_s=None, speaker_timeline=None):
    def emit(step, message):
        if session_id in _jobs:
            _jobs[session_id].put({"event": "progress", "step": step, "message": message})
        if session_id in _prepare_cache:
            _prepare_cache[session_id]["current_step"] = step

    try:
        if session_id in _cancelled:
            _cancelled.discard(session_id)
            logger.info("[%s] ✕ Cancelled before start", _sid(session_id))
            return

        if speaker_timeline:
            # ── WebRTC path: skip pyannote, use provided timeline + transcribe only ────
            speaker_labels = sorted({e["speaker"] for e in speaker_timeline})
            has_user_vad = "SPEAKER_00" in speaker_labels
            logger.info(
                "[%s] 1/3 Transcribing (WebRTC timeline provided: %d events, speakers: %s, has_user_vad: %s)",
                _sid(session_id), len(speaker_timeline), speaker_labels, has_user_vad,
            )
            if not has_user_vad:
                logger.warning(
                    "[%s] WARNING: No SPEAKER_00 in WebRTC timeline — local mic was NOT captured by injector. "
                    "Gap-fill will be used (may inflate user talk ratio).",
                    _sid(session_id),
                )
            emit("transcribing", "Transcribing audio with Whisper…")
            transcript = transcriber.transcribe(audio_path)
            logger.info(
                "[%s]    Transcription done: %d segments, ~%d words",
                _sid(session_id), len(transcript.get("segments", [])),
                sum(len(s.get("words", [])) for s in transcript.get("segments", [])),
            )
            emit("diarizing", "Using meeting speaker data…")

            total_dur = audio_duration_s or (
                max(s["end"] for s in transcript["segments"]) if transcript.get("segments") else 0
            )
            logger.info("[%s]    Audio duration: %.1fs", _sid(session_id), total_dur)
            diarization = _fill_speaker_gaps(speaker_timeline, total_dur)
            unique_speakers = {s["speaker"] for s in diarization}
            logger.info(
                "[%s]    WebRTC timeline processed: %d segments, %d unique speakers: %s",
                _sid(session_id), len(diarization), len(unique_speakers), sorted(unique_speakers),
            )
        else:
            # ── Standard path: parallel transcription + pyannote diarization ────────
            logger.info("[%s] 1/3 Transcribing + diarizing (pyannote path)...", _sid(session_id))
            emit("transcribing", "Transcribing audio with Whisper…")

            with ThreadPoolExecutor(max_workers=2) as pool:
                f_transcript = pool.submit(transcriber.transcribe, audio_path)
                f_diarization = pool.submit(diarizer.diarize, audio_path)
                transcript = f_transcript.result()
                logger.info(
                    "[%s]    Transcription done: %d segments",
                    _sid(session_id), len(transcript.get("segments", [])),
                )
                emit("diarizing", "Identifying speakers…")
                diarization = f_diarization.result()
                logger.info(
                    "[%s]    Pyannote done: %d segments, speakers: %s",
                    _sid(session_id), len(diarization),
                    sorted({s["speaker"] for s in diarization}),
                )

        if session_id in _cancelled:
            _cancelled.discard(session_id)
            if os.path.exists(audio_path): os.remove(audio_path)
            logger.info("[%s] ✕ Cancelled after transcription", _sid(session_id))
            return

        merged = diarizer.merge_transcript_with_speakers(
            transcript["segments"], diarization
        )
        logger.info("[%s]    Merged transcript: %d segments", _sid(session_id), len(merged))

        unique_speakers = {s["speaker"] for s in diarization if s["speaker"] != "UNKNOWN"}
        logger.info("[%s] 2/3 Detecting voice (%d speakers found)...", _sid(session_id), len(unique_speakers))
        emit("detecting", "Detecting your voice…")

        voiceprint_match = None
        voiceprint_confidence = None
        speaker_ids = sorted(unique_speakers)

        if speaker_timeline:
            # WebRTC path: user is always SPEAKER_00 — skip voiceprint
            detected_speaker = "SPEAKER_00"
            logger.info("[%s]    WebRTC mode — user auto-assigned to SPEAKER_00", _sid(session_id))

            # Validate that SPEAKER_00 segments exist in merged transcript
            user_merged_segs = [s for s in merged if s.get("speaker") == "SPEAKER_00"]
            logger.info(
                "[%s]    SPEAKER_00 segments in merged transcript: %d",
                _sid(session_id), len(user_merged_segs),
            )
            if len(user_merged_segs) == 0:
                logger.warning(
                    "[%s] WARNING: No SPEAKER_00 transcript segments found! "
                    "User's speech may not have been correctly attributed. "
                    "Analysis will run but signals may be zero/empty.",
                    _sid(session_id),
                )
        else:
            # Standard path: run voiceprint matching to identify the user
            res = supabase_admin.table("user_voiceprints").select("embedding_json").eq(
                "user_id", user_id
            ).execute()
            stored_vp = res.data[0] if res.data else None

            if stored_vp and voiceprint_matcher.available:
                raw = json.loads(stored_vp["embedding_json"])
                stored_embs = [np.array(e) for e in raw] if isinstance(raw[0], list) else [np.array(raw)]

                speaker_segs_map: dict = {}
                for seg in diarization:
                    if seg["speaker"] != "UNKNOWN":
                        speaker_segs_map.setdefault(seg["speaker"], []).append(seg)

                talk_times = {
                    sp: sum(s["end"] - s["start"] for s in segs)
                    for sp, segs in speaker_segs_map.items()
                }
                total_time = sum(talk_times.values()) or 1

                vp_scores: dict = {}
                for sp, segs in speaker_segs_map.items():
                    emb = voiceprint_matcher.extract_speaker_embedding(audio_path, segs)
                    if emb is not None:
                        vp_scores[sp] = max(
                            VoiceprintMatcher._cosine_similarity(emb, ref)
                            for ref in stored_embs
                        )

                if vp_scores:
                    best_vp = max(vp_scores, key=vp_scores.get)
                    best_score = vp_scores[best_vp]

                    if best_score >= 0.55:
                        voiceprint_match = best_vp
                        voiceprint_confidence = best_score
                        logger.info("[%s]    Voice matched: %s (confidence %.2f)", _sid(session_id), best_vp, best_score)
                    else:
                        combined = {
                            sp: 0.6 * vp_scores[sp] + 0.4 * (talk_times.get(sp, 0) / total_time)
                            for sp in vp_scores
                        }
                        best_combined = max(combined, key=combined.get)
                        voiceprint_match = best_combined
                        voiceprint_confidence = best_score
                        logger.warning(
                            "[%s]    Voice low-confidence (%.2f) → blended to %s",
                            _sid(session_id), best_score, best_combined,
                        )
            else:
                if not stored_vp:
                    logger.info("[%s]    No voiceprint enrolled — defaulting to first speaker", _sid(session_id))
                elif not voiceprint_matcher.available:
                    logger.warning("[%s]    Voiceprint matcher unavailable — defaulting to first speaker", _sid(session_id))

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
        logger.info("[%s] ✓ Prepare done — detected_speaker: %s", _sid(session_id), detected_speaker)

    except Exception as e:
        import traceback
        if os.path.exists(audio_path):
            os.remove(audio_path)
        logger.error("[%s] ✕ Prepare error: %s\n%s", _sid(session_id), e, traceback.format_exc())
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

    logger.info("[%s] ▶ Speaker confirmed (%s) — starting finalize job", _sid(session_id), confirmed_speaker)
    return {"job_id": session_id}


def _run_finalize_job(session_id, confirmed_speaker):
    import traceback as _tb
    job_key = f"finalize_{session_id}"

    def emit(step, message):
        if job_key in _jobs:
            _jobs[job_key].put({"event": "progress", "step": step, "message": message})

    cached = _prepare_cache.get(session_id)
    if not cached:
        logger.error("[%s] ✕ Finalize: session not in cache (expired?)", _sid(session_id))
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
        if session_id in _cancelled:
            _cancelled.discard(session_id)
            logger.info("[%s] ✕ Cancelled before finalize", _sid(session_id))
            return

        # ── Step 1: Signal extraction ─────────────────────────────────
        logger.info("[%s] 1/4 Extracting behavioral signals...", _sid(session_id))
        emit("extracting", "Extracting behavioral signals…")

        all_speaker_ids = list({s["speaker"] for s in diarization if s["speaker"] != "UNKNOWN"})
        logger.info("[%s]    Diarization speakers (%d): %s", _sid(session_id), len(all_speaker_ids), all_speaker_ids)

        if confirmed_speaker not in all_speaker_ids:
            logger.warning(
                "[%s]    WARNING: confirmed_speaker '%s' not in diarization — will extract anyway",
                _sid(session_id), confirmed_speaker
            )

        # Cap extraction to MAX_SPEAKERS_TO_ANALYZE to prevent OOM on multi-speaker meetings.
        # Always keep confirmed_speaker (= user) and SPEAKER_00; fill remaining slots with
        # speakers ranked by total talk time so the most active participants are included.
        def _speaker_talk_time(sp):
            return sum(s["end"] - s["start"] for s in diarization if s["speaker"] == sp)

        must_have = {confirmed_speaker, "SPEAKER_00"} & set(all_speaker_ids)
        remaining = [sp for sp in all_speaker_ids if sp not in must_have]
        remaining.sort(key=_speaker_talk_time, reverse=True)
        speakers_to_extract = list(must_have) + remaining
        if len(speakers_to_extract) > MAX_SPEAKERS_TO_ANALYZE:
            dropped = speakers_to_extract[MAX_SPEAKERS_TO_ANALYZE:]
            speakers_to_extract = speakers_to_extract[:MAX_SPEAKERS_TO_ANALYZE]
            logger.warning(
                "[%s]    Capping extraction at %d speakers (dropping %d to prevent OOM): %s",
                _sid(session_id), MAX_SPEAKERS_TO_ANALYZE, len(dropped), dropped
            )
        else:
            logger.info(
                "[%s]    Will extract signals for %d speaker(s): %s",
                _sid(session_id), len(speakers_to_extract), speakers_to_extract
            )

        all_speakers_signals = {}
        for sp in speakers_to_extract:
            sp_segs = [s for s in diarization if s["speaker"] == sp]
            sp_talk = _speaker_talk_time(sp)
            logger.info(
                "[%s]    Extracting signals for %s (%d segments, %.1fs talk time)…",
                _sid(session_id), sp, len(sp_segs), sp_talk
            )
            try:
                all_speakers_signals[sp] = SignalExtractor(audio_path, merged, sp).extract_all()
                logger.info("[%s]    ✓ %s extraction complete", _sid(session_id), sp)
            except Exception as sp_err:
                logger.error(
                    "[%s]    ✕ Signal extraction FAILED for %s: %s\n%s",
                    _sid(session_id), sp, sp_err, _tb.format_exc()
                )
                # Continue — don't let one speaker's failure abort the whole job

        signals = all_speakers_signals.get(confirmed_speaker)
        if signals is None:
            logger.warning(
                "[%s]    confirmed_speaker %s not in extracted signals — extracting now",
                _sid(session_id), confirmed_speaker
            )
            try:
                signals = SignalExtractor(audio_path, merged, confirmed_speaker).extract_all()
                all_speakers_signals[confirmed_speaker] = signals
                logger.info("[%s]    ✓ Fallback extraction for %s complete", _sid(session_id), confirmed_speaker)
            except Exception as fb_err:
                logger.error(
                    "[%s]    ✕ Fallback extraction FAILED for %s: %s\n%s",
                    _sid(session_id), confirmed_speaker, fb_err, _tb.format_exc()
                )
                raise

        if session_id in _cancelled:
            _cancelled.discard(session_id)
            if os.path.exists(audio_path):
                os.remove(audio_path)
            logger.info("[%s] ✕ Cancelled after signal extraction", _sid(session_id))
            return

        # ── Step 2: Dimension scoring ─────────────────────────────────
        logger.info("[%s] 2/4 Scoring behavioral dimensions...", _sid(session_id))
        emit("scoring", "Scoring behavioral dimensions…")
        dimensions = dimension_scorer.score_all(signals)
        logger.info("[%s]    Dimensions: %s", _sid(session_id), {k: round(v, 3) for k, v in (dimensions or {}).items()})

        # ── Step 3: Context detection + insight generation ────────────
        logger.info("[%s] 3/4 Detecting context + generating insights...", _sid(session_id))
        emit("generating", "Generating insights with AI…")
        sample_text = _sample_transcript(merged)
        full_text = _full_transcript(merged)

        if not sample_text.strip():
            logger.warning("[%s]    WARNING: sample_text is EMPTY — transcript may be blank", _sid(session_id))

        conversation_types = context_detector.detect(sample_text)
        primary_context = conversation_types[0]
        logger.info("[%s]    Context: %s (primary: %s)", _sid(session_id), conversation_types, primary_context)

        baseline = _get_context_baseline(user_id, primary_context)
        session_history = _get_user_session_history(user_id)
        resonance_calibration = _get_resonance_calibration(user_id)

        logger.info("[%s]    Calling insight_gen.generate...", _sid(session_id))
        insights = insight_gen.generate(
            signals, primary_context, baseline, full_text, dimensions,
            session_history=session_history,
            resonance_calibration=resonance_calibration,
            conversation_types=conversation_types,
        )
        logger.info("[%s]    ✓ Insights generated (%d keys)", _sid(session_id), len(insights))

        fingerprint = insights.pop("fingerprint", None)

        # ── Step 4: Reflection questions ──────────────────────────────
        logger.info("[%s] 4/4 Generating reflection questions...", _sid(session_id))
        emit("reflecting", "Generating reflection questions…")
        reflection_questions = insight_gen.generate_reflection_questions(
            signals, insights, full_text, primary_context
        )
        if reflection_questions:
            insights["reflection_questions"] = reflection_questions
            logger.info("[%s]    ✓ %d reflection questions generated", _sid(session_id), len(reflection_questions))
        else:
            logger.warning("[%s]    WARNING: No reflection questions returned", _sid(session_id))

        # ── Persist ───────────────────────────────────────────────────
        _update_voiceprint(user_id, audio_path, diarization, confirmed_speaker)
        _save_session(
            session_id, user_id, signals, insights, dimensions,
            primary_context, filename, confirmed_speaker,
            speaker_confirmed=True,
            fingerprint=fingerprint,
            all_speakers_signals=all_speakers_signals
        )
        logger.info("[%s]    ✓ Session saved to Supabase", _sid(session_id))

        # Trigger background consolidation if user has enough sessions
        try:
            count_res = supabase_admin.table("sessions").select(
                "id", count="exact"
            ).eq("user_id", user_id).execute()
            session_count = count_res.count or 0
            if session_count >= 12:
                threading.Thread(
                    target=_maybe_consolidate,
                    args=(user_id, session_count),
                    daemon=True
                ).start()
        except Exception:
            pass

        if os.path.exists(audio_path):
            os.remove(audio_path)
        del _prepare_cache[session_id]

        # Evict profile caches so the next GET /api/profile regenerates with the new session
        for key in list(_personality_cache.keys()):
            if key.startswith(f"{user_id}:"):
                del _personality_cache[key]
        for key in list(_mirror_feed_cache.keys()):
            if key.startswith(f"{user_id}:"):
                del _mirror_feed_cache[key]

        logger.info("[%s] ✓ Finalize complete — confirmed_speaker: %s", _sid(session_id), confirmed_speaker)
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
        }

        if job_key in _jobs:
            _jobs[job_key].put({"event": "done", "data": result_data})

    except Exception as e:
        if os.path.exists(audio_path):
            os.remove(audio_path)
        _prepare_cache.pop(session_id, None)
        logger.error("[%s] ✕ Finalize error: %s\n%s", _sid(session_id), e, _tb.format_exc())
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


# ── Cancel ───────────────────────────────────────────────────────

@app.delete("/api/jobs/{session_id}")
async def cancel_job(session_id: str, user_id: str = Depends(get_current_user)):
    _cancelled.add(session_id)
    _jobs.pop(session_id, None)
    _jobs.pop(f"finalize_{session_id}", None)
    cached = _prepare_cache.pop(session_id, None)
    if cached:
        path = cached.get("audio_path", "")
        if path and os.path.exists(path):
            os.remove(path)
    print(f"[{_sid(session_id)}] ✕ Cancelled by user")
    return {"status": "cancelled"}


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

    print(f"[{_sid(session_id)}] ▶ Re-analyzing as {confirmed_speaker}...")
    baseline = _get_context_baseline(user_id, primary_context)
    session_history = _get_user_session_history(user_id)
    resonance_calibration = _get_resonance_calibration(user_id)
    dimensions = dimension_scorer.score_all(signals)

    # Re-analysis uses existing fingerprint as transcript context if no merged_json
    existing_fingerprint = json.loads(session["fingerprint_json"]) if session.get("fingerprint_json") else None
    transcript_text = existing_fingerprint or ""

    insights = insight_gen.generate(
        signals, primary_context, baseline, transcript_text, dimensions,
        session_history=session_history,
        resonance_calibration=resonance_calibration,
        conversation_types=conversation_types,
    )

    fingerprint = insights.pop("fingerprint", existing_fingerprint)

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
        "fingerprint_json": json.dumps(fingerprint) if fingerprint else None,
    }).eq("id", session_id).execute()

    print(f"[{_sid(session_id)}] ✓ Re-analysis done")
    return {
        "session_id": session_id,
        "signals": signals,
        "insights": insights,
        "dimensions": dimensions,
        "filename": session.get("filename") or "recording",
        "detected_speaker": confirmed_speaker,
        "speaker_confirmed": True,
        "available_speakers": list(all_speakers_signals.keys()),
    }


# ── Session history ───────────────────────────────────────────────

@app.get("/api/sessions")
def get_sessions(user_id: str = Depends(get_current_user)):
    res = supabase_admin.table("sessions").select("*").eq(
        "user_id", user_id
    ).order("created_at", desc=True).execute()

    out = []
    for s in res.data:
        try:
            all_sp = json.loads(s["all_speakers_signals_json"]) if s.get("all_speakers_signals_json") else {}
            # Build a compact per-speaker timeline for the history chart.
            # Each speaker contributes their 60-second window timeline (wpm + speaking_time).
            speakers_timeline = {}
            for sp_id, sp_signals in all_sp.items():
                tl = sp_signals.get("timeline")
                if tl:
                    speakers_timeline[sp_id] = tl
            out.append({
                "session_id": s["id"],
                "context": s["context"],
                "filename": s.get("filename") or "recording",
                "detected_speaker": s.get("detected_speaker") or "SPEAKER_00",
                "speaker_confirmed": s.get("speaker_confirmed") or False,
                "created_at": s["created_at"],
                "insights": json.loads(s["insights_json"]),
                "signals": json.loads(s["signals_json"]),
                "dimensions": json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {},
                "available_speakers": list(all_sp.keys()),
                "speakers_timeline": speakers_timeline,
                "fingerprint": json.loads(s["fingerprint_json"]) if s.get("fingerprint_json") else None,
            })
        except Exception as e:
            print(f"[sessions] Skipping malformed session {s.get('id', '?')}: {e}")
    return out


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
        "id, context, created_at, signals_json, dimensions_json, insights_json, fingerprint_json, detected_speaker"
    ).eq("user_id", user_id).order("created_at", desc=False).execute()

    if len(res.data) < 1:
        return {
            "insufficient_data": True,
            "session_count": 0,
        }

    parsed = []
    for s in res.data:
        try:
            sig = json.loads(s["signals_json"])
            dims = json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {}
            ins = json.loads(s["insights_json"])
            fingerprint = json.loads(s["fingerprint_json"]) if s.get("fingerprint_json") else None
            parsed.append({
                "context": s["context"], "date": s["created_at"],
                "sig": sig, "dims": dims, "ins": ins,
                "fingerprint": fingerprint,
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

    # Pattern detection (needs 2+ sessions to establish consistency)
    patterns = []
    if n >= 2:
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

    _MF_VERSION = 4  # bump when tip field or prompt changes to invalidate old cache
    mf_cache_key = f"{user_id}:{n}:v{_MF_VERSION}"
    mirror_feed = _mirror_feed_cache.get(mf_cache_key)

    previous_feed: list = []  # existing feed passed as context when regenerating

    if mirror_feed is None:
        # Try Supabase cache
        try:
            mf_res = supabase_admin.table("user_profiles").select(
                "mirror_feed_json, mirror_feed_session_count"
            ).eq("user_id", user_id).execute()
            if mf_res.data:
                row = mf_res.data[0]
                if row.get("mirror_feed_session_count") == n * _MF_VERSION and row.get("mirror_feed_json"):
                    parsed_feed = json.loads(row["mirror_feed_json"])
                    if parsed_feed:  # discard any previously-cached empty lists
                        mirror_feed = parsed_feed
                # Always load previous feed (even if stale) so synthesizer can evolve it
                elif row.get("mirror_feed_json"):
                    try:
                        previous_feed = json.loads(row["mirror_feed_json"]) or []
                    except Exception:
                        previous_feed = []
        except Exception:
            pass

    if mirror_feed is None:
        def _session_text(p: dict) -> str:
            """Best available behavioral text for this session, richest first."""
            ins = p.get("ins", {})
            for val in [
                p.get("fingerprint"),
                ins.get("summary_sentence"),
                ins.get("conversation_summary"),
            ]:
                if val and isinstance(val, str) and val.strip() not in ("", "Session analyzed."):
                    return val.strip()
            # Last resort: compact signal summary so the session still contributes data
            try:
                sig = p["sig"]
                talk = round(sig["talk_ratio"]["user_ratio"] * 100)
                wpm = round(sig["speech_rate"]["overall_wpm"])
                filler = round(sig["filler_words"]["rate_per_100_words"], 1)
                return f"Talk ratio {talk}%, speech rate {wpm} wpm, filler rate {filler}/100 words."
            except Exception:
                return ""

        feed_sessions = [
            {
                "context": p["context"],
                "date": p["date"][:10],
                "fingerprint": _session_text(p),
                "notable_pattern": p["ins"].get("notable_pattern") or "",
            }
            for p in parsed
        ]
        user_summary = _get_user_summary(user_id)
        mirror_feed = mirror_feed_synth.synthesize(
            feed_sessions,
            user_summary=user_summary,
            existing_feed=previous_feed,
        )

        # Only cache a successful result — never persist an empty feed,
        # so a Groq failure or sparse-data session doesn't suppress the feed permanently.
        if mirror_feed:
            try:
                supabase_admin.table("user_profiles").upsert({
                    "user_id": user_id,
                    "mirror_feed_json": json.dumps(mirror_feed),
                    "mirror_feed_session_count": n * _MF_VERSION,
                    "updated_at": _utcnow(),
                }).execute()
            except Exception:
                pass
            _mirror_feed_cache[mf_cache_key] = mirror_feed
        else:
            mirror_feed = []  # return empty to caller but don't cache it

    if mirror_feed and mf_cache_key not in _mirror_feed_cache:
        _mirror_feed_cache[mf_cache_key] = mirror_feed

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
        "mirror_feed": mirror_feed,
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

    # Evict all cached profile data for this user — session count has changed
    for key in list(_personality_cache.keys()):
        if key.startswith(f"{user_id}:"):
            del _personality_cache[key]
    for key in list(_mirror_feed_cache.keys()):
        if key.startswith(f"{user_id}:"):
            del _mirror_feed_cache[key]

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


def _get_user_session_history(user_id: str, limit: int = 8) -> list:
    """Return session history for cross-session context.
    If a consolidated summary exists (12+ sessions), returns it + last 3 individual fingerprints.
    Otherwise returns last N individual fingerprints.
    """
    user_summary = _get_user_summary(user_id)

    fetch_limit = 3 if user_summary else limit
    res = supabase_admin.table("sessions").select(
        "context, created_at, fingerprint_json, insights_json"
    ).eq("user_id", user_id).order("created_at", desc=True).limit(fetch_limit).execute()

    recent = []
    for s in reversed(res.data):  # oldest first
        try:
            fingerprint = None
            if s.get("fingerprint_json"):
                fingerprint = json.loads(s["fingerprint_json"])
            if not fingerprint and s.get("insights_json"):
                ins = json.loads(s["insights_json"])
                fingerprint = ins.get("summary_sentence") or ins.get("conversation_summary")
            if fingerprint:
                recent.append({
                    "context": s["context"],
                    "date": s["created_at"][:10],
                    "fingerprint": fingerprint,
                })
        except Exception:
            continue

    if user_summary:
        return [{"context": "profile", "date": "consolidated",
                 "fingerprint": f"CONSOLIDATED BEHAVIORAL PROFILE:\n{user_summary}"}] + recent
    return recent


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


# ── User summary consolidation ────────────────────────────────────────

def _generate_user_summary(fingerprints: list) -> str:
    """LLM call: consolidate all session fingerprints into one behavioral summary."""
    ctx_map: dict = {}
    for fp in fingerprints:
        ctx_map.setdefault(fp["context"], []).append(fp)

    blocks = []
    for ctx, items in ctx_map.items():
        label = ctx.replace("_", " ").title()
        block = f"{label} ({len(items)} sessions):\n"
        for item in items:
            block += f"  {item['date']}: {item['fingerprint']}\n"
        blocks.append(block)

    prompt = f"""You are building a consolidated behavioral profile from {len(fingerprints)} recorded conversations.

SESSIONS BY CONTEXT:
{''.join(blocks)}

TASK: Write a single comprehensive behavioral summary of this person — 400–600 words.

Cover:
- Their core behavioral tendencies that appear regardless of context
- How they show up differently across different types of conversations (if multiple contexts exist)
- Recurring strengths — what they do consistently well
- Recurring blind spots or development areas that appear across multiple sessions
- How their behavior has evolved from their earliest sessions to their most recent ones

RULES:
1. Be specific — reference what was actually observed, not generic descriptions
2. Write in third person ("this person", "they", "their") — this is a reference document, not a direct address
3. Do not use raw numbers — translate signals into behavioral descriptions
4. Be honest about both strengths and gaps
5. Output plain text only — no JSON, no markdown headers, no bullet points"""

    try:
        response = personality_synth.client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=900,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return ""


def _maybe_consolidate(user_id: str, session_count: int) -> None:
    """Run in background thread. Consolidates fingerprints into user_summary_json
    at 12+ sessions, then refreshes every 5 new sessions."""
    if session_count < 12:
        return
    try:
        profile_res = supabase_admin.table("user_profiles").select(
            "user_summary_json, summary_session_count"
        ).eq("user_id", user_id).execute()

        existing = profile_res.data[0] if profile_res.data else {}
        last_count = existing.get("summary_session_count") or 0

        # Skip if summary is recent enough (within 5 sessions)
        if existing.get("user_summary_json") and (session_count - last_count) < 5:
            return

        fp_res = supabase_admin.table("sessions").select(
            "context, created_at, fingerprint_json"
        ).eq("user_id", user_id).order("created_at", desc=False).execute()

        fingerprints = []
        for s in fp_res.data:
            if s.get("fingerprint_json"):
                try:
                    fp = json.loads(s["fingerprint_json"])
                    if fp:
                        fingerprints.append({
                            "context": s["context"],
                            "date": s["created_at"][:10],
                            "fingerprint": fp,
                        })
                except Exception:
                    continue

        if len(fingerprints) < 10:
            return

        summary = _generate_user_summary(fingerprints)
        if not summary:
            return

        supabase_admin.table("user_profiles").upsert({
            "user_id": user_id,
            "user_summary_json": summary,
            "summary_session_count": session_count,
        }).execute()
        print(f"[consolidation] Updated user summary for {user_id} at {session_count} sessions.")
    except Exception as e:
        print(f"[consolidation] Failed for {user_id}: {e}")


def _get_user_summary(user_id: str) -> str | None:
    """Return consolidated behavioral summary if it exists."""
    try:
        res = supabase_admin.table("user_profiles").select(
            "user_summary_json"
        ).eq("user_id", user_id).execute()
        if res.data and res.data[0].get("user_summary_json"):
            return res.data[0]["user_summary_json"]
    except Exception:
        pass
    return None


def _full_transcript(merged: list) -> str:
    """Format complete diarized transcript as speaker-labeled lines."""
    return "\n".join(
        f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '').strip()}"
        for s in merged
        if s.get("text", "").strip()
    )


def _sample_transcript(merged: list, max_segments: int = 60) -> str:
    """Short transcript sample — used only for context detection."""
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
    speaker_confirmed=True, fingerprint=None, all_speakers_signals=None
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
        "fingerprint_json": json.dumps(fingerprint) if fingerprint else None,
        "all_speakers_signals_json": json.dumps(all_speakers_signals) if all_speakers_signals else None,
    }).execute()
