// /api/tts — ElevenLabs Text-to-Speech proxy for Klai voice narration.
// Accepts { text: string } and returns audio/mpeg bytes from ElevenLabs.
// Falls back to a JSON error (502/400) so the extension can gracefully fall
// back to browser SpeechSynthesis on failure.

// CORS so the Chrome extension (service worker / popup) can call this.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Default to "Sarah" (EXAVITQu4vr4xnSDxMaL) — a well-known multilingual public voice.
// Override by setting ELEVENLABS_VOICE_ID in .env.local.
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: 'ELEVENLABS_API_KEY not set' },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  let text: string
  try {
    const body = (await request.json()) as { text?: unknown }
    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      return Response.json(
        { error: 'json body must include a non-empty `text` string' },
        { status: 400, headers: CORS_HEADERS }
      )
    }
    text = body.text.trim()
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`

  let elevenResponse: Response
  try {
    elevenResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        // eleven_multilingual_v2 supports Spanish and most other languages natively.
        model_id: 'eleven_multilingual_v2',
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ElevenLabs request failed'
    console.error('[klai] /api/tts fetch error:', message)
    return Response.json({ error: message }, { status: 502, headers: CORS_HEADERS })
  }

  if (!elevenResponse.ok) {
    const errorText = await elevenResponse.text().catch(() => '')
    console.error('[klai] /api/tts ElevenLabs error:', elevenResponse.status, errorText)
    return Response.json(
      { error: `ElevenLabs returned ${elevenResponse.status}`, details: errorText },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  // Stream the audio bytes back with the correct content type and CORS headers.
  const audioBuffer = await elevenResponse.arrayBuffer()
  return new Response(audioBuffer, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audioBuffer.byteLength),
    },
  })
}
