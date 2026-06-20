import { motion } from 'framer-motion'
import type { KeyPoints } from '../lib/schema'

interface Props {
  data: KeyPoints
  /** Optional entrance delay in seconds for staggered choreography. Default: 0. */
  delay?: number
}

// Accent bullet color — consistent with the yellow brand accent across the widget set.
const BULLET_COLOR = '#facc15'

// Injected widgets use inline styles (not Tailwind): self-contained, immune to
// the host page's CSS, and they never leak styles back into the host page.
export function KeyPointsWidget({ data, delay = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, delay }}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 18px',
        borderRadius: 16,
        background: 'rgba(10, 10, 14, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
        color: '#ffffff',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1,
        maxWidth: 300,
      }}
    >
      {/* Optional title */}
      {data.title && (
        <span
          style={{
            fontSize: 11,
            color: '#9ca3af',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            paddingBottom: 8,
          }}
        >
          {data.title}
        </span>
      )}

      {/* Bullet points */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.points.map((point, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              lineHeight: 1.4,
            }}
          >
            {/* Bullet dot */}
            <span
              style={{
                color: BULLET_COLOR,
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              •
            </span>
            <span
              style={{
                fontSize: 13,
                color: '#e5e7eb',
                fontWeight: 400,
              }}
            >
              {point}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
