// OpenAI speech-to-text wrapper.
// Used by /api/transcribe so the extension can send mic audio and get text back.
// Key is server-side only (OPENAI_API_KEY); never exposed to the extension.
//
// Docs: https://platform.openai.com/docs/api-reference/audio/createTranscription

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'

// gpt-4o-mini-transcribe: fast + cheap, good multilingual (auto-detects es/en).
// whisper-1 is the fallback if the model name is ever rejected.
const PRIMARY_MODEL = 'gpt-4o-mini-transcribe'

export async function transcribeAudio(
  audio: Blob,
  filename = 'audio.webm'
): Promise<{ text: string }> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  async function call(model: string): Promise<Response> {
    const form = new FormData()
    form.append('file', audio, filename)
    form.append('model', model)
    // No `language` set → auto-detect (handles Spanish and English).
    return fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
  }

  let res = await call(PRIMARY_MODEL)
  if (!res.ok && res.status === 400) {
    // Some accounts/regions may not have the gpt-4o transcribe routes — fall back.
    res = await call('whisper-1')
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenAI transcription failed ${res.status}: ${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as { text?: string }
  return { text: json.text ?? '' }
}
