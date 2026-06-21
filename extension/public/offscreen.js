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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'offscreen' && msg.type === 'START_RECORDING') {
    startRecording()
  }
})
