// Mirror background service worker
// Orchestrates tab audio capture, chunked recording, and backend upload

const API_URL = 'https://harsh200415-mirror-backend.hf.space';

// Reload any open Meet tabs when the extension is installed or reloaded.
// During development this saves having to manually refresh Meet every time.
// In production this only fires on extension updates (rare, seamless).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    tabs.forEach(tab => chrome.tabs.reload(tab.id));
  });
});

// Manually handle action click — onClicked IS a user-gesture event handler, which is the ONLY
// context where tabCapture.getMediaStreamId and sidePanel.open are permitted.
// IMPORTANT: sidePanel.open() must be called synchronously (before any await) to remain
// within Chrome's user-gesture activation window. getMediaStreamId callbacks fire as
// macrotasks, which expire the gesture token before the await resolves.
chrome.action.onClicked.addListener(async (tab) => {
  // Open the panel immediately — must happen before any async operation.
  chrome.sidePanel.open({ tabId: tab.id }).catch(e =>
    console.error('[mirror] sidePanel.open failed:', e.message)
  );

  // Pre-fetch tabCapture stream ID (Meet only, and only when not already recording).
  // Cached in session storage so the side panel's "Start Recording" button can use it.
  if (tab.url?.startsWith('https://meet.google.com/') && !recordingActive) {
    try {
      const streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(id);
        });
      });
      console.log('[mirror] getMediaStreamId OK for tab', tab.id);
      await chrome.storage.session.set({
        pendingStreamId: streamId,
        pendingStreamTabId: tab.id,
        pendingStreamError: null,
      });
    } catch (e) {
      console.error('[mirror] getMediaStreamId FAILED:', e.message);
      await chrome.storage.session.set({
        pendingStreamId: null,
        pendingStreamTabId: tab.id,
        pendingStreamError: e.message,
      });
    }
  }
});

// Keep this SW instance alive while the side panel is open.
// The invocation from onClicked is bound to this specific SW instance; if the SW terminates
// and a new instance starts, the invocation is lost and tabCapture will fail.
// An open port from the side panel prevents termination.
chrome.runtime.onConnect.addListener((_port) => {
  // Holding the reference keeps the SW alive for the duration of the connection.
});

let recordingTabId = null;
let recordingActive = false;

// WebRTC mode state
let webrtcMode = false;
let speakerTimeline = []; // [{speaker, start, end}] accumulated from content script VAD events

const CHUNK_DURATION_S = 15 * 60; // 900 seconds per chunk

// ── Message router ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case 'start_recording': {
      // Legacy path from content script FAB — uses pre-fetched stream ID from onClicked
      const tabId = sender.tab?.id;
      if (!tabId) { sendResponse({ error: 'No tab ID' }); break; }
      handleStart(tabId, msg.mode || 'tabcapture', null)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    case 'start_recording_with_stream': {
      // Primary path from side panel — streamId may be passed directly or looked up from
      // the session cache (pre-fetched in onClicked).
      if (!msg.tabId) { sendResponse({ error: 'Missing tabId' }); break; }
      handleStart(msg.tabId, msg.mode || 'tabcapture', msg.streamId || null)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    case 'get_webrtc_available': {
      // Side panel querying whether WebRTC tracks were captured for a given tab
      sendResponse({ available: false }); // TODO: wire up when WebRTC injector fires
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
      if (msg.event) speakerTimeline.push(msg.event);
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

async function handleStart(tabId, mode = 'tabcapture', providedStreamId = null) {
  if (recordingActive) return { error: 'Already recording' };

  const { mirror_token } = await getToken();
  if (!mirror_token) return { error: 'Sign in to Mirror first' };

  // Close any existing offscreen doc FIRST to release the previous tab capture
  await chrome.offscreen.closeDocument().catch(() => {});

  // Prefer stream ID passed directly (from side panel's getMediaStreamId call).
  // Fall back to the one pre-fetched in onClicked.
  let streamId = providedStreamId;
  if (!streamId) {
    const { pendingStreamId, pendingStreamTabId } = await chrome.storage.session.get([
      'pendingStreamId', 'pendingStreamTabId',
    ]);
    if (pendingStreamId && pendingStreamTabId === tabId) {
      streamId = pendingStreamId;
      await chrome.storage.session.remove(['pendingStreamId', 'pendingStreamTabId']);
    }
  }

  if (!streamId) {
    return { error: 'Use the "Start Recording" button in the Mirror panel alongside Meet.' };
  }

  // Create fresh offscreen doc
  await ensureOffscreen();

  // Tell offscreen doc to start recording with this stream
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'start_recording',
    streamId,
  });

  recordingActive = true;
  recordingTabId = tabId;
  webrtcMode = (mode === 'webrtc');
  speakerTimeline = []; // reset timeline for new recording

  chrome.action.setBadgeText({ text: '●' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

  return { ok: true };
}

// ── Stop recording ────────────────────────────────────────────────

async function handleStop() {
  if (!recordingActive) return;
  recordingActive = false;
  recordingTabId = null;

  await chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop_recording' });

  chrome.action.setBadgeText({ text: '…' });
  chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
}

// ── Upload chunk ──────────────────────────────────────────────────

async function handleChunk({ base64, mimeType, chunkIndex }) {
  const { mirror_token } = await getToken();

  if (!mirror_token) {
    console.error('[mirror] No auth token — cannot upload chunk');
    return;
  }

  const startMin = chunkIndex * 15;
  const endMin = startMin + 15;
  const filename = `meet_${startMin}-${endMin}min.webm`;

  // Track chunk state in local storage so popup can show progress
  await chrome.storage.local.set({
    [`chunk_${chunkIndex}`]: { status: 'uploading', chunkIndex, startMin, endMin },
  });

  try {
    // Decode base64 back to binary Blob
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioBlob = new Blob([bytes], { type: mimeType || 'audio/webm' });

    // ── Step 1: prepare (upload + transcribe + diarise) ──────────
    const form = new FormData();
    form.append('audio', audioBlob, filename);
    form.append('filename', filename);

    // Include WebRTC speaker timeline if available for this chunk
    if (webrtcMode) {
      const chunkStart = chunkIndex * CHUNK_DURATION_S;
      const chunkEnd = chunkStart + CHUNK_DURATION_S;

      // Filter events overlapping this chunk's time window and normalise to chunk-relative time
      const chunkTimeline = speakerTimeline
        .filter(e => e.start < chunkEnd && e.end > chunkStart)
        .map(e => ({
          speaker: e.speaker,
          start: Math.max(e.start - chunkStart, 0),
          end: Math.min(e.end - chunkStart, CHUNK_DURATION_S),
        }));

      if (chunkTimeline.length > 0) {
        form.append('speaker_timeline', JSON.stringify(chunkTimeline));
        console.log(`[mirror] chunk ${chunkIndex}: including WebRTC timeline (${chunkTimeline.length} events)`);
      }
    }

    const prepareRes = await fetch(`${API_URL}/api/prepare/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mirror_token}` },
      body: form,
    });
    if (!prepareRes.ok) throw new Error(`Prepare failed (${prepareRes.status})`);
    const { job_id } = await prepareRes.json();

    const prepResult = await readSSEStream(
      `${API_URL}/api/prepare/${job_id}/stream`,
      mirror_token
    );

    const detectedSpeaker = prepResult.detected_speaker || 'SPEAKER_00';

    // ── Step 2: finalize (insights + scoring) ────────────────────
    const finalForm = new FormData();
    finalForm.append('session_id', job_id);
    finalForm.append('confirmed_speaker', detectedSpeaker);

    const finalRes = await fetch(`${API_URL}/api/finalize/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mirror_token}` },
      body: finalForm,
    });
    if (!finalRes.ok) throw new Error(`Finalize failed (${finalRes.status})`);
    const { job_id: finJobId } = await finalRes.json();

    await readSSEStream(
      `${API_URL}/api/finalize/${finJobId}/stream`,
      mirror_token
    );

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
    console.error('[mirror] Chunk upload error:', err);
    await chrome.storage.local.set({
      [`chunk_${chunkIndex}`]: { status: 'error', chunkIndex, startMin, endMin, error: err.message },
    });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
  }
}

// ── SSE stream reader ─────────────────────────────────────────────
// Service workers support fetch + ReadableStream but not EventSource.

async function readSSEStream(url, token, maxMinutes = 25) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), maxMinutes * 60 * 1000);

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
      if (done) throw new Error('Stream closed before job completed');

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
        if (evt.event === 'done') return evt.data || evt;
        if (evt.event === 'error') throw new Error(evt.message || 'Job failed');
        // 'progress' and 'ping' events: continue reading
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
