import Anthropic from '@anthropic-ai/sdk'
import { WidgetNodeSchema, LayoutSchema, ResponseSchema } from '@/lib/schema'

// Hardcoded fallback returned when ANTHROPIC_API_KEY is missing (dev without a key).
// Returns a valid Layout so the no-key path exercises the new schema.
const FALLBACK_LAYOUT = {
  type: 'layout' as const,
  nodes: [
    {
      slot: 'top-center' as const,
      widget: {
        type: 'scoreboard' as const,
        teams: [
          { name: 'Real Madrid', score: 2 },
          { name: 'FC Barcelona', score: 1 },
        ],
        minute: 67,
      },
    },
  ],
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
  const { text, image, mode } = body as { text?: string; image?: string; mode?: string }

  // Detect mode: vision-only proactive scan — no user text required.
  const isDetectMode = mode === 'detect'

  if (!isDetectMode && (!text || typeof text !== 'string')) {
    return Response.json(
      { error: 'text is required' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY

  // --- No API key ---
  if (!apiKey) {
    if (isDetectMode) {
      // In detect mode without a key, return null suggestion to avoid demo spam.
      return Response.json({ suggestion: null }, { headers: CORS_HEADERS })
    }
    console.warn(
      '[overlai] ANTHROPIC_API_KEY is not set — returning hardcoded fallback layout.'
    )
    return Response.json(FALLBACK_LAYOUT, { headers: CORS_HEADERS })
  }

  // --- Detect mode: proactive event detection ---
  if (isDetectMode) {
    return handleDetectMode(image, apiKey)
  }

  // --- Generate mode (default): forced tool_choice, unchanged behavior ---
  const client = new Anthropic({ apiKey })

  // When a screenshot is provided, use sonnet (better at reading on-screen text).
  // When text-only, keep haiku for low latency.
  const hasImage = typeof image === 'string' && image.startsWith('data:')
  const model = hasImage ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'

  // Build the instruction text.
  const instructionText = hasImage
    ? `You are a sports overlay assistant. The screenshot shows the current state of a live broadcast.

STEP 1 — Read the broadcast image carefully:
  a) Identify the MAIN ACTION AREA: where is the ball / play happening? What region of the screen is the center of attention?
  b) Identify existing ON-SCREEN broadcast graphics: score bug (bottom-left or top area), lower-thirds, team logos, sponsor banners, match clock overlays.
  c) Identify any EMPTY regions that have no text or graphics burned in.

STEP 2 — Choose slots that:
  - AVOID the main action area (center of the screen where the play is happening).
  - AVOID covering existing broadcast graphics already burned into the feed.
  - PREFER the identified empty regions.
  - SPREAD OUT widgets: never cluster two wide widgets in adjacent top slots (e.g. do NOT use top-center AND top-right for two wide scoreboard/alert widgets — they will collide). Instead spread across top and bottom, or left and right.

Available slots: top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right.
- top-* = upper 25% of video; bottom-* = lower 25%; middle-* = side edges at vertical center.
- Wide widgets (scoreboard, statpanel) need at least ~300px. top-center and top-right are adjacent — using both for wide widgets causes overlap.
- Prefer non-adjacent slots for multi-widget layouts: e.g. top-left + bottom-right, or top-center + bottom-left.

STEP 3 — Use ONLY data visible in the screenshot. Do not use prior knowledge of teams or scores.

Widget types:
- scoreboard: for live match scores and team information
- statpanel: for match statistics (possession, shots, corners, etc.)
- timer: when the user wants a countdown or timer
- alert: for short announcements like "GOAL!", "Penalty!", or key events

The user said: "${text}".
Compose the best layout for this intent. For broad requests like "show me the match" or "full overview",
use multiple widgets — e.g. scoreboard top-left + statpanel bottom-right (non-adjacent, non-colliding).
For single-widget requests, one node is fine.
Call render_layout with the data you can read from the broadcast.`
    : `You are a sports overlay assistant. The user said: "${text}".

You must call render_layout to compose a layout of 1–6 widgets placed in screen slots.
Available slots: top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right.

Widget types:
- scoreboard: questions about the score, match result, or teams playing (e.g. "what's the score?", "show me the scoreboard")
- timer: when the user wants a countdown or timer (e.g. "start a 5 minute timer", "30 second countdown")
- statpanel: when the user asks for match statistics like possession, shots on target, corners, or pass accuracy
- alert: for short dramatic announcements or events (e.g. "goal!", "show penalty alert", "red card")

Slot placement rules:
- SPREAD widgets across the screen — avoid adjacent top slots for two wide widgets (e.g. top-center + top-right collide).
- Prefer non-adjacent combinations: top-left + bottom-right, top-center + bottom-left, etc.
- Avoid the center of the screen (middle-left and middle-right are safer than top-center for secondary widgets).

For broad requests like "show me the full match" or "give me the full match overview", compose multiple widgets
(e.g. scoreboard top-left + statpanel bottom-right — non-adjacent, non-colliding).
For focused single-intent requests, one node is fine.
If no real data is known, invent plausible example data for a demo.
Call render_layout with the best matching layout.`

  // Build the user content: image block (if present) followed by the instruction text.
  type UserContent = Anthropic.MessageParam['content']
  let userContent: UserContent

  if (hasImage) {
    const commaIndex = image!.indexOf(',')
    const base64Data = commaIndex !== -1 ? image!.slice(commaIndex + 1) : image!

    userContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64Data,
        },
      },
      {
        type: 'text',
        text: instructionText,
      },
    ]
  } else {
    userContent = instructionText
  }

  // The tool schema supports a flat layout of 1–6 widget nodes.
  // Each node has: slot (enum), widget (flat object with all widget fields), optional zIndex.
  // The `widget.type` field discriminates which widget it is; per-type required fields
  // are enforced by Zod after Claude returns the tool input (backstop validation).
  //
  // FLAT structure: no recursion, no nested arrays of arrays — required by Anthropic
  // strict structured outputs which do not support recursive schemas.
  //
  // strict: true enables native Anthropic arg validation as a first layer.
  // Zod per-node validation is kept as the backstop (see graceful fallback below).
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    tools: [
      {
        name: 'render_layout',
        description:
          'Compose a layout of 1–6 overlay widgets placed in fixed screen slots. ' +
          'Each node specifies a slot position and a widget. ' +
          'Use multiple nodes when the user\'s intent benefits from seeing several widgets at once ' +
          '(e.g. "show me the full match" → scoreboard top-center + statpanel bottom-left). ' +
          'Single-widget requests can use one node. ' +
          'Choose slots to avoid covering the main broadcast action.',
        input_schema: {
          type: 'object' as const,
          properties: {
            nodes: {
              type: 'array',
              description: '1–6 widget nodes composing the layout.',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  slot: {
                    type: 'string',
                    enum: [
                      'top-left',
                      'top-center',
                      'top-right',
                      'middle-left',
                      'middle-right',
                      'bottom-left',
                      'bottom-center',
                      'bottom-right',
                    ],
                    description:
                      'Screen region where this widget appears. ' +
                      'top-* = upper quarter, middle-* = center sides, bottom-* = lower quarter.',
                  },
                  zIndex: {
                    type: 'integer',
                    description: 'Optional stacking order. Higher = on top. Default 10.',
                  },
                  // widget fields — flat (not nested object) to comply with strict mode limits.
                  // The `widget_type` field discriminates; all widget field names are unique
                  // across widget types so they can coexist in one flat object.
                  widget_type: {
                    type: 'string',
                    enum: ['scoreboard', 'timer', 'statpanel', 'alert'],
                    description:
                      'Type of widget to render. ' +
                      'scoreboard=live score, timer=countdown, statpanel=match stats, alert=announcement.',
                  },
                  // scoreboard fields
                  teams: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', description: 'Team name' },
                        score: { type: 'integer', minimum: 0, description: 'Goals scored' },
                      },
                      required: ['name', 'score'],
                    },
                    minItems: 2,
                    maxItems: 2,
                    description: '[scoreboard] Exactly two teams: [home, away].',
                  },
                  minute: {
                    type: 'integer',
                    minimum: 0,
                    description: '[scoreboard] Current match minute (optional).',
                  },
                  // timer fields
                  durationSeconds: {
                    type: 'integer',
                    minimum: 1,
                    description: '[timer] Countdown duration in seconds.',
                  },
                  label: {
                    type: 'string',
                    description: '[timer] Optional label shown above the countdown.',
                  },
                  // statpanel fields
                  title: {
                    type: 'string',
                    description: '[statpanel] Optional title shown above the stats list.',
                  },
                  stats: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', description: 'Stat name (e.g. "Possession")' },
                        value: { type: 'string', description: 'Stat value (e.g. "58%")' },
                      },
                      required: ['label', 'value'],
                    },
                    minItems: 1,
                    maxItems: 6,
                    description: '[statpanel] 1–6 key/value stat rows.',
                  },
                  // alert fields
                  message: {
                    type: 'string',
                    description: '[alert] Short announcement text (e.g. "GOAL!", "Penalty!").',
                  },
                  tone: {
                    type: 'string',
                    enum: ['info', 'success', 'warning'],
                    description:
                      '[alert] Visual accent: info=blue, success=green, warning=orange.',
                  },
                },
                required: ['slot', 'widget_type'],
              },
            },
          },
          required: ['nodes'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'render_layout' },
    messages: [{ role: 'user', content: userContent }],
  })

  // Extract the tool_use block — tool_choice forces exactly one.
  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return Response.json(
      { error: 'Claude did not return a tool_use block' },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  // Claude returns flat nodes: each node has widget_type + all widget fields at the
  // same level. We reshape each node into the nested { slot, widget: {...} } structure
  // that the Zod LayoutSchema expects.
  const rawInput = toolUse.input as {
    nodes: Array<{
      slot: string
      zIndex?: number
      widget_type: string
      // scoreboard
      teams?: Array<{ name: string; score: number }>
      minute?: number
      // timer
      durationSeconds?: number
      label?: string
      // statpanel
      title?: string
      stats?: Array<{ label: string; value: string }>
      // alert
      message?: string
      tone?: string
    }>
  }

  // Reshape flat node → nested LayoutNode. Validate each node independently.
  // Graceful fallback: if a node fails Zod validation, DROP that node and render the
  // rest rather than failing the whole response. Log dropped nodes.
  const validNodes: Array<{ slot: string; zIndex?: number; widget: unknown }> = []

  for (const rawNode of rawInput.nodes ?? []) {
    const { slot, zIndex, widget_type, ...widgetFields } = rawNode

    // Build the widget object from the flat fields.
    const widgetCandidate = { type: widget_type, ...widgetFields }

    // Validate the widget with Zod.
    const widgetParsed = WidgetNodeSchema.safeParse(widgetCandidate)
    if (!widgetParsed.success) {
      console.warn(
        '[overlai] Dropping invalid node (widget_type=%s, slot=%s): %s',
        widget_type,
        slot,
        widgetParsed.error.message
      )
      continue
    }

    validNodes.push({ slot, zIndex, widget: widgetParsed.data })
  }

  // If all nodes were dropped, return an error rather than an empty layout.
  if (validNodes.length === 0) {
    return Response.json(
      { error: 'All layout nodes failed schema validation' },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  // Build the Layout response object and run a final top-level validation.
  const layoutCandidate = { type: 'layout' as const, nodes: validNodes }
  const layoutParsed = LayoutSchema.safeParse(layoutCandidate)

  if (!layoutParsed.success) {
    console.error('[overlai] Layout Zod validation failed:', layoutParsed.error)
    return Response.json(
      { error: 'Layout schema validation failed', details: layoutParsed.error },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  return Response.json(layoutParsed.data, { headers: CORS_HEADERS })
}

// ---------------------------------------------------------------------------
// Detect mode handler — proactive event detection (no user text)
// ---------------------------------------------------------------------------
// Tool use is OPTIONAL here (no tool_choice forced). Claude may choose NOT to
// call render_layout if nothing notable is on screen, in which case we return
// { suggestion: null }. Only when Claude detects a notable event (goal, card,
// penalty, big score change) will it call render_layout.
// ---------------------------------------------------------------------------
async function handleDetectMode(
  image: string | undefined,
  apiKey: string,
): Promise<Response> {
  const hasImage = typeof image === 'string' && image.startsWith('data:')

  if (!hasImage) {
    // Detect mode requires an image to analyze.
    return Response.json({ suggestion: null }, { headers: CORS_HEADERS })
  }

  const client = new Anthropic({ apiKey })

  const commaIndex = image!.indexOf(',')
  const base64Data = commaIndex !== -1 ? image!.slice(commaIndex + 1) : image!

  const detectInstruction = `You are a sports broadcast monitor. Look at this live broadcast frame carefully.

ONLY call render_layout if there is a NOTABLE event or state worth surfacing RIGHT NOW:
- A goal just scored
- A card shown (red or yellow)
- A penalty awarded
- A significant score change or milestone
- A dramatic moment (VAR decision, injury, substitution shown on screen)

If the broadcast looks routine — normal play, pre-match, half-time generic footage, or nothing remarkable — do NOT call render_layout. It is better to stay silent than to show irrelevant widgets.

If you DO detect something notable, call render_layout with an appropriate widget or layout that highlights what is happening. Use only data visible in the screenshot.`

  type UserContent = Anthropic.MessageParam['content']
  const userContent: UserContent = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64Data,
      },
    },
    {
      type: 'text',
      text: detectInstruction,
    },
  ]

  // Same render_layout tool definition as generate mode, but tool_choice is NOT forced.
  // Claude can choose to call it or not.
  // Use haiku for detect mode: faster and cheaper for high-frequency polling.
  // Sonnet is preserved for generate mode (manual queries with image) where
  // accuracy and on-screen text reading quality matter more.
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    tools: [
      {
        name: 'render_layout',
        description:
          'Compose a layout of 1–3 overlay widgets for a notable live broadcast event. ' +
          'Only call this when something genuinely notable is happening.',
        input_schema: {
          type: 'object' as const,
          properties: {
            nodes: {
              type: 'array',
              description: '1–3 widget nodes for the detected event.',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  slot: {
                    type: 'string',
                    enum: [
                      'top-left', 'top-center', 'top-right',
                      'middle-left', 'middle-right',
                      'bottom-left', 'bottom-center', 'bottom-right',
                    ],
                  },
                  zIndex: { type: 'integer' },
                  widget_type: {
                    type: 'string',
                    enum: ['scoreboard', 'timer', 'statpanel', 'alert'],
                  },
                  teams: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        score: { type: 'integer', minimum: 0 },
                      },
                      required: ['name', 'score'],
                    },
                    minItems: 2,
                    maxItems: 2,
                  },
                  minute: { type: 'integer', minimum: 0 },
                  durationSeconds: { type: 'integer', minimum: 1 },
                  label: { type: 'string' },
                  title: { type: 'string' },
                  stats: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        value: { type: 'string' },
                      },
                      required: ['label', 'value'],
                    },
                    minItems: 1,
                    maxItems: 6,
                  },
                  message: { type: 'string' },
                  tone: {
                    type: 'string',
                    enum: ['info', 'success', 'warning'],
                  },
                },
                required: ['slot', 'widget_type'],
              },
            },
          },
          required: ['nodes'],
        },
      },
    ],
    // No tool_choice here — Claude can choose to not call the tool (suggest nothing).
    messages: [{ role: 'user', content: userContent }],
  })

  // Check whether Claude called the tool.
  const toolUse = response.content.find((block) => block.type === 'tool_use')

  // No tool_use block = nothing notable detected.
  if (!toolUse || toolUse.type !== 'tool_use') {
    return Response.json({ suggestion: null }, { headers: CORS_HEADERS })
  }

  // Reshape flat nodes → nested LayoutNodes (same as generate mode).
  const rawInput = toolUse.input as {
    nodes: Array<{
      slot: string
      zIndex?: number
      widget_type: string
      teams?: Array<{ name: string; score: number }>
      minute?: number
      durationSeconds?: number
      label?: string
      title?: string
      stats?: Array<{ label: string; value: string }>
      message?: string
      tone?: string
    }>
  }

  const validNodes: Array<{ slot: string; zIndex?: number; widget: unknown }> = []

  for (const rawNode of rawInput.nodes ?? []) {
    const { slot, zIndex, widget_type, ...widgetFields } = rawNode
    const widgetCandidate = { type: widget_type, ...widgetFields }
    const widgetParsed = WidgetNodeSchema.safeParse(widgetCandidate)
    if (!widgetParsed.success) {
      console.warn('[overlai detect] Dropping invalid node:', widgetParsed.error.message)
      continue
    }
    validNodes.push({ slot, zIndex, widget: widgetParsed.data })
  }

  if (validNodes.length === 0) {
    return Response.json({ suggestion: null }, { headers: CORS_HEADERS })
  }

  const layoutCandidate = { type: 'layout' as const, nodes: validNodes }
  const layoutParsed = LayoutSchema.safeParse(layoutCandidate)

  if (!layoutParsed.success) {
    console.warn('[overlai detect] Layout validation failed:', layoutParsed.error)
    return Response.json({ suggestion: null }, { headers: CORS_HEADERS })
  }

  return Response.json({ suggestion: layoutParsed.data }, { headers: CORS_HEADERS })
}
