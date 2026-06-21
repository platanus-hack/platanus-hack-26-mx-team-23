import { useState, useEffect } from 'react'
import { ensureContentScript } from '../lib/ensure-content-script'
import { KlaiMascot } from '../components/KlaiMascot'

type Status = 'idle' | 'listening' | 'sending' | 'done' | 'error'

const SCREENSHOT_MAX_WIDTH = 1280

async function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (img.width <= SCREENSHOT_MAX_WIDTH) { resolve(dataUrl); return }
      const scale = SCREENSHOT_MAX_WIDTH / img.width
      const canvas = document.createElement('canvas')
      canvas.width = SCREENSHOT_MAX_WIDTH
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function captureTab(): Promise<string | null> {
  try {
    const raw = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 70 })
    return await downscaleDataUrl(raw)
  } catch {
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

function statusToPhase(status: Status, intro: 'idle' | 'thinking' | 'done'): 'idle' | 'thinking' | 'done' {
  // During intro animation, reflect the intro state
  if (intro !== 'done') return intro
  if (status === 'sending') return 'thinking'
  if (status === 'done') return 'done'
  return 'idle'
}

function statusLabel(status: Status): string {
  if (status === 'listening') return 'Escuchando...'
  if (status === 'sending') return 'Generando respuesta...'
  if (status === 'done') return '¡Listo!'
  if (status === 'error') return 'Algo salió mal'
  return ''
}

export function Popup() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [watchMode, setWatchMode] = useState(false)
  const [narrationEnabled, setNarrationEnabled] = useState(true)
  const [intro, setIntro] = useState<'idle' | 'thinking' | 'done'>('idle')

  const busy = status === 'listening' || status === 'sending'

  // Intro animation on mount: blob → thinking → ball
  useEffect(() => {
    const t1 = setTimeout(() => setIntro('thinking'), 300)
    const t2 = setTimeout(() => setIntro('done'), 1100)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    chrome.storage.local.get(['watchMode', 'narration'], (result) => {
      if (typeof result.watchMode === 'boolean') setWatchMode(result.watchMode)
      // Default ON — only respect an explicit stored false (user deliberately muted).
      setNarrationEnabled(result.narration === false ? false : true)
    })
  }, [])

  // Auto-reset done state after 2.5s
  useEffect(() => {
    if (status === 'done') {
      const t = setTimeout(() => setStatus('idle'), 2500)
      return () => clearTimeout(t)
    }
  }, [status])

  async function handleWatchToggle() {
    const next = !watchMode
    setWatchMode(next)
    chrome.storage.local.set({ watchMode: next })
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'KLAI_WATCH', enabled: next })
      }
    } catch {
      // Tab may not have the content script (e.g. chrome:// pages) — ignore.
    }
  }

  async function handleNarrationToggle() {
    const next = !narrationEnabled
    setNarrationEnabled(next)
    chrome.storage.local.set({ narration: next })
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'KLAI_NARRATION', enabled: next })
      }
    } catch {
      // Tab may not have the content script (e.g. chrome:// pages) — ignore.
    }
  }

  // Route voice through the offscreen recorder (the same path as the keyboard
  // shortcut). It records even after the popup closes and drives the on-video
  // "Listening / Transcribing" indicator, so the popup just kicks it off and closes.
  async function handleMic() {
    try {
      await chrome.runtime.sendMessage({ type: 'POPUP_START_RECORDING' })
    } catch {
      // Service worker handles errors (e.g. opens the mic permission page).
    }
    // Close the popup so the user looks at the video, where the indicator appears.
    window.close()
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
    try {
      const image = await captureTab()
      await sendToActiveTab(query, image)
      setStatus('done')
      setText('')
    } catch {
      setStatus('error')
    }
  }

  const label = statusLabel(status)

  return (
    <div style={{
      width: 280,
      background: '#0A0A0F',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '20px 16px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 0,
    }}>
      {/* Mascot */}
      <div style={{ marginBottom: 12 }}>
        <KlaiMascot phase={statusToPhase(status, intro)} size={100} />
      </div>

      {/* Brand */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>
          klai
        </div>
        {label ? (
          <div style={{
            fontSize: 11,
            color: status === 'error' ? '#F87171' : status === 'done' ? '#4ADE80' : 'rgba(255,255,255,0.45)',
            marginTop: 2,
            transition: 'color 0.3s',
          }}>
            {label}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
            ¿Qué quieres saber?
          </div>
        )}
      </div>

      {/* Mic button — routes through offscreen recorder, closes popup */}
      <button
        onClick={handleMic}
        disabled={busy}
        style={{
          width: '100%',
          padding: '10px 0',
          borderRadius: 12,
          border: 'none',
          background: busy
            ? 'rgba(139,127,255,0.35)'
            : 'rgba(139,127,255,0.18)',
          color: '#8B7FFF',
          fontWeight: 700,
          fontSize: 13,
          cursor: busy ? 'not-allowed' : 'pointer',
          marginBottom: 8,
          transition: 'background 0.2s',
          outline: busy ? '1.5px solid #8B7FFF' : '1.5px solid rgba(139,127,255,0.3)',
        }}
      >
        {busy ? '● Procesando...' : '🎤  Hablar'}
      </button>

      {/* Text input */}
      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="¿Quién va ganando?"
          disabled={busy}
          style={{
            flex: 1,
            padding: '9px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          style={{
            padding: '9px 14px',
            borderRadius: 10,
            border: 'none',
            background: text.trim() && !busy ? '#8B7FFF' : 'rgba(139,127,255,0.2)',
            color: text.trim() && !busy ? '#fff' : 'rgba(255,255,255,0.3)',
            fontWeight: 700,
            fontSize: 13,
            cursor: text.trim() && !busy ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
          }}
        >
          →
        </button>
      </form>

      {/* Watch mode toggle */}
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
        paddingTop: 12,
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {watchMode ? '👁 Modo watch activo' : 'Modo watch'}
        </span>
        <button
          onClick={handleWatchToggle}
          style={{
            width: 36,
            height: 20,
            borderRadius: 999,
            border: 'none',
            background: watchMode ? '#8B7FFF' : 'rgba(255,255,255,0.12)',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute',
            top: 2,
            left: watchMode ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Narration toggle */}
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {narrationEnabled ? 'Narracion por voz activa' : 'Narracion por voz'}
        </span>
        <button
          onClick={handleNarrationToggle}
          style={{
            width: 36,
            height: 20,
            borderRadius: 999,
            border: 'none',
            background: narrationEnabled ? '#8B7FFF' : 'rgba(255,255,255,0.12)',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute',
            top: 2,
            left: narrationEnabled ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* One-time mic permission (a popup can't prompt for the mic itself) */}
      <button
        onClick={handleEnableMic}
        style={{
          marginTop: 12,
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.3)',
          fontSize: 10,
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: 0,
        }}
      >
        ¿El micrófono no funciona? Habilitar permiso
      </button>
    </div>
  )
}
