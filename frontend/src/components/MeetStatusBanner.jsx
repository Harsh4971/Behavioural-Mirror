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

  function handleStartRecording() {
    setRecordError(null)
    // Push a fresh Supabase token into the SW right before recording starts.
    // The SW stores tokens manually and doesn't auto-refresh — syncing here
    // ensures the chunk upload won't fail with a stale JWT.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        chrome.runtime.sendMessage({
          action: "sync_token",
          token: session.access_token,
          userId: session.user.id,
        }).catch(() => {})
      }
      chrome.runtime.sendMessage({
        action: "start_recording_with_stream",
        tabId: meetTabId,
        mode: "tabcapture",
      }, (res) => {
        if (chrome.runtime.lastError || res?.error) {
          const msg = res?.error || chrome.runtime.lastError?.message || "Failed to start"
          setRecordError(msg)
        }
      })
    }).catch(() => {
      chrome.runtime.sendMessage({
        action: "start_recording_with_stream",
        tabId: meetTabId,
        mode: "tabcapture",
      }, (res) => {
        if (chrome.runtime.lastError || res?.error) {
          const msg = res?.error || chrome.runtime.lastError?.message || "Failed to start"
          setRecordError(msg)
        }
      })
    })
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
                {recording ? "Recording…" : "Google Meet detected"}
              </span>
            </div>

            {!recording ? (
              <button onClick={handleStartRecording} disabled={!streamReady} style={{
                background: streamReady
                  ? "linear-gradient(90deg, #1d4ed8, #0891b2)"
                  : "rgba(29,78,216,0.15)",
                border: streamReady ? "none" : "1px solid rgba(29,78,216,0.3)",
                borderRadius: 8, padding: "7px 16px",
                color: streamReady ? "#fff" : "#4a6fa8",
                fontSize: 13, fontWeight: 600,
                cursor: streamReady ? "pointer" : "not-allowed",
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

          {/* Prompt to click the toolbar icon if stream not ready */}
          {!recording && !streamReady && !prefetchError && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#8b89aa", lineHeight: 1.5 }}>
              Click the <strong style={{ color: "#a5b4fc" }}>Mirror icon</strong> in the Chrome toolbar
              to activate recording for this tab.
            </div>
          )}

          {/* Show the actual Chrome error if pre-fetch failed */}
          {!recording && prefetchError && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#f87171", lineHeight: 1.5 }}>
              Chrome error: {prefetchError}
            </div>
          )}

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
