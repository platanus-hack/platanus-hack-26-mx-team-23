// Klai offscreen recorder (plain JS — copied verbatim from public/, no bundling).
//
// Owns the microphone in a persistent extension document so a recording can run
// even though the popup closes on blur. The service worker tells it to start;
// it records one utterance (auto-stops on silence or max duration) and posts the
// audio back as a base64 data URL.

let mediaRecorder = null
let stream = null
let audioCtx = null
let chunks = []
let tickTimer = null
let recording = false

// Silence-based auto-stop tuning.
const SILENCE_RMS = 0.015 // below this = "silence"
const SILENCE_MS = 1200 // stop after this much continuous silence
const MIN_MS = 600 // never stop before this (ignore leading silence)
const MAX_MS = 8000 // hard cap on a single utterance

function send(msg) {
  chrome.runtime.sendMessage(msg)
}

async function startRecording() {
  if (recording) return
  recording = true
  chunks = []

  // Proactive permission check: the offscreen doc is invisible and cannot show a
  // prompt. If the mic isn't already granted, bail with a permission error so the
  // service worker can open the permission tab instead of failing silently.
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' })
    if (perm.state !== 'granted') {
      recording = false
      send({ type: 'KLAI_AUDIO_ERROR', error: 'permission: microphone not granted' })
      return
    }
  } catch {
    // permissions.query unsupported — fall through and let getUserMedia decide.
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    recording = false
    const name = (err && err.name) || ''
    const isPerm = name === 'NotAllowedError' || name === 'SecurityError'
    send({
      type: 'KLAI_AUDIO_ERROR',
      error: (isPerm ? 'permission: ' : '') + String((err && err.message) || err),
    })
    return
  }

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  mediaRecorder = new MediaRecorder(stream, { mimeType: mime })
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  mediaRecorder.onstop = () => finalize(mime)
  mediaRecorder.start()

  // Signal that recording has actually started (getUserMedia and MediaRecorder.start()
  // both succeeded). The service worker relays this to the active tab so the overlay
  // can show a "Listening..." indicator.
  send({ type: 'KLAI_RECORDING_STARTED' })

  // Silence detection via Web Audio RMS.
  audioCtx = new AudioContext()
  try {
    await audioCtx.resume()
  } catch {
    // ignore — may already be running
  }
  const source = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const data = new Uint8Array(analyser.fftSize)

  const startedAt = Date.now()
  let silenceStart = null

  tickTimer = setInterval(() => {
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
      else if (Date.now() - silenceStart > SILENCE_MS && elapsed > MIN_MS) {
        stopRecording()
        return
      }
    } else {
      silenceStart = null
    }

    if (elapsed > MAX_MS) stopRecording()
  }, 60)
}

function stopRecording() {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop() // triggers onstop → finalize
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {})
    audioCtx = null
  }
}

function finalize(mime) {
  recording = false
  if (!chunks.length) {
    send({ type: 'KLAI_AUDIO_ERROR', error: 'empty recording' })
    return
  }
  const blob = new Blob(chunks, { type: mime })
  const reader = new FileReader()
  reader.onloadend = () => {
    send({ type: 'KLAI_AUDIO', audio: reader.result, mimeType: mime })
  }
  reader.onerror = () => send({ type: 'KLAI_AUDIO_ERROR', error: 'failed to encode audio' })
  reader.readAsDataURL(blob)
}

// ---------------------------------------------------------------------------
// Narration audio playback (AUDIO_PLAYBACK reason — no user-gesture required).
// ---------------------------------------------------------------------------

// Module-level Audio element for TTS narration. Reused across utterances so
// the AUDIO_PLAYBACK offscreen reason keeps it active.
let narrationAudio = null
let narrationObjectUrl = null
// AbortController for the currently in-flight /api/tts fetch.
// Replaced on every new KLAI_SPEAK so an older in-flight fetch is immediately
// cancelled and can never play after a newer request has started.
let narrationFetchController = null

/**
 * Abort any in-flight /api/tts fetch and stop any currently-playing clip.
 * Called at the top of every speakOffscreen() so a new narration always
 * interrupts — no backlog, no queue dump.
 */
function stopNarration() {
  // Cancel the in-flight fetch first so it cannot play after this point.
  if (narrationFetchController) {
    narrationFetchController.abort()
    narrationFetchController = null
  }
  if (narrationAudio) {
    narrationAudio.pause()
    narrationAudio.src = ''
  }
  if (narrationObjectUrl) {
    URL.revokeObjectURL(narrationObjectUrl)
    narrationObjectUrl = null
  }
}

/**
 * Fetch TTS audio from the backend and play it.
 * Falls back by sending KLAI_NARRATE_FALLBACK to the service worker if the
 * fetch fails or returns a non-ok status.
 */
async function speakOffscreen(text, backendUrl) {
  if (!text || !text.trim()) return

  // Abort any previous in-flight fetch and stop any playing clip before starting
  // the new one. This is the latest-wins guarantee: a rewound video or rapid
  // watch-mode burst can never produce a backlog dump.
  stopNarration()

  // Fresh controller for this fetch — stored at module level so the NEXT call
  // to stopNarration() can abort it before it resolves.
  const controller = new AbortController()
  narrationFetchController = controller

  try {
    const res = await fetch(`${backendUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn('[Klai offscreen] /api/tts returned', res.status, '— sending fallback')
      send({ type: 'KLAI_NARRATE_FALLBACK', text })
      return
    }

    const blob = await res.blob()

    // Guard: if this fetch was superseded while we were awaiting the blob, bail.
    if (controller.signal.aborted) return

    narrationObjectUrl = URL.createObjectURL(blob)
    narrationFetchController = null // fetch is done; controller no longer needed

    narrationAudio = new Audio(narrationObjectUrl)

    narrationAudio.addEventListener('ended', () => {
      if (narrationObjectUrl) {
        URL.revokeObjectURL(narrationObjectUrl)
        narrationObjectUrl = null
      }
    }, { once: true })

    narrationAudio.addEventListener('error', (e) => {
      console.warn('[Klai offscreen] narration playback error:', e)
      if (narrationObjectUrl) {
        URL.revokeObjectURL(narrationObjectUrl)
        narrationObjectUrl = null
      }
      send({ type: 'KLAI_NARRATE_FALLBACK', text })
    }, { once: true })

    await narrationAudio.play()
  } catch (err) {
    // An AbortError means a newer narration cancelled this one intentionally.
    // Do not fall back — just discard this clip silently.
    if (err && err.name === 'AbortError') return

    console.warn('[Klai offscreen] speakOffscreen failed:', err)
    if (narrationObjectUrl) {
      URL.revokeObjectURL(narrationObjectUrl)
      narrationObjectUrl = null
    }
    send({ type: 'KLAI_NARRATE_FALLBACK', text })
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'offscreen' && msg.type === 'START_RECORDING') {
    startRecording()
  } else if (msg && msg.target === 'offscreen' && msg.type === 'KLAI_SPEAK') {
    // Narration request from the service worker — play via AUDIO_PLAYBACK offscreen doc.
    void speakOffscreen(msg.text, msg.backendUrl)
  }
})
