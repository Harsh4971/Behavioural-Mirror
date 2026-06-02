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

const G = "linear-gradient(135deg, #d946ef 0%, #f97316 100%)"

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
        // Network error = backend offline → let user through to main app
        // API error (4xx) = backend up but not enrolled → show enrollment
        setEnrollState(e.response ? "needed" : "done")
      })
  }, [session])

  if (authLoading || (session && enrollState === "checking")) return (
    <div style={{ textAlign: "center", padding: 80, color: "#4a4865" }}>
      Loading…
    </div>
  )

  if (!session) return <AuthView onAuth={setSession} />

  if (!onboardingDone) return (
    <OnboardingView onDone={() => setOnboardingDone(true)} />
  )

  if (enrollState === "needed") return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#f0eeff",
          letterSpacing: "-0.3px" }}>
          🪞 Behavioural Mirror
        </h1>
        <p style={{ color: "#4a4865", fontSize: 13, margin: "4px 0 0" }}>
          Reflective insights from your conversations
        </p>
      </div>
      <EnrollView onEnrolled={() => setEnrollState("done")} onSkip={() => setEnrollState("done")} />
    </div>
  )

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24 }}>

      {/* Header */}
      <div style={{ marginBottom: 28, display: "flex",
        justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.3px" }}>
            <span style={{ background: G, WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              mirror
            </span>
          </h1>
          <p style={{ color: "#4a4865", fontSize: 13, margin: "4px 0 0" }}>
            Reflective insights from your conversations
          </p>
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
                style={{ background: "#14141f", border: "1px solid #2a2a42", borderRadius: 7,
                  padding: "6px 14px", cursor: "pointer", fontSize: 13, color: "#8b89aa" }}>
                Account ▾
              </button>
              {showAccountMenu && (
                <div style={{ position: "absolute", right: 0, top: "110%",
                  background: "#14141f", border: "1px solid #2a2a42", borderRadius: 10,
                  boxShadow: "0 8px 40px rgba(0,0,0,0.6)", zIndex: 20,
                  minWidth: 200, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px 6px", fontSize: 11,
                    color: "#4a4865", borderBottom: "1px solid #2a2a42",
                    textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Voice — {enrollState === "done" ? "enrolled" : "not enrolled"}
                  </div>
                  {[
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
                        borderBottom: "1px solid #2a2a42",
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
        borderBottom: "1px solid #2a2a42" }}>
        {[
          { key: "profile", label: "Profile" },
          { key: "upload", label: "Upload" },
          { key: "history", label: "History" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setView(key)}
            style={{ background: "none", border: "none", cursor: "pointer",
              fontWeight: view === key ? 600 : 400, fontSize: 14,
              color: view === key ? "#e879f9" : "#8b89aa",
              borderBottom: view === key ? "2px solid #e879f9" : "2px solid transparent",
              padding: "0 16px 12px", transition: "color 0.15s" }}>
            {label}
          </button>
        ))}
      </nav>

      {/* Re-enroll modal */}
      {showReenroll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
          zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#14141f", border: "1px solid #2a2a42",
            borderRadius: 16, maxWidth: 500, width: "90%", maxHeight: "90vh",
            overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "20px 24px 0" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#f0eeff" }}>
                Retrain your voice
              </span>
              <button onClick={() => setShowReenroll(false)}
                style={{ background: "none", border: "none", cursor: "pointer",
                  fontSize: 20, color: "#4a4865", lineHeight: 1 }}>×</button>
            </div>
            <EnrollView
              onEnrolled={() => { setShowReenroll(false); setEnrollState("done") }}
              onSkip={() => setShowReenroll(false)}
            />
          </div>
        </div>
      )}

      <div style={{ display: view === "profile" ? "block" : "none" }}>
        <ProfileView active={view === "profile"} onUpload={() => setView("upload")} />
      </div>
      <div style={{ display: view === "upload" ? "block" : "none" }}>
        <UploadView
          onResults={(r) => { setResults(r); setView("results") }}
          onActivate={() => setView("upload")}
        />
      </div>
      {view === "results" && results && (
        <ResultsView results={results} onBack={() => setView("history")} />
      )}
      <div style={{ display: view === "history" ? "block" : "none" }}>
        <HistoryView active={view === "history"}
          onSelect={(r) => { setResults(r); setView("results") }} />
      </div>
    </div>
  )
}
