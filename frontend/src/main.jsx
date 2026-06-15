import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Keep the background service worker alive while the side panel is open.
// The SW's tabCapture invocation (from the user clicking the extension icon) is
// bound to the specific SW instance — if it terminates and restarts, the invocation
// is lost and recording fails. An open port prevents termination.
if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
  chrome.runtime.connect({ name: 'sidepanel-keepalive' });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
