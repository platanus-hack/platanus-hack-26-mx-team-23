import Anthropic from '@anthropic-ai/sdk'
import { WidgetSchema } from '@/lib/schema'

// Hardcoded fallback returned when ANTHROPIC_API_KEY is missing (dev without a key).
const FALLBACK_SCOREBOARD = {
  type: 'scoreboard' as const,
  teams: [
    { name: 'Real Madrid', score: 2 },
    { name: 'FC Barcelona', score: 1 },
  ],
  minute: 67,
}

// CORS headers applied to every response so the Chrome extension can call this.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Handle OPTIONS preflight (browser sends this before the real POST).
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const body = await request.json()
  const { text } = body as { text?: string }

  if (!text || typeof text !== 'string') {
    return Response.json(
      { error: 'text is required' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY

  // --- No API key: return a hardcoded valid schema so the UI still works in dev ---
  if (!apiKey) {
    console.warn(
      '[overlai] ANTHROPIC_API_KEY is not set — returning hardcoded fallback scoreboard.'
    )
    return Response.json(FALLBACK_SCOREBOARD, { headers: CORS_HEADERS })
  }

  // --- Real Claude call via structured output (tool use) ---
  const client = new Anthropic({ apiKey })

  // The tool schema mirrors ScoreboardSchema from lib/schema.ts.
  // Forcing tool_choice guarantees Claude always returns structured tool_input,
  // never raw JSON text — this is the reliable structured-output pattern.
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    tools: [
      {
        name: 'render_widget',
        description:
          'Render a UI widget over a live video based on the user request. ' +
          'Currently supports: scoreboard (live match score).',
        input_schema: {
          type: 'object' as const,
          properties: {
            type: {
              type: 'string',
              enum: ['scoreboard'],
              description: 'The widget type to render.',
            },
            teams: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Team name' },
                  score: {
                    type: 'integer',
                    minimum: 0,
                    description: 'Goals scored',
                  },
                },
                required: ['name', 'score'],
              },
              minItems: 2,
              maxItems: 2,
              description: 'Exactly two teams: [home, away].',
            },
            minute: {
              type: 'integer',
              minimum: 0,
              description: 'Current match minute (optional).',
            },
          },
          required: ['type', 'teams'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'render_widget' },
    messages: [
      {
        role: 'user',
        content:
          `You are a football overlay assistant. The user said: "${text}". ` +
          'Call render_widget with the best matching widget data. ' +
          'If no real scores are known, invent plausible example data for a demo.',
      },
    ],
  })

  // Extract the tool_use block — tool_choice forces exactly one.
  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return Response.json(
      { error: 'Claude did not return a tool_use block' },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  // Validate the tool input with Zod before sending to the extension.
  const parsed = WidgetSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    console.error('[overlai] Zod validation failed:', parsed.error)
    return Response.json(
      { error: 'Widget schema validation failed', details: parsed.error },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  return Response.json(parsed.data, { headers: CORS_HEADERS })
}
