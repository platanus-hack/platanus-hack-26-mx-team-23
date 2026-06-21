import { useState, useEffect } from 'react'
import { recognizeOnce, isSpeechSupported } from '../lib/voice'
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
  const message: { type: string; text: string; image?: string } = { type: 'OVERLAI_TEXT', text }
  if (image) message.image = image
  await chrome.tabs.sendMessage(tab.id, message)
}

function statusToPhase(status: Status, intro: 'idle' | 'thinking' | 'done'): 'idle' | 'thinking' | 'done' {
  // During intro animation, ignore status
  if (intro !== 'done') return intro
  if (status === 'sending') return 'thinking'
  if (status === 'done') return 'done'
  return 'done' // stay as ball after intro completes
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
  const [intro, setIntro] = useState<'idle' | 'thinking' | 'done'>('idle')
  const speechAvailable = isSpeechSupported()

  // Intro animation on mount: blob → thinking → ball
  useEffect(() => {
    const t1 = setTimeout(() => setIntro('thinking'), 300)
    const t2 = setTimeout(() => setIntro('done'), 1100)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    chrome.storage.local.get('watchMode', (result) => {
      if (typeof result.watchMode === 'boolean') setWatchMode(result.watchMode)
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
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'OVERLAI_WATCH', enabled: next })
    } catch { /* protected page */ }
  }

  async function handleMic() {
    setStatus('listening')
    const result = await recognizeOnce()
    if (!result.ok) { setStatus('error'); return }
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
    try {
      const image = await captureTab()
      await sendToActiveTab(query, image)
      setStatus('done')
      setText('')
    } catch {
      setStatus('error')
    }
  }

  const busy = status === 'listening' || status === 'sending'
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

      {/* Mic button */}
      {speechAvailable && (
        <button
          onClick={handleMic}
          disabled={busy}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 12,
            border: 'none',
            background: status === 'listening'
              ? 'rgba(139,127,255,0.35)'
              : 'rgba(139,127,255,0.18)',
            color: '#8B7FFF',
            fontWeight: 700,
            fontSize: 13,
            cursor: busy ? 'not-allowed' : 'pointer',
            marginBottom: 8,
            transition: 'background 0.2s',
            outline: status === 'listening' ? '1.5px solid #8B7FFF' : '1.5px solid rgba(139,127,255,0.3)',
          }}
        >
          {status === 'listening' ? '● Escuchando...' : '🎤  Hablar'}
        </button>
      )}

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

      {/* Watch mode */}
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
    </div>
  )
}
