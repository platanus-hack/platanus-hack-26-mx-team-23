// speak.ts — Klai voice narration helper.
// Strategy: try ElevenLabs via the backend /api/tts route first (premium TTS).
// If the request fails, ElevenLabs returns an error, or HTMLAudioElement.play()
// is blocked by autoplay policy (common for proactive/watch-mode narration that
// has no preceding user gesture), fall back to the browser's built-in
// SpeechSynthesis. SpeechSynthesis is more lenient with autoplay restrictions.

// Backend base URL — same source as the rest of the extension.
const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Browser SpeechSynthesis — Spanish voice cache
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Active audio tracking — ensures only one TTS plays at a time
// ---------------------------------------------------------------------------

// Module-level reference to any currently-playing ElevenLabs audio element.
// Set when ElevenLabs audio starts, cleared on ended/error/fallback.
let currentAudio: HTMLAudioElement | null = null

/**
 * Stop any currently-playing audio (ElevenLabs or SpeechSynthesis).
 * Called at the start of every speak() so new speech always interrupts.
 */
function stopCurrent(): void {
  if (currentAudio !== null) {
    currentAudio.pause()
    currentAudio = null
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

/**
 * Speak `text` via browser SpeechSynthesis (fallback path).
 * Spanish voice preferred; rate 1.05.
 */
function speakFallback(text: string): void {
  if (!('speechSynthesis' in window)) return
  if (!text.trim()) return

  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)

  const voice = pickSpanishVoice()
  if (voice) utterance.voice = voice

  utterance.rate = 1.05
  utterance.volume = 1

  window.speechSynthesis.speak(utterance)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Speak `text` aloud.
 *
 * Primary path: POST to /api/tts (ElevenLabs eleven_multilingual_v2).
 *   → On success: play the returned audio/mpeg blob.
 *   → On failure (network error, non-2xx, or play() rejection): fall back.
 *
 * Fallback path: browser SpeechSynthesis (native, offline, no latency).
 *   Used when ElevenLabs is unavailable or when the browser's autoplay policy
 *   blocks HTMLAudioElement.play() (typically for proactive/watch-mode narration
 *   that fires without a preceding user gesture — SpeechSynthesis is exempt).
 *
 * Always cancels/pauses whatever is currently playing before starting new speech.
 */
export async function speak(text: string): Promise<void> {
  if (!text.trim()) return

  // Stop any in-flight utterance or audio element — no backlog.
  stopCurrent()

  // --- Attempt ElevenLabs TTS ---
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!response.ok) {
      // Non-2xx from the proxy (ElevenLabs error, missing key, etc.) → fall back.
      console.warn('[klai] /api/tts non-ok response:', response.status, '— falling back to SpeechSynthesis')
      speakFallback(text)
      return
    }

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    currentAudio = audio

    // Revoke the object URL once playback ends to free memory.
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(objectUrl)
      if (currentAudio === audio) currentAudio = null
    }, { once: true })

    audio.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl)
      if (currentAudio === audio) currentAudio = null
    }, { once: true })

    // play() can throw/reject when autoplay is blocked (no preceding user gesture).
    // This is expected for proactive narration — catch and fall back silently.
    await audio.play()
  } catch (err) {
    // Network error, play() rejection (autoplay policy), or any other failure.
    // Clean up the audio element if it was already assigned.
    if (currentAudio !== null) {
      currentAudio.pause()
      currentAudio = null
    }
    console.warn('[klai] ElevenLabs TTS failed, falling back to SpeechSynthesis:', err)
    speakFallback(text)
  }
}
