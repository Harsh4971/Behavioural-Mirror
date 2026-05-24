import { useState } from "react"
import UploadView from "./components/UploadView"
import ResultsView from "./components/ResultsView"
import HistoryView from "./components/HistoryView"

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

      {view === "upload" && (
        <UploadView onResults={(r) => { setResults(r); setView("results") }} />
      )}
      {view === "results" && results && (
        <ResultsView
          results={results}
          onBack={() => setView("upload")}
          onReanalyze={(newSpeaker) => {
            setView("upload")
          }}
        />
      )}
      {view === "history" && (
        <HistoryView onSelect={(r) => { setResults(r); setView("results") }} />
      )}
    </div>
  )
}