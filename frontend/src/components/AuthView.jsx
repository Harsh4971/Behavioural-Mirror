import { useState, useRef } from "react"
import { supabase } from "../lib/supabase"

const G = "linear-gradient(135deg, #d946ef 0%, #f97316 100%)"

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
      if (mode === "signup") {
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

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🪞</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px",
            letterSpacing: "-0.5px", background: G,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text" }}>
            mirror
          </h1>
          <p style={{ color: "#4a4865", fontSize: 13, margin: 0 }}>
            {mode === "login"
              ? "Sign in to access your sessions."
              : "Create an account to get started."}
          </p>
        </div>

        {/* Card */}
        <div style={{ background: "#14141f", border: "1px solid #2a2a42",
          borderRadius: 16, padding: 28,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500,
                marginBottom: 6, color: "#8b89aa" }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required style={{ width: "100%", padding: "10px 12px", fontSize: 14 }} />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500,
                marginBottom: 6, color: "#8b89aa" }}>Password</label>
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
              style={{ width: "100%", padding: "13px 24px",
                background: loading ? "#1a1a2e" : G,
                color: loading ? "#4a4865" : "white",
                border: loading ? "1px solid #2a2a42" : "none",
                borderRadius: 8, fontSize: 15,
                cursor: loading ? "not-allowed" : "pointer", fontWeight: 600,
                boxShadow: loading ? "none" : "0 0 24px rgba(217,70,239,0.3)",
                transition: "all 0.15s" }}>
              {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage("") }}
              style={{ background: "none", border: "none", cursor: "pointer",
                color: "#4a4865", fontSize: 13 }}>
              {mode === "login"
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
