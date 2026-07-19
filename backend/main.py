from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Depends
from pydantic import BaseModel
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

from pipeline.transcriber import Transcriber
from pipeline.diarizer import Diarizer
from pipeline.signal_extractor import SignalExtractor
from pipeline.insight_generator import InsightGenerator
from pipeline.dimension_scorer import DimensionScorer
from pipeline.voiceprint import VoiceprintMatcher
from pipeline.context_detector import ContextDetector
from pipeline.portrait_synthesizer import PortraitSynthesizer
from pipeline.evidence_gate import (
    SIGNAL_EVIDENCE_CONFIG, SUB_SIGNAL_EVIDENCE_CONFIG, compute_evidence, extract_value,
    COMPOSITE_CONFIG, compute_composite_position
)
from pipeline import home_feed
from pipeline.trigger_detector import run_trigger_detection
from pipeline.llm_utils import extract_text
from anthropic import Anthropic
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

# Per-job watchdog timers — cancelled when job completes normally
_job_timers: dict = {}
_JOB_TIMEOUT_S = 25 * 60  # 25 minutes — matches the 25-min recording chunk size


def _start_job_timeout(job_key: str, cancel_id: str):
    """After _JOB_TIMEOUT_S, inject cancel_id into _cancelled if the job is still running."""
    def _expire():
        if job_key in _jobs:
            logger.warning("[timeout] Job %s timed out after %ds — cancelling", job_key[:12], _JOB_TIMEOUT_S)
            _cancelled.add(cancel_id)
        _job_timers.pop(job_key, None)
    t = threading.Timer(_JOB_TIMEOUT_S, _expire)
    t.daemon = True
    t.start()
    _job_timers[job_key] = t


def _cancel_job_timeout(job_key: str):
    t = _job_timers.pop(job_key, None)
    if t:
        t.cancel()


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
transcriber = Transcriber(api_key=os.getenv("DEEPGRAM_API_KEY"))
diarizer = Diarizer(hf_token=os.getenv("HF_TOKEN"))
insight_gen = InsightGenerator(api_key=os.getenv("ANTHROPIC_API_KEY"))
context_detector = ContextDetector(api_key=os.getenv("ANTHROPIC_API_KEY"))
dimension_scorer = DimensionScorer()
voiceprint_matcher = VoiceprintMatcher(hf_token=os.getenv("HF_TOKEN"))
portrait_synth = PortraitSynthesizer(api_key=os.getenv("ANTHROPIC_API_KEY"))
anthropic_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
print("[startup] All models loaded. Server ready.")

# In-memory caches — cleared on server restart, Supabase is the durable layer.
# All three keyed by user_id alone (not session_count) — none of these
# regenerate every session anymore, they check their own stored
# session_count_at_synthesis against a refresh interval instead. Each value is
# a (payload, session_count_at_synthesis) tuple.
_portrait_cache: dict = {}      # signals + context_shifts (_get_or_synthesize_portrait)
_paragraph_cache: dict = {}     # portrait paragraph + tags (_get_or_refresh_portrait_paragraph)
_coaching_cache: dict = {}      # coaching synthesis (_get_or_synthesize_coaching)


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


def _compute_profile_evidence(parsed: list) -> dict:
    """Evidence-gated signal aggregation for the You page's standing portrait.
    Reuses the same `parsed` session list /api/profile already fetched — no new
    query. Computes 'overall' (pooled across all contexts) and 'by_context'
    (grouped) evidence for each of the 9 relational signals, per CLAUDE.md rule
    #3 (gate on accumulated evidence per signal, never session count) and rule
    #4 (self-relative only — no population comparison anywhere here).

    Each steady signal in `by_context` (not `overall`) also gets a recent-vs-
    established mean comparison (last 3 sessions vs the full rolling-window mean,
    within that single context) — this powers Home feed "progress" cards later.
    Deliberately NOT computed on the cross-context pool: a run of recent sessions
    in a different context would drag the "recent" average in a way that has
    nothing to do with genuine behavioral change.
    """
    from collections import defaultdict as _dd

    def _signal_values(sessions):
        values_by_signal = {k: [] for k in SIGNAL_EVIDENCE_CONFIG}
        for p in sessions:
            for signal_key in SIGNAL_EVIDENCE_CONFIG:
                try:
                    values_by_signal[signal_key].append(extract_value(signal_key, p["sig"]))
                except (KeyError, TypeError):
                    pass
        return values_by_signal

    def _evidence_for(sessions, compute_shift: bool) -> dict:
        values_by_signal = _signal_values(sessions)
        result = {}
        for signal_key, values in values_by_signal.items():
            ev = compute_evidence(signal_key, values)  # filters None internally; dispatches continuous/categorical
            is_categorical = SIGNAL_EVIDENCE_CONFIG[signal_key]["kind"] == "categorical"
            non_none = [v for v in values if v is not None]  # chronological, oldest→newest
            # recent-vs-established shift is only meaningful for a continuous
            # signal (needs a numeric mean) — categorical dims (pacing_arc,
            # energy_arc) express "progress" via drift/context-shift events
            # instead, not a shift_pct card. Also only computed here for a
            # SINGLE context (see by_context below) — computing it on the
            # cross-context pool is misleading: a run of e.g. social sessions
            # can drag the "recent" average down for reasons that have nothing
            # to do with a genuine behavioral shift, just a different
            # conversation type happening recently. Self-relative framing has
            # to stay within one context.
            if not is_categorical and compute_shift and ev["is_steady"] and len(non_none) >= 3:
                recent = non_none[-3:]
                ev["recent_mean"] = round(float(np.mean(recent)), 3)
                ev["shift_pct"] = (
                    round((ev["recent_mean"] - ev["mean"]) / ev["mean"] * 100, 1)
                    if ev["mean"] else None
                )
            else:
                ev["recent_mean"] = None
                ev["shift_pct"] = None
            result[signal_key] = ev
        return result

    # compute_shift=True here (unlike its original by-context-only use) feeds
    # Shape's established-vs-recent overlay on the You page — a quiet visual
    # glance, not a worded claim, and not an input to trigger_detector.py's
    # actual drift detection (which stays correctly by-context). Accepting
    # the same context-clustering imprecision _evidence_for's own comment
    # warns about below is a deliberate, lower-stakes tradeoff for this
    # specific consumer, not an oversight of that comment.
    overall = _evidence_for(parsed, compute_shift=True)

    ctx_map: dict = _dd(list)
    for p in parsed:
        ctx_map[p["context"]].append(p)
    by_context = {ctx: _evidence_for(items, compute_shift=True) for ctx, items in ctx_map.items()}

    return {"overall": overall, "by_context": by_context}


def _compute_sub_signal_evidence(parsed: list) -> dict:
    """Evidence for the 3 fold-in sub-signals (question_pickup, gets_interrupted,
    long_turn_rate) — pooled only, no by_context split (subs don't get their own
    context-shift treatment, see evidence_gate.SUB_SIGNAL_EVIDENCE_CONFIG). Kept
    separate from _compute_profile_evidence's main 15-dimension dicts so the
    You-page steady/still-forming lists and profile_strength_pct stay scoped to
    the real dimensions — this is only consumed for sub-note gating (e.g.
    portrait_synthesizer's "how it may land" section)."""
    result = {}
    for sub_key in SUB_SIGNAL_EVIDENCE_CONFIG:
        values = []
        for p in parsed:
            try:
                values.append(extract_value(sub_key, p["sig"]))
            except (KeyError, TypeError):
                pass
        result[sub_key] = compute_evidence(sub_key, values, SUB_SIGNAL_EVIDENCE_CONFIG)
    return result


_PORTRAIT_REFRESH_INTERVAL = 3  # sessions between refreshes — shared cadence for
# the signals/context-shift synthesis below, the portrait paragraph+tags, and
# coaching synthesis. Was: regenerated every single session (cache key included
# session_count, guaranteeing a miss each time) — recadenced so Reflected Back /
# How You Shift By Context stop rewriting on every session and stay in sync with
# the paragraph instead of visibly lagging behind it.


def _get_or_synthesize_portrait(user_id: str, session_count: int, evidence: dict,
                                blind_spots: list, parsed: list) -> dict:
    """Evidence-based replacement for the old dimension-scoring personality
    synthesis (retired). Reuses the user_profiles.personality_json /
    session_count_at_synthesis columns (repurposed, different shape — no schema
    change needed) since nothing else writes to them anymore. Cached in memory
    by user_id alone (not session_count) since it no longer regenerates every
    session — recency is checked inside the function against the stored
    session_count_at_synthesis instead of via a session-count-keyed cache miss.
    """
    if user_id in _portrait_cache:
        cached_portrait, cached_session_count = _portrait_cache[user_id]
        if session_count - cached_session_count < _PORTRAIT_REFRESH_INTERVAL:
            return cached_portrait

    try:
        result = supabase_admin.table("user_profiles") \
            .select("personality_json, session_count_at_synthesis") \
            .eq("user_id", user_id).execute()
        if result.data:
            row = result.data[0]
            raw_pj = row.get("personality_json")
            stored_session_count = row.get("session_count_at_synthesis")
            if raw_pj and stored_session_count is not None \
                    and session_count - stored_session_count < _PORTRAIT_REFRESH_INTERVAL:
                portrait = json.loads(raw_pj)
                _portrait_cache[user_id] = (portrait, stored_session_count)
                return portrait
    except Exception:
        pass

    sub_evidence = _compute_sub_signal_evidence(parsed)
    portrait = portrait_synth.synthesize(evidence, blind_spots, session_count, sub_evidence)
    _portrait_cache[user_id] = (portrait, session_count)

    try:
        supabase_admin.table("user_profiles").upsert({
            "user_id": user_id,
            "session_count_at_synthesis": session_count,
            "personality_json": json.dumps(portrait),
            "updated_at": _utcnow(),
        }).execute()
    except Exception:
        pass

    return portrait


def _get_or_refresh_portrait_paragraph(user_id: str, session_count: int, evidence: dict) -> dict:
    """Standing narrative paragraph + tag chips (You page, page position #2).
    Same refresh-interval cadence as _get_or_synthesize_portrait above, but a
    separate cache/column since it's a self-referential call (needs its own
    previous output as input) and gated independently. session_count_at_synthesis
    is stored INSIDE portrait_paragraph_json itself rather than as a second DB
    column, since user_profiles already has a column by that name used by the
    signals/context-shift portrait above.
    """
    if user_id in _paragraph_cache:
        cached_result, cached_session_count = _paragraph_cache[user_id]
        if session_count - cached_session_count < _PORTRAIT_REFRESH_INTERVAL:
            return cached_result

    previous_text = None
    try:
        result = supabase_admin.table("user_profiles") \
            .select("portrait_paragraph_json") \
            .eq("user_id", user_id).execute()
        if result.data:
            raw = result.data[0].get("portrait_paragraph_json")
            if raw:
                stored = json.loads(raw)
                previous_text = stored.get("text")
                stored_session_count = stored.get("session_count_at_synthesis")
                if stored_session_count is not None \
                        and session_count - stored_session_count < _PORTRAIT_REFRESH_INTERVAL:
                    cached_payload = {"text": stored.get("text"), "tags": stored.get("tags", [])}
                    _paragraph_cache[user_id] = (cached_payload, stored_session_count)
                    return cached_payload
    except Exception:
        pass

    synthesized = portrait_synth.synthesize_paragraph(evidence, previous_text, session_count)
    _paragraph_cache[user_id] = (synthesized, session_count)

    if synthesized.get("text"):
        try:
            supabase_admin.table("user_profiles").upsert({
                "user_id": user_id,
                "portrait_paragraph_json": json.dumps({
                    "text": synthesized["text"],
                    "tags": synthesized.get("tags", []),
                    "session_count_at_synthesis": session_count,
                }),
                "updated_at": _utcnow(),
            }).execute()
        except Exception:
            pass

    return synthesized


_COACHING_MIN_SESSIONS = 3     # matches the app's lowest sample floor elsewhere
_COACHING_MIN_RECURRENCE = 2   # a single session's advice isn't a pattern yet


def _group_coaching_suggestions(parsed: list) -> dict:
    """Groups every session's coaching_suggestions by dimension_key, keeping
    only groups that recurred in >=_COACHING_MIN_RECURRENCE separate sessions.
    Sessions predating the dimension_key schema addition are silently excluded
    from grouping (no key to group by) — not an error, just not yet eligible.
    """
    from collections import defaultdict as _dd
    grouped: dict = _dd(list)
    for p in parsed:
        suggestions = (p.get("ins") or {}).get("coaching_suggestions", [])
        for s in suggestions:
            dimension_key = s.get("dimension_key")
            if not dimension_key:
                continue
            grouped[dimension_key].append({
                "issue": s.get("issue", ""),
                "suggestion": s.get("suggestion", ""),
                "why_it_matters": s.get("why_it_matters", ""),
            })
    return {k: v for k, v in grouped.items() if len(v) >= _COACHING_MIN_RECURRENCE}


def _get_or_synthesize_coaching(user_id: str, session_count: int, parsed: list) -> dict:
    """Where You Might Grow (You page, page position #7). Gated at
    >=_COACHING_MIN_SESSIONS and requires at least one dimension recurring in
    >=_COACHING_MIN_RECURRENCE sessions' coaching_suggestions. Same
    session_count_at_synthesis-embedded-in-JSON pattern as the paragraph
    above, own cache/column since it's a genuinely separate LLM call (raw
    per-session text, not evidence-gated numeric means).
    """
    if session_count < _COACHING_MIN_SESSIONS:
        return {"items": []}

    if user_id in _coaching_cache:
        cached_result, cached_session_count = _coaching_cache[user_id]
        if session_count - cached_session_count < _PORTRAIT_REFRESH_INTERVAL:
            return cached_result

    try:
        result = supabase_admin.table("user_profiles") \
            .select("coaching_synthesis_json") \
            .eq("user_id", user_id).execute()
        if result.data:
            raw = result.data[0].get("coaching_synthesis_json")
            if raw:
                stored = json.loads(raw)
                stored_session_count = stored.get("session_count_at_synthesis")
                if stored_session_count is not None \
                        and session_count - stored_session_count < _PORTRAIT_REFRESH_INTERVAL:
                    cached_payload = {"items": stored.get("items", [])}
                    _coaching_cache[user_id] = (cached_payload, stored_session_count)
                    return cached_payload
    except Exception:
        pass

    grouped = _group_coaching_suggestions(parsed)
    synthesized = portrait_synth.synthesize_coaching(grouped, session_count)
    _coaching_cache[user_id] = (synthesized, session_count)

    try:
        supabase_admin.table("user_profiles").upsert({
            "user_id": user_id,
            "coaching_synthesis_json": json.dumps({
                "items": synthesized.get("items", []),
                "session_count_at_synthesis": session_count,
            }),
            "updated_at": _utcnow(),
        }).execute()
    except Exception:
        pass

    return synthesized


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
  <p style="color:#4a4d6a;font-size:14px;">Mirror: Voice Insights &nbsp;·&nbsp; Effective 16 June 2026</p>

  <div class="highlight">
    <strong>The short version:</strong> Your audio is written to temporary storage during processing and permanently deleted the moment analysis is complete. We never store, sell, or share your recordings.
  </div>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Email address</strong> — used solely for account authentication via Supabase.</li>
    <li><strong>Audio recordings</strong> — uploaded or recorded by you for analysis. Written to temporary server storage during processing and permanently deleted once analysis is complete. Never retained long-term.</li>
    <li><strong>Behavioural analysis results</strong> — transcripts, speaker patterns, dimension scores, and insights generated from your recordings. Stored in your account so you can track trends over time.</li>
    <li><strong>Voiceprint embedding (optional)</strong> — if you choose to use the voice training feature, a mathematical representation of your voice (not a recording itself) is stored to help identify which speaker is you in uploaded files. This is entirely optional, can be skipped, and can be deleted at any time.</li>
  </ul>

  <h2>What we do not collect</h2>
  <ul>
    <li>We do not retain raw audio after analysis is complete.</li>
    <li>We do not sell, rent, or share your data with third parties for advertising or marketing.</li>
    <li>We do not track your browsing activity or behaviour outside of the Mirror extension.</li>
    <li>We do not record any conversation automatically — recording always requires an explicit action from you.</li>
  </ul>

  <h2>How your data is processed</h2>
  <p>When you submit a recording, it is sent securely to our processing server. The following steps occur:</p>
  <ul>
    <li>Audio is written to temporary server storage and transcribed using the <strong>Deepgram API</strong> (Deepgram's privacy policy applies to transcription; transcription requests are opted out of Deepgram's model-improvement program).</li>
    <li>Speaker diarization and voice analysis are performed using <strong>pyannote.audio</strong> models running on our server.</li>
    <li>Behavioural insights are generated using <strong>Anthropic's Claude API</strong>.</li>
    <li>The audio file is permanently deleted from the server immediately once processing is complete.</li>
  </ul>
  <p>Analysis results (not the audio) are stored in your account database hosted on <strong>Supabase</strong>, a GDPR-compliant cloud database provider.</p>

  <h2>Google Meet integration</h2>
  <p>When using Mirror with Google Meet, the extension can capture audio from your meeting tab only when you explicitly click the Record button. Before your first recording, the extension displays a consent prompt reminding you that you are responsible for ensuring all meeting participants are aware the conversation is being recorded. Audio is never captured automatically or without your knowledge. The same data handling rules apply: audio is processed and permanently deleted; only the resulting insights are stored.</p>

  <h2>Third-party services</h2>
  <ul>
    <li><strong>Supabase</strong> — authentication and database storage. <a href="https://supabase.com/privacy" target="_blank">Privacy policy</a>.</li>
    <li><strong>Deepgram</strong> — speech transcription. <a href="https://deepgram.com/privacy-policy" target="_blank">Privacy policy</a>.</li>
    <li><strong>Anthropic</strong> — language model inference for behavioural insights. <a href="https://www.anthropic.com/legal/privacy" target="_blank">Privacy policy</a>.</li>
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

  <p class="meta">Mirror: Voice Insights &nbsp;·&nbsp; Privacy Policy &nbsp;·&nbsp; Last updated 16 June 2026</p>

</div>
</body>
</html>"""


# ── Usage ─────────────────────────────────────────────────────────

@app.get("/api/usage")
async def get_usage(user_id: str = Depends(get_current_user)):
    from datetime import timedelta
    limit = 15
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month = (month_start + timedelta(days=32)).replace(day=1)
    res = supabase_admin.table("sessions") \
        .select("id", count="exact") \
        .eq("user_id", user_id) \
        .gte("created_at", month_start.isoformat()) \
        .execute()
    used = res.count or 0
    return {
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "resets_on": next_month.strftime("%b 1"),
    }


# ── SSE Step 1: Start prepare job ────────────────────────────────

@app.post("/api/prepare/start")
async def start_prepare_session(
    audio: UploadFile = File(...),
    filename: str = Form("recording"),
    speaker_timeline: Optional[str] = Form(None),
    mic_audio: Optional[UploadFile] = File(None),
    user_id: str = Depends(get_current_user)
):
    _cleanup_stale_cache()

    # ── Monthly session cap ───────────────────────────────────────────
    _SESSION_MONTHLY_LIMIT = 15
    _month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    _usage_res = supabase_admin.table("sessions") \
        .select("id", count="exact") \
        .eq("user_id", user_id) \
        .gte("created_at", _month_start) \
        .execute()
    if (_usage_res.count or 0) >= _SESSION_MONTHLY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"You've used all {_SESSION_MONTHLY_LIMIT} sessions for this month. Your limit resets on the 1st."
        )

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
    if _duration_s > 1800:
        os.remove(audio_path)
        raise HTTPException(
            status_code=400,
            detail="Recording exceeds the 30-minute limit. Please trim and re-upload."
        )

    # Parse WebRTC speaker timeline if provided (skips pyannote diarization)
    parsed_timeline = None
    if speaker_timeline:
        try:
            parsed_timeline = json.loads(speaker_timeline)
            print(f"[{_sid(session_id)}] ▶ WebRTC speaker timeline provided ({len(parsed_timeline)} events)")
        except Exception:
            parsed_timeline = None

    # Mic stream (the user's own voice) — saved separately from the tab/room audio above.
    # Transcribed independently in _run_prepare_job and never merged into the tab-based
    # transcript/diarization fields; it's proof-of-capture only at this stage.
    mic_audio_path = None
    mic_duration_s = None
    if mic_audio is not None:
        mic_temp_path = f"{UPLOAD_DIR}/{session_id}_mic_temp"
        mic_audio_path = f"{UPLOAD_DIR}/{session_id}_mic.wav"
        mic_contents = await mic_audio.read()
        if mic_contents:
            with open(mic_temp_path, "wb") as f:
                f.write(mic_contents)
            subprocess.run(
                ["ffmpeg", "-i", mic_temp_path, "-ar", "16000", "-ac", "1", "-y", mic_audio_path],
                capture_output=True
            )
            os.remove(mic_temp_path)
            with wave.open(mic_audio_path, "r") as _mic_wf:
                mic_duration_s = _mic_wf.getnframes() / _mic_wf.getframerate()
            print(
                f"[{_sid(session_id)}] ▶ Mic audio received ({len(mic_contents)} bytes, "
                f"{mic_duration_s:.1f}s after conversion)"
            )
        else:
            mic_audio_path = None

    job_q: stdlib_queue.Queue = stdlib_queue.Queue()
    _jobs[session_id] = job_q

    threading.Thread(
        target=_run_prepare_job,
        args=(session_id, audio_path, user_id, filename, _duration_s, parsed_timeline,
              mic_audio_path, mic_duration_s),
        daemon=True
    ).start()
    _start_job_timeout(session_id, session_id)

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


def _run_prepare_job(session_id, audio_path, user_id, filename, audio_duration_s=None,
                      speaker_timeline=None, mic_audio_path=None, mic_duration_s=None):
    def emit(step, message):
        if session_id in _jobs:
            _jobs[session_id].put({"event": "progress", "step": step, "message": message})
        if session_id in _prepare_cache:
            _prepare_cache[session_id]["current_step"] = step

    try:
        if session_id in _cancelled:
            _cancelled.discard(session_id)
            _cancel_job_timeout(session_id)
            logger.info("[%s] ✕ Cancelled before start", _sid(session_id))
            if mic_audio_path and os.path.exists(mic_audio_path):
                os.remove(mic_audio_path)
            return

        # No WebRTC speaker timeline — pyannote/voiceprint diarization has been quarantined
        # off the live path (CLAUDE.md rule #1: no diarization/voiceprint guessing on live
        # recordings). Fail cleanly rather than silently falling back to speaker-guessing.
        if not speaker_timeline:
            logger.error(
                "[%s] ✕ No WebRTC speaker timeline provided — cannot process without it "
                "(pyannote fallback removed from the live path). WebRTC injection likely "
                "failed or hadn't detected any track yet for this recording.",
                _sid(session_id),
            )
            if mic_audio_path and os.path.exists(mic_audio_path):
                os.remove(mic_audio_path)
            if os.path.exists(audio_path):
                os.remove(audio_path)
            _cancel_job_timeout(session_id)
            if session_id in _jobs:
                _jobs[session_id].put({
                    "event": "error",
                    "message": "Couldn't detect meeting audio for this recording. "
                                "Please reload the Meet tab and try recording again.",
                })
            return

        # ── Mic transcript (the user's own voice) — independent of the tab/room pipeline ──
        # Proof-only for now: transcribed and logged/returned, never merged into the
        # tab-based transcript/diarization/merged fields below. Kicked off in a background
        # thread so it runs CONCURRENTLY with the tab transcribe/diarize pipeline below rather
        # than adding its full duration on top — halves the extra latency from adding a second
        # ASR call, which otherwise raises the odds of the cached auth token going stale before
        # /api/finalize/start is reached. Raw mic audio is deleted immediately once resolved,
        # per the "discard room+mic audio after feature extraction" rule.
        mic_pool = None
        mic_future = None
        if mic_audio_path:
            logger.info("[%s] Transcribing MIC audio (user's own voice) in parallel...", _sid(session_id))
            emit("transcribing_mic", "Transcribing your voice…")
            mic_pool = ThreadPoolExecutor(max_workers=1)
            mic_future = mic_pool.submit(transcriber.transcribe, mic_audio_path)

        # WebRTC timeline is guaranteed present here (fail-fast above otherwise).
        speaker_labels = sorted({e["speaker"] for e in speaker_timeline})
        has_user_vad = "SPEAKER_00" in speaker_labels
        logger.info(
            "[%s] 1/2 Transcribing (WebRTC timeline provided: %d events, speakers: %s, has_user_vad: %s)",
            _sid(session_id), len(speaker_timeline), speaker_labels, has_user_vad,
        )
        if not has_user_vad:
            logger.warning(
                "[%s] WARNING: No SPEAKER_00 in WebRTC timeline — local mic was NOT captured by injector. "
                "Gap-fill will be used (may inflate user talk ratio).",
                _sid(session_id),
            )
        emit("transcribing", "Transcribing audio with Deepgram…")
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

        if session_id in _cancelled:
            _cancelled.discard(session_id)
            _cancel_job_timeout(session_id)
            if os.path.exists(audio_path): os.remove(audio_path)
            if mic_pool:
                mic_pool.shutdown(wait=False)
                if os.path.exists(mic_audio_path): os.remove(mic_audio_path)
            logger.info("[%s] ✕ Cancelled after transcription", _sid(session_id))
            return

        tab_merged = diarizer.merge_transcript_with_speakers(
            transcript["segments"], diarization
        )
        logger.info("[%s]    Tab-derived merged transcript: %d segments", _sid(session_id), len(tab_merged))

        unique_speakers = {s["speaker"] for s in diarization if s["speaker"] != "UNKNOWN"}
        logger.info("[%s] 2/2 Detecting voice (%d speakers found)...", _sid(session_id), len(unique_speakers))
        emit("detecting", "Detecting your voice…")

        # No voiceprint matching — the user is identified by construction (the mic stream),
        # never guessed via speaker embeddings. CLAUDE.md rule #1.
        voiceprint_match = None
        voiceprint_confidence = None
        detected_speaker = "SPEAKER_00"
        logger.info("[%s]    User auto-assigned to SPEAKER_00 (mic is the user, by construction)", _sid(session_id))

        # Retrieve the mic transcript now (moved earlier than before) — it's the source of
        # truth for the user's own speech, not a diagnostic-only side channel. Google Meet
        # never echoes your own voice back through the tab's own audio output, so the tab
        # recording structurally can't reliably contain it — only the OTHER participant(s).
        # The mic recording is isolated to the user by construction, so its own segments can
        # be used directly, with no VAD-timeline matching needed.
        mic_transcript = None
        if mic_future:
            try:
                mic_transcript = mic_future.result()
                mic_segs = mic_transcript.get("segments", [])
                last_end = mic_segs[-1]["end"] if mic_segs else 0.0
                logger.info(
                    "[%s]    Mic transcription done: %d segments — audio duration %.1fs, "
                    "last transcribed word ends at %.1fs (gap: %.1fs)",
                    _sid(session_id), len(mic_segs),
                    mic_duration_s or 0.0, last_end, (mic_duration_s or 0.0) - last_end,
                )
            except Exception as mic_err:
                logger.error("[%s]    ✕ Mic transcription FAILED: %s", _sid(session_id), mic_err)
                mic_transcript = None
            finally:
                mic_pool.shutdown(wait=False)
                if os.path.exists(mic_audio_path):
                    os.remove(mic_audio_path)

        mic_transcript_text = " ".join(
            seg["text"] for seg in mic_transcript.get("segments", [])
        ).strip() if mic_transcript else None

        # Other-speaker segments from the tab-derived merge — this part already works
        # correctly (tab audio faithfully captures everyone else), so it's kept as-is.
        other_speaker_segs = [s for s in tab_merged if s.get("speaker") != "SPEAKER_00"]
        tab_derived_user_segs = [s for s in tab_merged if s.get("speaker") == "SPEAKER_00"]

        mic_user_segs = []
        if mic_transcript:
            mic_user_segs = [
                {**seg, "speaker": "SPEAKER_00"} for seg in mic_transcript.get("segments", [])
            ]

        if mic_user_segs:
            user_segs_source = "mic"
            user_merged_segs = mic_user_segs
        else:
            # Graceful fallback — mic transcription unavailable/failed/empty. Degrade to the
            # old tab-VAD-attributed behavior rather than losing the user's data entirely.
            user_segs_source = "tab (fallback — mic unavailable)"
            user_merged_segs = tab_derived_user_segs

        merged = sorted(other_speaker_segs + user_merged_segs, key=lambda s: s["start"])

        logger.info(
            "[%s]    User segments: %d from %s (tab-derived alternative would have given %d)",
            _sid(session_id), len(user_merged_segs), user_segs_source, len(tab_derived_user_segs),
        )
        logger.info("[%s]    Merged transcript: %d segments", _sid(session_id), len(merged))
        if len(user_merged_segs) == 0:
            logger.warning(
                "[%s] WARNING: No user transcript segments found (mic or tab)! "
                "User's speech may not have been correctly attributed. "
                "Analysis will run but signals may be zero/empty.",
                _sid(session_id),
            )

        # TEMPORARY DEBUG — structural turn timeline only (speaker, timing, gaps —
        # never the transcript text itself, per the privacy rule on room content).
        # For visually verifying turn/gap structure during testing. Remove once
        # no longer needed.
        logger.info("[%s]    TURN TIMELINE (speaker, start-end, duration; gaps noted):", _sid(session_id))
        _prev_end, _prev_speaker = None, None
        for _seg in merged:
            if _prev_end is not None:
                _gap = _seg["start"] - _prev_end
                if _gap > 0.1:
                    _kind = "same speaker" if _prev_speaker == _seg["speaker"] else "speaker change"
                    logger.info("[%s]      ... gap %.2fs (%s) ...", _sid(session_id), _gap, _kind)
            logger.info(
                "[%s]      %-12s %7.2fs - %7.2fs  (%.2fs)",
                _sid(session_id), _seg["speaker"], _seg["start"], _seg["end"], _seg["end"] - _seg["start"],
            )
            _prev_end, _prev_speaker = _seg["end"], _seg["speaker"]

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
            # NEW, separate from the tab-based transcript above — never merged into it.
            "mic_transcript": mic_transcript,
        }

        result_data = {
            "session_id": session_id,
            "speakers": _build_speaker_samples(merged, diarization),
            "detected_speaker": detected_speaker,
            "voiceprint_match": voiceprint_match,
            "voiceprint_confidence": voiceprint_confidence,
            "mic_transcript": mic_transcript_text,
        }

        _cancel_job_timeout(session_id)
        if session_id in _jobs:
            _jobs[session_id].put({"event": "done", "data": result_data})
        logger.info("[%s] ✓ Prepare done — detected_speaker: %s", _sid(session_id), detected_speaker)

    except Exception as e:
        import traceback
        _cancel_job_timeout(session_id)
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if mic_pool:
            mic_pool.shutdown(wait=False)
        if mic_audio_path and os.path.exists(mic_audio_path):
            os.remove(mic_audio_path)
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
    _start_job_timeout(f"finalize_{session_id}", session_id)

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
            _cancel_job_timeout(f"finalize_{session_id}")
            logger.info("[%s] ✕ Cancelled before finalize", _sid(session_id))
            return

        # ── Step 1: Signal extraction ─────────────────────────────────
        # Only the confirmed user's own signals are ever extracted — CLAUDE.md
        # rule #8 ("never build a profile of the room"). This used to also run
        # full signal extraction for every other detected room participant
        # (up to MAX_SPEAKERS_TO_ANALYZE), persisting their behavioral signals
        # indefinitely in all_speakers_signals_json purely to power the old
        # diarization-era "Not you?" speaker-switcher — removed along with it.
        logger.info("[%s] 1/4 Extracting behavioral signals...", _sid(session_id))
        emit("extracting", "Extracting behavioral signals…")

        try:
            signals = SignalExtractor(audio_path, merged, confirmed_speaker).extract_all()
            logger.info("[%s]    ✓ Signal extraction complete", _sid(session_id))
        except Exception as sig_err:
            logger.error(
                "[%s]    ✕ Signal extraction FAILED: %s\n%s",
                _sid(session_id), sig_err, _tb.format_exc()
            )
            raise

        if session_id in _cancelled:
            _cancelled.discard(session_id)
            _cancel_job_timeout(f"finalize_{session_id}")
            if os.path.exists(audio_path):
                os.remove(audio_path)
            logger.info("[%s] ✕ Cancelled after signal extraction", _sid(session_id))
            return

        # ── Step 2: Dimension scoring ─────────────────────────────────
        logger.info("[%s] 2/3 Scoring behavioral dimensions...", _sid(session_id))
        emit("scoring", "Scoring behavioral dimensions…")
        dimensions = dimension_scorer.score_all(signals)
        logger.info("[%s]    Dimensions: %s", _sid(session_id), list((dimensions or {}).keys()))

        # ── Step 3: Context detection + insight generation ────────────
        logger.info("[%s] 3/3 Detecting context + generating insights...", _sid(session_id))
        emit("generating", "Generating insights with AI…")
        sample_text = _sample_transcript(merged)
        full_text = _full_transcript(merged)

        if not sample_text.strip():
            logger.warning("[%s]    WARNING: sample_text is EMPTY — transcript may be blank", _sid(session_id))

        conversation_types = context_detector.detect(sample_text)
        primary_context = conversation_types[0]
        logger.info("[%s]    Context: %s (primary: %s)", _sid(session_id), conversation_types, primary_context)

        evidence = _get_context_evidence(user_id, primary_context)
        session_history = _get_user_session_history(user_id)
        resonance_calibration = _get_resonance_calibration(user_id)

        logger.info("[%s]    Calling insight_gen.generate...", _sid(session_id))
        insights = insight_gen.generate(
            signals, primary_context, evidence, full_text, dimensions,
            session_history=session_history,
            resonance_calibration=resonance_calibration,
            conversation_types=conversation_types,
        )
        logger.info("[%s]    ✓ Insights generated (%d keys)", _sid(session_id), len(insights))

        fingerprint = insights.pop("fingerprint", None)

        # ── Persist ───────────────────────────────────────────────────
        # No voiceprint update — pyannote/voiceprint is quarantined off the live path
        # (CLAUDE.md rule #1); the user is identified by the mic stream, not by matching.
        _save_session(
            session_id, user_id, signals, insights, dimensions,
            primary_context, filename, confirmed_speaker,
            speaker_confirmed=True,
            fingerprint=fingerprint,
        )
        logger.info("[%s]    ✓ Session saved to Supabase", _sid(session_id))

        # Home feed dimension-maturation events — diffs this session's evidence
        # against persisted state and writes any newly fired event. Wrapped
        # defensively (same pattern as the consolidation trigger below) so a
        # bug here can never break finalize itself.
        try:
            fired_events = run_trigger_detection(user_id, session_id, primary_context)
            if fired_events:
                logger.info("[%s]    ✓ %d dimension event(s) fired: %s", _sid(session_id),
                            len(fired_events), [e["trigger_type"] for e in fired_events])
        except Exception:
            logger.error("[%s]    ✕ Trigger detection failed (non-fatal):\n%s",
                          _sid(session_id), _tb.format_exc())

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

        # Evict profile caches so the next GET /api/profile re-checks freshness
        # against the new session count (each cache's own refresh-interval
        # logic decides whether that actually triggers a new LLM call or not).
        _portrait_cache.pop(user_id, None)
        _paragraph_cache.pop(user_id, None)
        _coaching_cache.pop(user_id, None)

        logger.info("[%s] ✓ Finalize complete — confirmed_speaker: %s", _sid(session_id), confirmed_speaker)
        result_data = {
            "session_id": session_id,
            "signals": signals,
            "insights": insights,
            "dimensions": dimensions,
            "filename": filename,
            "detected_speaker": confirmed_speaker,
            "speaker_confirmed": True,
            "voiceprint_confidence": voiceprint_confidence,
        }

        _cancel_job_timeout(job_key)
        if job_key in _jobs:
            _jobs[job_key].put({"event": "done", "data": result_data})

    except Exception as e:
        _cancel_job_timeout(job_key)
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


# ── Session history ───────────────────────────────────────────────

@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, user_id: str = Depends(get_current_user)):
    """Single-session fetch, same response shape as a HistoryView list card's
    onSelect — used by Home's "View full session" link, which only has a
    session_id and needs the full signals/insights/dimensions to open the
    session detail page directly."""
    res = supabase_admin.table("sessions").select("*").eq(
        "id", session_id
    ).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Session not found.")

    s = res.data[0]
    return {
        "session_id": s["id"],
        "context": s["context"],
        "filename": s.get("filename") or "recording",
        "detected_speaker": s.get("detected_speaker") or "SPEAKER_00",
        "created_at": s["created_at"],
        "insights": json.loads(s["insights_json"]),
        "signals": json.loads(s["signals_json"]),
        "dimensions": json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {},
        "fingerprint": json.loads(s["fingerprint_json"]) if s.get("fingerprint_json") else None,
    }


# Priority order for HistoryView's one-line card highlight — first steady
# composite wins, Relational-first per CLAUDE.md's own signal priority.
_HIGHLIGHT_PRIORITY = [
    "rapport", "power_balance", "turn_taking_courtesy",
    "speech_style", "fluency", "responsive_engagement", "vocal_arousal",
]


def _compute_session_highlight(session_id: str, session_signals: dict, context: str, all_parsed: list) -> dict | None:
    """One self-relative one-liner for a HistoryView card — the first steady
    composite in priority order, or None if nothing is steady yet for this
    user+context. Deliberately just one, not all 7 — a list card is a glance,
    not the detail page."""
    same_context_history = [p["sig"] for p in all_parsed if p["context"] == context and p["id"] != session_id]
    for key in _HIGHLIGHT_PRIORITY:
        result = compute_composite_position(key, session_signals, same_context_history)
        if result["is_steady"]:
            return {"label": result["label"], "position": result["position"]}
    return None


@app.get("/api/sessions")
def get_sessions(
    user_id: str = Depends(get_current_user),
    page: int = 0,
    page_size: int = 10,
):
    page_size = min(max(page_size, 1), 50)
    offset = page * page_size

    res = supabase_admin.table("sessions").select("*", count="exact").eq(
        "user_id", user_id
    ).order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

    total = res.count or 0
    # Fetched once per request (not per-card) — same pattern /api/profile and
    # /api/home already use for evidence computation against full history.
    all_parsed = _fetch_and_parse_sessions(user_id)

    out = []
    for s in res.data:
        try:
            signals = json.loads(s["signals_json"])
            out.append({
                "session_id": s["id"],
                "context": s["context"],
                "filename": s.get("filename") or "recording",
                "detected_speaker": s.get("detected_speaker") or "SPEAKER_00",
                "speaker_confirmed": s.get("speaker_confirmed") or False,
                "created_at": s["created_at"],
                "insights": json.loads(s["insights_json"]),
                "signals": signals,
                "dimensions": json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {},
                "fingerprint": json.loads(s["fingerprint_json"]) if s.get("fingerprint_json") else None,
                "highlight": _compute_session_highlight(s["id"], signals, s["context"], all_parsed),
            })
        except Exception as e:
            print(f"[sessions] Skipping malformed session {s.get('id', '?')}: {e}")
    return {"sessions": out, "total": total, "has_more": (offset + page_size) < total}


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
                "hedging_rate": sig.get("hedging", {}).get("rate_per_100_words"),
                "directness_rate": sig.get("directness", {}).get("rate_per_100_words"),
                "question_pickup_rate": sig.get("question_impact", {}).get("pickup_rate"),
                "drive_score": sig.get("drive_vs_follow", {}).get("drive_score"),
                "building_on_rate": sig.get("building_on_others", {}).get("building_on_rate"),
                # Added for Signal History's curated 7-signal set — previously
                # computed nowhere in this endpoint despite both being tracked
                # dimensions since the 9→15 rebuild.
                "curiosity_rate": sig.get("curiosity", {}).get("question_turn_rate_per_100_words"),
                "turn_taking_rate": sig.get("interruptions", {}).get("user_interrupt_rate_per_10_transitions"),
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


def _fetch_and_parse_sessions(user_id: str) -> list:
    """Shared session fetch-and-parse used by both /api/profile and /api/home —
    same query, same shape, so the two surfaces never drift out of sync."""
    res = supabase_admin.table("sessions").select(
        "id, context, created_at, signals_json, dimensions_json, insights_json, fingerprint_json, detected_speaker"
    ).eq("user_id", user_id).order("created_at", desc=False).execute()

    parsed = []
    for s in res.data:
        try:
            sig = json.loads(s["signals_json"])
            dims = json.loads(s["dimensions_json"]) if s.get("dimensions_json") else {}
            ins = json.loads(s["insights_json"])
            fingerprint = json.loads(s["fingerprint_json"]) if s.get("fingerprint_json") else None
            parsed.append({
                "id": s["id"],
                "context": s["context"], "date": s["created_at"],
                "sig": sig, "dims": dims, "ins": ins,
                "fingerprint": fingerprint,
                "detected_speaker": s.get("detected_speaker") or "SPEAKER_00",
            })
        except Exception:
            continue
    return parsed


@app.get("/api/sessions/{session_id}/spectrum")
def get_session_spectrum(session_id: str, user_id: str = Depends(get_current_user)):
    """Session Spectrum tab data: each of the 7 composites' self-relative
    position (less/about/more than usual) for this one session, computed
    against the user's own same-context history — never a number, never
    compared to anyone else. See history_session_detail_redesign memory doc
    for the full design (why composites are computed at read-time, not stored)."""
    parsed = _fetch_and_parse_sessions(user_id)
    target = next((p for p in parsed if p["id"] == session_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Session not found.")

    same_context_history = [p["sig"] for p in parsed if p["context"] == target["context"] and p["id"] != session_id]

    # One composite's failure (evidence_gate.py already guards individual
    # signal extraction, but a defensive outer layer here too — same pattern
    # as _run_finalize_job's per-speaker try/except) never takes down the
    # other 6 or the whole request.
    composites = {}
    for key in COMPOSITE_CONFIG:
        try:
            composites[key] = compute_composite_position(key, target["sig"], same_context_history)
        except Exception as e:
            logger.error("[spectrum] Composite '%s' failed for session %s: %s", key, _sid(session_id), e)
            composites[key] = {"composite": key, "label": COMPOSITE_CONFIG[key]["label"],
                                "is_steady": False, "position": None, "components": []}
    return {"session_id": session_id, "context": target["context"], "composites": composites}


@app.get("/api/profile")
def get_profile(user_id: str = Depends(get_current_user)):
    parsed = _fetch_and_parse_sessions(user_id)

    if len(parsed) < 1:
        return {
            "insufficient_data": True,
            "session_count": 0,
        }

    n = len(parsed)

    # Blind spots — contexts the mirror hasn't seen yet
    recorded_contexts = set(p["context"] for p in parsed)
    blind_spots = _compute_blind_spots(recorded_contexts)

    # Evidence-based standing portrait (You page) — self-relative only, gated per
    # signal on accumulated evidence (CLAUDE.md rules #3/#4). Replaces the old
    # numeric dimension-scoring personality synthesis entirely — no invented
    # dimensions, no 0-100 scores, no trait labels.
    evidence = _compute_profile_evidence(parsed)
    portrait_llm = _get_or_synthesize_portrait(user_id, n, evidence, blind_spots, parsed)
    llm_notes_by_signal = {s["signal_key"]: s for s in portrait_llm.get("signals", [])}
    llm_context_notes = {s["signal_key"]: s["note"] for s in portrait_llm.get("context_shifts", [])}

    steady_signals = []
    still_forming = []
    for signal_key, ev in evidence["overall"].items():
        cfg = SIGNAL_EVIDENCE_CONFIG[signal_key]
        label = cfg["label"]
        if ev["is_steady"]:
            llm = llm_notes_by_signal.get(signal_key, {})
            steady_signals.append({
                "signal_key": signal_key,
                "label": label,
                "kind": cfg["kind"],
                # continuous dims populate mean/recent_mean/shift_pct; categorical
                # dims (pacing_arc, energy_arc) populate mode_label/agreement_ratio
                # instead — never both, since categorical has no numeric mean.
                "mean": ev.get("mean"),
                "mode_label": ev.get("mode_label"),
                "agreement_ratio": ev.get("agreement_ratio"),
                "sample_count": ev["sample_count"],
                "recent_mean": ev.get("recent_mean"),
                "shift_pct": ev.get("shift_pct"),
                "framing": llm.get("framing", "observation"),
                "note": llm.get("note", ""),
            })
        elif ev["sample_count"] < ev["min_samples_required"]:
            # Only genuinely "still forming" — enough-samples-but-too-variable
            # signals are omitted entirely rather than mislabeled as approaching
            # steady (they'd sit at "6 of 5" forever; see home_feed.py's identical fix).
            still_forming.append({
                "signal_key": signal_key,
                "label": label,
                "sample_count": ev["sample_count"],
                "min_needed": ev["min_samples_required"],
            })

    how_you_shift_by_context = []
    for signal_key, note in llm_context_notes.items():
        is_categorical = SIGNAL_EVIDENCE_CONFIG[signal_key]["kind"] == "categorical"
        value_field = "mode_label" if is_categorical else "mean"
        by_ctx = {
            ctx: data[signal_key][value_field]
            for ctx, data in evidence["by_context"].items()
            if data.get(signal_key, {}).get("is_steady")
        }
        if len(by_ctx) >= 2:
            how_you_shift_by_context.append({
                "signal_key": signal_key,
                "label": SIGNAL_EVIDENCE_CONFIG[signal_key]["label"],
                "by_context": by_ctx,
                "note": note,
            })

    # Profile strength: fraction of the 9 signals with enough steady evidence —
    # NOT session count / context variety, so it only grows when there's genuine
    # self-relative evidence behind it. Same label scheme as before for familiarity.
    strength_pct = round(100 * len(steady_signals) / len(SIGNAL_EVIDENCE_CONFIG))
    if strength_pct < 25:   strength_label = "Just starting"
    elif strength_pct < 50: strength_label = "Building"
    elif strength_pct < 75: strength_label = "Developing"
    elif strength_pct < 90: strength_label = "Established"
    else:                   strength_label = "Deep mirror"

    # Global indicators strip — plain observational facts about the user's own
    # history, deliberately NOT evidence-gated (rule #3 doesn't apply to raw
    # averages/counts, only to pattern claims) — visible from session 1, no
    # gating, recomputed fresh every request same as blind_spots.
    total_time_recorded_s = sum(p["sig"].get("session_duration_s", 0) or 0 for p in parsed)
    talk_ratios = [p["sig"]["talk_ratio"]["user_ratio"] for p in parsed if p["sig"].get("talk_ratio")]
    paces = [p["sig"]["speech_rate"]["overall_wpm"] for p in parsed if p["sig"].get("speech_rate")]
    indicators = {
        "session_count": n,
        "time_recorded_s": round(total_time_recorded_s, 1),
        "avg_talk_share": round(float(np.mean(talk_ratios)), 3) if talk_ratios else None,
        "avg_pace": round(float(np.mean(paces)), 1) if paces else None,
        "contexts_covered": len(recorded_contexts),
        "contexts_total": len(_CONTEXT_BLIND_SPOTS),  # 9 possible conversation-type contexts
    }

    portrait_paragraph = _get_or_refresh_portrait_paragraph(user_id, n, evidence)
    coaching = _get_or_synthesize_coaching(user_id, n, parsed)

    return {
        "insufficient_data": False,
        "session_count": n,
        "profile_strength": {"pct": strength_pct, "label": strength_label},
        "indicators": indicators,
        "portrait_paragraph": portrait_paragraph.get("text"),
        "portrait_tags": portrait_paragraph.get("tags", []),
        "portrait": {"steady": steady_signals, "still_forming": still_forming},
        "how_you_shift_by_context": how_you_shift_by_context,
        "coaching": coaching.get("items", []),
        "blind_spots": blind_spots,
    }


def _get_dismissed_card_keys(user_id: str) -> set:
    try:
        res = supabase_admin.table("dismissed_cards").select("card_key").eq(
            "user_id", user_id
        ).execute()
        return {row["card_key"] for row in res.data}
    except Exception:
        return set()


@app.get("/api/home")
def get_home(user_id: str = Depends(get_current_user)):
    """v2 Home feed: a single interleaved timeline of session recap cards
    (unconditional, one per session) and dimension-maturation event cards
    (fired by pipeline/trigger_detector.py at finalize time), sorted newest
    first. No longer needs evidence/portrait computation at all — that LLM
    call only runs when the You page itself is viewed, not on every Home load.
    The "7 visible + 8th faded + Show more" behavior is a frontend rendering
    contract over this complete, uncapped list — backend returns everything.
    """
    parsed = _fetch_and_parse_sessions(user_id)
    if len(parsed) < 1:
        return {"insufficient_data": True, "session_count": 0, "cards": []}

    dismissed = _get_dismissed_card_keys(user_id)

    events_res = supabase_admin.table("dimension_events").select("*").eq(
        "user_id", user_id
    ).order("created_at", desc=True).execute()

    cards = []
    cards += home_feed.build_session_recap_cards(parsed, dismissed)
    cards += home_feed.build_dimension_event_cards(events_res.data, dismissed)
    cards.sort(key=lambda c: c["date"], reverse=True)

    return {"insufficient_data": False, "session_count": len(parsed), "cards": cards}


@app.post("/api/home/dismiss")
async def dismiss_home_card(
    card_key: str = Form(...),
    user_id: str = Depends(get_current_user)
):
    supabase_admin.table("dismissed_cards").upsert({
        "user_id": user_id,
        "card_key": card_key,
    }, on_conflict="user_id,card_key").execute()
    return {"status": "dismissed"}


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
    _portrait_cache.pop(user_id, None)
    _paragraph_cache.pop(user_id, None)
    _coaching_cache.pop(user_id, None)

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


# ── Feedback ──────────────────────────────────────────────────────

class FeedbackPayload(BaseModel):
    category: str
    message: str

@app.post("/api/feedback")
async def submit_feedback(
    payload: FeedbackPayload,
    user_id: str = Depends(get_current_user),
):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message is required.")

    valid_categories = {"bug", "feature", "quality", "general"}
    if payload.category not in valid_categories:
        raise HTTPException(status_code=400, detail="Invalid category.")

    # Save to Supabase
    supabase_admin.table("feedback").insert({
        "user_id": user_id,
        "category": payload.category,
        "message": payload.message.strip(),
    }).execute()

    # Email notification — only runs if RESEND_API_KEY is configured
    resend_key = os.getenv("RESEND_API_KEY")
    if resend_key:
        try:
            import resend
            resend.api_key = resend_key

            # Fetch user email for context
            user_data = supabase_admin.auth.admin.get_user_by_id(user_id)
            user_email = getattr(user_data.user, "email", "unknown")

            category_labels = {
                "bug": "Bug Report",
                "feature": "Feature Request",
                "quality": "Something Feels Off",
                "general": "General Feedback",
            }
            label = category_labels.get(payload.category, payload.category)

            resend.Emails.send({
                "from": "Mirror Feedback <feedback@mirrorai.live>",
                "to": ["harsh200415@gmail.com"],
                "subject": f"Mirror Feedback — {label}",
                "html": f"""
                <div style="font-family:system-ui,sans-serif;max-width:560px;color:#111;">
                  <h2 style="margin:0 0 4px;">New feedback: {label}</h2>
                  <p style="color:#888;font-size:13px;margin:0 0 20px;">
                    From {user_email} &nbsp;·&nbsp; {_utcnow()}
                  </p>
                  <div style="background:#f6f6f6;border-radius:8px;padding:16px 20px;
                              font-size:15px;line-height:1.6;white-space:pre-wrap;">
                    {payload.message.strip()}
                  </div>
                </div>
                """,
            })
        except Exception as e:
            logger.warning(f"Feedback email failed: {e}")

    return {"status": "sent"}


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


def _get_context_evidence(user_id: str, context: str) -> dict:
    """Per-signal evidence gating for self-relative baseline comparison (CLAUDE.md
    rule #3: gate on accumulated evidence per signal, never session count; rule #4:
    self-relative only, never population comparisons — no population-norm fallback
    of any kind).

    Always returns a dict (never None) — signals with insufficient or noisy evidence
    are marked not-steady, never silently dropped, so the caller/prompt can render an
    honest "not enough evidence yet" state instead of guessing.
    """
    res = supabase_admin.table("sessions").select("signals_json").eq(
        "user_id", user_id
    ).eq("context", context).order("created_at", desc=False).execute()

    context_sessions = [s for s in res.data if s.get("signals_json")]
    all_signals = [json.loads(s["signals_json"]) for s in context_sessions]

    evidence = {}
    for signal_key in SIGNAL_EVIDENCE_CONFIG:
        try:
            values = [extract_value(signal_key, sig) for sig in all_signals]
        except (KeyError, TypeError):
            values = []
        evidence[signal_key] = compute_evidence(signal_key, values)

    return {"context": context, "session_count": len(context_sessions), "signals": evidence}


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
        response = anthropic_client.messages.create(
            model="claude-sonnet-5",
            max_tokens=900,
            thinking={"type": "disabled"},
            messages=[{"role": "user", "content": prompt}],
        )
        return extract_text(response).strip()
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
    speaker_confirmed=True, fingerprint=None
):
    # all_speakers_signals_json is intentionally never written anymore — it used
    # to persist full behavioral signal extractions for every other room
    # participant (CLAUDE.md rule #8: never build a profile of the room). The
    # column stays in the DB schema (nullable, always NULL going forward) rather
    # than migrating it away as part of this change.
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
    }).execute()
