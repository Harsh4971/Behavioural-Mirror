import { useState, useEffect, useRef } from "react"
import { supabase } from "../lib/supabase"

export default function MeetStatusBanner() {
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
  const timerRef = useRef(null)
  const dismissTimers = useRef([])

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

  // Auto-dismiss completed and error chunks after 5 seconds
  useEffect(() => {
    const settled = chunks.filter(c => c.status === "done" || c.status === "error")
    if (settled.length === 0) return

    const t = setTimeout(() => {
      chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items).filter(k => {
          const v = items[k]
          return k.startsWith("chunk_") && (v.status === "done" || v.status === "error")
        })
        if (keys.length > 0) chrome.storage.local.remove(keys)
      })
    }, 5000)

    dismissTimers.current.push(t)
    return () => clearTimeout(t)
  }, [chunks])

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

    refresh()
    checkTab()
    chrome.storage.onChanged.addListener(onStorageChanged)
    const ri = setInterval(refresh, 3000)
    const ti = setInterval(checkTab, 2000)
    return () => {
      clearInterval(ri)
      clearInterval(ti)
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [])

  function handleStartRecordingConfirmed() {
    setRecordError(null)
    if (!meetTabId) { setRecordError('No Meet tab found'); return }

    // Get a fresh stream ID RIGHT NOW at button-click time.
    // Stream IDs from getMediaStreamId expire within seconds — pre-fetching
    // them on toolbar-icon click (the old approach) caused "Error starting tab capture"
    // because too much time passed before the offscreen doc called getUserMedia.
    chrome.tabCapture.getMediaStreamId({ targetTabId: meetTabId }, (freshStreamId) => {
      if (chrome.runtime.lastError || !freshStreamId) {
        const err = chrome.runtime.lastError?.message || 'Unknown error'
        console.error('[mirror-panel] getMediaStreamId failed:', err)
        setRecordError(`Tab capture failed: ${err}`)
        return
      }

      const startWithStream = (streamId) => {
        const recMode = webrtcReady ? "webrtc" : "tabcapture"
        chrome.runtime.sendMessage({
          action: "start_recording_with_stream",
          tabId: meetTabId,
          mode: recMode,
          streamId,
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
        startWithStream(freshStreamId)
      }).catch(() => startWithStream(freshStreamId))
    })
  }

  function handleStartRecording() {
    if (!localStorage.getItem("mirror_consent_v1")) {
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
              Before you record
            </h3>
            <p style={{ fontSize: 13, color: "#8b89aa", lineHeight: 1.7,
              margin: "0 0 20px", textAlign: "center" }}>
              You are responsible for ensuring all meeting participants are aware
              this conversation is being recorded. Please obtain consent from
              everyone in the call before starting.
            </p>
            <button
              onClick={() => {
                localStorage.setItem("mirror_consent_v1", "1")
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

      {/* Meet recording controls */}
      {onMeet && (
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
              <button onClick={handleStartRecording} style={{
                background: "linear-gradient(90deg, #1d4ed8, #0891b2)",
                border: "none",
                borderRadius: 8, padding: "7px 16px",
                color: "#fff",
                fontSize: 13, fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}>
                Start Recording
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

          {recordError && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{recordError}</div>
          )}
        </div>
      )}

      <style>{`@keyframes mirrorBannerPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

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
              Analysing minutes {c.startMin}–{c.endMin}…
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
              Analysis failed — minutes {c.startMin}–{c.endMin}
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
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)",
          borderRadius: 10, padding: "10px 14px", marginBottom: 8,
        }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>✓</span>
          <div>
            <div style={{ fontSize: 12, color: "#86efac", fontWeight: 500 }}>
              Meet insights ready — check History
            </div>
            <div style={{ fontSize: 11, color: "#4a4d6a", marginTop: 2 }}>
              {done.length} segment{done.length > 1 ? "s" : ""} analysed
            </div>
          </div>
          <button onClick={clearAll} style={{
            marginLeft: "auto", background: "none", border: "none",
            color: "#4a4d6a", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}>×</button>
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
