import { motion } from 'framer-motion'
import type { InfoCard } from '../lib/schema'

interface Props {
  data: InfoCard
  /** Optional entrance delay in seconds for staggered choreography. Default: 0. */
  delay?: number
}

// Accent color map — maps the optional accent enum to a highlight color.
const ACCENT_COLORS: Record<string, string> = {
  blue:   '#38bdf8',
  green:  '#4ade80',
  orange: '#fb923c',
  purple: '#a78bfa',
}

// Injected widgets use inline styles (not Tailwind): self-contained, immune to
// the host page's CSS, and they never leak styles back into the host page.
export function InfoCardWidget({ data, delay = 0 }: Props) {
  const accentColor = ACCENT_COLORS[data.accent ?? 'blue']

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, delay }}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 18px',
        borderRadius: 16,
        background: 'rgba(10, 10, 14, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${accentColor}33`,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
        color: '#ffffff',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.4,
        maxWidth: 280,
      }}
    >
      {/* Title row with accent bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 3,
            height: 16,
            borderRadius: 2,
            background: accentColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: accentColor,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {data.title}
        </span>
      </div>

      {/* Body text */}
      <span
        style={{
          fontSize: 13,
          color: '#e5e7eb',
          fontWeight: 400,
          lineHeight: 1.5,
        }}
      >
        {data.body}
      </span>
    </motion.div>
  )
}
