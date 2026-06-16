import { useState, useRef } from "react"
import { supabase } from "../lib/supabase"

const G = "linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)"

export default function AuthView({ onAuth }) {
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const hideTimerRef = useRef(null)

  const togglePassword = () => {
    if (showPassword) {
      setShowPassword(false)
      clearTimeout(hideTimerRef.current)
    } else {
      setShowPassword(true)
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => setShowPassword(false), 7000)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setMessage("")
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        if (error) throw error
        setMessage("Password reset link sent — check your email.")
        setMode("login")
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage("Check your email for a confirmation link.")
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onAuth(data.session)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id

  const handleGoogle = async () => {
    setLoading(true)
    setError("")

    if (isExtension) {
      try {
        const redirectUrl = chrome.identity.getRedirectURL()
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
        })
        if (error || !data?.url) throw error || new Error("No auth URL returned")

        chrome.identity.launchWebAuthFlow(
          { url: data.url, interactive: true },
          async (callbackUrl) => {
            if (chrome.runtime.lastError || !callbackUrl) {
              setError("Google sign-in was cancelled or failed.")
              setLoading(false)
              return
            }
            const parsed = new URL(callbackUrl)
            const hashParams = new URLSearchParams(parsed.hash.substring(1))

            // Tokens can be in hash (implicit) or query params (some Supabase versions)
            const accessToken = hashParams.get("access_token") || parsed.searchParams.get("access_token")
            const refreshToken = hashParams.get("refresh_token") || parsed.searchParams.get("refresh_token") || ""

            if (accessToken) {
              const { data: s, error: se } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
              if (se) setError(se.message)
              else onAuth(s.session)
              setLoading(false)
              return
            }

            // PKCE: exchange authorization code
            const code = parsed.searchParams.get("code") || hashParams.get("code")
            if (code) {
              const { data: s, error: se } = await supabase.auth.exchangeCodeForSession(code)
              if (se) setError(se.message)
              else onAuth(s.session)
              setLoading(false)
              return
            }

            // Show the actual error from the URL if present
            const oauthError = hashParams.get("error_description") || parsed.searchParams.get("error_description")
              || hashParams.get("error") || parsed.searchParams.get("error")
            setError(oauthError || "Could not retrieve session from Google.")
            setLoading(false)
          }
        )
      } catch (e) {
        setError(e.message)
        setLoading(false)
      }
      return
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }} className="view-enter">

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <svg width="48" height="48" viewBox="0 0 52 52" fill="none" style={{ marginBottom: 14 }}>
            <defs>
              <linearGradient id="auth-g" x1="0" y1="0" x2="52" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1d4ed8"/><stop offset="1" stopColor="#0891b2"/>
              </linearGradient>
            </defs>
            <rect x="2"  y="20" width="6"  height="6"  rx="3" fill="url(#auth-g)" opacity=".35"/>
            <rect x="11" y="13" width="6"  height="13" rx="3" fill="url(#auth-g)" opacity=".6"/>
            <rect x="20" y="6"  width="8"  height="20" rx="4" fill="url(#auth-g)"/>
            <rect x="31" y="13" width="6"  height="13" rx="3" fill="url(#auth-g)" opacity=".6"/>
            <rect x="40" y="20" width="6"  height="6"  rx="3" fill="url(#auth-g)" opacity=".35"/>
            <line x1="0" y1="28" x2="52" y2="28" stroke="#1e2438" strokeWidth="1.25"/>
            <rect x="2"  y="29" width="6"  height="6"  rx="3" fill="url(#auth-g)" opacity=".15"/>
            <rect x="11" y="29" width="6"  height="13" rx="3" fill="url(#auth-g)" opacity=".27"/>
            <rect x="20" y="29" width="8"  height="20" rx="4" fill="url(#auth-g)" opacity=".33"/>
            <rect x="31" y="29" width="6"  height="13" rx="3" fill="url(#auth-g)" opacity=".27"/>
            <rect x="40" y="29" width="6"  height="6"  rx="3" fill="url(#auth-g)" opacity=".15"/>
          </svg>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px",
            letterSpacing: "-0.5px", color: "#f0eeff" }}>
            mirror<span style={{ color: "#1d4ed8" }}>.</span>
          </h1>
          <p style={{ color: "#4a4865", fontSize: 13, margin: 0 }}>
            {mode === "login"
              ? "Sign in to access your sessions."
              : "Create an account to get started."}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "linear-gradient(#151922, #151922) padding-box, linear-gradient(135deg, rgba(29,78,216,0.35), rgba(34,211,238,0.35)) border-box",
          border: "1px solid transparent",
          borderRadius: 16, padding: 28,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)"
        }}>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500,
                marginBottom: 6, color: "#8b89aa" }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required style={{ width: "100%", padding: "10px 12px", fontSize: 14 }} />
            </div>

            {mode === "reset" ? null : (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#8b89aa" }}>Password</label>
                {mode === "login" && (
                  <button type="button"
                    onClick={() => { setMode("reset"); setError(""); setMessage("") }}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      fontSize: 12, color: "#4a4865", padding: 0 }}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password} onChange={e => setPassword(e.target.value)}
                  required minLength={6}
                  style={{ width: "100%", padding: "10px 40px 10px 12px", fontSize: 14 }}
                />
                <button type="button" onClick={togglePassword}
                  style={{ position: "absolute", right: 10, top: "50%",
                    transform: "translateY(-50%)", background: "none", border: "none",
                    cursor: "pointer", padding: 4, color: "#4a4865", fontSize: 15, lineHeight: 1 }}>
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            )}

            {error && (
              <div style={{ background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.25)",
                borderRadius: 8, padding: 12, marginBottom: 16,
                fontSize: 13, color: "#f87171" }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{ background: "rgba(52,211,153,0.08)",
                border: "1px solid rgba(52,211,153,0.25)",
                borderRadius: 8, padding: 12, marginBottom: 16,
                fontSize: 13, color: "#34d399" }}>
                {message}
              </div>
            )}

            <button type="submit" disabled={loading}
              className={loading ? "" : "btn-grad"}
              style={{ width: "100%", padding: "13px 24px",
                background: loading ? "#151922" : G,
                color: loading ? "#4a4865" : "white",
                border: loading ? "1px solid #1e2438" : "none",
                borderRadius: 8, fontSize: 15,
                cursor: loading ? "not-allowed" : "pointer", fontWeight: 600,
                boxShadow: loading ? "none" : "0 0 24px rgba(29,78,216,0.3)" }}>
              {loading ? "…" : mode === "login" ? "Sign in" : mode === "reset" ? "Send reset link" : "Create account"}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
            <div style={{ flex: 1, height: 1, background: "#1e2438" }} />
            <span style={{ fontSize: 12, color: "#4a4865" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#1e2438" }} />
          </div>

          {/* Google OAuth — hidden in extension (requires different OAuth setup) */}
          <button type="button" onClick={handleGoogle} disabled={loading}
            style={{ width: "100%", padding: "11px 24px", fontSize: 14, fontWeight: 500,
              cursor: loading ? "not-allowed" : "pointer",
              background: "#0e1320", color: "#d4d2e8",
              border: "1px solid #1e2438", borderRadius: 8,
              display: isExtension ? "none" : "flex",
              alignItems: "center", justifyContent: "center", gap: 10,
              transition: "border-color 0.15s", opacity: loading ? 0.5 : 1 }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#4a4865"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2438"}>
            <svg width="17" height="17" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage("") }}
              style={{ background: "none", border: "none", cursor: "pointer",
                color: "#4a4865", fontSize: 13 }}>
              {mode === "reset"
                ? "Back to sign in"
                : mode === "login"
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
