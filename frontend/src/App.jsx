import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import api from "./lib/api"
import AuthView from "./components/AuthView"
import OnboardingView from "./components/OnboardingView"
import EnrollView from "./components/EnrollView"
import UploadView from "./components/UploadView"
import ResultsView from "./components/ResultsView"
import HistoryView from "./components/HistoryView"
import ProfileView from "./components/ProfileView"
import HowItWorksView from "./components/HowItWorksView"

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [enrollState, setEnrollState] = useState("checking")
  const [onboardingDone, setOnboardingDone] = useState(
    () => !!localStorage.getItem("bm_onboarding_v1")
  )
  const [view, setView] = useState("profile")
  const [results, setResults] = useState(null)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showReenroll, setShowReenroll] = useState(false)

  // Each key tracks how many times we've navigated TO that view — re-mounting
  // the wrapper div causes the .view-enter animation to fire every tab switch.
  const [viewKeys, setViewKeys] = useState({ profile: 0, upload: 0, history: 0 })

  useEffect(() => {
    if (view === "profile" || view === "upload" || view === "history") {
      setViewKeys(k => ({ ...k, [view]: k[view] + 1 }))
    }
  }, [view])

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await api.delete("/api/account")
      await supabase.auth.signOut()
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
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) setEnrollState("checking")
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    api.get("/api/voiceprint/status")
      .then(res => setEnrollState(res.data.enrolled ? "done" : "needed"))
      .catch((e) => {
        setEnrollState(e.response ? "needed" : "done")
      })
  }, [session])

  if (authLoading || (session && enrollState === "checking")) return (
    <div style={{ textAlign: "center", padding: 80, color: "#2e3464" }}>
      Loading…
    </div>
  )

  if (!session) return <AuthView onAuth={setSession} />

  if (!onboardingDone) return (
    <OnboardingView onDone={() => setOnboardingDone(true)} />
  )

  if (enrollState === "needed") return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24 }}>
      <div style={{ marginBottom: 28, display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="enr-g" x1="0" y1="0" x2="32" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1d4ed8"/><stop offset="1" stopColor="#0891b2"/>
            </linearGradient>
          </defs>
          <rect x="2"  y="12" width="4" height="4"  rx="2" fill="url(#enr-g)" opacity=".4"/>
          <rect x="8"  y="8"  width="4" height="8"  rx="2" fill="url(#enr-g)" opacity=".65"/>
          <rect x="14" y="4"  width="4" height="12" rx="2" fill="url(#enr-g)"/>
          <rect x="20" y="8"  width="4" height="8"  rx="2" fill="url(#enr-g)" opacity=".65"/>
          <rect x="26" y="12" width="4" height="4"  rx="2" fill="url(#enr-g)" opacity=".4"/>
          <line x1="0" y1="17.5" x2="32" y2="17.5" stroke="#1e2438" strokeWidth="1"/>
          <rect x="2"  y="18" width="4" height="4"  rx="2" fill="url(#enr-g)" opacity=".18"/>
          <rect x="8"  y="18" width="4" height="8"  rx="2" fill="url(#enr-g)" opacity=".3"/>
          <rect x="14" y="18" width="4" height="12" rx="2" fill="url(#enr-g)" opacity=".38"/>
          <rect x="20" y="18" width="4" height="8"  rx="2" fill="url(#enr-g)" opacity=".3"/>
          <rect x="26" y="18" width="4" height="4"  rx="2" fill="url(#enr-g)" opacity=".18"/>
        </svg>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.3px", color: "#f0eeff" }}>
          mirror<span style={{ color: "#1d4ed8" }}>.</span>
        </h1>
      </div>
      <EnrollView onEnrolled={() => setEnrollState("done")} onSkip={() => setEnrollState("done")} />
    </div>
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

    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24, position: "relative", zIndex: 1 }}>

      {/* Header */}
      <div style={{ marginBottom: 28, display: "flex",
        justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
            <defs>
              <linearGradient id="hdr-g" x1="0" y1="0" x2="32" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1d4ed8"/><stop offset="1" stopColor="#0891b2"/>
              </linearGradient>
            </defs>
            <rect x="2"  y="12" width="4" height="4"  rx="2" fill="url(#hdr-g)" opacity=".4"/>
            <rect x="8"  y="8"  width="4" height="8"  rx="2" fill="url(#hdr-g)" opacity=".65"/>
            <rect x="14" y="4"  width="4" height="12" rx="2" fill="url(#hdr-g)"/>
            <rect x="20" y="8"  width="4" height="8"  rx="2" fill="url(#hdr-g)" opacity=".65"/>
            <rect x="26" y="12" width="4" height="4"  rx="2" fill="url(#hdr-g)" opacity=".4"/>
            <line x1="0" y1="17.5" x2="32" y2="17.5" stroke="#1e2438" strokeWidth="1"/>
            <rect x="2"  y="18" width="4" height="4"  rx="2" fill="url(#hdr-g)" opacity=".18"/>
            <rect x="8"  y="18" width="4" height="8"  rx="2" fill="url(#hdr-g)" opacity=".3"/>
            <rect x="14" y="18" width="4" height="12" rx="2" fill="url(#hdr-g)" opacity=".38"/>
            <rect x="20" y="18" width="4" height="8"  rx="2" fill="url(#hdr-g)" opacity=".3"/>
            <rect x="26" y="18" width="4" height="4"  rx="2" fill="url(#hdr-g)" opacity=".18"/>
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.3px", color: "#f0eeff" }}>
            mirror<span style={{ color: "#1d4ed8" }}>.</span>
          </h1>
        </div>

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
                  <div style={{ padding: "8px 14px 6px", fontSize: 11,
                    color: "#4a4d6a", borderBottom: "1px solid #1e2438",
                    textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Voice — {enrollState === "done" ? "enrolled" : "not enrolled"}
                  </div>
                  {[
                    { label: "How it works",
                      onClick: () => { setView("howItWorks"); setShowAccountMenu(false) },
                      color: "#f0eeff" },
                    { label: enrollState === "done" ? "Retrain your voice" : "Enroll your voice",
                      onClick: () => { setShowReenroll(true); setShowAccountMenu(false) },
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
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", gap: 0, marginBottom: 32,
        borderBottom: "1px solid #1e2438" }}>
        {[
          { key: "profile", label: "Profile" },
          { key: "upload", label: "Upload" },
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

      {/* Re-enroll modal */}
      {showReenroll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
          zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#151922", border: "1px solid #1e2438",
            borderRadius: 16, maxWidth: 500, width: "90%", maxHeight: "90vh",
            overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "20px 24px 0" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#f0eeff" }}>
                Retrain your voice
              </span>
              <button onClick={() => setShowReenroll(false)}
                style={{ background: "none", border: "none", cursor: "pointer",
                  fontSize: 20, color: "#4a4d6a", lineHeight: 1 }}>×</button>
            </div>
            <EnrollView
              onEnrolled={() => { setShowReenroll(false); setEnrollState("done") }}
              onSkip={() => setShowReenroll(false)}
            />
          </div>
        </div>
      )}

      {view === "howItWorks" && (
        <HowItWorksView onBack={() => setView("profile")} />
      )}

      {/* Persistent views — kept mounted, but wrapper remounts each tab visit
          so .view-enter animation fires every time you switch to that tab */}
      <div style={{ display: view === "profile" ? "block" : "none" }}>
        <div key={`profile-${viewKeys.profile}`} className="view-enter">
          <ProfileView active={view === "profile"} onUpload={() => setView("upload")} />
        </div>
      </div>
      <div style={{ display: view === "upload" ? "block" : "none" }}>
        <div key={`upload-${viewKeys.upload}`} className="view-enter">
          <UploadView
            onResults={(r) => { setResults(r); setView("results") }}
            onActivate={() => setView("upload")}
          />
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
