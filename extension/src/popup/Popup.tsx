import { useState, useEffect } from 'react'
import { recognizeOnce, isSpeechSupported } from '../lib/voice'

type Status = 'idle' | 'listening' | 'sending' | 'done' | 'error'

/** Max width (px) for the downscaled screenshot sent to the backend. */
const SCREENSHOT_MAX_WIDTH = 1280

/**
 * Downscale a data URL to at most SCREENSHOT_MAX_WIDTH wide, re-encoding as JPEG.
 * If the image is already narrower, it is returned unchanged.
 */
async function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (img.width <= SCREENSHOT_MAX_WIDTH) {
        resolve(dataUrl)
        return
      }
      const scale = SCREENSHOT_MAX_WIDTH / img.width
      const canvas = document.createElement('canvas')
      canvas.width = SCREENSHOT_MAX_WIDTH
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * Capture the visible tab as a JPEG data URL.
 * Returns null if capture is not available (e.g. protected page).
 */
async function captureTab(): Promise<string | null> {
  try {
    const raw = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 70 })
    return await downscaleDataUrl(raw)
  } catch {
    // captureVisibleTab can fail on chrome:// pages, extension pages, etc.
    return null
  }
}

async function sendToActiveTab(text: string, image: string | null): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab found')
  const message: { type: string; text: string; image?: string } = { type: 'OVERLAI_TEXT', text }
  if (image) message.image = image
  await chrome.tabs.sendMessage(tab.id, message)
}

export function Popup() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [watchMode, setWatchMode] = useState(false)

  const speechAvailable = isSpeechSupported()

  // Load persisted watch mode state on mount.
  useEffect(() => {
    chrome.storage.local.get('watchMode', (result) => {
      if (typeof result.watchMode === 'boolean') {
        setWatchMode(result.watchMode)
      }
    })
  }, [])

  async function handleWatchToggle() {
    const next = !watchMode
    setWatchMode(next)
    chrome.storage.local.set({ watchMode: next })

    // Notify the active tab's content script immediately.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'OVERLAI_WATCH', enabled: next })
      }
    } catch {
      // Tab may not have the content script (e.g. chrome:// pages) — ignore.
    }
  }

  async function handleMic() {
    setStatus('listening')
    setStatusMsg('Listening...')

    const result = await recognizeOnce()
    if (!result.ok) {
      setStatus('error')
      setStatusMsg(result.error)
      return
    }

    setText(result.text)
    await submitText(result.text)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await submitText(text.trim())
  }

  async function submitText(query: string) {
    setStatus('sending')
    setStatusMsg(`Sending: "${query}"`)
    try {
      // Capture a screenshot of the visible tab so the backend can read on-screen graphics.
      // Falls back to text-only if the page is protected or capture fails.
      const image = await captureTab()
      await sendToActiveTab(query, image)
      setStatus('done')
      setStatusMsg('Widget sent to page!')
    } catch (err) {
      setStatus('error')
      setStatusMsg(err instanceof Error ? err.message : 'Failed to send')
    }
  }

  const micLabel =
    status === 'listening'
      ? '... Listening'
      : status === 'sending'
        ? 'Sending...'
        : '🎤 Speak'

  return (
    <div className="w-72 p-4 bg-gray-900 text-white font-sans">
      <h1 className="text-lg font-bold mb-1 text-yellow-400">Overlai</h1>
      <p className="text-xs text-gray-400 mb-4">Voice-driven overlay engine</p>

      {/* Mic button — only shown when speech is available */}
      {speechAvailable && (
        <button
          className="w-full py-3 rounded-xl bg-yellow-400 text-black font-bold text-sm mb-3 cursor-pointer hover:bg-yellow-300 transition-colors disabled:opacity-50"
          onClick={handleMic}
          disabled={status === 'listening' || status === 'sending'}
        >
          {micLabel}
        </button>
      )}

      {/* Text input fallback (always visible) */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "who&apos;s winning?"'
          className="flex-1 px-3 py-2 rounded-lg bg-gray-800 text-white text-sm border border-gray-700 focus:outline-none focus:border-yellow-400"
          disabled={status === 'listening' || status === 'sending'}
        />
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-yellow-400 text-black font-bold text-sm hover:bg-yellow-300 transition-colors disabled:opacity-50"
          disabled={!text.trim() || status === 'listening' || status === 'sending'}
        >
          Go
        </button>
      </form>

      {/* Watch mode toggle */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
        <span className="text-xs text-gray-400">Watch mode</span>
        <button
          onClick={handleWatchToggle}
          className={`relative inline-flex items-center w-10 h-5 rounded-full transition-colors focus:outline-none ${
            watchMode ? 'bg-yellow-400' : 'bg-gray-600'
          }`}
          title={watchMode ? 'Watch mode ON — auto-detecting events' : 'Watch mode OFF'}
        >
          <span
            className={`inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform ${
              watchMode ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {watchMode && (
        <p className="text-xs text-yellow-400 text-center mt-1">Watching for events...</p>
      )}

      {/* Status line */}
      {statusMsg && (
        <p
          className={`mt-3 text-xs text-center ${
            status === 'error' ? 'text-red-400' : status === 'done' ? 'text-green-400' : 'text-gray-400'
          }`}
        >
          {statusMsg}
        </p>
      )}
    </div>
  )
}
