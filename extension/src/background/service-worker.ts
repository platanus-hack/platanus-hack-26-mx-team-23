// Background service worker (Manifest V3)
// Handles two responsibilities:
//   1. KLAI_DETECT — captures the visible tab and calls the backend in detect mode,
//      returning a suggestion (or null) to the requesting content script.
//   2. Lifecycle logging.

// Backend base URL — set VITE_BACKEND_BASE_URL at build time (e.g. the Vercel URL).
// Falls back to localhost for local development.
const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://localhost:3000'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Klai] Extension installed — background service worker ready.')
})

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
// Returns true to keep the message channel open for async sendResponse calls.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener(
  (
    message: { type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === 'KLAI_DETECT') {
      handleDetect(sender, sendResponse)
      // Return true = async response (channel stays open until sendResponse is called).
      return true
    }
  },
)

async function handleDetect(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const windowId = sender.tab?.windowId

  if (typeof windowId !== 'number') {
    sendResponse(null)
    return
  }

  // Capture the tab. captureVisibleTab is privileged — only the service worker can call it.
  let imageDataUrl: string
  try {
    imageDataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 70,
    })
  } catch (err) {
    // Protected pages (chrome://, extension pages) — fail silently.
    console.warn('[Klai SW] captureVisibleTab failed:', err)
    sendResponse(null)
    return
  }

  // POST to backend in detect mode.
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl, mode: 'detect' }),
    })

    if (!res.ok) {
      console.warn('[Klai SW] Backend detect returned', res.status)
      sendResponse(null)
      return
    }

    const data = (await res.json()) as { suggestion: unknown }
    // data.suggestion is null when nothing notable was detected.
    sendResponse(data.suggestion ?? null)
  } catch (err) {
    console.warn('[Klai SW] Detect fetch failed:', err)
    sendResponse(null)
  }
}
