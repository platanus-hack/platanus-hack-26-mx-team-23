// speak.ts — native SpeechSynthesis helper for Klai voice narration.
// Uses browser-native TTS only (no network, works offline).
// Spoken output is in Spanish (es-MX preferred, any es-* accepted).

let cachedVoices: SpeechSynthesisVoice[] | null = null

function loadVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices !== null) return cachedVoices
  const voices = window.speechSynthesis.getVoices()
  if (voices.length > 0) {
    cachedVoices = voices
  }
  return voices
}

// Pick the best available Spanish voice.
// Preference order: es-MX → any es-* → system default (null).
function pickSpanishVoice(): SpeechSynthesisVoice | null {
  const voices = loadVoices()
  if (voices.length === 0) return null

  const esMx = voices.find((v) => v.lang.toLowerCase().startsWith('es-mx'))
  if (esMx) return esMx

  const esAny = voices.find((v) => v.lang.toLowerCase().startsWith('es'))
  return esAny ?? null
}

// Cache voices once they are available (voices may load async on some browsers).
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = window.speechSynthesis.getVoices()
    }
  }
}

/**
 * Speak `text` aloud using the browser's native SpeechSynthesis.
 * Cancels any ongoing utterance so new speech always interrupts the previous one.
 * No-op when SpeechSynthesis is unavailable.
 */
export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return
  if (!text.trim()) return

  // Cancel any in-flight utterance — no backlog.
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)

  const voice = pickSpanishVoice()
  if (voice) utterance.voice = voice

  utterance.rate = 1.05
  utterance.volume = 1

  window.speechSynthesis.speak(utterance)
}
