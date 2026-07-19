// Mirror background service worker
// Orchestrates tab audio capture, chunked recording, and backend upload

const API_URL = 'https://harsh200415-mirror-backend.hf.space';

const MEET_URL_PATTERN = /^https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/;

// Run on every SW start — disables the panel globally before any user interaction.
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Panel is disabled globally; only Meet tabs get it enabled.
async function syncPanelEnabled(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const isMeet = MEET_URL_PATTERN.test(tab.url || '');
    await chrome.sidePanel.setOptions(
      isMeet
        ? { tabId, enabled: true, path: 'index.html' }
        : { tabId, enabled: false }
    );
  } catch (_) {}
}

chrome.tabs.onActivated.addListener(({ tabId }) => syncPanelEnabled(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) syncPanelEnabled(tabId);
});

chrome.runtime.onInstalled.addListener(async () => {
  // Enable for any Meet tabs already open at install/reload time.
  try {
    const allTabs = await chrome.tabs.query({});
    for (const t of allTabs) {
      if (MEET_URL_PATTERN.test(t.url || '')) {
        await chrome.sidePanel.setOptions({ tabId: t.id, enabled: true, path: 'index.html' });
      }
    }
  } catch (_) {}

  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    tabs.forEach(tab => chrome.tabs.reload(tab.id));
  });
});

// On non-Meet tabs: open the full-page view.
// On Meet tabs: open the side panel + pre-fetch stream ID while activeTab grant is fresh.
// Must be non-async so sidePanel.open() is called within the user gesture context.
chrome.action.onClicked.addListener((tab) => {
  if (!MEET_URL_PATTERN.test(tab.url || '')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') + '?fullpage=1' });
    return;
  }

  // Open panel synchronously — panel is already enabled for this tab via syncPanelEnabled.
  chrome.sidePanel.open({ tabId: tab.id }).catch(e => {
    console.warn('[mirror] sidePanel.open failed:', e.message);
  });

  // Pre-fetch stream ID with callback (no await) so activeTab grant is still valid.
  if (!recordingActive) {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
      if (chrome.runtime.lastError) {
        console.error('[mirror] getMediaStreamId FAILED:', chrome.runtime.lastError.message);
        chrome.storage.session.set({
          pendingStreamId: null,
          pendingStreamTabId: tab.id,
          pendingStreamError: chrome.runtime.lastError.message,
        });
      } else {
        console.log('[mirror] getMediaStreamId OK for tab', tab.id);
        chrome.storage.session.set({
          pendingStreamId: id,
          pendingStreamTabId: tab.id,
          pendingStreamError: null,
        });
      }
    });
  }
});

// Keep SW alive while side panel is open (MV3 lifecycle).
chrome.runtime.onConnect.addListener((_port) => {});

let recordingTabId = null;
let recordingActive = false;

// WebRTC mode state
let webrtcMode = false;
let speakerTimeline = []; // [{speaker, start, end}] accumulated from content script VAD events
let webrtcAvailableTabId = null;

const CHUNK_DURATION_S = 25 * 60; // 1500 seconds per chunk — must match offscreen.js's CHUNK_MS

// ── Message router ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case 'start_recording': {
      // FAB path from content script — content script already sent start_tracking to injector.
      // Pass fromFAB=true so handleStart does NOT send start_webrtc_tracking again (would reset injector clock).
      const tabId = sender.tab?.id;
      if (!tabId) { sendResponse({ error: 'No tab ID' }); break; }
      handleStart(tabId, msg.mode || 'tabcapture', null, /* fromFAB= */ true)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    case 'start_recording_with_stream': {
      // Side-panel path — background must notify content script/injector to start tracking.
      if (!msg.tabId) { sendResponse({ error: 'Missing tabId' }); break; }
      handleStart(msg.tabId, msg.mode || 'tabcapture', msg.streamId || null, /* fromFAB= */ false)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    case 'set_webrtc_available': {
      webrtcAvailableTabId = sender.tab?.id ?? null;
      console.log('[mirror] WebRTC tracks available on tab', webrtcAvailableTabId);
      sendResponse({ ok: true });
      break;
    }

    case 'get_webrtc_available': {
      const available = !!(msg.tabId && webrtcAvailableTabId === msg.tabId);
      sendResponse({ available });
      break;
    }

    case 'stop_recording':
      handleStop()
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'audio_chunk':
      handleChunk(msg).catch(console.error);
      sendResponse({ ok: true });
      break;

    case 'speaker_event':
      // Accumulate VAD events from content script (WebRTC mode only)
      if (msg.event) {
        speakerTimeline.push(msg.event);
      }
      sendResponse({ ok: true });
      break;

    case 'sync_token':
      chrome.storage.session.set({ mirror_token: msg.token, mirror_user_id: msg.userId });
      chrome.storage.local.set({ mirror_token: msg.token, mirror_user_id: msg.userId });
      sendResponse({ ok: true });
      break;

    case 'get_recording_state':
      sendResponse({ active: recordingActive, tabId: recordingTabId });
      break;
  }
});

// ── Start recording ───────────────────────────────────────────────

async function getToken() {
  let { mirror_token, mirror_user_id } = await chrome.storage.session.get([
    'mirror_token', 'mirror_user_id',
  ]);
  if (!mirror_token) {
    const local = await chrome.storage.local.get(['mirror_token', 'mirror_user_id']);
    mirror_token = local.mirror_token;
    mirror_user_id = local.mirror_user_id;
    if (mirror_token) {
      await chrome.storage.session.set({ mirror_token, mirror_user_id });
    }
  }
  return { mirror_token, mirror_user_id };
}

// fromFAB=true  → content script already sent start_tracking to injector; don't send again.
// fromFAB=false → side panel path; background must notify injector to start tracking.
async function handleStart(tabId, mode = 'tabcapture', providedStreamId = null, fromFAB = false) {
  if (recordingActive) return { error: 'Already recording' };

  const { mirror_token } = await getToken();
  if (!mirror_token) return { error: 'Sign in to Mirror first' };

  // Close any existing offscreen doc FIRST to release the previous tab capture
  await chrome.offscreen.closeDocument().catch(() => {});

  let streamId = providedStreamId;

  if (!streamId) {
    // Always get a fresh stream ID on-demand — pre-fetched IDs expire in ~10 s.
    // tabCapture permission + host_permissions for meet.google.com allows this
    // from the service worker without an active user gesture.
    console.log('[mirror] Getting fresh stream ID on-demand for tab', tabId);
    try {
      streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(id);
        });
      });
      console.log('[mirror] On-demand stream ID acquired for tab', tabId);
      // Discard any stale pre-fetched ID
      chrome.storage.session.remove(['pendingStreamId', 'pendingStreamTabId', 'pendingStreamError']).catch(() => {});
    } catch (e) {
      // On-demand failed — try the pre-fetched one as last resort
      console.warn('[mirror] On-demand getMediaStreamId failed:', e.message, '— trying pre-fetched ID');
      const { pendingStreamId, pendingStreamTabId } = await chrome.storage.session.get([
        'pendingStreamId', 'pendingStreamTabId',
      ]);
      if (pendingStreamId && pendingStreamTabId === tabId) {
        streamId = pendingStreamId;
        await chrome.storage.session.remove(['pendingStreamId', 'pendingStreamTabId']);
        console.log('[mirror] Using pre-fetched stream ID as fallback');
      } else {
        console.error('[mirror] No usable stream ID — cannot start recording');
        return { error: 'Tab capture failed: ' + e.message };
      }
    }
  }

  // Create fresh offscreen doc
  await ensureOffscreen();

  // Tell offscreen doc to start recording and check it actually succeeded
  const offscreenResp = await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'start_recording',
    streamId,
  }).catch(e => ({ error: e.message }));

  if (offscreenResp?.error) {
    console.error('[mirror] Offscreen startRecording failed:', offscreenResp.error);
    return { error: offscreenResp.error };
  }

  recordingActive = true;
  recordingTabId = tabId;
  webrtcMode = (mode === 'webrtc');
  speakerTimeline = []; // reset timeline for new recording

  console.log(`[mirror] Recording started — mode: ${mode}, tabId: ${tabId}, fromFAB: ${fromFAB}`);

  // Store start time so side panel can restore the timer after remount
  await chrome.storage.local.set({ mirror_recording_start: Date.now() });

  // Notify content script to show recording dot
  chrome.tabs.sendMessage(tabId, { action: 'recording_started' }).catch(() => {});

  // Only notify the injector from the side-panel path.
  // For the FAB path, content script already called start_tracking on the injector
  // (before sending start_recording). Sending it again would reset recordingStartMs
  // and corrupt early event timestamps.
  if (webrtcMode && !fromFAB) {
    const startTime = Date.now();
    chrome.tabs.sendMessage(tabId, {
      action: 'start_webrtc_tracking',
      startTime,
    }).then(() => {
      console.log('[mirror] start_webrtc_tracking sent to content script (t=' + startTime + ')');
    }).catch(e => {
      console.error('[mirror] ERROR: start_webrtc_tracking FAILED — speaker timeline will be empty!', e.message);
      console.error('[mirror] Is content-meet.js loaded? Is this a meet.google.com tab?');
    });
  }

  chrome.action.setBadgeText({ text: '●' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

  return { ok: true };
}

// ── Stop recording ────────────────────────────────────────────────

async function handleStop() {
  if (!recordingActive) return;
  const stoppedTabId = recordingTabId;
  const wasWebrtc = webrtcMode;
  recordingActive = false;
  recordingTabId = null;

  console.log(`[mirror] Stopping recording — webrtcMode: ${wasWebrtc}, speakerTimeline events before flush: ${speakerTimeline.length}`);

  // ── CRITICAL: Flush WebRTC timeline BEFORE stopping the recorder ──────────
  // If we stop the recorder first, the offscreen sends audio_chunk immediately.
  // handleChunk reads speakerTimeline synchronously (before network I/O), so
  // any flush events that arrive after audio_chunk is received get MISSED.
  // Flushing first ensures all open speaking segments are in speakerTimeline
  // by the time handleChunk processes the chunk.
  if (wasWebrtc && stoppedTabId) {
    try {
      await chrome.tabs.sendMessage(stoppedTabId, { action: 'stop_webrtc_tracking' });
      console.log('[mirror] stop_webrtc_tracking sent — waiting 400ms for flush events to arrive...');
    } catch (e) {
      console.warn('[mirror] stop_webrtc_tracking message failed (content script may not be loaded):', e.message);
    }
    // Give the content script → injector → background message chain time to complete
    await new Promise(r => setTimeout(r, 400));
    console.log(`[mirror] WebRTC flush complete — speakerTimeline now has ${speakerTimeline.length} events`);
    if (speakerTimeline.length === 0) {
      console.warn('[mirror] WARNING: speakerTimeline is EMPTY after flush! WebRTC VAD may not have captured any audio.');
      console.warn('[mirror] Possible causes: injector not loaded, getUserMedia intercepted before injector ran, no active tracks.');
      console.warn('[mirror] Backend will fall back to pyannote diarization for this recording.');
    }
  }

  await chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop_recording' });

  // Clear stored start time
  await chrome.storage.local.remove('mirror_recording_start');

  // Notify content script to hide recording dot
  if (stoppedTabId) {
    chrome.tabs.sendMessage(stoppedTabId, { action: 'recording_stopped' }).catch(() => {});
  }

  chrome.action.setBadgeText({ text: '…' });
  chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });

  // Pre-fetch a new stream ID so the panel re-enables without another toolbar click.
  if (stoppedTabId) {
    setTimeout(() => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: stoppedTabId }, (newId) => {
        if (chrome.runtime.lastError || !newId) return;
        chrome.storage.session.set({
          pendingStreamId: newId,
          pendingStreamTabId: stoppedTabId,
          pendingStreamError: null,
        });
        console.log('[mirror] Pre-fetched new stream ID for tab', stoppedTabId);
      });
    }, 2000);
  }
}

// ── Upload chunk ──────────────────────────────────────────────────

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'audio/webm' });
}

// Asks any open extension page (side panel / full page) to force-refresh its Supabase
// session and report the current token back. Used to self-heal a 401 mid-chunk — prepare
// and finalize can be minutes apart (2 transcriptions, diarization, scoring, an LLM call),
// long enough for the token cached at recording-start to go stale before finalize runs.
async function requestTokenRefresh() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'request_token_refresh' }, (res) => {
      if (chrome.runtime.lastError || !res?.token) {
        resolve(null);
      } else {
        resolve(res.token);
      }
    });
  });
}

// POSTs with the given token; on a 401, requests a fresh token and retries once.
// Returns { res, token } — token is the one that ultimately succeeded (or was last tried),
// so callers can reuse it for a subsequent SSE stream read.
async function fetchWithTokenRetry(url, token, body, chunkIndex, label) {
  let res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (res.status === 401) {
    console.warn(`[mirror] Chunk ${chunkIndex}: ${label} got 401 — refreshing token and retrying once...`);
    const freshToken = await requestTokenRefresh();
    if (freshToken) {
      token = freshToken;
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
    }
  }
  return { res, token };
}

async function handleChunk({ tabBase64, tabMimeType, micBase64, micMimeType, chunkIndex }) {
  let { mirror_token } = await getToken();

  if (!mirror_token) {
    console.error('[mirror] ERROR: No auth token — cannot upload chunk. User must be signed in.');
    return;
  }

  const startMin = chunkIndex * 15;
  const endMin = startMin + 15;
  const filename = `meet_${startMin}-${endMin}min.webm`;
  const micFilename = `mic_${startMin}-${endMin}min.webm`;

  console.log(`[mirror] Processing chunk ${chunkIndex} (${filename}), webrtcMode: ${webrtcMode}, hasMic: ${!!micBase64}`);

  // Track chunk state in local storage so popup can show progress
  await chrome.storage.local.set({
    [`chunk_${chunkIndex}`]: { status: 'uploading', chunkIndex, startMin, endMin },
  });

  try {
    const audioBlob = base64ToBlob(tabBase64, tabMimeType);
    console.log(`[mirror] Chunk ${chunkIndex}: tab audio blob size = ${(audioBlob.size / 1024).toFixed(1)} KB`);

    if (audioBlob.size === 0) {
      throw new Error('Audio blob is empty — no audio was captured. Check tab capture permissions.');
    }

    // ── Step 1: prepare (upload + transcribe + diarise) ──────────
    const form = new FormData();
    form.append('audio', audioBlob, filename);
    form.append('filename', filename);

    if (micBase64) {
      const micBlob = base64ToBlob(micBase64, micMimeType);
      console.log(`[mirror] Chunk ${chunkIndex}: mic audio blob size = ${(micBlob.size / 1024).toFixed(1)} KB`);
      form.append('mic_audio', micBlob, micFilename);
    }

    // Include WebRTC speaker timeline if available for this chunk
    if (webrtcMode) {
      const chunkStart = chunkIndex * CHUNK_DURATION_S;
      const chunkEnd = chunkStart + CHUNK_DURATION_S;

      const chunkTimeline = speakerTimeline
        .filter(e => e.start < chunkEnd && e.end > chunkStart)
        .map(e => ({
          speaker: e.speaker,
          start: Math.max(e.start - chunkStart, 0),
          end: Math.min(e.end - chunkStart, CHUNK_DURATION_S),
        }));

      console.log(`[mirror] Chunk ${chunkIndex}: WebRTC mode — ${speakerTimeline.length} total events, ${chunkTimeline.length} events in this chunk's window`);

      if (chunkTimeline.length > 0) {
        // Log speaker breakdown
        const speakerBreakdown = {};
        chunkTimeline.forEach(e => { speakerBreakdown[e.speaker] = (speakerBreakdown[e.speaker] || 0) + 1; });
        console.log(`[mirror] Chunk ${chunkIndex}: speaker breakdown in timeline:`, speakerBreakdown);
        form.append('speaker_timeline', JSON.stringify(chunkTimeline));
      } else {
        console.warn(`[mirror] Chunk ${chunkIndex}: WARNING — WebRTC timeline is empty! Falling back to pyannote diarization.`);
        console.warn(`[mirror] If this is a multi-person meeting, the speaker split may be incorrect.`);
      }
    }

    const { res: prepareRes, token: tokenAfterPrepare } = await fetchWithTokenRetry(
      `${API_URL}/api/prepare/start`, mirror_token, form, chunkIndex, 'Prepare'
    );
    mirror_token = tokenAfterPrepare;
    if (!prepareRes.ok) {
      const errText = await prepareRes.text().catch(() => '');
      throw new Error(`Prepare failed (HTTP ${prepareRes.status}): ${errText.slice(0, 200)}`);
    }
    const { job_id } = await prepareRes.json();
    console.log(`[mirror] Chunk ${chunkIndex}: prepare job started — job_id: ${job_id}`);

    const prepResult = await readSSEStream(
      `${API_URL}/api/prepare/${job_id}/stream`,
      mirror_token
    );
    console.log(`[mirror] Chunk ${chunkIndex}: prepare done — detected_speaker: ${prepResult.detected_speaker}`);

    if (prepResult.mic_transcript) {
      console.log(`[mirror] Chunk ${chunkIndex}: MIC TRANSCRIPT —`, prepResult.mic_transcript);
    } else if (micBase64) {
      console.warn(`[mirror] Chunk ${chunkIndex}: mic audio was uploaded but no mic_transcript came back from backend.`);
    }

    const detectedSpeaker = prepResult.detected_speaker || 'SPEAKER_00';

    // ── Step 2: finalize (insights + scoring) ────────────────────
    const finalForm = new FormData();
    finalForm.append('session_id', job_id);
    finalForm.append('confirmed_speaker', detectedSpeaker);

    const { res: finalRes, token: tokenAfterFinalize } = await fetchWithTokenRetry(
      `${API_URL}/api/finalize/start`, mirror_token, finalForm, chunkIndex, 'Finalize'
    );
    mirror_token = tokenAfterFinalize;
    if (!finalRes.ok) {
      const errText = await finalRes.text().catch(() => '');
      throw new Error(`Finalize failed (HTTP ${finalRes.status}): ${errText.slice(0, 200)}`);
    }
    const { job_id: finJobId } = await finalRes.json();
    console.log(`[mirror] Chunk ${chunkIndex}: finalize job started — job_id: ${finJobId}`);

    const finalResult = await readSSEStream(
      `${API_URL}/api/finalize/${finJobId}/stream`,
      mirror_token
    );
    console.log(`[mirror] Chunk ${chunkIndex}: finalize done — session saved`);

    // ── Done ─────────────────────────────────────────────────────
    await chrome.storage.local.set({
      [`chunk_${chunkIndex}`]: { status: 'done', chunkIndex, startMin, endMin, sessionId: job_id },
      meet_last_completed: Date.now(),
    });

    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: recordingActive ? '●' : '' });
    }, 3000);

  } catch (err) {
    console.error(`[mirror] ERROR in chunk ${chunkIndex}:`, err.message);
    await chrome.storage.local.set({
      [`chunk_${chunkIndex}`]: { status: 'error', chunkIndex, startMin, endMin, error: err.message },
    });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
  }
}

// ── SSE stream reader ─────────────────────────────────────────────

async function readSSEStream(url, token, maxMinutes = 25) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error(`[mirror] ERROR: SSE stream timed out after ${maxMinutes} minutes — ${url}`);
    controller.abort();
  }, maxMinutes * 60 * 1000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Stream returned ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream closed before job completed — server may have restarted or timed out');

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.event === 'done') return evt.data || evt;
        if (evt.event === 'error') {
          console.error('[mirror] ERROR from backend SSE stream:', evt.message);
          throw new Error(evt.message || 'Job failed');
        }
        if (evt.event === 'progress') {
          console.log(`[mirror] Progress: ${evt.step} — ${evt.message}`);
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Offscreen document management ────────────────────────────────

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Record tab audio for meeting behavioural analysis',
    });
  }
}
