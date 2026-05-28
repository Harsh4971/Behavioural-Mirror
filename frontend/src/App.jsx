import { useState } from "react"
import UploadView from "./components/UploadView"
import ResultsView from "./components/ResultsView"
import HistoryView from "./components/HistoryView"

function getOrCreateUserId() {
  let id = localStorage.getItem("bm_user_id")
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem("bm_user_id", id)
  }
  return id
}

const USER_ID = getOrCreateUserId()

export default function App() {
  const [view, setView] = useState("upload")
  const [results, setResults] = useState(null)

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🪞 Behavioral Mirror</h1>
        <p style={{ color: "#666", marginTop: 4, fontSize: 14, margin: 0 }}>
          Reflective insights from your conversations
        </p>
      </div>

      <nav style={{ display: "flex", gap: 20, marginBottom: 32,
        borderBottom: "1px solid #eee", paddingBottom: 12 }}>
        {["upload", "history"].map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ background: "none", border: "none", cursor: "pointer",
              fontWeight: view === v ? 600 : 400, fontSize: 14,
              color: view === v ? "#111" : "#888",
              borderBottom: view === v ? "2px solid #111" : "2px solid transparent",
              paddingBottom: 4, textTransform: "capitalize" }}>
            {v}
          </button>
        ))}
      </nav>

      <div style={{ display: view === "upload" ? "block" : "none" }}>
        <UploadView
          userId={USER_ID}
          onResults={(r) => { setResults(r); setView("results") }}
          onActivate={() => setView("upload")}
        />
      </div>
      {view === "results" && results && (
        <ResultsView
          results={results}
          onBack={() => setView("history")}
          onReanalyze={() => setView("upload")}
        />
      )}
      <div style={{ display: view === "history" ? "block" : "none" }}>
        <HistoryView
          userId={USER_ID}
          active={view === "history"}
          onSelect={(r) => { setResults(r); setView("results") }}
        />
      </div>
    </div>
  )
}