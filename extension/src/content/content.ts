// Content script: injects the Klai overlay React root over the page <video>
// and handles messages from the popup.

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Overlay } from './Overlay'

// ---------------------------------------------------------------------------
// Watch mode polling
// ---------------------------------------------------------------------------
// The polling timer lives here (content script) because it must survive popup
// close/open cycles. Each tick asks the SERVICE WORKER to capture the tab
// (content scripts cannot call captureVisibleTab). The service worker returns
// a suggestion layout or null.
// ---------------------------------------------------------------------------

/** Interval between watch-mode detect probes. */
const WATCH_INTERVAL_MS = 3500

let watchInterval: ReturnType<typeof setInterval> | null = null

/** Guard: skip a tick if a previous detect is still in flight. */
let detectBusy = false

function startWatchMode(): void {
  if (watchInterval !== null) return // already running

  watchInterval = setInterval(async () => {
    if (detectBusy) return
    detectBusy = true

    try {
      const response = await chrome.runtime.sendMessage({ type: 'KLAI_DETECT' })
      if (response !== null && response !== undefined) {
        const { suggestion, scoreState } = response as { suggestion: unknown; scoreState: unknown }
        // Dispatch klai:suggestion when the backend detected something notable.
        if (suggestion !== null && suggestion !== undefined) {
          window.dispatchEvent(new CustomEvent('klai:suggestion', { detail: suggestion }))
        }
        // Always dispatch klai:score-state so the overlay can manage the fill-the-gap scoreboard.
        if (scoreState !== null && scoreState !== undefined) {
          window.dispatchEvent(new CustomEvent('klai:score-state', { detail: scoreState }))
        }
      }
    } catch {
      // Runtime may be unavailable briefly during extension reload.
    } finally {
      detectBusy = false
    }
  }, WATCH_INTERVAL_MS)

  console.log('[Klai] Watch mode started (interval %dms)', WATCH_INTERVAL_MS)
}

function stopWatchMode(): void {
  if (watchInterval !== null) {
    clearInterval(watchInterval)
    watchInterval = null
    detectBusy = false
    console.log('[Klai] Watch mode stopped')
  }
}

// ---------------------------------------------------------------------------
// Overlay mount
// ---------------------------------------------------------------------------

let overlayRoot: ReactDOM.Root | null = null

function mount() {
  // Avoid double-mounting
  if (document.getElementById('klai-root')) return

  const container = document.createElement('div')
  container.id = 'klai-root'
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
  `
  document.body.appendChild(container)

  overlayRoot = ReactDOM.createRoot(container)
  overlayRoot.render(React.createElement(Overlay))
}

// Mount immediately if DOM is ready, otherwise wait.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}

// ---------------------------------------------------------------------------
// Message listeners
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Presence check used by ensureContentScript() before delivering KLAI_TEXT.
  if (message?.type === 'KLAI_PING') {
    sendResponse({ ok: true })
    return
  }

  // Manual query from popup (text + optional screenshot).
  if (message?.type === 'KLAI_TEXT' && typeof message.text === 'string') {
    const detail: { text: string; image?: string } = { text: message.text }
    if (typeof message.image === 'string') detail.image = message.image
    window.dispatchEvent(new CustomEvent('klai:query', { detail }))
  }

  // Watch mode toggle from popup.
  if (message?.type === 'KLAI_WATCH' && typeof message.enabled === 'boolean') {
    if (message.enabled) {
      startWatchMode()
    } else {
      stopWatchMode()
    }
  }

  // Voice pipeline state from the service worker — forward to the overlay.
  if (message?.type === 'KLAI_VOICE_STATE' && typeof message.state === 'string') {
    window.dispatchEvent(
      new CustomEvent('klai:voice-state', { detail: { state: message.state } }),
    )
  }
})

// ---------------------------------------------------------------------------
// Resume watch mode if it was active before a page reload.
// ---------------------------------------------------------------------------
chrome.storage.local.get('watchMode', (result) => {
  if (result.watchMode === true) {
    startWatchMode()
  }
})
