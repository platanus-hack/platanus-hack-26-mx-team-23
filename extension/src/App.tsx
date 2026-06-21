import { useState } from 'react'
import { Popup } from './popup/Popup'
import { KlaiMascot } from './components/KlaiMascot'

const PHASES = ['idle', 'thinking', 'done'] as const

// DEV PREVIEW — remove before shipping
function MascotPreview() {
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'done'>('idle')
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0A0A0F',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 40,
      fontFamily: 'system-ui',
    }}>
      <KlaiMascot phase={phase} size={120} />
      <div style={{ display: 'flex', gap: 12 }}>
        {PHASES.map(p => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: phase === p ? '1px solid #8B7FFF' : '1px solid rgba(255,255,255,0.15)',
              background: phase === p ? 'rgba(139,127,255,0.2)' : 'transparent',
              color: phase === p ? '#8B7FFF' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

const PREVIEW_MODE = false // flip to true para previsualizar la mascota en aislado

export default function App() {
  return PREVIEW_MODE ? <MascotPreview /> : <Popup />
}
