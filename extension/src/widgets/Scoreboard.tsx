import { motion } from 'framer-motion'
import type { Scoreboard } from '../lib/schema'

interface Props {
  data: Scoreboard
}

// Injected widgets use inline styles (not Tailwind): self-contained, immune to
// the host page's CSS, and they never leak styles back into the host page.
export function ScoreboardWidget({ data }: Props) {
  const [home, away] = data.teams

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 22px',
        borderRadius: 16,
        background: 'rgba(10, 10, 14, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
        color: '#ffffff',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 18 }}>{home.name}</span>
      <span style={{ fontSize: 30, color: '#facc15' }}>{home.score}</span>
      <span style={{ fontSize: 16, color: '#9ca3af' }}>—</span>
      <span style={{ fontSize: 30, color: '#facc15' }}>{away.score}</span>
      <span style={{ fontSize: 18 }}>{away.name}</span>
      {data.minute !== undefined && (
        <span
          style={{
            fontSize: 14,
            color: '#4ade80',
            marginLeft: 6,
            fontWeight: 600,
          }}
        >
          {data.minute}&apos;
        </span>
      )}
    </motion.div>
  )
}
