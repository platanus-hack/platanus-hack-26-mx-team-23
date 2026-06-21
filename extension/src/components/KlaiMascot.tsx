import { motion, AnimatePresence } from 'framer-motion'
import klaiIdle from '../assets/klai-idle.png'
import klaiThinking from '../assets/klai-thinking.jpg'
import klaiDone from '../assets/klai-done.jpg'

type Phase = 'idle' | 'thinking' | 'done'

const FRAMES: Record<Phase, string> = {
  idle: klaiIdle,
  thinking: klaiThinking,
  done: klaiDone,
}

// Scale + rotation per phase to add life to the crossfade
const ENTER_ANIM: Record<Phase, object> = {
  idle:     { scale: [0.85, 1.04, 1],    rotate: [0, 0, 0]    },
  thinking: { scale: [0.9, 1.08, 1],     rotate: [-4, 4, 0]   },
  done:     { scale: [0.8, 1.12, 0.96, 1], rotate: [0, 0, 0]  },
}

export function KlaiMascot({
  phase = 'idle',
  size = 96,
}: {
  phase?: Phase
  size?: number
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        // Outer glow
        filter: 'drop-shadow(0 0 18px rgba(139,127,255,0.55))',
      }}
    >
      <AnimatePresence mode="crossfade">
        <motion.img
          key={phase}
          src={FRAMES[phase]}
          alt={`Klai ${phase}`}
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{
            opacity: 1,
            ...ENTER_ANIM[phase],
            transition: {
              duration: phase === 'done' ? 0.5 : 0.35,
              ease: [0.165, 0.84, 0.44, 1],
            },
          }}
          exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.2 } }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            borderRadius: '50%',
          }}
        />
      </AnimatePresence>

      {/* Idle breathing loop — only active on idle */}
      {phase === 'idle' && (
        <motion.div
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Thinking pulse ring */}
      {phase === 'thinking' && (
        <motion.div
          animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            inset: -8,
            borderRadius: '50%',
            border: '2px solid rgba(139,127,255,0.6)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
