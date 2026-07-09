// Mirror WebRTC injector — runs in page MAIN world (manifest world: "MAIN")
// Patches RTCPeerConnection to capture per-participant audio tracks + build VAD timeline.
// Also patches getUserMedia to capture the local microphone VAD (labelled SPEAKER_00).
// Posts messages to content-meet.js (ISOLATED world) via window.postMessage.

(function () {
  'use strict';
  if (window.__mirrorWebRTCInjected) return;
  window.__mirrorWebRTCInjected = true;

  const OrigRTC = window.RTCPeerConnection;
  if (!OrigRTC) {
    console.warn('[mirror-webrtc] RTCPeerConnection not found — injector disabled');
    return;
  }

  // trackCount indexes remote tracks so each gets a stable SPEAKER_XX label.
  // SPEAKER_00 is reserved for the local microphone (getUserMedia).
  // Remote tracks start at SPEAKER_01, SPEAKER_02, …
  let remoteTrackCount = 0;

  // Map<trackId, { flush: fn, stop: fn, label: string }>
  const activeTracks = new Map();
  let recordingStartMs = null;

  // ── Voice Activity Detection per track ───────────────────────────

  function createVAD(track, speakerLabel) {
    let audioCtx;
    try { audioCtx = new AudioContext(); } catch (e) {
      console.warn(`[mirror-webrtc] AudioContext creation failed for ${speakerLabel}:`, e.message);
      return { flush: () => {}, stop: () => {} };
    }

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    try {
      audioCtx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    } catch (e) {
      console.warn(`[mirror-webrtc] Failed to connect track for ${speakerLabel}:`, e.message);
      audioCtx.close().catch(() => {});
      return { flush: () => {}, stop: () => {} };
    }

    const buf = new Float32Array(analyser.fftSize);
    const RMS_SQ_THRESHOLD = 6.4e-5;
    let isSpeaking = false;
    let segStart = 0;

    const intervalId = setInterval(() => {
      if (recordingStartMs === null) return;
      analyser.getFloatTimeDomainData(buf);
      let sq = 0;
      for (let i = 0; i < buf.length; i++) sq += buf[i] * buf[i];
      const speaking = (sq / buf.length) > RMS_SQ_THRESHOLD;
      const t = (Date.now() - recordingStartMs) / 1000;

      if (speaking && !isSpeaking) {
        isSpeaking = true;
        segStart = t;
      } else if (!speaking && isSpeaking) {
        isSpeaking = false;
        if (t - segStart >= 0.3) postSpeakerEvent(speakerLabel, segStart, t);
      }
    }, 100);

    function flush() {
      if (isSpeaking && recordingStartMs !== null) {
        const t = (Date.now() - recordingStartMs) / 1000;
        if (t - segStart >= 0.3) postSpeakerEvent(speakerLabel, segStart, t);
        isSpeaking = false;
      }
    }

    function stop() {
      flush();
      clearInterval(intervalId);
      audioCtx.close().catch(() => {});
    }

    return { flush, stop };
  }

  function postSpeakerEvent(speaker, start, end) {
    window.postMessage({
      source: 'mirror-webrtc-injector',
      type: 'speaker_event',
      event: { speaker, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 },
    }, '*');
  }

  // ── RTCPeerConnection patch — remote tracks ────────────────────────

  function MirrorRTCPeerConnection(...args) {
    const pc = new OrigRTC(...args);

    // ── Diagnostics — investigating intermittent audio dropouts during
    // recording. Pure logging, no behavior change. connectionState/
    // iceConnectionState transitions are the direct signal for the actual
    // Meet call itself degrading (as opposed to just our own recording tap).
    const CONCERNING_STATES = new Set(['failed', 'disconnected']);
    pc.addEventListener('connectionstatechange', () => {
      const log = CONCERNING_STATES.has(pc.connectionState) ? console.warn : console.log;
      log(`[mirror-webrtc] DIAG: pc.connectionState → ${pc.connectionState}`);
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      const log = CONCERNING_STATES.has(pc.iceConnectionState) ? console.warn : console.log;
      log(`[mirror-webrtc] DIAG: pc.iceConnectionState → ${pc.iceConnectionState}`);
    });

    pc.addEventListener('track', ({ track }) => {
      if (track.kind !== 'audio' || activeTracks.has(track.id)) return;

      // Use SPEAKER_01, SPEAKER_02 … for remote participants (SPEAKER_00 = local mic).
      // Consistent SPEAKER_XX format ensures backend handles all labels the same way.
      remoteTrackCount++;
      const label = `SPEAKER_0${remoteTrackCount}`;
      console.log(`[mirror-webrtc] Captured remote audio track #${remoteTrackCount} → ${label}`);

      track.onmute = () => console.warn(`[mirror-webrtc] DIAG: remote track ${label} MUTED`);
      track.onunmute = () => console.log(`[mirror-webrtc] DIAG: remote track ${label} unmuted`);

      const vad = createVAD(track, label);
      activeTracks.set(track.id, { ...vad, label });

      track.addEventListener('ended', () => {
        console.log(`[mirror-webrtc] Remote track ended: ${label}`);
        vad.stop();
        activeTracks.delete(track.id);
      });

      window.postMessage({
        source: 'mirror-webrtc-injector',
        type: 'track_captured',
        trackCount: remoteTrackCount,
      }, '*');
    });

    return pc;
  }

  MirrorRTCPeerConnection.prototype = OrigRTC.prototype;
  Object.setPrototypeOf(MirrorRTCPeerConnection, OrigRTC);
  Object.defineProperty(MirrorRTCPeerConnection, 'name', { value: 'RTCPeerConnection', configurable: true });
  window.RTCPeerConnection = MirrorRTCPeerConnection;

  // ── getUserMedia patch — local microphone ─────────────────────────
  // Intercepts Meet's local mic stream to build a VAD for the user's own speech.
  // Labels these events "SPEAKER_00" so the backend correctly attributes the user
  // even when the tab audio doesn't loop back the local microphone.

  const OrigGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function (constraints) {
    return OrigGetUserMedia(constraints).then(function (localStream) {
      const audioTracks = localStream.getAudioTracks();
      for (const track of audioTracks) {
        if (!activeTracks.has('local_' + track.id)) {
          console.log('[mirror-webrtc] Intercepted local mic track → SPEAKER_00');
          // DIAG: this is Meet's own mic track (the one that actually reaches the
          // other participants) — mute here means your voice genuinely isn't going
          // out, distinct from anything in our own separate offscreen recording tap.
          track.onmute = () => console.warn('[mirror-webrtc] DIAG: local Meet mic track MUTED — your voice is not reaching the call');
          track.onunmute = () => console.log('[mirror-webrtc] DIAG: local Meet mic track unmuted');

          const vad = createVAD(track, 'SPEAKER_00');
          activeTracks.set('local_' + track.id, { ...vad, label: 'SPEAKER_00' });

          track.addEventListener('ended', () => {
            console.log('[mirror-webrtc] Local mic track ended');
            vad.stop();
            activeTracks.delete('local_' + track.id);
          });
        }
      }
      return localStream;
    });
  };

  console.log('[mirror-webrtc] RTCPeerConnection + getUserMedia patched successfully');

  // ── Control messages from content script ─────────────────────────

  window.addEventListener('message', ({ source: src, data }) => {
    if (src !== window || data?.source !== 'mirror-content') return;

    if (data.type === 'start_tracking') {
      recordingStartMs = data.startTime || Date.now();
      const trackList = [...activeTracks.values()].map(t => t.label || '?').join(', ');
      console.log(`[mirror-webrtc] Timeline tracking started (recordingStartMs=${recordingStartMs})`);
      console.log(`[mirror-webrtc] Active tracks (${activeTracks.size}): ${trackList || 'none'}`);
      if (activeTracks.size === 0) {
        console.warn('[mirror-webrtc] WARNING: No active tracks at recording start!');
        console.warn('[mirror-webrtc] Possible cause: RTCPeerConnection established before injector ran, OR getUserMedia not yet called.');
        console.warn('[mirror-webrtc] Speaker timeline will be empty — backend will use pyannote diarization.');
      }
      if (!activeTracks.has('local_' + [...activeTracks.keys()].find(k => k.startsWith('local_')))) {
        // Check specifically for SPEAKER_00
        const hasLocalMic = [...activeTracks.values()].some(t => t.label === 'SPEAKER_00');
        if (!hasLocalMic) {
          console.warn('[mirror-webrtc] WARNING: Local mic (SPEAKER_00) not captured!');
          console.warn('[mirror-webrtc] getUserMedia may have been called before injector ran.');
          console.warn('[mirror-webrtc] User speaking time will be estimated via gap-fill only.');
        }
      }
    }

    if (data.type === 'stop_tracking') {
      // Flush open segments but keep intervals alive so a second recording in the
      // same session picks up immediately on the next start_tracking.
      let flushedCount = 0;
      activeTracks.forEach(({ flush, label }) => {
        flush();
        flushedCount++;
      });
      console.log(`[mirror-webrtc] Timeline tracking stopped — flushed ${flushedCount} active tracks`);
      recordingStartMs = null;
    }
  });

})();
