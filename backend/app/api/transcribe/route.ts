import { transcribeAudio } from '@/lib/transcribe'

// CORS so the Chrome extension (service worker / popup) can call this.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// OpenAI detects the audio format from the filename extension, so derive a
// matching extension from the declared mime type (base type, ignoring codecs).
function filenameForMime(mimeType?: string): string {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase()
  const map: Record<string, string> = {
    'audio/webm': 'audio.webm',
    'audio/ogg': 'audio.ogg',
    'audio/oga': 'audio.oga',
    'audio/mp4': 'audio.m4a',
    'audio/x-m4a': 'audio.m4a',
    'audio/m4a': 'audio.m4a',
    'audio/mpeg': 'audio.mp3',
    'audio/mp3': 'audio.mp3',
    'audio/wav': 'audio.wav',
    'audio/x-wav': 'audio.wav',
    'audio/flac': 'audio.flac',
  }
  return map[base] ?? 'audio.webm'
}

// Accepts the mic clip two ways:
//   1) multipart/form-data with a `file` field (popup uses FormData)
//   2) application/json { audio: <base64 or data URL>, mimeType?: string }
//      (service worker can't easily build FormData → sends base64)
export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: 'OPENAI_API_KEY not set' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const contentType = request.headers.get('content-type') ?? ''

  let blob: Blob
  let filename = 'audio.webm'

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!file || typeof file === 'string') {
        return Response.json(
          { error: 'multipart body must include a `file` field' },
          { status: 400, headers: CORS_HEADERS }
        )
      }
      blob = file
      filename = (file as File).name || filename
    } else {
      const body = (await request.json()) as { audio?: string; mimeType?: string }
      if (!body.audio || typeof body.audio !== 'string') {
        return Response.json(
          { error: 'json body must include `audio` (base64 or data URL)' },
          { status: 400, headers: CORS_HEADERS }
        )
      }
      const comma = body.audio.indexOf(',')
      const base64 = comma !== -1 ? body.audio.slice(comma + 1) : body.audio
      const bytes = Buffer.from(base64, 'base64')
      blob = new Blob([bytes], { type: body.mimeType || 'audio/webm' })
      filename = filenameForMime(body.mimeType)
    }

    const { text } = await transcribeAudio(blob, filename)
    return Response.json({ text }, { headers: CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'transcription failed'
    console.error('[klai] /api/transcribe error:', message)
    return Response.json({ error: message }, { status: 502, headers: CORS_HEADERS })
  }
}
