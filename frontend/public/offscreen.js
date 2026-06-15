// Offscreen document — runs MediaRecorder (service workers can't use audio APIs)

let stream = null;
let mediaRecorder = null;
let chunks = [];
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
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  const audioTracks = stream.getAudioTracks();
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
    const source = playbackCtx.createMediaStreamSource(stream);
    source.connect(playbackCtx.destination);
    console.log('[mirror-offscreen] Audio routed back to speakers — local playback restored');
  } catch (e) {
    console.warn('[mirror-offscreen] WARNING: Could not restore local audio playback:', e.message);
  }

  chunkIndex = 0;
  beginChunk();

  // Every 15 minutes, cut the current chunk and start a new one
  chunkTimer = setInterval(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      console.log(`[mirror-offscreen] 15-minute chunk boundary — stopping recorder for chunk ${chunkIndex}`);
      mediaRecorder.stop(); // onstop will start the next chunk automatically
    }
  }, CHUNK_MS);
}

function beginChunk() {
  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  console.log(`[mirror-offscreen] beginChunk ${chunkIndex} — mimeType: ${mimeType}`);
  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.onstop = async () => {
    console.log(`[mirror-offscreen] onstop fired for chunk ${chunkIndex} — chunks: ${chunks.length}`);

    if (chunks.length === 0) {
      console.error('[mirror-offscreen] ERROR: No audio data captured (chunks array is empty)!');
      console.error('[mirror-offscreen] Possible causes:');
      console.error('  1. Stream tracks were muted or ended before recording');
      console.error('  2. MediaRecorder.stop() called before any data was available');
      console.error('  3. Tab audio output was disabled or the tab was muted');
      console.error('[mirror-offscreen] Analysis will NOT run for this chunk — no audio_chunk will be sent.');
      // If stream still live, start next chunk anyway
      if (stream && stream.active && chunkTimer !== null) {
        beginChunk();
      }
      return;
    }

    const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
    console.log(`[mirror-offscreen] Chunk ${chunkIndex} blob: ${(blob.size / 1024).toFixed(1)} KB`);

    const arrayBuffer = await blob.arrayBuffer();

    // Convert to base64 — ArrayBuffer doesn't survive sendMessage serialisation
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const base64 = btoa(binary);

    console.log(`[mirror-offscreen] Sending audio_chunk ${chunkIndex} to background (${(base64.length / 1024).toFixed(1)} KB base64)`);
    chrome.runtime.sendMessage({
      action: 'audio_chunk',
      base64,
      mimeType: blob.type,
      chunkIndex: chunkIndex++,
    });

    // If stream is still live, start next chunk immediately
    if (stream && stream.active && chunkTimer !== null) {
      beginChunk();
    }
  };

  mediaRecorder.onerror = (e) => {
    console.error(`[mirror-offscreen] MediaRecorder error on chunk ${chunkIndex}:`, e.error?.message || e);
  };

  mediaRecorder.start();
  console.log(`[mirror-offscreen] MediaRecorder started for chunk ${chunkIndex}`);
}

function stopRecording() {
  clearInterval(chunkTimer);
  chunkTimer = null;

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('[mirror-offscreen] Stopping MediaRecorder (final chunk)...');
    mediaRecorder.stop(); // sends final chunk via onstop
  } else {
    console.warn(`[mirror-offscreen] WARNING: stopRecording called but MediaRecorder state is "${mediaRecorder?.state}" — no onstop will fire!`);
  }

  // Give onstop time to fire before stopping the stream tracks and audio context
  setTimeout(() => {
    if (stream) {
      console.log('[mirror-offscreen] Stopping all stream tracks');
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (playbackCtx) {
      playbackCtx.close().catch(() => {});
      playbackCtx = null;
    }
  }, 1500);
}
