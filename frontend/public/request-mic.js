// Standalone extension tab used solely to obtain the one-time microphone permission grant.
// getUserMedia's permission prompt cannot render inside a side panel, popup, or offscreen
// document — only a normal extension tab can show it. Once granted here, the grant applies
// to the whole extension origin (chrome-extension://<id>), so the offscreen document's later
// getUserMedia call succeeds without re-prompting.

(async function () {
  const titleEl = document.getElementById('title');
  const messageEl = document.getElementById('message');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    chrome.runtime.sendMessage({ action: 'mic_permission_result', granted: true });
    titleEl.textContent = 'Microphone access granted';
    messageEl.textContent = 'You can close this tab — returning to Mirror…';
    setTimeout(() => window.close(), 900);
  } catch (e) {
    chrome.runtime.sendMessage({ action: 'mic_permission_result', granted: false, error: e.message });
    titleEl.textContent = 'Microphone access denied';
    messageEl.textContent = e.message + ' — close this tab and try again once allowed.';
  }
})();
