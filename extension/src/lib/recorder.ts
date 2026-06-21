// Microphone recorder for the popup.
//
// Records one utterance via MediaRecorder (auto-stops on silence or max duration)
// and transcribes it through the backend /api/transcribe endpoint. This replaces
// the flaky Web Speech API and unifies the popup with the hands-free path.
//
// Note: calling this from the popup works without a prompt once the mic permission
// was granted via permission.html (the popup itself cannot show the prompt).

const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://localhost:3000'

// Silence-based auto-stop tuning (mirrors public/offscreen.js).
const SILENCE_RMS = 0.015
const SILENCE_MS = 1200
const MIN_MS = 600
const MAX_MS = 8000

export function isMicSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** Record a single utterance and resolve with the audio blob. */
export function recordClip(): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Microphone access denied'))
      return
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType: mime })
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)

    let tick: ReturnType<typeof setInterval> | null = null
    const startedAt = Date.now()
    let silenceStart: number | null = null

    function cleanup() {
      if (tick) clearInterval(tick)
      stream.getTracks().forEach((t) => t.stop())
      audioCtx.close().catch(() => {})
    }

    function stop() {
      if (recorder.state !== 'inactive') recorder.stop()
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      cleanup()
      if (!chunks.length) {
        reject(new Error('No audio captured'))
        return
      }
      resolve(new Blob(chunks, { type: mime }))
    }

    recorder.start()
    void audioCtx.resume().catch(() => {})

    tick = setInterval(() => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      const elapsed = Date.now() - startedAt

      if (rms < SILENCE_RMS) {
        if (silenceStart === null) silenceStart = Date.now()
        else if (Date.now() - silenceStart > SILENCE_MS && elapsed > MIN_MS) stop()
      } else {
        silenceStart = null
      }

      if (elapsed > MAX_MS) stop()
    }, 60)
  })
}

/** Transcribe a recorded blob via the backend; resolves with the recognized text. */
export async function transcribeBlob(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'audio.webm')

  const res = await fetch(`${BACKEND_BASE_URL}/api/transcribe`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.error ?? `Transcription failed (${res.status})`)
  }
  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}

/** Record and transcribe in one step; resolves with the recognized text. */
export async function recordAndTranscribe(): Promise<string> {
  const blob = await recordClip()
  return transcribeBlob(blob)
}
