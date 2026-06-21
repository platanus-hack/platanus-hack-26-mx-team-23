import Anthropic from '@anthropic-ai/sdk'
import { WidgetNodeSchema, LayoutSchema, ControlActionSchema, SlotSchema } from '@/lib/schema'
import { DATA_TOOLS, runTool } from '@/lib/tools'

// Hardcoded fallback returned when ANTHROPIC_API_KEY is missing (dev without a key).
// Returns a valid Layout so the no-key path exercises the new schema.
const FALLBACK_LAYOUT = {
  type: 'layout' as const,
  nodes: [
    {
      slot: 'top-center' as const,
      widget: {
        type: 'infocard' as const,
        title: 'Klai',
        body: 'No API key configured. Add ANTHROPIC_API_KEY to your .env.local file.',
        accent: 'blue' as const,
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

// Describes an active widget instance sent from the extension so the model
// can resolve references like "close the scoreboard" or "move the stats widget".
interface ActiveWidgetInfo {
  id: string
  type: string
  label: string
}

export async function POST(request: Request) {
  const body = await request.json()
  const { text, image, mode, history, activeWidgets } = body as {
    text?: string
    image?: string
    mode?: string
    history?: Array<{ query: string; summary: string }>
    activeWidgets?: ActiveWidgetInfo[]
  }

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
      // In detect mode without a key, return null suggestion and null scoreState.
      return Response.json({ suggestion: null, scoreState: null }, { headers: CORS_HEADERS })
    }
    console.warn(
      '[klai] ANTHROPIC_API_KEY is not set — returning hardcoded fallback layout.'
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

  // Build optional history context block to inject into the instruction text.
  // When the client provides recent interaction history, Claude uses it to resolve
  // pronoun references and follow-up questions (e.g. "what does that mean?", "summarize more").
  const historyBlock =
    Array.isArray(history) && history.length > 0
      ? `\nRecent interactions in this session (most recent last):\n${history
          .map((h, i) => `  ${i + 1}. User asked: "${h.query}" → showed: ${h.summary}`)
          .join('\n')}\n\nUse the above history to resolve references in the user's new request. ` +
        `For example, if the user says "tell me more" or "what about the other team?", ` +
        `identify the relevant subject from the most recent relevant interaction and answer about that.\n`
      : ''

  // Build the active-widgets context block so the model can resolve management
  // references like "close the scoreboard" or "move the goals widget to the right".
  const activeWidgetsBlock =
    Array.isArray(activeWidgets) && activeWidgets.length > 0
      ? `\nCurrently on screen:\n${activeWidgets
          .map((w) => `  id=${w.id}  type=${w.type}  label="${w.label}"`)
          .join('\n')}\n\n` +
        `If the user wants to CLOSE, MOVE, or CLEAR existing widgets, call control_widgets ` +
        `referencing the exact id(s) from the list above.\n` +
        `Resolve natural-language references against the list — e.g. "this" or "that" → most recently ` +
        `relevant widget; "the scoreboard" → type=scoreboard; "the stats" or "the cards" → ` +
        `type=statpanel whose label matches; "everything" or "all" → action=clear_all.\n` +
        `For move: choose the slot enum closest to the user's phrasing — ` +
        `"to the right" → *-right slot; "top" → top-*; "bottom left" → bottom-left; etc.\n` +
        `If the user wants NEW information or asks a question about the content, call render_layout instead.\n`
      : ''

  // Build the instruction text.
  const instructionText = hasImage
    ? `You are a generative overlay assistant. The screenshot shows a video currently playing.
${historyBlock}${activeWidgetsBlock}
STEP 1 — Identify the DOMAIN of the PRIMARY content in the MAIN video frame:
  The PRIMARY content is what is being actively shown in the large central video area.
  It is NOT a picture-in-picture feed, NOT a commentator webcam, NOT a promo/teaser for upcoming content.

  Determine the domain:
  - SPORT MATCH: live game with score graphics, a pitch/court/field, teams competing
  - LECTURE / TALK: a presenter, slides, whiteboard, or educational content
  - COOKING: food preparation, ingredients, kitchen environment
  - GAMEPLAY: a video game being played, game UI visible
  - OTHER: news, documentary, tutorial, etc.

  For sport matches:
    a) Find the main scorebug (score bug): a dedicated broadcast graphic tied to the live action in the main frame.
       It is usually pinned to the top-left or bottom area of the main video. This is the authoritative source for
       team names, score, and match clock.
    b) Identify the MAIN ACTION AREA: where is the ball / play happening?
    c) Identify existing ON-SCREEN broadcast graphics: score bug, lower-thirds, team logos.
    d) Identify any EMPTY regions that have no text or graphics burned in.

STEP 2 — IGNORE these elements — do NOT read or use data from them:
  - Scrolling tickers / results bars showing OTHER content scores or headlines.
  - Scores, names, or results from any match OTHER than the primary content.
  - "Up next", "Coming up", or any promotion for future content.
  - League standings tables, tournament brackets.
  - Channel logos, sponsor banners, social media handles, watermarks.
  - Any picture-in-picture box or commentator webcam feed.
  - Overlays or UI that are NOT part of the main video content.
  If you cannot confidently read data from the primary content, omit uncertain fields or use placeholders.

STEP 3 — Choose the MOST APPROPRIATE widgets for the detected domain + user intent:

  SPORT MATCH:
  - scoreboard: live match scores and team information
  - statpanel: match statistics (possession, shots, corners, pass accuracy, etc.)
  - timer: when user wants a countdown or timer
  - alert: short announcements like "GOAL!", "Penalty!", "Red card!", or key events
  - momentum: when user asks about win probability, who's going to win, or momentum.
    Use momentum_teams (exactly 2) with integer probabilities summing to ~100. Base the estimate on
    the visible score, match clock, and game state — NOT on prior knowledge. Always add a momentum_note
    such as "Estimate based on score & time" to make clear it is an approximation.

  LECTURE / TUTORIAL / TALK:
  - infocard: for context, facts, or a brief explanation (e.g. "who is this speaker?")
  - keypoints: for summaries, key takeaways, or "what is this lecture about?" requests
  - definition: when user asks "what does X mean?" or about a specific term shown/mentioned
  - statpanel: for structured data or comparisons visible on slides

  COOKING:
  - keypoints: for recipe steps, ingredients list, or technique summaries
  - timer: for cook times, rest times, or baking durations
  - infocard: for context about a dish, ingredient, or technique

  GAMEPLAY:
  - infocard: for game facts, lore, or item descriptions
  - statpanel: for character stats, inventory, or game metrics visible on screen
  - alert: for notable in-game events

  ANY DOMAIN (safe generic fallback):
  - infocard: general context or information the user asked about
  - keypoints: any list-style answer (steps, highlights, summary)

STEP 4 — Choose slots that:
  - AVOID the main action area (center of the screen where the content is happening).
  - AVOID covering existing graphics already burned into the feed.
  - PREFER identified empty regions.
  - SPREAD OUT widgets: never cluster two wide widgets in adjacent top slots.

Available slots: top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right.
- top-* = upper 25% of video; bottom-* = lower 25%; middle-* = side edges at vertical center.
- Wide widgets need at least ~300px. top-center and top-right are adjacent — using both for wide widgets causes overlap.
- Prefer non-adjacent slots for multi-widget layouts: e.g. top-left + bottom-right, or top-center + bottom-left.

STEP 4.5 — For SPORT MATCHES: read the two team names off the scorebug, then call get_sports_data with
those names in \`teams\` and the \`want\` section(s) matching the user's question, for ANY data not directly
visible on screen — cards, referee, venue, lineups, detailed stats, standings, recent form, odds, news.
(want mapping: score/who's winning→["score"]; stats/possession/cards→["stats"]; goals→["events"];
referee/stadium/TV→["info"]; top scorer→["leaders"]; lineups/formation→["lineups"]; group table→["standings"];
record→["record"]; form/h2h→["form"]; odds→["odds"]; news→["news"].) TRUST the tool's score/stats over the image.

STEP 5 — Use ONLY data visible in the screenshot OR returned by get_sports_data. Do not use prior knowledge
and do not invent scores, stats, names, or events — omit uncertain fields.

The user said: "${text}".
Compose the best layout for this intent. For broad requests like "summarize this" or "full overview",
use multiple widgets — e.g. keypoints top-left + infocard bottom-right (non-adjacent, non-colliding).
For single-widget requests, one node is fine.
Call render_layout with the data you can read from the PRIMARY content in the video.`
    : `You are a generative overlay assistant. The user said: "${text}".
${historyBlock}${activeWidgetsBlock}
You must call either render_layout (to create/update widgets) or control_widgets (to manage existing ones).
Available slots: top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right.

Widget types — choose based on the user's intent:
- scoreboard: questions about a live game score, match result, or teams playing
- timer: when the user wants a countdown or timer (e.g. "start a 5 minute timer", "30 second countdown")
- statpanel: when the user asks for statistics, numbers, or structured comparisons
- alert: for short dramatic announcements or events (e.g. "goal!", "important alert", "red card")
- momentum: when the user asks "who's going to win", "win probability", or "momentum" for a sports match.
  Use momentum_teams (exactly 2 entries) with integer probabilities 0–100 summing to ~100.
  Base probabilities on visible score and time. Always set momentum_note to a disclaimer.
- infocard: for facts, context, or brief explanations about anything in the video
- keypoints: for summaries, steps, highlights, or any list-style answer (1–6 bullet points)
- definition: when the user asks what a term means or wants a concept explained

Slot placement rules:
- SPREAD widgets across the screen — avoid adjacent top slots for two wide widgets.
- Prefer non-adjacent combinations: top-left + bottom-right, top-center + bottom-left, etc.
- Avoid the center of the screen (middle-left and middle-right are safer than top-center for secondary widgets).

For broad requests like "summarize this" or "give me an overview", compose multiple widgets
(e.g. keypoints top-left + infocard bottom-right — non-adjacent, non-colliding).
For focused single-intent requests, one node is fine.
If no real data is available, invent plausible example data for a demo.
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
  // The `widget_type` field discriminates which widget it is; per-type required fields
  // are enforced by Zod after Claude returns the tool input (backstop validation).
  //
  // FLAT structure: no recursion, no nested arrays of arrays — required by Anthropic
  // strict structured outputs which do not support recursive schemas.
  //
  // Prefixed field names (momentum_teams, kp_points, def_term, def_definition,
  // infocard_title, infocard_body, infocard_accent) avoid collision when multiple
  // widget types share semantically similar field names in the same flat object.
  // System guidance for the agent loop: research with web_research when the answer
  // isn't on screen, then finish with render_layout.
  const GENERATE_SYSTEM = `You are Klai, a generative overlay assistant for live video.
You have four tools:
- get_sports_data: PRIMARY source for the live FIFA World Cup match shown on screen. Use it FIRST for any football/soccer question. It covers score, stats, goals/cards, referee/venue/TV, match leaders, lineups/formations, group standings, tournament record, recent form/head-to-head, betting odds, and news. Pass the two team names you read from the on-screen scorebug in \`teams\` (order/abbreviations don't matter; if you can't read them, call it with no teams to resolve the only live game). Pass \`want\` as an array of the section(s) the user asked for — e.g. ["score"], ["stats"], ["info"] for referee/venue, ["lineups"], ["standings"], ["form"], ["odds"], ["news"], or ["score","info"] for combined; request ONLY what's needed, omit \`want\` for a quick overview. Map results into scoreboard/statpanel/alert/infocard/keypoints widgets, and TRUST its score/stats over what you read from the image.
- web_research: fallback for facts get_sports_data can't provide — non-World-Cup sports, player bios, current news, definitions, prices, general knowledge. Prefer one focused query.
- render_layout: compose the final overlay UI. Call it EXACTLY ONCE as your last step when creating or updating widgets.
- control_widgets: manage existing on-screen widgets — close specific instances by id, move one instance to a new slot, or clear all instances. Call this when the user's intent is to close, dismiss, move, or clear existing widgets (not to create new ones).
Policy:
1. If the user's intent is to manage existing widgets (close, move, dismiss, clear), call control_widgets immediately. Do NOT call render_layout for management requests.
2. If the screen shows a live football/soccer match and the user wants new information, call get_sports_data with the team names from the scorebug BEFORE anything else, passing the \`want\` section(s) that match the user's question.
3. When the user asks about something beyond the on-screen scorebug — referee, lineups, detailed stats, standings, form, odds, news — call get_sports_data with the matching \`want\` section(s).
4. If get_sports_data returns no match (or the topic is non-World-Cup / a non-sports fact), use web_research.
5. For purely on-screen, non-factual content, you may skip the data tools.
6. ESPN does not provide live win-probability; if the user asks who will win / momentum, ESTIMATE from the score and clock and clearly label it an estimate in momentum_note.
If a tool fails or returns nothing, render the best answer you can. For create requests, always finish by calling render_layout. For manage requests, call control_widgets and stop.`

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }]
  const MAX_ROUNDS = 5
  let toolUse: Anthropic.ToolUseBlock | null = null
  // Tracks whether the model called control_widgets (management intent).
  let controlToolUse: Anthropic.ToolUseBlock | null = null

  // The control_widgets tool — allows the model to close/move/clear existing widgets.
  const CONTROL_WIDGETS_TOOL: Anthropic.Tool = {
    name: 'control_widgets',
    description:
      'Manage existing on-screen widget instances. ' +
      'Use this when the user wants to CLOSE, MOVE, or CLEAR widgets — not to create new ones. ' +
      'Reference widget ids from the "Currently on screen" list in the instruction text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['close', 'move', 'clear_all'],
          description:
            'close = remove specific widget(s) by id; ' +
            'move = reposition one widget to a different slot; ' +
            'clear_all = remove every widget on screen.',
        },
        targetIds: {
          type: 'array',
          items: { type: 'string' },
          description: '[close only] Array of instance ids to close. Must match ids from the active-widgets list.',
        },
        targetId: {
          type: 'string',
          description: '[move only] The single instance id to reposition.',
        },
        slot: {
          type: 'string',
          enum: [
            'top-left', 'top-center', 'top-right',
            'middle-left', 'middle-right',
            'bottom-left', 'bottom-center', 'bottom-right',
          ],
          description: '[move only] The destination slot.',
        },
      },
      required: ['action'],
    },
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const isLast = round === MAX_ROUNDS - 1
    const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: GENERATE_SYSTEM,
    tools: [
      ...DATA_TOOLS,
      CONTROL_WIDGETS_TOOL,
      {
        name: 'render_layout',
        description:
          'Compose a layout of 1–6 overlay widgets placed in fixed screen slots. ' +
          'Each node specifies a slot position and a widget. ' +
          'Use multiple nodes when the user\'s intent benefits from several widgets at once. ' +
          'Single-widget requests can use one node. ' +
          'Choose slots to avoid covering the main video content.',
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
                  widget_type: {
                    type: 'string',
                    enum: [
                      'scoreboard',
                      'timer',
                      'statpanel',
                      'alert',
                      'momentum',
                      'infocard',
                      'keypoints',
                      'definition',
                    ],
                    description:
                      'Type of widget to render. ' +
                      'scoreboard=live score, timer=countdown, statpanel=stats table, alert=announcement, ' +
                      'momentum=win-probability bar, infocard=titled info card, ' +
                      'keypoints=bullet list, definition=term explanation.',
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
                  // momentum fields (prefixed to avoid collision with scoreboard `teams`)
                  momentum_teams: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', description: 'Team name' },
                        probability: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 100,
                          description: 'Estimated win probability (0–100). The two values should sum to ~100.',
                        },
                      },
                      required: ['name', 'probability'],
                    },
                    minItems: 2,
                    maxItems: 2,
                    description:
                      '[momentum] Exactly two teams with their estimated win probabilities. ' +
                      'Values should sum to ~100. ESTIMATE based on score and time — not official data.',
                  },
                  momentum_note: {
                    type: 'string',
                    description:
                      '[momentum] Short note shown below the bar, e.g. "Estimate based on score & time".',
                  },
                  // infocard fields (prefixed to avoid collision with statpanel `title`)
                  infocard_title: {
                    type: 'string',
                    description: '[infocard] Short title for the card (e.g. "Did you know?", "Speaker").',
                  },
                  infocard_body: {
                    type: 'string',
                    description: '[infocard] Main info text (1–3 sentences).',
                  },
                  infocard_accent: {
                    type: 'string',
                    enum: ['blue', 'green', 'orange', 'purple'],
                    description:
                      '[infocard] Accent color: blue (default), green (facts/tips), orange (warnings), purple (creative).',
                  },
                  // keypoints fields (prefixed to avoid collision with statpanel list pattern)
                  kp_title: {
                    type: 'string',
                    description: '[keypoints] Optional header above the bullet list.',
                  },
                  kp_points: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 6,
                    description: '[keypoints] 1–6 bullet point strings.',
                  },
                  // definition fields (prefixed to avoid ambiguity)
                  def_term: {
                    type: 'string',
                    description: '[definition] The term or concept to define.',
                  },
                  def_definition: {
                    type: 'string',
                    description: '[definition] Clear concise explanation of the term.',
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
    // On the last allowed round force render_layout so we always get a layout
    // (only applies when no control_widgets call was made earlier).
    // Otherwise: { type: 'any' } — model MUST call a tool but picks which one,
    // allowing it to choose control_widgets for management intents.
    tool_choice: isLast
      ? { type: 'tool', name: 'render_layout' }
      : { type: 'any' },
    messages,
  })

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    // Terminal: control_widgets called → capture and return immediately.
    const controlCall = toolUses.find((t) => t.name === 'control_widgets')
    if (controlCall) {
      controlToolUse = controlCall
      break
    }

    // Terminal: render_layout called → capture its input and stop.
    const renderCall = toolUses.find((t) => t.name === 'render_layout')
    if (renderCall) {
      toolUse = renderCall
      break
    }

    // No tool call → nudge toward rendering and retry.
    if (toolUses.length === 0) {
      messages.push({ role: 'assistant', content: response.content })
      messages.push({
        role: 'user',
        content: 'Call render_layout now with the best layout you can from what you know.',
      })
      continue
    }

    // Execute data tools (get_sports_data, web_research) and feed results back.
    messages.push({ role: 'assistant', content: response.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const out = await runTool(tu.name, tu.input)
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  // --- Handle control_widgets response ---
  if (controlToolUse) {
    // Reshape the flat tool input into the ControlAction shape for Zod validation.
    const raw = controlToolUse.input as {
      action: string
      targetIds?: string[]
      targetId?: string
      slot?: string
    }

    let controlCandidate: unknown
    switch (raw.action) {
      case 'close':
        controlCandidate = { kind: 'control', action: 'close', targetIds: raw.targetIds ?? [] }
        break
      case 'move':
        controlCandidate = { kind: 'control', action: 'move', targetId: raw.targetId ?? '', slot: raw.slot }
        break
      case 'clear_all':
        controlCandidate = { kind: 'control', action: 'clear_all' }
        break
      default:
        return Response.json(
          { error: `Unknown control action: ${raw.action}` },
          { status: 502, headers: CORS_HEADERS }
        )
    }

    const parsed = ControlActionSchema.safeParse(controlCandidate)
    if (!parsed.success) {
      console.error('[klai] control_widgets Zod validation failed:', parsed.error)
      return Response.json(
        { error: 'Control action schema validation failed', details: parsed.error },
        { status: 502, headers: CORS_HEADERS }
      )
    }

    return Response.json(parsed.data, { headers: CORS_HEADERS })
  }

  if (!toolUse) {
    return Response.json(
      { error: 'Claude did not return a render_layout call' },
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
      // momentum (prefixed to avoid collision with scoreboard's `teams`)
      momentum_teams?: Array<{ name: string; probability: number }>
      momentum_note?: string
      // infocard (prefixed to avoid collision with statpanel's `title`)
      infocard_title?: string
      infocard_body?: string
      infocard_accent?: string
      // keypoints (prefixed)
      kp_title?: string
      kp_points?: string[]
      // definition (prefixed)
      def_term?: string
      def_definition?: string
    }>
  }

  // Reshape flat node → nested LayoutNode. Validate each node independently.
  // Graceful fallback: if a node fails Zod validation, DROP that node and render the
  // rest rather than failing the whole response. Log dropped nodes.
  const validNodes: Array<{ slot: string; zIndex?: number; widget: unknown }> = []

  for (const rawNode of rawInput.nodes ?? []) {
    const {
      slot, zIndex, widget_type,
      momentum_teams, momentum_note,
      infocard_title, infocard_body, infocard_accent,
      kp_title, kp_points,
      def_term, def_definition,
      ...widgetFields
    } = rawNode

    // Build the widget object from the flat fields, remapping prefixed keys to schema names.
    let widgetCandidate: Record<string, unknown>

    switch (widget_type) {
      case 'momentum':
        widgetCandidate = {
          type: 'momentum',
          teams: momentum_teams,
          note: momentum_note,
        }
        break
      case 'infocard':
        widgetCandidate = {
          type: 'infocard',
          title: infocard_title,
          body: infocard_body,
          accent: infocard_accent,
        }
        break
      case 'keypoints':
        widgetCandidate = {
          type: 'keypoints',
          title: kp_title,
          points: kp_points,
        }
        break
      case 'definition':
        widgetCandidate = {
          type: 'definition',
          term: def_term,
          definition: def_definition,
        }
        break
      default:
        // scoreboard, timer, statpanel, alert — field names match schema directly.
        widgetCandidate = { type: widget_type, ...widgetFields }
    }

    // Validate the widget with Zod.
    const widgetParsed = WidgetNodeSchema.safeParse(widgetCandidate)
    if (!widgetParsed.success) {
      console.warn(
        '[klai] Dropping invalid node (widget_type=%s, slot=%s): %s',
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
    console.error('[klai] Layout Zod validation failed:', layoutParsed.error)
    return Response.json(
      { error: 'Layout schema validation failed', details: layoutParsed.error },
      { status: 502, headers: CORS_HEADERS }
    )
  }

  return Response.json(layoutParsed.data, { headers: CORS_HEADERS })
}

// ---------------------------------------------------------------------------
// Detect mode handler — proactive event detection (no user text)
//
// HYBRID TWO-STAGE PIPELINE:
//
//   STAGE 1 — Haiku filter (cheap, fast):
//     Model : claude-haiku-4-5
//     Task  : Answer a structured yes/no: "is something worth surfacing about
//             the main content right now?"
//     Output: { notable: boolean; reason: string }
//     Cost  : Minimal — tiny tool, small max_tokens.
//     Gate  : If notable === false → return { suggestion: null } immediately.
//             Do NOT call Stage 2. This keeps per-tick cost and latency low
//             for the common case (nothing happening).
//
//   STAGE 2 — Sonnet confirm + render (accurate, only when needed):
//     Model : claude-sonnet-4-6
//     Task  : Confirm the event is genuinely notable and produce the widget
//             layout using the full hardened grounding rules.
//     Output: optional render_layout tool call.
//     Cost  : Paid only when Haiku said YES — typically rare.
//             Sonnet's superior OCR accuracy avoids misreading on-screen text.
//
// ---------------------------------------------------------------------------

// Shared render_layout tool input schema — used by Stage 2 / generate mode.
const RENDER_LAYOUT_INPUT_SCHEMA = {
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
            enum: [
              'scoreboard', 'timer', 'statpanel', 'alert', 'momentum',
              'infocard', 'keypoints', 'definition',
            ],
          },
          // scoreboard
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
          // timer
          durationSeconds: { type: 'integer', minimum: 1 },
          label: { type: 'string' },
          // statpanel
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
          // alert
          message: { type: 'string' },
          tone: {
            type: 'string',
            enum: ['info', 'success', 'warning'],
          },
          // momentum (prefixed)
          momentum_teams: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                probability: { type: 'integer', minimum: 0, maximum: 100 },
              },
              required: ['name', 'probability'],
            },
            minItems: 2,
            maxItems: 2,
          },
          momentum_note: { type: 'string' },
          // infocard (prefixed)
          infocard_title: { type: 'string' },
          infocard_body: { type: 'string' },
          infocard_accent: {
            type: 'string',
            enum: ['blue', 'green', 'orange', 'purple'],
          },
          // keypoints (prefixed)
          kp_title: { type: 'string' },
          kp_points: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 6,
          },
          // definition (prefixed)
          def_term: { type: 'string' },
          def_definition: { type: 'string' },
        },
        required: ['slot', 'widget_type'],
      },
    },
  },
  required: ['nodes'],
}

// Hardened grounding rules shared between Stage 2 detect and generate-with-image.
// The PRIMARY content is what is being actively shown in the MAIN video frame.
const DETECT_GROUNDING_RULES = `
PRIMARY CONTENT IDENTIFICATION:
- The PRIMARY content is what is being actively shown in the MAIN video frame (the large central video area).
- For sport broadcasts: read ONLY the scorebug/score bug that belongs to the primary match — typically
  pinned top-left or bottom of the main frame, tied to the live action visible in the frame.
- DO NOT read data from picture-in-picture boxes, commentator webcam feeds, or any smaller inset.

IGNORE these elements entirely — never use data from them:
- Scrolling tickers or results bars showing OTHER content or match scores.
- Scores, team names, or results from any content OTHER than the primary live content.
- "Up next", "Coming up", or any promo for future content.
- League standings, tournament brackets, or historical result graphics.
- Channel logos, sponsor banners, social media handles, watermarks.
- Picture-in-picture boxes and commentator webcam feeds.
- Any overlay or UI element that is NOT part of the main video content.

If multiple scores or content types are visible, only the PRIMARY content in the main frame is authoritative.
If you cannot confidently identify the primary content, do NOT fabricate: return nothing (do not call render_layout).

Use ONLY data visible in the screenshot. Do not apply prior knowledge.`

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

  // Build the shared image block used by both stages.
  const imageBlock: Anthropic.ImageBlockParam = {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: base64Data,
    },
  }

  // -------------------------------------------------------------------------
  // STAGE 1 — Haiku filter: cheap yes/no "is something worth surfacing?"
  //
  // Model : claude-haiku-4-5 (fast, inexpensive — suited for high-frequency polling)
  // Tool  : check_notable — structured yes/no with short reason
  // Tokens: max_tokens 256 — we only need a tiny JSON object back
  // -------------------------------------------------------------------------
  const stage1Instruction = `You are a video content monitor scanning for notable moments worth surfacing as an overlay.

Look ONLY at the PRIMARY content — what is being actively shown in the MAIN video frame.
Ignore scrolling tickers, unrelated scores, picture-in-picture, webcams, and promos.

You must ALWAYS report score visibility (scorebugVisible) even when nothing notable is happening.

SCOREBUG VISIBILITY:
- A scorebug is the broadcast's own score graphic tied to the primary match — typically pinned top-left or bottom of the main frame.
- Set scorebugVisible: true if the broadcast's scorebug is CURRENTLY VISIBLE and readable in the main video frame.
- Set scorebugVisible: false if the scorebug is hidden, off-screen, or not present (e.g. during a replay, wide shot, cutaway, half-time graphics, or any moment the broadcast hides its own score).
- When scorebugVisible is true AND you can read the score clearly: include home (name, score), away (name, score), and minute if visible.
- When scorebugVisible is false OR the score is unreadable: omit home, away, minute.

Is something NOTABLE happening in the PRIMARY content RIGHT NOW that would be worth surfacing as an overlay?

Examples of notable moments (across different content types):
- Sport: goal just scored, red or yellow card shown, penalty awarded, VAR decision, significant score change
- Lecture/talk: a key definition shown, a pivotal slide, a graph or result being explained
- Cooking: a critical step being performed, a technique being demonstrated
- Gameplay: a boss fight started, a key item obtained, a notable game event
- Any: a dramatic, educational, or clearly significant moment in the main video

Call check_notable with your assessment. Be conservative: if you are unsure, answer notable: false.`

  const stage1Response = await client.messages.create({
    model: 'claude-haiku-4-5', // Stage 1: fast cheap filter
    max_tokens: 512,           // Slightly larger — now also returns scorebug state
    tools: [
      {
        name: 'check_notable',
        description: 'Report whether something notable is happening AND the current scorebug visibility status.',
        input_schema: {
          type: 'object' as const,
          properties: {
            notable: {
              type: 'boolean',
              description: 'true if a notable moment worth surfacing as an overlay is happening in the primary content.',
            },
            reason: {
              type: 'string',
              description: 'One short sentence explaining why notable is true or false.',
            },
            scorebugVisible: {
              type: 'boolean',
              description: 'true if the broadcast\'s own scorebug is currently visible and readable in the main video frame. false if hidden, off-screen, or not present (e.g. during replays, cutaways, wide shots, half-time screens).',
            },
            home: {
              type: 'object',
              description: 'Home team — include ONLY when scorebugVisible is true and the score is readable.',
              properties: {
                name: { type: 'string', description: 'Home team name as shown in the scorebug.' },
                score: { type: 'integer', minimum: 0, description: 'Home team score.' },
              },
              required: ['name', 'score'],
            },
            away: {
              type: 'object',
              description: 'Away team — include ONLY when scorebugVisible is true and the score is readable.',
              properties: {
                name: { type: 'string', description: 'Away team name as shown in the scorebug.' },
                score: { type: 'integer', minimum: 0, description: 'Away team score.' },
              },
              required: ['name', 'score'],
            },
            minute: {
              type: 'integer',
              minimum: 0,
              description: 'Current match minute — include ONLY when scorebugVisible is true and the minute is readable.',
            },
          },
          required: ['notable', 'reason', 'scorebugVisible'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'check_notable' }, // Force structured output
    messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: stage1Instruction }] }],
  })

  // Parse Stage 1 result.
  const stage1Tool = stage1Response.content.find((b) => b.type === 'tool_use')
  if (!stage1Tool || stage1Tool.type !== 'tool_use') {
    // Unexpected — treat as non-notable to fail safe.
    console.warn('[klai detect] Stage 1 did not return check_notable — skipping')
    return Response.json({ suggestion: null }, { headers: CORS_HEADERS })
  }

  const stage1Input = stage1Tool.input as {
    notable: boolean
    reason: string
    scorebugVisible: boolean
    home?: { name: string; score: number }
    away?: { name: string; score: number }
    minute?: number
  }
  console.log('[klai detect] Stage 1 (haiku):', stage1Input.notable, '—', stage1Input.reason, '| scorebugVisible:', stage1Input.scorebugVisible)

  // Build scoreState from Stage 1 output — always returned regardless of notable.
  const scoreState: {
    scorebugVisible: boolean
    home?: { name: string; score: number }
    away?: { name: string; score: number }
    minute?: number
  } = { scorebugVisible: stage1Input.scorebugVisible }

  if (stage1Input.scorebugVisible && stage1Input.home && stage1Input.away) {
    scoreState.home = stage1Input.home
    scoreState.away = stage1Input.away
    if (stage1Input.minute !== undefined) scoreState.minute = stage1Input.minute
  }

  // Gate: if Haiku says nothing notable, stop here — no Sonnet call.
  // Still return scoreState so the extension can manage the fill-the-gap scoreboard.
  if (!stage1Input.notable) {
    return Response.json({ suggestion: null, scoreState }, { headers: CORS_HEADERS })
  }

  // -------------------------------------------------------------------------
  // STAGE 2 — Sonnet confirm + render: accurate read, only when Haiku said YES
  //
  // Model : claude-sonnet-4-6 (better OCR / on-screen text accuracy)
  // Tool  : render_layout — optional tool use (no forced choice)
  //         Sonnet may still decide the event isn't genuinely notable or
  //         can't be read confidently → no tool call → { suggestion: null }
  // Tokens: max_tokens 1024 — needs to produce a full widget layout
  // -------------------------------------------------------------------------
  const stage2Instruction = `You are a video content monitor. The fast filter flagged a potentially notable moment.
Confirm whether it is genuinely notable and — if so — compose an appropriate overlay layout.
${DETECT_GROUNDING_RULES}

ONLY call render_layout if there is a CONFIRMED NOTABLE moment in the PRIMARY content.

For sport broadcasts, notable moments include:
- A goal just scored, a card shown, a penalty awarded, a significant score change, a VAR decision

For lectures and educational content:
- A key definition or concept being explained, an important result or formula shown

For cooking:
- A critical technique or step being performed that is worth highlighting

For gameplay:
- A boss fight, a key achievement, or a dramatic in-game event

If after your own careful read you conclude there is nothing genuinely notable, or you cannot confidently
read the primary content data, do NOT call render_layout. Return nothing.

If you DO call render_layout, choose the widget type appropriate for the content domain and use only
data from the PRIMARY content in the main video frame.`

  const stage2Response = await client.messages.create({
    model: 'claude-sonnet-4-6', // Stage 2: accurate — only called when Haiku said YES
    max_tokens: 1024,           // Enough for a full render_layout payload
    tools: [
      {
        name: 'render_layout',
        description:
          'Compose a layout of 1–3 overlay widgets for a confirmed notable moment in the video. ' +
          'Only call this when something genuinely notable is happening in the PRIMARY content.',
        input_schema: RENDER_LAYOUT_INPUT_SCHEMA,
      },
    ],
    // No tool_choice — Sonnet may decline to call the tool if not actually notable.
    messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: stage2Instruction }] }],
  })

  // Check whether Sonnet confirmed by calling render_layout.
  const stage2Tool = stage2Response.content.find((b) => b.type === 'tool_use')

  // No tool call = Sonnet decided it wasn't actually notable (or couldn't read it confidently).
  if (!stage2Tool || stage2Tool.type !== 'tool_use') {
    console.log('[klai detect] Stage 2 (sonnet) declined — not notable or unreadable')
    return Response.json({ suggestion: null, scoreState }, { headers: CORS_HEADERS })
  }

  // Reshape flat nodes → nested LayoutNodes (same pattern as generate mode).
  const rawInput = stage2Tool.input as {
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
      momentum_teams?: Array<{ name: string; probability: number }>
      momentum_note?: string
      infocard_title?: string
      infocard_body?: string
      infocard_accent?: string
      kp_title?: string
      kp_points?: string[]
      def_term?: string
      def_definition?: string
    }>
  }

  const validNodes: Array<{ slot: string; zIndex?: number; widget: unknown }> = []

  for (const rawNode of rawInput.nodes ?? []) {
    const {
      slot, zIndex, widget_type,
      momentum_teams, momentum_note,
      infocard_title, infocard_body, infocard_accent,
      kp_title, kp_points,
      def_term, def_definition,
      ...widgetFields
    } = rawNode

    let widgetCandidate: Record<string, unknown>

    switch (widget_type) {
      case 'momentum':
        widgetCandidate = { type: 'momentum', teams: momentum_teams, note: momentum_note }
        break
      case 'infocard':
        widgetCandidate = { type: 'infocard', title: infocard_title, body: infocard_body, accent: infocard_accent }
        break
      case 'keypoints':
        widgetCandidate = { type: 'keypoints', title: kp_title, points: kp_points }
        break
      case 'definition':
        widgetCandidate = { type: 'definition', term: def_term, definition: def_definition }
        break
      default:
        widgetCandidate = { type: widget_type, ...widgetFields }
    }

    const widgetParsed = WidgetNodeSchema.safeParse(widgetCandidate)
    if (!widgetParsed.success) {
      console.warn('[klai detect] Dropping invalid node:', widgetParsed.error.message)
      continue
    }
    validNodes.push({ slot, zIndex, widget: widgetParsed.data })
  }

  if (validNodes.length === 0) {
    return Response.json({ suggestion: null, scoreState }, { headers: CORS_HEADERS })
  }

  const layoutCandidate = { type: 'layout' as const, nodes: validNodes }
  const layoutParsed = LayoutSchema.safeParse(layoutCandidate)

  if (!layoutParsed.success) {
    console.warn('[klai detect] Layout validation failed:', layoutParsed.error)
    return Response.json({ suggestion: null, scoreState }, { headers: CORS_HEADERS })
  }

  console.log('[klai detect] Stage 2 (sonnet) confirmed notable — returning suggestion')
  return Response.json({ suggestion: layoutParsed.data, scoreState }, { headers: CORS_HEADERS })
}
