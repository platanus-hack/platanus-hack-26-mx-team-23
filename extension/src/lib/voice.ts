// Web Speech API wrapper for Klai.
// Gracefully degrades: returns null from start() if the browser does not support it.

export type VoiceResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

/**
 * Returns true if Web Speech API is available in this context.
 * The API is NOT available in content-script sandbox (MV3 restriction) —
 * only use this from the popup.
 */
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'webkitSpeechRecognition' in window
}

/**
 * Listen once, resolve with the first final transcript (or an error).
 * Automatically stops after the first result or on error/no-speech.
 */
export function recognizeOnce(): Promise<VoiceResult> {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) {
      resolve({ ok: false, error: 'Speech recognition not supported in this browser.' })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? ''
      if (transcript) {
        resolve({ ok: true, text: transcript })
      } else {
        resolve({ ok: false, error: 'No transcript captured.' })
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      resolve({ ok: false, error: `Speech error: ${event.error}` })
    }

    recognition.onnomatch = () => {
      resolve({ ok: false, error: 'No speech match.' })
    }

    recognition.onend = () => {
      // onend fires after onresult too; the promise may already be resolved — that's fine.
    }

    recognition.start()
  })
}
