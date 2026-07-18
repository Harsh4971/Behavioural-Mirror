import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import api from "./lib/api"
import { LogoLockup } from "./components/Logo"
import AuthView from "./components/AuthView"
import OnboardingView from "./components/OnboardingView"
import ResultsView from "./components/ResultsView"
import HistoryView from "./components/HistoryView"
import ProfileView from "./components/ProfileView"
import HomeView from "./components/HomeView"
import HowItWorksView from "./components/HowItWorksView"
import MeetStatusBanner from "./components/MeetStatusBanner"
import FeedbackModal from "./components/FeedbackModal"

const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id
const isFullPage = new URLSearchParams(window.location.search).get("fullpage") === "1"

function openFullPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") + "?fullpage=1" })
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [onboardingDone, setOnboardingDone] = useState(
    () => !!localStorage.getItem("bm_onboarding_v1")
  )
  const [view, setView] = useState("home")
  const [results, setResults] = useState(null)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)

  // Each key tracks how many times we've navigated TO that view — re-mounting
  // the wrapper div causes the .view-enter animation to fire every tab switch.
  const [viewKeys, setViewKeys] = useState({ home: 0, profile: 0, history: 0 })

  useEffect(() => {
    if (view === "home" || view === "profile" || view === "history") {
      setViewKeys(k => ({ ...k, [view]: k[view] + 1 }))
    }
  }, [view])

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await api.delete("/api/account")
      await supabase.auth.signOut()
      setDeleting(false)
      setConfirmDelete(false)
    } catch (e) {
      console.error("Delete account failed:", e)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
      // Sync token on initial load so background worker can authenticate Meet uploads
      if (session && typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          action: 'sync_token',
          token: session.access_token,
          userId: session.user.id,
        }).catch(() => {})
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setConfirmDelete(false)
        setShowAccountMenu(false)
        setDeleting(false)
      }
      if (session) {
        // Keep background service worker's JWT in sync for Meet recording
        if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
          chrome.runtime.sendMessage({
            action: 'sync_token',
            token: session.access_token,
            userId: session.user.id,
          }).catch(() => {})
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Lets background.js force a fresh token on demand (e.g. after a 401 mid-recording) —
  // getSession() proactively refreshes if the current session is expired, regardless of
  // whether Supabase's own background auto-refresh timer has fired yet.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return
    function onMessage(msg, _sender, sendResponse) {
      if (msg.action !== 'request_token_refresh') return
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          chrome.runtime.sendMessage({
            action: 'sync_token',
            token: session.access_token,
            userId: session.user.id,
          }).catch(() => {})
        }
        sendResponse({ token: session?.access_token || null, userId: session?.user?.id || null })
      })
      return true
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  if (authLoading) return (
    <div style={{ textAlign: "center", padding: 80, color: "#2e3464" }}>
      Loading…
    </div>
  )

  if (!session) return <AuthView onAuth={setSession} />

  if (!onboardingDone) return (
    <OnboardingView onDone={() => setOnboardingDone(true)} />
  )

  return (
    <>
    {/* Ambient background blobs */}
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <div style={{
        position: "absolute", top: "-15%", right: "-8%",
        width: 650, height: 650, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(29,78,216,0.09) 0%, transparent 68%)",
        filter: "blur(1px)",
        animation: "blobDrift1 22s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", bottom: "-12%", left: "-6%",
        width: 550, height: 550, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(8,145,178,0.07) 0%, transparent 68%)",
        filter: "blur(1px)",
        animation: "blobDrift2 28s ease-in-out infinite",
      }} />
    </div>

    <div style={{ maxWidth: isFullPage ? 900 : 600, margin: "0 auto", padding: isFullPage ? "32px 40px" : 24, position: "relative", zIndex: 1 }}>

      {/* Header */}
      <div style={{ marginBottom: 28, display: "flex",
        justifyContent: "space-between", alignItems: "flex-start" }}>
        <LogoLockup markSize={26} fontSize={22} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Open as full page — only in side panel */}
          {isExtension && !isFullPage && (
            <button
              onClick={openFullPage}
              title="Open in full page"
              style={{
                background: "none", border: "1px solid #1e2438",
                borderRadius: 7, padding: "6px 10px",
                cursor: "pointer", color: "#4a4865",
                display: "flex", alignItems: "center",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#2e3464"; e.currentTarget.style.color = "#8b89aa" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e2438"; e.currentTarget.style.color = "#4a4865" }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M8.5 1.5H12.5V5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12.5 1.5L7.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M6 2.5H2.5C1.9 2.5 1.5 2.9 1.5 3.5V11.5C1.5 12.1 1.9 12.5 2.5 12.5H10.5C11.1 12.5 11.5 12.1 11.5 11.5V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}

        <div style={{ position: "relative" }}>
          {confirmDelete ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8,
              background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              <span style={{ color: "#f87171" }}>Delete all data?</span>
              <button onClick={() => { setConfirmDelete(false); setShowAccountMenu(false) }}
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: "#8b89aa", fontSize: 13, padding: "0 4px" }}>
                Cancel
              </button>
              <button onClick={handleDeleteAccount} disabled={deleting}
                style={{ background: "#f87171", color: "white", border: "none",
                  borderRadius: 6, padding: "4px 12px", fontSize: 13, fontWeight: 600,
                  cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.6 : 1 }}>
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          ) : (
            <>
              <button onClick={() => setShowAccountMenu(v => !v)}
                style={{ background: "#151922", border: "1px solid #1e2438", borderRadius: 7,
                  padding: "6px 14px", cursor: "pointer", fontSize: 13, color: "#8b89aa" }}>
                Account ▾
              </button>
              {showAccountMenu && (
                <div style={{ position: "absolute", right: 0, top: "110%",
                  background: "#151922", border: "1px solid #1e2438", borderRadius: 10,
                  boxShadow: "0 8px 40px rgba(0,0,0,0.7)", zIndex: 20,
                  minWidth: 200, overflow: "hidden" }}>
                  {[
                    { label: "How it works",
                      onClick: () => { setView("howItWorks"); setShowAccountMenu(false) },
                      color: "#f0eeff" },
                    { label: "Send feedback",
                      onClick: () => { setShowFeedback(true); setShowAccountMenu(false) },
                      color: "#f0eeff" },
                    { label: "Sign out",
                      onClick: () => { supabase.auth.signOut(); setShowAccountMenu(false) },
                      color: "#f0eeff" },
                    { label: "Delete account",
                      onClick: () => { setConfirmDelete(true); setShowAccountMenu(false) },
                      color: "#f87171" },
                  ].map(({ label, onClick, color }) => (
                    <button key={label} onClick={onClick}
                      style={{ display: "block", width: "100%", padding: "10px 14px",
                        textAlign: "left", background: "none", border: "none",
                        borderBottom: "1px solid #1e2438",
                        cursor: "pointer", fontSize: 13, color }}>
                      {label}
                    </button>
                  ))}
                  <a
                    href="https://mirrorai.live/privacy"
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "block", padding: "10px 14px",
                      fontSize: 13, color: "#4a4d6a", textDecoration: "none" }}
                    onMouseEnter={e => e.currentTarget.style.color = "#8b89aa"}
                    onMouseLeave={e => e.currentTarget.style.color = "#4a4d6a"}>
                    Privacy Policy
                  </a>
                </div>
              )}
            </>
          )}
        </div>
        </div>{/* end flex header-right */}
      </div>

      {!isFullPage && <MeetStatusBanner onViewHistory={() => setView("history")} />}

      {/* Nav */}
      <nav style={{ display: "flex", gap: 0, marginBottom: 32,
        borderBottom: "1px solid #1e2438" }}>
        {[
          { key: "home", label: "Home" },
          { key: "profile", label: "You" },
          { key: "history", label: "History" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setView(key)}
            className={`nav-tab${view === key ? " active" : ""}`}
            style={{ background: "none", border: "none", cursor: "pointer",
              fontWeight: view === key ? 600 : 400, fontSize: 14,
              color: view === key ? "#5b9cf6" : "#8b89aa",
              padding: "0 16px 12px" }}>
            {label}
          </button>
        ))}
      </nav>

      {showFeedback && (
        <FeedbackModal onClose={() => setShowFeedback(false)} />
      )}

      {view === "howItWorks" && (
        <HowItWorksView onBack={() => setView("home")} />
      )}

      {/* Persistent views — kept mounted, but wrapper remounts each tab visit
          so .view-enter animation fires every time you switch to that tab */}
      <div style={{ display: view === "home" ? "block" : "none" }}>
        <div key={`home-${viewKeys.home}`} className="view-enter">
          <HomeView active={view === "home"} />
        </div>
      </div>
      <div style={{ display: view === "profile" ? "block" : "none" }}>
        <div key={`profile-${viewKeys.profile}`} className="view-enter">
          <ProfileView active={view === "profile"} />
        </div>
      </div>
      {view === "results" && results && (
        <div className="view-enter">
          <ResultsView results={results} onBack={() => setView("history")} />
        </div>
      )}
      <div style={{ display: view === "history" ? "block" : "none" }}>
        <div key={`history-${viewKeys.history}`} className="view-enter">
          <HistoryView active={view === "history"}
            onSelect={(r) => { setResults(r); setView("results") }} />
        </div>
      </div>
    </div>
    </>
  )
}
