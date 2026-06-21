// Background service worker (Manifest V3)
// Handles two responsibilities:
//   1. KLAI_DETECT — captures the visible tab and calls the backend in detect mode,
//      returning a suggestion (or null) to the requesting content script.
//   2. Lifecycle logging.

import { ensureContentScript } from '../lib/ensure-content-script'

// Backend base URL — set VITE_BACKEND_BASE_URL at build time (e.g. the Vercel URL).
// Falls back to localhost for local development.
const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://localhost:3000'
const OFFSCREEN_PATH = 'offscreen.html'
const PERMISSION_PATH = 'permission.html'

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Klai] Extension installed — background service worker ready.')
  // First install → open the mic permission page (a popup/offscreen can't prompt).
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(PERMISSION_PATH) })
  }
  // Pre-warm the offscreen recorder so its listener is ready before the first use.
  void ensureOffscreen()
})

chrome.runtime.onStartup?.addListener(() => {
  void ensureOffscreen()
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

// ---------------------------------------------------------------------------
// Voice path (shortcut + popup) — records via the offscreen doc, transcribes,
// then forwards { text, image } to the content script (same KLAI_TEXT channel).
// ---------------------------------------------------------------------------

function openPermissionPage(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL(PERMISSION_PATH) })
}

// ---------------------------------------------------------------------------
// Voice state relay
// ---------------------------------------------------------------------------
// Sends the current voice pipeline state ('listening' | 'transcribing' | 'idle')
// to the active tab's content script so the overlay can render a recording indicator.
// Failures are swallowed — protected pages, missing content script, etc.
// ---------------------------------------------------------------------------
type VoiceState = 'listening' | 'transcribing' | 'idle'

async function setVoiceState(state: VoiceState): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id == null) return
    await ensureContentScript(tab.id)
    await chrome.tabs.sendMessage(tab.id, { type: 'KLAI_VOICE_STATE', state })
  } catch {
    // Protected page or no content script — ignore silently.
  }
}

// Ensure the offscreen recorder document exists (idempotent).
async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument?.()
  if (has) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Record the microphone for hands-free voice commands.',
  })
}

// Ensure the offscreen doc exists, then tell it to record. Retries because a
// freshly-created doc may not have its listener ready ("Receiving end ...").
async function startVoiceCapture(): Promise<void> {
  try {
    await ensureOffscreen()
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_RECORDING' })
        return
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    console.error('[Klai SW] offscreen never acknowledged START_RECORDING')
  } catch (err) {
    console.error('[Klai SW] failed to start recording:', err)
  }
}

// Keyboard shortcut → start a recording.
chrome.commands.onCommand.addListener((command) => {
  console.log('[Klai SW] command received:', command)
  if (command !== 'trigger-klai') return
  void startVoiceCapture()
})

// Voice messages from the popup button and the offscreen recorder.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'POPUP_START_RECORDING') {
    void startVoiceCapture()
  } else if (msg?.type === 'KLAI_RECORDING_STARTED') {
    // Offscreen recorder confirmed that MediaRecorder.start() succeeded.
    void setVoiceState('listening')
  } else if (msg?.type === 'KLAI_AUDIO' && typeof msg.audio === 'string') {
    void handleAudio(msg.audio, msg.mimeType)
  } else if (msg?.type === 'KLAI_AUDIO_ERROR') {
    console.warn('[Klai SW] recorder error:', msg.error)
    void setVoiceState('idle')
    if (typeof msg.error === 'string' && /permission|notallowed|denied|dismiss/i.test(msg.error)) {
      openPermissionPage()
    }
  }
})

async function handleAudio(audioDataUrl: string, mimeType?: string): Promise<void> {
  // Recording finished — transition to transcribing immediately.
  void setVoiceState('transcribing')

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })

  // Screenshot of the visible tab (best-effort).
  let image: string | null = null
  try {
    if (tab?.windowId != null) {
      image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 })
    }
  } catch {
    image = null
  }

  // Transcribe via the backend (key stays server-side).
  let text = ''
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioDataUrl, mimeType }),
    })
    if (!res.ok) throw new Error(`transcribe returned ${res.status}`)
    const json = (await res.json()) as { text?: string }
    text = json.text ?? ''
  } catch (err) {
    console.error('[Klai SW] transcription failed:', err)
    void setVoiceState('idle')
    return
  }

  if (!text.trim()) {
    console.warn('[Klai SW] empty transcript — ignoring.')
    void setVoiceState('idle')
    return
  }

  // Deliver to the content script (inject it first if the tab doesn't have it).
  if (tab?.id != null) {
    const message: { type: string; text: string; image?: string } = { type: 'KLAI_TEXT', text }
    if (image) message.image = image
    try {
      await ensureContentScript(tab.id)
      await chrome.tabs.sendMessage(tab.id, message)
      // Transcript delivered successfully — pipeline complete, reset indicator.
      void setVoiceState('idle')
    } catch (err) {
      console.warn('[Klai SW] could not deliver to tab:', err)
      void setVoiceState('idle')
    }
  } else {
    // No valid tab — nothing to deliver.
    void setVoiceState('idle')
  }
}
