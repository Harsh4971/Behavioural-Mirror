import { useState, useEffect, useRef } from "react"
import { supabase } from "../lib/supabase"
import api from "../lib/api"

// Resolves to 'granted', 'denied', or 'dismissed'.
// Side panels (and popups/offscreen docs) can't render the getUserMedia permission prompt —
// it silently rejects with no UI. If permission isn't already granted, this opens a normal
// extension tab (request-mic.html) that *can* show the prompt, and waits for its result.
async function ensureMicPermission() {
  if (typeof navigator.permissions?.query !== "function") {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
      return "granted"
    } catch {
      return "dismissed"
    }
  }

  let status
  try {
    status = await navigator.permissions.query({ name: "microphone" })
  } catch {
    status = null
  }
  if (status?.state === "granted") return "granted"
  if (status?.state === "denied") return "denied"

  return new Promise((resolve) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("request-mic.html") }, (tab) => {
      const tabId = tab?.id
      let settled = false

      function onMessage(msg) {
        if (msg.action !== "mic_permission_result") return
        settled = true
        chrome.runtime.onMessage.removeListener(onMessage)
        chrome.tabs.onRemoved.removeListener(onRemoved)
        resolve(msg.granted ? "granted" : "dismissed")
      }
      function onRemoved(closedTabId) {
        if (closedTabId !== tabId || settled) return
        settled = true
        chrome.runtime.onMessage.removeListener(onMessage)
        chrome.tabs.onRemoved.removeListener(onRemoved)
        resolve("dismissed")
      }

      chrome.runtime.onMessage.addListener(onMessage)
      chrome.tabs.onRemoved.addListener(onRemoved)
    })
  })
}

export default function MeetStatusBanner({ onViewHistory }) {
  const [chunks, setChunks] = useState([])
  const [recording, setRecording] = useState(false)
  const [onMeet, setOnMeet] = useState(false)
  const [meetTabId, setMeetTabId] = useState(null)
  const [streamReady, setStreamReady] = useState(false)
  const [prefetchError, setPrefetchError] = useState(null)
  const [recordError, setRecordError] = useState(null)
  const [webrtcReady, setWebrtcReady] = useState(false)
  const [secondsElapsed, setSecondsElapsed] = useState(0)
  const [showConsent, setShowConsent] = useState(false)
  const [chunkWarning, setChunkWarning] = useState(false)
  const [chunkWarningFinal, setChunkWarningFinal] = useState(false)
  const [usage, setUsage] = useState(null)
  const [upgradeStatus, setUpgradeStatus] = useState("idle") // idle | sending | sent
  const timerRef = useRef(null)
  const dismissTimers = useRef(null)
  const chunkWarnClearRef = useRef(null)

  // Start/stop the elapsed timer whenever recording state changes.
  // On remount (tab switch, panel reopen), restore elapsed time from stored start timestamp
  // so the counter doesn't reset to 00:00 while recording is still active.
  useEffect(() => {
    if (recording) {
      chrome.storage.local.get('mirror_recording_start', ({ mirror_recording_start }) => {
        const elapsed = mirror_recording_start
          ? Math.floor((Date.now() - mirror_recording_start) / 1000)
          : 0
        setSecondsElapsed(elapsed)
        timerRef.current = setInterval(() => setSecondsElapsed(s => s + 1), 1000)
      })
    } else {
      clearInterval(timerRef.current)
      timerRef.current = null
      setSecondsElapsed(0)
    }
    return () => clearInterval(timerRef.current)
  }, [recording])


  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return

    function refresh() {
      chrome.runtime.sendMessage({ action: "get_recording_state" }, (res) => {
        if (!chrome.runtime.lastError && res) setRecording(res.active)
      })
      chrome.storage.local.get(null, (items) => {
        const found = Object.entries(items)
          .filter(([k]) => k.startsWith("chunk_"))
          .map(([k, v]) => ({ ...v, _key: k }))
          .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
        setChunks(found)
      })
    }

    let currentTabId = null

    function checkStreamReady(tid) {
      if (!tid) { setStreamReady(false); return }
      chrome.storage.session.get(['pendingStreamId', 'pendingStreamTabId', 'pendingStreamError'], (data) => {
        const ready = !!(data.pendingStreamId && data.pendingStreamTabId === tid)
        setStreamReady(ready)
        if (!ready && data.pendingStreamError && data.pendingStreamTabId === tid) {
          setPrefetchError(data.pendingStreamError)
        } else {
          setPrefetchError(null)
        }
      })
    }

    function checkTab() {
      if (!chrome.tabs) return
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab) return
        const isMeet = /^https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/.test(tab.url || "")
        setOnMeet(isMeet)
        const tid = isMeet ? tab.id : null
        setMeetTabId(tid)
        currentTabId = tid
        checkStreamReady(tid)
        if (tid) {
          chrome.runtime.sendMessage({ action: 'get_webrtc_available', tabId: tid }, (res) => {
            if (!chrome.runtime.lastError && res) setWebrtcReady(res.available)
          })
        } else {
          setWebrtcReady(false)
        }
      })
    }

    // React immediately when background stores the pre-fetched stream ID (or an error)
    function onStorageChanged(changes, area) {
      if (area === 'session' && (changes.pendingStreamId || changes.pendingStreamTabId || changes.pendingStreamError)) {
        checkStreamReady(currentTabId)
      }
    }

    // offscreen.js sends this ~30s before each chunk boundary. isFinal tells us
    // whether recording continues into a new segment (as it does today, up to
    // the segment cap) or is about to end for good (the last allowed segment).
    function onRuntimeMessage(msg) {
      if (msg.action !== 'chunk_ending_soon') return
      setChunkWarning(true)
      setChunkWarningFinal(!!msg.isFinal)
      clearTimeout(chunkWarnClearRef.current)
      chunkWarnClearRef.current = setTimeout(() => setChunkWarning(false), 30000)
    }

    refresh()
    checkTab()
    chrome.storage.onChanged.addListener(onStorageChanged)
    chrome.runtime.onMessage.addListener(onRuntimeMessage)
    const ri = setInterval(refresh, 3000)
    const ti = setInterval(checkTab, 2000)
    return () => {
      clearInterval(ri)
      clearInterval(ti)
      chrome.storage.onChanged.removeListener(onStorageChanged)
      chrome.runtime.onMessage.removeListener(onRuntimeMessage)
      clearTimeout(chunkWarnClearRef.current)
    }
  }, [])

  async function handleStartRecordingConfirmed() {
    setRecordError(null)
    if (!meetTabId) { setRecordError('No Meet tab found'); return }

    // tabcapture/pyannote fallback mode has been removed from the live path (CLAUDE.md rule
    // #1 — no diarization/voiceprint guessing). The button is disabled until webrtcReady, but
    // guard here too in case this is ever called some other way.
    if (!webrtcReady) {
      setRecordError('Still detecting meeting audio — please wait a moment and try again.')
      return
    }

    // Bootstrap mic permission before recording — the offscreen document that does the actual
    // mic recording can't show a permission prompt itself, and neither can this side panel
    // (getUserMedia's prompt only renders in a normal extension tab). ensureMicPermission opens
    // one when needed and waits for the result. Once granted, the grant applies to the whole
    // extension origin (chrome-extension://<id>), so the offscreen doc's later getUserMedia
    // call succeeds without re-prompting.
    const micStatus = await ensureMicPermission()
    if (micStatus !== 'granted') {
      setRecordError(
        micStatus === 'denied'
          ? 'Microphone access is blocked for Mirror. Open chrome://extensions → Mirror → Details → Site settings, allow Microphone, then try again.'
          : 'Microphone access is required. Please allow it in the tab that opened, then try again.'
      )
      return
    }

    const doStart = () => {
      // Background handles the stream ID — either from the pre-fetched cache
      // (set when user clicked the toolbar icon) or on-demand via host_permissions.
      chrome.runtime.sendMessage({
        action: "start_recording_with_stream",
        tabId: meetTabId,
        mode: "webrtc",
        streamId: null,
      }, (res) => {
        if (chrome.runtime.lastError || res?.error) {
          const msg = res?.error || chrome.runtime.lastError?.message || "Failed to start"
          setRecordError(msg)
        }
      })
    }

    // Sync a fresh Supabase token before recording (SW tokens can go stale)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        chrome.runtime.sendMessage({
          action: "sync_token",
          token: session.access_token,
          userId: session.user.id,
        }).catch(() => {})
      }
      doStart()
    }).catch(() => doStart())
  }

  function handleStartRecording() {
    if (!localStorage.getItem("mirror_consent_v3")) {
      setShowConsent(true)
    } else {
      handleStartRecordingConfirmed()
    }
  }

  function handleStopRecording() {
    chrome.runtime.sendMessage({ action: "stop_recording" })
  }

  const active = chunks.filter(c => c.status === "uploading")
  const errors = chunks.filter(c => c.status === "error")
  const done = chunks.filter(c => c.status === "done")

  // "Segment ready — view in history" auto-dismisses on its own after 20s so
  // it doesn't linger; the in-progress "Analysing…" banner above is left
  // alone since it should stay for as long as it's actually true.
  useEffect(() => {
    if (done.length > 0 && !recording && active.length === 0) {
      dismissTimers.current = setTimeout(() => clearAll(), 20000)
      return () => clearTimeout(dismissTimers.current)
    }
  }, [done.length, recording, active.length])

  // Free-session usage — fetched once on mount so hitting the cap is caught
  // *before* someone tries to record (not discovered only after a wasted
  // recording fails to upload). Also restores "already expressed interest"
  // from a per-account localStorage flag, so re-opening the panel doesn't
  // let someone re-click Upgrade and send a duplicate email every time.
  useEffect(() => {
    api.get("/api/usage").then(res => setUsage(res.data)).catch(() => {})
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id && localStorage.getItem(`mirror_upgrade_interest_${session.user.id}`)) {
        setUpgradeStatus("sent")
      }
    }).catch(() => {})
  }, [])

  async function handleUpgradeClick() {
    setUpgradeStatus("sending")
    try {
      await api.post("/api/upgrade-interest")
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user?.id) {
        localStorage.setItem(`mirror_upgrade_interest_${session.user.id}`, "1")
      }
      setUpgradeStatus("sent")
    } catch {
      setUpgradeStatus("idle")
    }
  }

  const showBanner = onMeet || recording || active.length > 0 || errors.length > 0 || done.length > 0
  if (!showBanner) return null

  return (
    <div style={{ marginBottom: 20 }}>

      {/* One-time recording consent modal */}
      {showConsent && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(2px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}>
          <div style={{
            background: "#151922", border: "1px solid #1e2438",
            borderRadius: 14, padding: "24px 22px", maxWidth: 340, width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          }}>
            <div style={{ fontSize: 22, marginBottom: 12, textAlign: "center" }}>🔒</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0eeff",
              margin: "0 0 10px", textAlign: "center" }}>
              Before you start
            </h3>
            <p style={{ fontSize: 13, color: "#8b89aa", lineHeight: 1.7,
              margin: "0 0 14px", textAlign: "center" }}>
              Audio is processed and permanently deleted the moment analysis is
              complete — never stored, never replayed, never shared.
            </p>
            <p style={{ fontSize: 13, color: "#8b89aa", lineHeight: 1.7,
              margin: "0 0 20px", textAlign: "center" }}>
              <strong style={{ color: "#c4c2d8" }}>Only your own patterns are kept</strong> — whoever
              else is on this call is never profiled or stored. Please make sure everyone
              on the call knows it's being recorded.
            </p>
            <button
              onClick={() => {
                localStorage.setItem("mirror_consent_v3", "1")
                setShowConsent(false)
                handleStartRecordingConfirmed()
              }}
              style={{
                width: "100%", padding: "12px 0",
                background: "linear-gradient(135deg, #1d4ed8, #0891b2)",
                color: "white", border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                marginBottom: 10,
              }}
            >
              I understand — Start Recording
            </button>
            <button
              onClick={() => setShowConsent(false)}
              style={{
                width: "100%", padding: "10px 0", background: "none",
                border: "none", fontSize: 13, color: "#4a4865", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Free-session cap reached — shown instead of recording controls, before
          anyone wastes a real recording only to have the upload get rejected. */}
      {onMeet && !recording && usage && usage.remaining <= 0 && (
        <div style={{
          background: "rgba(29,78,216,0.06)", border: "1px solid rgba(29,78,216,0.25)",
          borderRadius: 12, padding: "14px 16px", marginBottom: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f0eeff", marginBottom: 4 }}>
            You've used all {usage.limit} free sessions
          </div>
          <div style={{ fontSize: 12, color: "#8b89aa", lineHeight: 1.6, marginBottom: 10 }}>
            Upgrade to keep recording — ₹69/month.
          </div>
          {upgradeStatus === "sent" ? (
            <div style={{ fontSize: 12, color: "#5b9cf6", fontWeight: 500 }}>
              Thanks! This is coming soon — we'll email you the moment it's ready.
            </div>
          ) : (
            <button onClick={handleUpgradeClick} disabled={upgradeStatus === "sending"} style={{
              background: "linear-gradient(90deg, #1d4ed8, #0891b2)", border: "none",
              borderRadius: 8, padding: "8px 18px", color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: upgradeStatus === "sending" ? "default" : "pointer",
              opacity: upgradeStatus === "sending" ? 0.6 : 1,
            }}>
              {upgradeStatus === "sending" ? "…" : "Upgrade — ₹69/month"}
            </button>
          )}
        </div>
      )}

      {/* Meet recording controls */}
      {onMeet && !(usage && usage.remaining <= 0 && !recording) && (
        <div style={{
          background: "rgba(13,15,20,0.6)", border: "1px solid #1e2438",
          borderRadius: 12, padding: "14px 16px", marginBottom: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {recording && (
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#ef4444", flexShrink: 0,
                  animation: "mirrorBannerPulse 1.4s ease-in-out infinite",
                }} />
              )}
              <span style={{ fontSize: 13, fontWeight: 600, color: recording ? "#fca5a5" : "#f0eeff" }}>
                {recording
                  ? `${String(Math.floor(secondsElapsed / 60)).padStart(2, "0")}:${String(secondsElapsed % 60).padStart(2, "0")}  ·  Recording`
                  : "Google Meet detected"}
              </span>
            </div>

            {!recording ? (
              <button onClick={handleStartRecording} disabled={!webrtcReady} style={{
                background: webrtcReady ? "linear-gradient(90deg, #1d4ed8, #0891b2)" : "#1e2438",
                border: "none",
                borderRadius: 8, padding: "7px 16px",
                color: webrtcReady ? "#fff" : "#4a4865",
                fontSize: 13, fontWeight: 600,
                cursor: webrtcReady ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}>
                {webrtcReady ? "Start Recording" : "Waiting for meeting audio…"}
              </button>
            ) : (
              <button onClick={handleStopRecording} style={{
                background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 8, padding: "7px 16px",
                color: "#f87171", fontSize: 13, fontWeight: 600, cursor: "pointer",
                flexShrink: 0,
              }}>
                Stop
              </button>
            )}
          </div>

          {!recording && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#4a4865", lineHeight: 1.5 }}>
              By recording, you confirm all participants are aware of this recording.
            </div>
          )}

          {recordError && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{recordError}</div>
          )}
        </div>
      )}

      <style>{`@keyframes mirrorBannerPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

      {/* 30s heads-up before a chunk boundary. Two distinct messages: mid-recording
          continues into a new segment automatically (not a stop/pause); the last
          allowed segment ends recording for real once the cap (40 min total) is hit. */}
      {chunkWarning && recording && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)",
          borderRadius: 10, padding: "10px 14px", marginBottom: 8,
        }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>⏱</span>
          <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 500 }}>
            {chunkWarningFinal
              ? "Recording will end automatically in 30s — you've reached the 40-minute limit"
              : "Wrapping up this segment — recording continues automatically"}
          </div>
        </div>
      )}

      {/* Chunks being analysed */}
      {active.map((c, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(29,78,216,0.07)", border: "1px solid rgba(29,78,216,0.2)",
          borderRadius: 10, padding: "10px 14px", marginBottom: 8,
        }}>
          <Spinner />
          <div>
            <div style={{ fontSize: 12, color: "#a5b4fc", fontWeight: 500 }}>
              Analysing segment {(c.chunkIndex ?? 0) + 1}…
            </div>
            <div style={{ fontSize: 11, color: "#4a4d6a", marginTop: 2 }}>
              Transcribing and generating insights
            </div>
          </div>
        </div>
      ))}

      {/* Errors */}
      {errors.map((c, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 10, padding: "10px 14px", marginBottom: 8,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div>
            <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>
              Analysis failed — segment {(c.chunkIndex ?? 0) + 1}
            </div>
            <div style={{ fontSize: 11, color: "#4a4d6a", marginTop: 2 }}>
              {c.error || "Unknown error"}
            </div>
          </div>
          <button onClick={() => clearChunk(c)} style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "#4a4d6a", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}>×</button>
        </div>
      ))}

      {/* Completed */}
      {done.length > 0 && !recording && active.length === 0 && (
        <div style={{
          background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)",
          borderRadius: 10, padding: "10px 14px", marginBottom: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "#86efac", fontWeight: 500 }}>
                Analysis complete — {done.length} segment{done.length > 1 ? "s" : ""} ready
              </div>
            </div>
            <button onClick={clearAll} style={{
              background: "none", border: "none",
              color: "#4a4d6a", cursor: "pointer", fontSize: 16, lineHeight: 1,
            }}>×</button>
          </div>
          <button
            onClick={() => { clearAll(); onViewHistory?.() }}
            style={{
              marginTop: 8, width: "100%",
              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 6, padding: "6px 0",
              color: "#86efac", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            View in History →
          </button>
        </div>
      )}
    </div>
  )
}

function clearChunk(chunk) {
  chrome.storage.local.remove(chunk._key || `chunk_${chunk.chunkIndex}`)
}

function clearAll() {
  chrome.storage.local.get(null, (items) => {
    const keys = Object.keys(items).filter(k => k.startsWith("chunk_"))
    chrome.storage.local.remove(keys)
  })
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#1d4ed8" strokeWidth="2" strokeDasharray="20 14" strokeLinecap="round"/>
    </svg>
  )
}
