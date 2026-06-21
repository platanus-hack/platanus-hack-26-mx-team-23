// speak.ts — Klai voice narration helper.
// Strategy: try ElevenLabs via the backend /api/tts route first (premium TTS).
// If the request fails, ElevenLabs returns an error, or HTMLAudioElement.play()
// is blocked by autoplay policy (common for proactive/watch-mode narration that
// has no preceding user gesture), fall back to the browser's built-in
// SpeechSynthesis. SpeechSynthesis is more lenient with autoplay restrictions.
//
// Autoplay unlock strategy:
//   Chrome's autoplay policy blocks audio.play() on elements that have never been
//   interacted with under a user gesture. The fix: reuse a SINGLE module-level
//   HTMLAudioElement that is "primed" (muted play → pause) on the user's first
//   gesture via unlockAudio(). Once an element has been successfully played under
//   a gesture, the browser allows subsequent programmatic plays on that same element
//   even without a gesture. This makes proactive/watch-mode narration audible.

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
// Shared audio element + unlock state
// ---------------------------------------------------------------------------
//
// A single HTMLAudioElement is reused for all ElevenLabs playback. Reusing
// one element that has been unlocked by a gesture lets subsequent programmatic
// play() calls succeed even without a new gesture (Chrome autoplay policy).
//
// Object-URL lifecycle:
//   - The previous object URL is tracked in currentObjectUrl.
//   - On 'ended' the URL is revoked.
//   - When a new clip replaces an in-progress one (stopCurrent), the old URL
//     is revoked immediately so memory is not leaked.
//
// Latest-wins abort:
//   - currentFetchController holds the AbortController for the in-flight
//     /api/tts fetch. Every new speak() call aborts the previous controller
//     so stale fetches never play after a newer request has started.

const audioEl: HTMLAudioElement = new Audio()
let currentObjectUrl: string | null = null
let currentFetchController: AbortController | null = null

// Whether unlockAudio() has already run a successful priming play.
// Once true, re-entering unlockAudio() is a no-op.
let audioUnlocked = false

/**
 * Prime the shared audio element under a user gesture so subsequent
 * programmatic play() calls (e.g. from proactive/watch-mode narration)
 * are not blocked by Chrome's autoplay policy.
 *
 * Must be called from a synchronous user-gesture handler (pointerdown,
 * keydown, click, etc.). Idempotent — safe to call multiple times.
 */
export function unlockAudio(): void {
  if (audioUnlocked) return

  try {
    // A 44-byte silent WAV: RIFF header + 1 sample of silence at 8 kHz mono 8-bit.
    // Using a data-URI avoids any network request.
    const SILENT_WAV =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

    audioEl.muted = true
    audioEl.src = SILENT_WAV

    const playPromise = audioEl.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          audioEl.pause()
          audioEl.muted = false
          audioEl.src = ''
          audioUnlocked = true
          console.log('[klai] Audio context unlocked via user gesture')
        })
        .catch(() => {
          // Could not prime even under the gesture; reset mute so live playback
          // still attempts normally (browser may have relaxed the policy by then).
          audioEl.muted = false
        })
    } else {
      // Synchronous play (older browsers) — mark as unlocked immediately.
      audioEl.pause()
      audioEl.muted = false
      audioEl.src = ''
      audioUnlocked = true
    }
  } catch {
    // Never throw from a gesture handler.
    audioEl.muted = false
  }

  // Also resume SpeechSynthesis in case it was suspended.
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.resume()
    } catch {
      // Ignore — not all browsers expose resume().
    }
  }
}

/**
 * Stop any currently-playing audio (ElevenLabs or SpeechSynthesis) and
 * abort any in-flight /api/tts fetch. Called at the start of every speak()
 * so new speech always interrupts — no backlog, no stale clips.
 */
function stopCurrent(): void {
  // Abort in-flight fetch first so it cannot play after this point.
  if (currentFetchController !== null) {
    currentFetchController.abort()
    currentFetchController = null
  }
  audioEl.pause()
  if (currentObjectUrl !== null) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

/**
 * Speak `text` via browser SpeechSynthesis (fallback path).
 * Spanish voice preferred; rate 1.05.
 *
 * Robustness: if getVoices() returns an empty list (voices have not loaded yet
 * or are not available), we still speak with the system default voice rather
 * than silently doing nothing. The utterance.voice is only set when a Spanish
 * voice is actually available — otherwise the browser picks its default.
 */
function speakFallback(text: string): void {
  if (!('speechSynthesis' in window)) return
  if (!text.trim()) return

  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)

  // pickSpanishVoice() returns null when getVoices() is empty (async load) or
  // when no Spanish voice is installed. Do NOT block on voice availability —
  // omitting utterance.voice lets the browser use its default voice immediately.
  const voice = pickSpanishVoice()
  if (voice !== null) utterance.voice = voice

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

  // Stop any in-flight fetch and any playing audio — latest-wins, no backlog.
  stopCurrent()

  // --- Attempt ElevenLabs TTS ---
  try {
    // Fresh AbortController for this request. Stored at module level so the
    // NEXT call to stopCurrent() (triggered by the next speak()) can abort it.
    const controller = new AbortController()
    currentFetchController = controller

    const response = await fetch(`${BACKEND_BASE_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })

    if (!response.ok) {
      // Non-2xx from the proxy (ElevenLabs error, missing key, etc.) → fall back.
      console.warn('[klai] /api/tts non-ok response:', response.status, '— falling back to SpeechSynthesis')
      speakFallback(text)
      return
    }

    const blob = await response.blob()

    // Guard: if this request was superseded while we were awaiting the blob, bail.
    if (controller.signal.aborted) return

    // Fetch is done; controller is no longer needed.
    currentFetchController = null

    // Revoke any previous object URL before assigning the new one.
    if (currentObjectUrl !== null) {
      URL.revokeObjectURL(currentObjectUrl)
      currentObjectUrl = null
    }

    const objectUrl = URL.createObjectURL(blob)
    currentObjectUrl = objectUrl

    // Reuse the single module-level audio element (already unlocked by gesture).
    audioEl.src = objectUrl

    // Revoke the object URL once playback ends to free memory.
    audioEl.addEventListener('ended', () => {
      if (currentObjectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        currentObjectUrl = null
      }
    }, { once: true })

    audioEl.addEventListener('error', () => {
      if (currentObjectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        currentObjectUrl = null
      }
    }, { once: true })

    // play() can still reject if the element was never unlocked.
    // Fall back to SpeechSynthesis in that case.
    await audioEl.play()
  } catch (err) {
    // AbortError = a newer speak() cancelled this one intentionally.
    // Discard silently — do not fall back (the newer call handles playback).
    if (err instanceof Error && err.name === 'AbortError') return

    // Network error, play() rejection (autoplay policy if never unlocked), or
    // any other failure. Clean up and fall back to SpeechSynthesis.
    if (currentObjectUrl !== null) {
      URL.revokeObjectURL(currentObjectUrl)
      currentObjectUrl = null
    }
    currentFetchController = null
    console.warn('[klai] ElevenLabs TTS failed, falling back to SpeechSynthesis:', err)
    speakFallback(text)
  }
}
