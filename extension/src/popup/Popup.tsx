import { useState, useEffect } from 'react'
import { recordClip, transcribeBlob } from '../lib/recorder'
import { ensureContentScript } from '../lib/ensure-content-script'

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
  // Inject the overlay content script if the tab doesn't have it yet
  // (tabs opened before the extension loaded won't, otherwise this no-ops).
  await ensureContentScript(tab.id)
  const message: { type: string; text: string; image?: string } = { type: 'KLAI_TEXT', text }
  if (image) message.image = image
  await chrome.tabs.sendMessage(tab.id, message)
}

export function Popup() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [watchMode, setWatchMode] = useState(false)

  const busy = status === 'listening' || status === 'sending'

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
        chrome.tabs.sendMessage(tab.id, { type: 'KLAI_WATCH', enabled: next })
      }
    } catch {
      // Tab may not have the content script (e.g. chrome:// pages) — ignore.
    }
  }

  // Record in the popup itself (it stays open) and show every step. getUserMedia
  // works without a prompt because the permission was granted via permission.html.
  async function handleMic() {
    try {
      setStatus('listening')
      setStatusMsg('Grabando… habla y haz una pausa')
      const blob = await recordClip()

      setStatus('sending')
      setStatusMsg('Transcribiendo…')
      const transcript = await transcribeBlob(blob)
      if (!transcript) {
        setStatus('error')
        setStatusMsg('No se captó audio. Reintenta.')
        return
      }

      setText(transcript)
      setStatusMsg(`"${transcript}" — enviando al video…`)
      const image = await captureTab()
      await sendToActiveTab(transcript, image)

      setStatus('done')
      setStatusMsg('Listo — mira el video')
    } catch (err) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : 'Error de micrófono'
      setStatusMsg(
        /denied|notallowed|permission|dismiss/i.test(msg)
          ? 'Falta permiso de micrófono. Pulsa "Habilitar permiso" abajo.'
          : msg
      )
    }
  }

  // Open the one-time microphone permission page (a popup cannot prompt for mic).
  function handleEnableMic() {
    chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') })
    window.close()
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

  return (
    <div className="w-72 p-4 bg-gray-900 text-white font-sans">
      <h1 className="text-lg font-bold mb-1 text-yellow-400">Klai</h1>
      <p className="text-xs text-gray-400 mb-4">Voice-driven overlay engine</p>

      {/* Mic button — records in the popup (stays open) and shows each step. */}
      <button
        className="w-full py-3 rounded-xl bg-yellow-400 text-black font-bold text-sm mb-1 cursor-pointer hover:bg-yellow-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        onClick={handleMic}
        disabled={busy}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        {status === 'listening' ? 'Grabando…' : status === 'sending' ? 'Procesando…' : 'Hablar'}
      </button>
      <p className="text-[10px] text-gray-500 text-center mb-3">
        o usa el atajo Ctrl/Cmd+Shift+Y sobre el video
      </p>

      {/* Text input fallback (always visible) */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Ask about this video...'
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

      {/* One-time mic permission (a popup can't prompt for the mic itself) */}
      <button
        onClick={handleEnableMic}
        className="mt-4 w-full text-[11px] text-gray-400 underline hover:text-yellow-400 transition-colors cursor-pointer"
      >
        ¿El micrófono no funciona? Habilitar permiso
      </button>
    </div>
  )
}
