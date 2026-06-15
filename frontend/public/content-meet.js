// Mirror content script — injected into meet.google.com

(function () {
  'use strict';

  if (!/^\/[a-z]+-[a-z]+-[a-z]+/.test(location.pathname)) return;

  let webrtcMode = false;

  // ── Styles ────────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
    @keyframes mirrorDotPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.45; transform: scale(0.75); }
    }
    #mirror-rec-dot {
      position: fixed;
      bottom: 100px;
      right: 22px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      z-index: 2147483647;
      display: none;
      pointer-events: none;
      animation: mirrorDotPulse 1.4s ease-in-out infinite;
    }
    #mirror-tooltip {
      position: fixed;
      top: 12px;
      right: 72px;
      z-index: 2147483647;
      background: rgba(13, 15, 20, 0.92);
      border: 1px solid rgba(29, 78, 216, 0.35);
      border-radius: 20px;
      padding: 7px 14px;
      font-family: 'Google Sans', system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: #f0eeff;
      letter-spacing: -0.1px;
      backdrop-filter: blur(12px);
      pointer-events: none;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.4s ease;
    }
  `;
  document.head.appendChild(style);

  // ── Recording dot ─────────────────────────────────────────────────

  const dot = document.createElement('div');
  dot.id = 'mirror-rec-dot';
  document.body.appendChild(dot);

  // Sync dot with current recording state (handles page reload mid-recording)
  chrome.runtime.sendMessage({ action: 'get_recording_state' }, (res) => {
    if (!chrome.runtime.lastError && res?.active) dot.style.display = 'block';
  });

  // ── One-time tooltip (per Meet tab session) ───────────────────────
  // sessionStorage persists through refreshes but clears when the tab closes,
  // so this shows once per Meet tab — not on every refresh, but again on a new tab.

  const TOOLTIP_MESSAGES = [
    'Mirror sees what you miss',
    'Mirror has something to show you',
    'Uncover what makes you, you',
    'Mirror has been watching. Ready to see?',
    'What do others notice about you?',
    'See yourself through Mirror',
    // 'Know yourself better than anyone else',
    // 'How does Mirror see you?',
    // 'What does Mirror know about you?',
    // 'How do others see you?',
    // 'How do you come across to others?',
  ];

  const msg = TOOLTIP_MESSAGES[Math.floor(Math.random() * TOOLTIP_MESSAGES.length)];

  const tip = document.createElement('div');
  tip.id = 'mirror-tooltip';
  tip.textContent = msg;
  document.body.appendChild(tip);

  // Fade in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { tip.style.opacity = '1'; });
  });

  // Fade out after 5s, remove after transition
  setTimeout(() => { tip.style.opacity = '0'; }, 5000);
  setTimeout(() => tip.remove(), 5500);

  // ── WebRTC injector messages (MAIN world → ISOLATED world) ────────

  window.addEventListener('message', ({ source: src, data }) => {
    if (src !== window || data?.source !== 'mirror-webrtc-injector') return;

    if (data.type === 'track_captured') {
      console.log(`[mirror-content] Remote audio track captured (total: ${data.trackCount}) — notifying background`);
      chrome.runtime.sendMessage({ action: 'set_webrtc_available' }).catch(e => {
        console.warn('[mirror-content] set_webrtc_available failed:', e?.message);
      });
    }

    if (data.type === 'speaker_event') {
      if (!webrtcMode) return;
      chrome.runtime.sendMessage({
        action: 'speaker_event',
        event: data.event,
      }).catch(e => {
        console.warn('[mirror-content] speaker_event forward failed:', e?.message);
      });
    }
  });

  // ── Commands from background SW ───────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'recording_started') {
      dot.style.display = 'block';
    }

    if (msg.action === 'recording_stopped') {
      dot.style.display = 'none';
    }

    if (msg.action === 'start_webrtc_tracking') {
      console.log('[mirror-content] start_webrtc_tracking received — enabling speaker forwarding');
      webrtcMode = true;
      window.postMessage({
        source: 'mirror-content',
        type: 'start_tracking',
        startTime: msg.startTime || Date.now(),
      }, '*');
    }

    if (msg.action === 'stop_webrtc_tracking') {
      console.log('[mirror-content] stop_webrtc_tracking received — flushing injector');
      window.postMessage({ source: 'mirror-content', type: 'stop_tracking' }, '*');
      webrtcMode = false;
    }
  });

})();
