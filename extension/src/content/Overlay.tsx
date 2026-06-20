import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { WidgetSchema, type Widget } from '../lib/schema'
import { getWidget } from '../lib/registry'

// Single constant — easy to swap for production URL.
const BACKEND_BASE_URL = 'http://localhost:3000'

type OverlayState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'widget'; data: Widget }
  | { status: 'error'; message: string }

export function Overlay() {
  const [videoRect, setVideoRect] = useState<DOMRect | null>(null)
  const [state, setState] = useState<OverlayState>({ status: 'idle' })

  // Keep videoRect in sync with the page <video> element.
  useEffect(() => {
    function findVideo() {
      const video = document.querySelector('video')
      if (video) setVideoRect(video.getBoundingClientRect())
    }

    findVideo()
    const interval = setInterval(findVideo, 2000)
    return () => clearInterval(interval)
  }, [])

  // Listen for intent queries dispatched by the content script.
  useEffect(() => {
    async function handleQuery(event: Event) {
      const { text, image } = (event as CustomEvent<{ text: string; image?: string }>).detail
      if (!text) return

      setState({ status: 'loading' })

      try {
        const body: { text: string; image?: string } = { text }
        if (image) body.image = image

        const response = await fetch(`${BACKEND_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}))
          throw new Error(
            `Backend returned ${response.status}: ${errBody.error ?? 'Unknown error'}`
          )
        }

        const rawData = await response.json()

        // Validate with Zod before rendering — safety net for unexpected LLM output.
        const parsed = WidgetSchema.safeParse(rawData)
        if (!parsed.success) {
          throw new Error(`Invalid widget schema from backend: ${parsed.error.message}`)
        }

        setState({ status: 'widget', data: parsed.data })
      } catch (err) {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
        // Auto-dismiss error after 5 seconds.
        setTimeout(() => setState({ status: 'idle' }), 5000)
      }
    }

    window.addEventListener('overlai:query', handleQuery)
    return () => window.removeEventListener('overlai:query', handleQuery)
  }, [])

  // Widget anchor: top-left corner of the <video>, or fixed fallback.
  const anchorTop = videoRect ? videoRect.top + 16 : 16
  const anchorLeft = videoRect ? videoRect.left + 16 : 16

  return (
    <div style={{ pointerEvents: 'none', width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: anchorTop,
          left: anchorLeft,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Loading indicator */}
        <AnimatePresence>
          {state.status === 'loading' && (
            <div
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: '#facc15',
                fontSize: 12,
                padding: '6px 12px',
                borderRadius: 8,
                fontFamily: 'monospace',
              }}
            >
              Building widget...
            </div>
          )}
        </AnimatePresence>

        {/* Error message */}
        <AnimatePresence>
          {state.status === 'error' && (
            <div
              style={{
                background: 'rgba(200,0,0,0.7)',
                color: '#fff',
                fontSize: 12,
                padding: '6px 12px',
                borderRadius: 8,
                fontFamily: 'monospace',
                maxWidth: 320,
              }}
            >
              {state.message}
            </div>
          )}
        </AnimatePresence>

        {/* Rendered widget */}
        <AnimatePresence mode="wait">
          {state.status === 'widget' && (() => {
            const WidgetComponent = getWidget(state.data.type)
            if (!WidgetComponent) {
              return (
                <div
                  style={{
                    background: 'rgba(0,0,0,0.5)',
                    color: '#aaa',
                    fontSize: 11,
                    padding: '4px 8px',
                    borderRadius: 6,
                  }}
                >
                  Unknown widget type: {state.data.type}
                </div>
              )
            }
            return <WidgetComponent key={state.data.type} data={state.data} />
          })()}
        </AnimatePresence>
      </div>
    </div>
  )
}
