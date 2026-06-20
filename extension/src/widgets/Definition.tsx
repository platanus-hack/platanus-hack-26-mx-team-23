import { motion } from 'framer-motion'
import type { Definition } from '../lib/schema'

interface Props {
  data: Definition
  /** Optional entrance delay in seconds for staggered choreography. Default: 0. */
  delay?: number
}

// Injected widgets use inline styles (not Tailwind): self-contained, immune to
// the host page's CSS, and they never leak styles back into the host page.
export function DefinitionWidget({ data, delay = 0 }: Props) {
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
        border: '1px solid rgba(167, 139, 250, 0.25)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
        color: '#ffffff',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.4,
        maxWidth: 280,
      }}
    >
      {/* Term */}
      <span
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: '#a78bfa',
          letterSpacing: '0.02em',
        }}
      >
        {data.term}
      </span>

      {/* Divider */}
      <div
        style={{
          height: 1,
          background: 'rgba(167, 139, 250, 0.2)',
        }}
      />

      {/* Definition text */}
      <span
        style={{
          fontSize: 13,
          color: '#e5e7eb',
          fontWeight: 400,
          lineHeight: 1.5,
        }}
      >
        {data.definition}
      </span>
    </motion.div>
  )
}
