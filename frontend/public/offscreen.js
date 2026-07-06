// Offscreen document — runs MediaRecorder (service workers can't use audio APIs)
//
// Records TWO independent streams per chunk:
//   - tab audio  (chromeMediaSource:'tab')  — the other participants, as Meet plays them
//   - mic audio  (plain getUserMedia)       — the user's own voice
// Both recorders are cut on the same 15-minute boundary and sent to background.js
// together once both blobs for that chunk are ready.

let tabStream = null;
let micStream = null;
let micAvailable = false;

let tabRecorder = null;
let micRecorder = null;
let tabChunks = [];
let micChunks = [];

let pendingTabBlob = null;   // set once tabRecorder.onstop has a blob for the current chunk
let pendingMicBlob = null;   // set once micRecorder.onstop has a blob for the current chunk (or stays null if mic unavailable)
let chunkSent = false;       // guards against double-send if both onstop handlers fire

let chunkIndex = 0;
let chunkTimer = null;
let playbackCtx = null; // AudioContext that routes captured audio back to speakers

const CHUNK_MS = 15 * 60 * 1000; // 15 minutes

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.action === 'start_recording') {
    console.log('[mirror-offscreen] start_recording received — streamId:', msg.streamId);
    startRecording(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(e => {
        console.error('[mirror-offscreen] ERROR: startRecording failed:', e.message);
        sendResponse({ error: e.message });
      });
    return true;
  }

  if (msg.action === 'stop_recording') {
    console.log('[mirror-offscreen] stop_recording received');
    stopRecording();
    sendResponse({ ok: true });
  }
});

async function startRecording(streamId) {
  if (!streamId) {
    throw new Error('No streamId provided to startRecording');
  }

  console.log('[mirror-offscreen] Requesting tab capture stream...');
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  const audioTracks = tabStream.getAudioTracks();
  console.log(`[mirror-offscreen] Tab capture stream acquired — ${audioTracks.length} audio track(s)`);

  if (audioTracks.length === 0) {
    console.error('[mirror-offscreen] ERROR: Tab capture stream has no audio tracks! Recording will produce empty audio.');
  } else {
    audioTracks.forEach((t, i) => console.log(`[mirror-offscreen] Audio track ${i}: ${t.label}, enabled=${t.enabled}, muted=${t.muted}`));
  }

  // Route captured audio back to local speakers.
  // getUserMedia with chromeMediaSource:'tab' silences the tab's audio output by default —
  // without this, the user cannot hear remote participants while recording is active.
  try {
    playbackCtx = new AudioContext();
    const source = playbackCtx.createMediaStreamSource(tabStream);
    source.connect(playbackCtx.destination);
    console.log('[mirror-offscreen] Audio routed back to speakers — local playback restored');
  } catch (e) {
    console.warn('[mirror-offscreen] WARNING: Could not restore local audio playback:', e.message);
  }

  // Mic capture — best-effort. Permission must already have been granted from a visible
  // extension page (side panel bootstraps this before triggering start_recording), since
  // this offscreen document cannot itself show a permission prompt. If it fails, log and
  // continue with tab-only recording — the app must keep working as before.
  try {
    console.log('[mirror-offscreen] Requesting microphone stream...');
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micAvailable = true;
    const micTracks = micStream.getAudioTracks();
    console.log(`[mirror-offscreen] Mic stream acquired — ${micTracks.length} audio track(s)`);
    micTracks.forEach((t, i) => console.log(`[mirror-offscreen] Mic track ${i}: ${t.label}, enabled=${t.enabled}, muted=${t.muted}`));
  } catch (e) {
    micAvailable = false;
    micStream = null;
    console.error('[mirror-offscreen] ERROR: Mic capture failed — continuing with tab-only recording:', e.message);
  }

  chunkIndex = 0;
  beginChunk();

  // Every 15 minutes, cut the current chunk and start a new one
  chunkTimer = setInterval(() => {
    console.log(`[mirror-offscreen] 15-minute chunk boundary — stopping recorder(s) for chunk ${chunkIndex}`);
    if (tabRecorder && tabRecorder.state === 'recording') tabRecorder.stop();
    if (micRecorder && micRecorder.state === 'recording') micRecorder.stop();
  }, CHUNK_MS);
}

function beginChunk() {
  tabChunks = [];
  micChunks = [];
  pendingTabBlob = null;
  pendingMicBlob = null;
  chunkSent = false;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  console.log(`[mirror-offscreen] beginChunk ${chunkIndex} — mimeType: ${mimeType}`);

  tabRecorder = new MediaRecorder(tabStream, { mimeType });
  tabRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) tabChunks.push(e.data);
  };
  tabRecorder.onstop = () => {
    console.log(`[mirror-offscreen] tab onstop fired for chunk ${chunkIndex} — chunks: ${tabChunks.length}`);
    pendingTabBlob = tabChunks.length > 0
      ? new Blob(tabChunks, { type: tabRecorder.mimeType })
      : null;
    if (!pendingTabBlob) {
      console.error('[mirror-offscreen] ERROR: No tab audio data captured for this chunk — analysis will NOT run for this chunk.');
    }
    maybeSendChunk();
  };
  tabRecorder.onerror = (e) => {
    console.error(`[mirror-offscreen] tab MediaRecorder error on chunk ${chunkIndex}:`, e.error?.message || e);
  };
  tabRecorder.start();

  if (micAvailable && micStream) {
    micRecorder = new MediaRecorder(micStream, { mimeType });
    micRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) micChunks.push(e.data);
    };
    micRecorder.onstop = () => {
      console.log(`[mirror-offscreen] mic onstop fired for chunk ${chunkIndex} — chunks: ${micChunks.length}`);
      pendingMicBlob = micChunks.length > 0
        ? new Blob(micChunks, { type: micRecorder.mimeType })
        : null;
      if (!pendingMicBlob) {
        console.warn('[mirror-offscreen] WARNING: No mic audio data captured for this chunk — mic transcript will be skipped for this chunk.');
      }
      maybeSendChunk();
    };
    micRecorder.onerror = (e) => {
      console.error(`[mirror-offscreen] mic MediaRecorder error on chunk ${chunkIndex}:`, e.error?.message || e);
    };
    micRecorder.start();
  } else {
    micRecorder = null;
  }

  console.log(`[mirror-offscreen] MediaRecorder(s) started for chunk ${chunkIndex} (mic: ${micAvailable})`);
}

// Waits for both recorders (tab always, mic only if available) to report their blob for the
// current chunk before sending — avoids the background having to correlate two async uploads.
async function maybeSendChunk() {
  if (chunkSent) return;
  const tabDone = pendingTabBlob !== null || tabRecorder?.state !== 'recording';
  const micDone = !micAvailable || pendingMicBlob !== null || micRecorder?.state !== 'recording';
  if (!tabDone || !micDone) return;

  chunkSent = true;
  const thisChunkIndex = chunkIndex;

  if (!pendingTabBlob) {
    // Nothing to analyze this chunk — still advance if the stream is live.
    if (tabStream && tabStream.active && chunkTimer !== null) beginChunk();
    return;
  }

  console.log(`[mirror-offscreen] Chunk ${thisChunkIndex}: tab blob ${(pendingTabBlob.size / 1024).toFixed(1)} KB` +
    (pendingMicBlob ? `, mic blob ${(pendingMicBlob.size / 1024).toFixed(1)} KB` : ', no mic blob'));

  const tabBase64 = await blobToBase64(pendingTabBlob);
  const micBase64 = pendingMicBlob ? await blobToBase64(pendingMicBlob) : null;

  console.log(`[mirror-offscreen] Sending audio_chunk ${thisChunkIndex} to background`);
  chrome.runtime.sendMessage({
    action: 'audio_chunk',
    tabBase64,
    tabMimeType: pendingTabBlob.type,
    micBase64,
    micMimeType: pendingMicBlob ? pendingMicBlob.type : null,
    chunkIndex: chunkIndex++,
  });

  // If stream is still live, start next chunk immediately
  if (tabStream && tabStream.active && chunkTimer !== null) {
    beginChunk();
  }
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  return btoa(binary);
}

function stopRecording() {
  clearInterval(chunkTimer);
  chunkTimer = null;

  if (tabRecorder && tabRecorder.state === 'recording') {
    console.log('[mirror-offscreen] Stopping tab MediaRecorder (final chunk)...');
    tabRecorder.stop();
  } else {
    console.warn(`[mirror-offscreen] WARNING: stopRecording called but tab MediaRecorder state is "${tabRecorder?.state}" — no onstop will fire!`);
  }

  if (micRecorder && micRecorder.state === 'recording') {
    console.log('[mirror-offscreen] Stopping mic MediaRecorder (final chunk)...');
    micRecorder.stop();
  }

  // Give onstop time to fire before stopping the stream tracks and audio context
  setTimeout(() => {
    if (tabStream) {
      console.log('[mirror-offscreen] Stopping tab stream tracks');
      tabStream.getTracks().forEach(t => t.stop());
      tabStream = null;
    }
    if (micStream) {
      console.log('[mirror-offscreen] Stopping mic stream tracks');
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    micAvailable = false;
    if (playbackCtx) {
      playbackCtx.close().catch(() => {});
      playbackCtx = null;
    }
  }, 1500);
}
