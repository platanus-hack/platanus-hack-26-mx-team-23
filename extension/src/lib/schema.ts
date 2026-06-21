import { z } from 'zod'

// --- Scoreboard ---
export const TeamSchema = z.object({
  name: z.string(),
  score: z.number().int().nonnegative(),
})

export const ScoreboardSchema = z.object({
  type: z.literal('scoreboard'),
  teams: z.array(TeamSchema).length(2),
  minute: z.number().int().nonnegative().optional(),
})

export type Scoreboard = z.infer<typeof ScoreboardSchema>

// --- Timer ---
export const TimerSchema = z.object({
  type: z.literal('timer'),
  label: z.string().optional(),
  durationSeconds: z.number().int().positive(),
})

export type Timer = z.infer<typeof TimerSchema>

// --- StatPanel ---
export const StatSchema = z.object({
  label: z.string(),
  value: z.string(),
})

export const StatPanelSchema = z.object({
  type: z.literal('statpanel'),
  title: z.string().optional(),
  stats: z.array(StatSchema).min(1).max(6),
})

export type StatPanel = z.infer<typeof StatPanelSchema>

// --- Alert ---
export const AlertSchema = z.object({
  type: z.literal('alert'),
  message: z.string(),
  tone: z.enum(['info', 'success', 'warning']).optional(),
})

export type Alert = z.infer<typeof AlertSchema>

// --- Momentum ---
// Win-probability widget: two teams, each with an integer probability 0–100.
// The two probabilities should sum to ~100; the widget normalizes them if they don't.
export const MomentumTeamSchema = z.object({
  name: z.string(),
  probability: z.number().int().min(0).max(100),
})

export const MomentumSchema = z.object({
  type: z.literal('momentum'),
  teams: z.array(MomentumTeamSchema).length(2),
  note: z.string().optional(),
})

export type Momentum = z.infer<typeof MomentumSchema>

// --- InfoCard ---
// A titled info card for explaining anything: facts, context, trivia, general info.
export const InfoCardSchema = z.object({
  type: z.literal('infocard'),
  title: z.string(),
  body: z.string(),
  accent: z.enum(['blue', 'green', 'orange', 'purple']).optional(),
})

export type InfoCard = z.infer<typeof InfoCardSchema>

// --- KeyPoints ---
// A bulleted list — recipe steps, lecture key points, match highlights, summaries.
export const KeyPointsSchema = z.object({
  type: z.literal('keypoints'),
  title: z.string().optional(),
  points: z.array(z.string()).min(1).max(6),
})

export type KeyPoints = z.infer<typeof KeyPointsSchema>

// --- Definition ---
// A term + explanation card for tutorials and lectures.
export const DefinitionSchema = z.object({
  type: z.literal('definition'),
  term: z.string(),
  definition: z.string(),
})

export type Definition = z.infer<typeof DefinitionSchema>

// --- Widget node (discriminated union of the 8 widget types) ---
export const WidgetNodeSchema = z.discriminatedUnion('type', [
  ScoreboardSchema,
  TimerSchema,
  StatPanelSchema,
  AlertSchema,
  MomentumSchema,
  InfoCardSchema,
  KeyPointsSchema,
  DefinitionSchema,
])

export type WidgetNode = z.infer<typeof WidgetNodeSchema>

// Keep the old name as an alias for backward compatibility inside the extension.
export const WidgetSchema = WidgetNodeSchema
export type Widget = WidgetNode


// --- Slot positions ---
// 8 fixed regions relative to the video element.
export const SlotSchema = z.enum([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])

export type Slot = z.infer<typeof SlotSchema>

// --- Layout node: one widget placed in one slot ---
export const LayoutNodeSchema = z.object({
  widget: WidgetNodeSchema,
  slot: SlotSchema,
  zIndex: z.number().int().optional(),
})

export type LayoutNode = z.infer<typeof LayoutNodeSchema>

// --- Layout: flat, bounded (1–6 nodes), non-recursive ---
// Flat structure required: Anthropic strict structured outputs do not support
// recursive schemas or numerical constraints at the top level.
export const LayoutSchema = z.object({
  type: z.literal('layout'),
  nodes: z.array(LayoutNodeSchema).min(1).max(6),
})

export type Layout = z.infer<typeof LayoutSchema>

// --- Control actions ---
// Emitted by the backend when the user's intent is to manage existing widgets
// rather than create new ones. The extension applies these directly without
// accumulating them as layout content.
export const ControlActionSchema = z.discriminatedUnion('action', [
  // Close one or more specific widget instances by id.
  z.object({
    kind: z.literal('control'),
    action: z.literal('close'),
    targetIds: z.array(z.string()).min(1),
  }),
  // Move one widget instance to a new slot.
  z.object({
    kind: z.literal('control'),
    action: z.literal('move'),
    targetId: z.string(),
    slot: SlotSchema,
  }),
  // Clear all active widget instances (same as the "Clear all" button).
  z.object({
    kind: z.literal('control'),
    action: z.literal('clear_all'),
  }),
  // Toggle voice narration (text-to-speech) on or off.
  z.object({
    kind: z.literal('control'),
    action: z.literal('narration'),
    enabled: z.boolean(),
  }),
])

export type ControlAction = z.infer<typeof ControlActionSchema>

// --- Top-level response: single widget (back-compat), a layout, OR a control action ---
export const ResponseSchema = z.union([WidgetNodeSchema, LayoutSchema, ControlActionSchema])

export type KlaiResponse = z.infer<typeof ResponseSchema>
