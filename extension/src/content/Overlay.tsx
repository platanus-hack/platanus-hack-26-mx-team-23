import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion, useMotionValue } from 'framer-motion'
import {
  ResponseSchema,
  ControlActionSchema,
  LayoutSchema,
  WidgetNodeSchema,
  type ControlAction,
  type Layout,
  type LayoutNode,
  type Slot,
  type WidgetNode,
} from '../lib/schema'
import { getWidget } from '../lib/registry'

// Backend base URL — set VITE_BACKEND_BASE_URL at build time (e.g. the Vercel URL).
// Falls back to localhost for local development.
const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Session history — Features E + 7
// ---------------------------------------------------------------------------
// Maintains an in-memory log of the user's MANUAL interactions for the current
// page session. Each entry stores the original query and a short human-readable
// summary of what was shown, derived from the validated layout.
//
// The history is sent with each manual query so the backend can resolve
// pronoun references like "and his stats?" or "what about the other team?".
//
// Design decisions:
//   - Cap: last 5 entries (oldest entry evicted when limit is exceeded).
//   - Reset: in-memory only; clears automatically on page navigation.
//   - Proactive (watch-mode) suggestions are NOT added to history. The user did
//     not ask for them, so they should not pollute the conversational thread.
//   - Scope: module-level (one history per content-script lifetime == per tab).
// ---------------------------------------------------------------------------

interface HistoryEntry {
  query: string
  summary: string
}

const SESSION_HISTORY_MAX = 5

// Module-level array — lives as long as the content script is alive (per tab).
const sessionHistory: HistoryEntry[] = []

/** Derive a compact human-readable summary from a validated Layout. */
function deriveLayoutSummary(layout: Layout): string {
  const parts = layout.nodes.map((n) => {
    const w = n.widget
    switch (w.type) {
      case 'scoreboard': {
        const [h, a] = w.teams
        const min = w.minute !== undefined ? ` ${w.minute}'` : ''
        return `scoreboard: ${h.name} ${h.score}-${a.score} ${a.name}${min}`
      }
      case 'statpanel': {
        const title = w.title ? `${w.title} ` : ''
        return `statpanel: ${title}${w.stats.map((s) => `${s.label} ${s.value}`).join(', ')}`
      }
      case 'timer':
        return `timer: ${w.label ?? ''}${w.durationSeconds}s`
      case 'alert':
        return `alert: ${w.message}`
      case 'momentum': {
        const [h, a] = w.teams
        return `momentum: ${h.name} ${h.probability}% vs ${a.name} ${a.probability}%`
      }
      case 'infocard':
        return `infocard: ${w.title} — ${w.body.slice(0, 60)}`
      case 'keypoints': {
        const title = w.title ? `${w.title}: ` : ''
        return `keypoints: ${title}${w.points.slice(0, 3).join('; ')}`
      }
      case 'definition':
        return `definition: ${w.term}`
      default:
        return (w as { type: string }).type
    }
  })
  return parts.join(' | ')
}

/**
 * Derives a short human-readable label for a single WidgetInstance so the
 * backend can resolve voice/text references like "close the scoreboard" or
 * "move the stats widget to the right".
 */
function deriveWidgetLabel(inst: WidgetInstance): string {
  const w = inst.widget
  switch (w.type) {
    case 'scoreboard': {
      const [h, a] = w.teams
      return `scoreboard (${h.name} vs ${a.name})`
    }
    case 'statpanel':
      return w.title ? `statpanel: ${w.title}` : 'statpanel'
    case 'timer':
      return `timer${w.label ? ` (${w.label})` : ''} ${w.durationSeconds}s`
    case 'alert':
      return `alert: ${w.message.slice(0, 40)}`
    case 'momentum': {
      const [h, a] = w.teams
      return `momentum: ${h.name} ${h.probability}% vs ${a.name} ${a.probability}%`
    }
    case 'infocard':
      return `infocard: ${w.title}`
    case 'keypoints':
      return `keypoints${w.title ? `: ${w.title}` : ''}`
    case 'definition':
      return `definition: ${w.term}`
    default:
      return (w as { type: string }).type
  }
}

/** Append a manual interaction to the session history, evicting the oldest if at cap. */
function pushHistory(query: string, layout: Layout): void {
  const entry: HistoryEntry = { query, summary: deriveLayoutSummary(layout) }
  sessionHistory.push(entry)
  if (sessionHistory.length > SESSION_HISTORY_MAX) {
    sessionHistory.shift()
  }
}

// Padding (px) between each slot container and the video edge / center.
const SLOT_PADDING = 16

// Gap (px) added between stacked widgets when vertical-offset fallback is used.
const STACK_GAP = 8

// Interval (ms) between successive widget reveals during progressive assembly.
// Each node appears this many milliseconds after the previous one.
const REVEAL_INTERVAL_MS = 200

// Maximum number of live widget instances before oldest non-dragged ones are dropped.
const MAX_INSTANCES = 8

// Reveal order: widget types listed here enter first (ascending index = earlier).
// Types not listed fall after all listed types, then sorted by ascending zIndex.
// Generic widgets (infocard, keypoints, definition) reveal after sports-specific ones.
const REVEAL_ORDER: string[] = [
  'scoreboard',
  'momentum',
  'statpanel',
  'timer',
  'alert',
  'infocard',
  'keypoints',
  'definition',
]

// ---------------------------------------------------------------------------
// Widget priority: determines which widget "wins" a slot conflict and which
// gets relocated. Higher number = higher priority = stays in its slot.
// Priority order: alert > scoreboard > momentum > timer > statpanel > generic widgets
// Generic widgets (infocard, keypoints, definition) are lower priority than alert
// but higher priority than zero (unknown types).
// ---------------------------------------------------------------------------
const WIDGET_PRIORITY: Record<string, number> = {
  alert:      40,
  scoreboard: 30,
  momentum:   25,
  timer:      20,
  statpanel:  10,
  infocard:    8,
  keypoints:   7,
  definition:  6,
}

function widgetPriority(type: string): number {
  return WIDGET_PRIORITY[type] ?? 0
}

// All 8 valid slot names in a stable order used for relocation searches.
const ALL_SLOTS: Slot[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'top-center',
  'bottom-center',
  'middle-left',
  'middle-right',
]

// ---------------------------------------------------------------------------
// Center no-go zone
// ---------------------------------------------------------------------------
// The central ~40% of the video rect (both horizontally and vertically) is
// reserved as broadcast action area. No widget slot anchor should place a widget
// whose bounding rect extends into this zone.
//
// Implementation: we check whether a slot anchor's resulting widget rect
// intersects the center zone. If so, the slot is excluded from the candidate
// list during relocation.
// ---------------------------------------------------------------------------
function centerNoGoZone(rect: DOMRect): DOMRect {
  // 40% of each dimension, centered.
  const w = rect.width * 0.4
  const h = rect.height * 0.4
  return new DOMRect(
    rect.left + (rect.width - w) / 2,
    rect.top + (rect.height - h) / 2,
    w,
    h,
  )
}

// Returns true if two rects intersect (including touching edges).
function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  )
}

// ---------------------------------------------------------------------------
// Slot anchor computation
// ---------------------------------------------------------------------------
// Maps a Slot enum value to absolute CSS positioning relative to the video rect.
// Each slot is an absolutely-positioned container; the widget renders inside it.
function slotStyle(
  slot: Slot,
  rect: DOMRect,
  offsetY = 0,
): React.CSSProperties {
  const p = SLOT_PADDING

  const top = rect.top
  const left = rect.left
  const right = rect.right
  const bottom = rect.bottom
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  const positions: Record<Slot, React.CSSProperties> = {
    'top-left':      { top: top + p + offsetY,       left: left + p },
    'top-center':    { top: top + p + offsetY,       left: centerX, transform: `translateX(-50%)` },
    'top-right':     { top: top + p + offsetY,       right: window.innerWidth - right + p },
    'middle-left':   { top: centerY + offsetY,       left: left + p, transform: 'translateY(-50%)' },
    'middle-right':  { top: centerY + offsetY,       right: window.innerWidth - right + p, transform: 'translateY(-50%)' },
    'bottom-left':   { bottom: window.innerHeight - bottom + p - offsetY, left: left + p },
    'bottom-center': { bottom: window.innerHeight - bottom + p - offsetY, left: centerX, transform: 'translateX(-50%)' },
    'bottom-right':  { bottom: window.innerHeight - bottom + p - offsetY, right: window.innerWidth - right + p },
  }

  return {
    position: 'fixed',
    ...positions[slot],
  }
}

// Estimates the anchor point (top-left corner in viewport space) of a slot,
// given a known widget width and height. Used during pre-render relocation
// planning to approximate where a widget will land before we can measure it.
function estimateSlotRect(slot: Slot, videoRect: DOMRect, w: number, h: number): DOMRect {
  const p = SLOT_PADDING
  const cx = videoRect.left + videoRect.width / 2
  const cy = videoRect.top + videoRect.height / 2

  let x: number, y: number

  switch (slot) {
    case 'top-left':
      x = videoRect.left + p; y = videoRect.top + p; break
    case 'top-center':
      x = cx - w / 2; y = videoRect.top + p; break
    case 'top-right':
      x = videoRect.right - p - w; y = videoRect.top + p; break
    case 'middle-left':
      x = videoRect.left + p; y = cy - h / 2; break
    case 'middle-right':
      x = videoRect.right - p - w; y = cy - h / 2; break
    case 'bottom-left':
      x = videoRect.left + p; y = videoRect.bottom - p - h; break
    case 'bottom-center':
      x = cx - w / 2; y = videoRect.bottom - p - h; break
    case 'bottom-right':
      x = videoRect.right - p - w; y = videoRect.bottom - p - h; break
  }

  return new DOMRect(x, y, w, h)
}

// When the backend returns a bare widget (back-compat), wrap it as a 1-node layout
// placed at top-left so the renderer always sees a Layout.
function normalizeToLayout(raw: unknown): Layout | null {
  // Try layout first (has type: 'layout')
  const layoutParsed = LayoutSchema.safeParse(raw)
  if (layoutParsed.success) return layoutParsed.data

  // Try single widget — wrap in a layout at top-left
  const widgetParsed = WidgetNodeSchema.safeParse(raw)
  if (widgetParsed.success) {
    return {
      type: 'layout',
      nodes: [{ widget: widgetParsed.data, slot: 'top-left' }],
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Per-widget signature — used for accumulation dedup.
// Computes a signature for a single LayoutNode (type + key identifying fields).
// If an incoming widget has the same signature as an existing instance, we
// UPDATE that instance in place (keeping its position) rather than adding a copy.
// ---------------------------------------------------------------------------
// Normalize a string for identity comparison: lowercase, trimmed, collapsed
// whitespace — so "Cruz Azul" and "CRUZ  AZUL " dedupe to the same widget.
function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

// Identity signature used to dedupe accumulated widgets. It must use STABLE
// identity fields only — never volatile values (score, minute, probability,
// stat values, timer remaining) — otherwise a re-read with a changed score
// would be treated as a new widget and duplicate the card.
function widgetSignature(node: LayoutNode): string {
  const w = node.widget
  // Inherently single instances per video: one scoreboard / one momentum bar.
  if (w.type === 'scoreboard') return 'scoreboard'
  if (w.type === 'momentum') return 'momentum'
  if (w.type === 'timer') return `timer:${w.durationSeconds}`
  if (w.type === 'alert') return `alert:${norm(w.message)}`
  if (w.type === 'statpanel') return `statpanel:${norm(w.title ?? '')}`
  if (w.type === 'infocard') return `infocard:${norm(w.title)}`
  if (w.type === 'keypoints') return `keypoints:${norm(w.title ?? '')}`
  if (w.type === 'definition') return `definition:${norm(w.term)}`
  return (w as { type: string }).type
}

// Derive a lightweight signature from a full layout for proactive suggestion dedup.
function layoutSignature(layout: Layout): string {
  return layout.nodes
    .map((n) => widgetSignature(n))
    .sort()
    .join('|')
}

// ---------------------------------------------------------------------------
// Auto-dismiss constants for proactive alert widgets.
// Alerts are momentary event announcements (goal, penalty, card) and should
// disappear on their own after ALERT_AUTO_DISMISS_MS. The cooldown prevents
// the watch loop from immediately re-adding the same alert after it auto-closes
// (which would cause the old flicker bug). A DIFFERENT alert message bypasses
// the cooldown and appears immediately.
// ---------------------------------------------------------------------------
const ALERT_AUTO_DISMISS_MS = 15_000
const ALERT_COOLDOWN_MS = 45_000

// Module-level cooldown tracker: alert widgetSignature → timestamp of auto-close.
// Checked in the proactive accumulate path before adding a new alert instance.
const recentlyAutoClosedAlerts = new Map<string, number>()

// ---------------------------------------------------------------------------
// Dismissed proactive widget signatures — module-level (per content-script
// lifetime, i.e. per tab).
//
// When the user manually closes a proactive widget, its widgetSignature is
// added here. The proactive suggestion handler checks this set and skips
// any incoming node whose signature matches — preventing watch-mode from
// re-opening cards the user dismissed.
//
// The manual query path does NOT check this set; the user explicitly asked,
// so the widget always appears. When a manual query adds/updates a widget,
// its signature is REMOVED from this set so future proactive updates can
// surface it again.
//
// "Clear all": clears this set too — the user gets a clean slate and watch
// mode can resume surfacing everything.
// ---------------------------------------------------------------------------
const dismissedSignatures = new Set<string>()

// ---------------------------------------------------------------------------
// Dismissed proactive widget TYPES — module-level (per content-script lifetime).
//
// Tracks which widget types the user has explicitly closed while they were
// proactive (watch-mode) instances. The proactive accumulation path checks
// this set by TYPE (not by full signature) so that cross-language or
// semantically-equivalent duplicates (e.g. "DISCIPLINARY SUMMARY" EN and
// "TARJETAS EN EL PARTIDO" ES) are both suppressed once the user dismisses
// any one of them.
//
// The manual query path REMOVES a type from this set when it adds/updates a
// widget of that type — re-enabling auto for that type so watch mode can
// surface it again after the user has explicitly requested it.
//
// "Clear all": clears this set too — clean slate for watch mode.
// ---------------------------------------------------------------------------
const dismissedAutoTypes = new Set<string>()

// ---------------------------------------------------------------------------
// Fill-the-gap scoreboard — module-level state.
//
// lastKnownScore is updated whenever a scoreState arrives with scorebugVisible:true
// and readable home/away data. It is also updated when a scoreboard widget is
// created via a manual query or a Sonnet suggestion (see accumulateLayout).
//
// When the broadcast hides its own scorebug (replay, cutaway, wide shot) and
// we have lastKnownScore, a proactive AUTO scoreboard instance is shown so
// the viewer never loses track of the score. When the broadcast's own scorebug
// reappears, the AUTO scoreboard is removed — the broadcast covers it.
// ---------------------------------------------------------------------------

interface TeamScore {
  name: string
  score: number
}

interface ScoreState {
  scorebugVisible: boolean
  home?: TeamScore
  away?: TeamScore
  minute?: number
}

// Last known score populated from broadcast scorebug reads or manual scoreboard widgets.
let lastKnownScore: { home: TeamScore; away: TeamScore; minute?: number } | null = null

// Stable AUTO-scoreboard instance ID — assigned when the instance is first created
// and reused across updates so we can find and remove it later. The ID must be
// stable across event ticks; we use a prefix + timestamp set at creation time.
let autoScoreboardInstanceId: string | null = null

// ---------------------------------------------------------------------------
// Widget instance model — the live list of active widgets.
// Replaces the single-layout OverlayState.
// ---------------------------------------------------------------------------
interface WidgetInstance {
  /** Stable unique id — used as React key and ref key. */
  id: string
  /** The validated widget data. */
  widget: WidgetNode
  /** Initial/auto slot from the layout or collision resolver. */
  slot: Slot
  /** zIndex hint from the original layout node. */
  zIndex: number
  /**
   * Once the user drags the widget, we store its absolute viewport position
   * here. When set, the widget is excluded from the collision resolver's
   * relocation logic (but counted as an obstacle at its actual visual position).
   *
   * @deprecated Internal use only — kept as a non-null sentinel to signal
   * "this widget has been manually positioned". Use dragOffset for the actual
   * visual offset. Will be set to {x:0,y:0} as a dummy value when dragOffset
   * is present, purely to preserve the existing obstacle/relocation guards.
   */
  manualPos: { x: number; y: number } | null
  /**
   * Drag offset (pixels) relative to the slot anchor (top/left from slotStyle).
   * The widget's on-screen position = slot anchor + dragOffset.
   * Persisted so the widget stays put across re-renders (e.g. new widget added).
   * Null means the user has never dragged the widget.
   */
  dragOffset: { x: number; y: number } | null
  /** Whether this came from watch mode (proactive suggestion). */
  proactive: boolean
  /**
   * Monotonically increasing insertion counter — used to sort instances for
   * progressive reveal ordering and for evicting the oldest when we exceed
   * MAX_INSTANCES.
   */
  insertionOrder: number
  /**
   * The slot assigned to this instance by the overlap resolver.
   * Null means the resolver has not yet placed this instance.
   * Once set, this instance is treated as a FIXED OBSTACLE by subsequent
   * resolver runs — it will not be relocated when new widgets are added.
   */
  placedSlot: Slot | null
  /**
   * The vertical offset (px) assigned to this instance by the overlap resolver
   * (used when stacking within the same slot). Zero means no stacking offset.
   * Only valid when placedSlot is non-null.
   */
  placedOffsetY: number
}

// ---------------------------------------------------------------------------
// Loading / error indicator state — kept separate from the instance list.
// ---------------------------------------------------------------------------
type StatusState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }

// Returns the reveal-order rank for a widget type.
// Lower rank = reveals earlier. Types absent from REVEAL_ORDER get rank = Infinity.
function revealRank(type: string): number {
  const idx = REVEAL_ORDER.indexOf(type)
  return idx === -1 ? Infinity : idx
}

// Voice capture state type — mirrors the VoiceState type in the service worker.
type VoiceIndicatorState = 'idle' | 'listening' | 'transcribing'

// ---------------------------------------------------------------------------
// Resolved placement state
// ---------------------------------------------------------------------------
// After the measure pass, each instance's final slot and vertical offset are
// stored here. Keys are instance IDs.
// ---------------------------------------------------------------------------
interface ResolvedPlacement {
  slot: Slot
  offsetY: number
}

type PlacementMap = Map<string, ResolvedPlacement>

// ---------------------------------------------------------------------------
// Slot deduplication across ALL active instances (pre-render, pure JS, no DOM)
// ---------------------------------------------------------------------------
// If two instances (existing + incoming) are assigned the same slot, the higher-
// priority widget stays; the lower-priority one is relocated to the nearest free
// slot. Dragged instances (manualPos set) are FIXED and excluded from relocation
// but DO count as obstacles (their slots are considered occupied).
// ---------------------------------------------------------------------------
function deduplicateSlotsForInstances(
  instances: WidgetInstance[],
  videoRect: DOMRect,
): WidgetInstance[] {
  const noGo = centerNoGoZone(videoRect)

  // Fixed = dragged (manualPos !== null) OR already resolver-placed (placedSlot !== null).
  // Fixed instances occupy their slots and are never relocated.
  const isFixed = (i: WidgetInstance) => i.manualPos !== null || i.placedSlot !== null

  const fixedSlots = new Set<Slot>(
    instances.filter(isFixed).map((i) => (i.placedSlot ?? i.slot) as Slot),
  )

  const slotMap = new Map<Slot, WidgetInstance>()
  // Pre-populate fixed instances using their effective slot.
  for (const inst of instances) {
    if (isFixed(inst)) {
      const effectiveSlot = (inst.placedSlot ?? inst.slot) as Slot
      slotMap.set(effectiveSlot, inst)
    }
  }

  // Sort non-fixed (unplaced, non-dragged) instances by priority descending so
  // higher-priority nodes claim their desired slot first.
  const nonFixed = instances
    .filter((i) => !isFixed(i))
    .sort((a, b) => widgetPriority(b.widget.type) - widgetPriority(a.widget.type))

  const result: WidgetInstance[] = [...instances.filter(isFixed)]

  for (const inst of nonFixed) {
    const targetSlot = inst.slot
    if (!slotMap.has(targetSlot) && !fixedSlots.has(targetSlot)) {
      slotMap.set(targetSlot, inst)
      result.push(inst)
    } else {
      // Slot occupied — find the nearest free, non-center-colliding slot.
      const freeSlot = ALL_SLOTS.find((s) => {
        if (slotMap.has(s)) return false
        // Rough estimate: treat widget as ~300x60 for relocation candidate check.
        const estRect = estimateSlotRect(s, videoRect, 300, 60)
        return !rectsIntersect(estRect, noGo)
      })

      if (freeSlot) {
        const movedInst: WidgetInstance = { ...inst, slot: freeSlot }
        slotMap.set(freeSlot, movedInst)
        result.push(movedInst)
      } else {
        // No free slot — keep original slot (overlap resolver will handle it).
        slotMap.set(inst.slot, inst)
        result.push(inst)
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Overlap resolution (post-measure pass) across all active instances.
//
// Fixed instances (dragged OR already placed by a previous resolver run) are
// treated as immovable obstacles. Only instances that have never been placed
// (placedSlot === null AND manualPos === null) are newly positioned.
//
// This ensures that adding or closing a widget never relocates widgets that
// are already on screen — only brand-new widgets get positioned.
//
// With the motion-value drag model, each dragged widget's actual viewport
// position is: slotAnchor(top/left) + dragOffset(x/y). The measuredRect from
// the hidden layer is at the slot anchor (it uses slotStyle, not manualPos),
// so we shift it by dragOffset to get the true obstacle rect.
// ---------------------------------------------------------------------------
function resolveOverlapsForInstances(
  instances: WidgetInstance[],
  measuredRects: Map<string, DOMRect>,
  videoRect: DOMRect,
): PlacementMap {
  const noGo = centerNoGoZone(videoRect)

  const placed: Array<{ id: string; slot: Slot; rect: DOMRect; offsetY: number }> = []
  const result: PlacementMap = new Map()

  // --- Pass 1: register all FIXED instances as obstacles ---
  // Fixed = dragged (manualPos !== null) OR already resolved in a prior run
  // (placedSlot !== null). Their position never changes.
  for (const inst of instances) {
    const isDragged = inst.manualPos !== null
    const isPlaced = inst.placedSlot !== null

    if (isDragged) {
      const measuredRect = measuredRects.get(inst.id)
      if (measuredRect) {
        // Actual on-screen position: slot anchor + drag offset.
        const offset = inst.dragOffset ?? { x: 0, y: 0 }
        const rect = new DOMRect(
          measuredRect.x + offset.x,
          measuredRect.y + offset.y,
          measuredRect.width,
          measuredRect.height,
        )
        placed.push({ id: inst.id, slot: inst.slot, rect, offsetY: 0 })
        result.set(inst.id, { slot: inst.slot, offsetY: 0 })
      } else {
        result.set(inst.id, { slot: inst.slot, offsetY: 0 })
      }
    } else if (isPlaced) {
      // Already resolver-placed: lock in at the stored slot + offsetY.
      const slot = inst.placedSlot as Slot
      const offsetY = inst.placedOffsetY
      const measuredRect = measuredRects.get(inst.id)
      if (measuredRect) {
        const rect = estimateSlotRect(slot, videoRect, measuredRect.width, measuredRect.height)
        placed.push({ id: inst.id, slot, rect, offsetY })
      }
      result.set(inst.id, { slot, offsetY })
    }
  }

  // --- Pass 2: position only UNPLACED, non-dragged instances ---
  // These are widgets that were just added and have not been placed yet.
  const unplaced = instances
    .filter((i) => i.manualPos === null && i.placedSlot === null)
    .sort((a, b) => widgetPriority(b.widget.type) - widgetPriority(a.widget.type))

  for (const inst of unplaced) {
    const measuredRect = measuredRects.get(inst.id)

    if (!measuredRect) {
      result.set(inst.id, { slot: inst.slot, offsetY: 0 })
      continue
    }

    const w = measuredRect.width
    const h = measuredRect.height

    let chosenSlot: Slot = inst.slot
    let chosenOffsetY = 0
    let chosenRect = measuredRect

    const slotInCenter = rectsIntersect(measuredRect, noGo)
    const collidingWith = placed.find((p) => rectsIntersect(measuredRect, p.rect))

    if (slotInCenter || collidingWith) {
      const occupiedSlots = new Set(placed.map((p) => p.slot))
      const candidateSlot = ALL_SLOTS.find((s) => {
        if (occupiedSlots.has(s)) return false
        const estRect = estimateSlotRect(s, videoRect, w, h)
        if (rectsIntersect(estRect, noGo)) return false
        return !placed.some((p) => rectsIntersect(estRect, p.rect))
      })

      if (candidateSlot) {
        chosenSlot = candidateSlot
        chosenOffsetY = 0
        chosenRect = estimateSlotRect(candidateSlot, videoRect, w, h)
      } else if (collidingWith) {
        const isBottom = inst.slot.startsWith('bottom')
        const stackOffset = collidingWith.rect.height + STACK_GAP

        chosenSlot = inst.slot
        chosenOffsetY = stackOffset
        const dy = isBottom ? -stackOffset : stackOffset
        chosenRect = new DOMRect(measuredRect.x, measuredRect.y + dy, w, h)
      }
    }

    placed.push({ id: inst.id, slot: chosenSlot, rect: chosenRect, offsetY: chosenOffsetY })
    result.set(inst.id, { slot: chosenSlot, offsetY: chosenOffsetY })
  }

  return result
}

// Counter for generating stable instance IDs.
let instanceCounter = 0

function nextInstanceId(): string {
  return `klai-inst-${++instanceCounter}`
}

// ---------------------------------------------------------------------------
// Close button SVG — inline, no emoji.
// ---------------------------------------------------------------------------
function CloseIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="1" y1="1" x2="9" y2="9" />
      <line x1="9" y1="1" x2="1" y2="9" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// DraggableWidget — wraps a widget component with drag, close button, and
// pointer-events management. Keeps widget components unchanged.
//
// Drag model (motion-value base+offset):
//   - x and y are useMotionValue instances passed directly to the motion.div
//     via style={{ x, y }}. Framer-motion's drag moves the element by mutating
//     these values — no CSS transform is left behind after onDragEnd.
//   - The container's top/left (from slotStyle) is the SLOT ANCHOR and never
//     changes during or after a drag. The visual position is always:
//       viewport position = slot anchor (top/left CSS) + drag offset (x/y motion values)
//   - On onDragEnd, we read x.get()/y.get() (the cumulative offset) and
//     persist it to the instance via onDragEnd callback. On (re)mount, the
//     motion values are initialized from the persisted initialOffset so the
//     widget stays put when other widgets are added/removed.
//   - No dragConstraints: the drag is free in all directions. Constraints in
//     absolute viewport coordinates are in the wrong coordinate space for the
//     base+offset model and clamp movement to one direction (only right/down).
//     Free drag (no constraints) works correctly in all four directions.
// ---------------------------------------------------------------------------
interface DraggableWidgetProps {
  instanceId: string
  widget: WidgetNode
  delay: number
  /** Persisted drag offset (x, y) relative to the slot anchor. Null = never dragged. */
  initialOffset: { x: number; y: number } | null
  onClose: (id: string) => void
  /** Called with the cumulative x/y offset (motion value deltas) from the slot anchor. */
  onDragEnd: (id: string, x: number, y: number) => void
}

function DraggableWidget({
  instanceId,
  widget,
  delay,
  initialOffset,
  onClose,
  onDragEnd,
}: DraggableWidgetProps) {
  const WidgetComponent = getWidget(widget.type)
  if (!WidgetComponent) return null

  const [isHovered, setIsHovered] = useState(false)

  // Motion values drive the drag transform. Initialized from the persisted
  // offset so the widget appears exactly where the user left it on re-mount.
  const x = useMotionValue(initialOffset?.x ?? 0)
  const y = useMotionValue(initialOffset?.y ?? 0)

  return (
    <>
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0}
        style={{
          x,
          y,
          position: 'relative',
          display: 'inline-block',
          cursor: 'grab',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
        whileDrag={{ cursor: 'grabbing' }}
        onDragEnd={() => {
          // Read the current cumulative offset from the motion values.
          // This is the total displacement from the slot anchor (top/left CSS).
          // NO getBoundingClientRect() needed — no jump possible because the
          // container's top/left never changes; only x/y motion values move.
          onDragEnd(instanceId, x.get(), y.get())
        }}
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
      >
        <div style={{ display: 'inline-block' }}>
          <WidgetComponent data={widget} delay={delay} />
        </div>

        {/* Close button — top-right corner of the widget */}
        <AnimatePresence>
          {isHovered && (
            <motion.button
              key="close-btn"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => {
                e.stopPropagation()
                onClose(instanceId)
              }}
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(30,30,36,0.88)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: 'rgba(255,255,255,0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                pointerEvents: 'auto',
                padding: 0,
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                zIndex: 1,
              }}
              aria-label="Close widget"
            >
              <CloseIcon />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  )
}

export function Overlay() {
  const [videoRect, setVideoRect] = useState<DOMRect | null>(null)

  // The live list of active widget instances. Accumulates across queries.
  const [instances, setInstances] = useState<WidgetInstance[]>([])

  // Status indicator — loading / error, separate from widget instances.
  const [statusState, setStatusState] = useState<StatusState>({ status: 'idle' })

  const [voiceState, setVoiceState] = useState<VoiceIndicatorState>('idle')

  // PlacementMap computed by the measure pass (keyed by instance ID).
  const [placements, setPlacements] = useState<PlacementMap>(new Map())

  // Set of instance IDs that have been revealed so far. Newly added instances
  // are added one-by-one via the reveal timer; existing ones stay visible.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())

  // Queue of instance IDs waiting to be progressively revealed.
  const revealQueueRef = useRef<string[]>([])
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Refs for the hidden measurement layer — keyed by instance ID.
  const measureRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Fingerprint of the current instance set — used to detect when instances
  // change so we only re-run the resolve pass when necessary.
  const lastNodeFingerprintRef = useRef<string>('')

  // Signature of the last proactive suggestion shown — used to skip duplicate detections.
  const lastSuggestionSignatureRef = useRef<string>('')

  // Per-instance auto-dismiss timers for proactive alert widgets.
  // Keyed by instance id. Timers are cleared on closeInstance, unmount, and Clear all.
  const alertTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Scratch list populated inside the accumulateLayout setInstances updater so we
  // can schedule timers after the updater returns (timers must not be started inside
  // the updater itself because React may call updaters more than once in strict mode).
  // Each entry: { id, sig, reset } where reset=true means cancel the old timer first.
  const pendingAlertTimerOpsRef = useRef<Array<{ id: string; sig: string; reset: boolean }>>([])

  // Schedule (or reset) the auto-dismiss timer for a proactive alert instance.
  // Called right after accumulateLayout's setInstances call drains pendingAlertTimerOpsRef.
  const scheduleAlertTimer = useCallback((id: string, sig: string, reset: boolean) => {
    if (reset) {
      const existing = alertTimersRef.current.get(id)
      if (existing !== undefined) {
        clearTimeout(existing)
        alertTimersRef.current.delete(id)
      }
    }
    const timer = setTimeout(() => {
      alertTimersRef.current.delete(id)
      // Record cooldown BEFORE removing from state so the watch loop cannot sneak
      // the same alert back in between the two operations.
      recentlyAutoClosedAlerts.set(sig, Date.now())
      // Auto-close: NOT user-initiated — does not add to dismissedAutoTypes so
      // a genuinely new alert (different message) can still appear later.
      setInstances((prev) => prev.filter((i) => i.id !== id))
      setRevealedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      measureRefs.current.delete(id)
    }, ALERT_AUTO_DISMISS_MS)
    alertTimersRef.current.set(id, timer)
  }, [])

  // Keep videoRect in sync with the page <video> element.
  useEffect(() => {
    function findVideo() {
      const video = document.querySelector('video')
      if (video) setVideoRect(video.getBoundingClientRect())
    }

    findVideo()
    const interval = setInterval(findVideo, 2000)
    return () => clearInterval(interval)
  }, [])

  // ---------------------------------------------------------------------------
  // Accumulate new layout nodes into the instances list.
  //
  // Rules:
  //   - For each incoming node, compute its widgetSignature.
  //   - If an existing instance has the SAME signature, UPDATE its widget data
  //     in place (keep its manualPos / slot).
  //   - Otherwise ADD as a new instance.
  //   - Cap at MAX_INSTANCES: if adding would exceed the cap, evict the oldest
  //     non-dragged instance (lowest insertionOrder, manualPos === null).
  //   - Queue newly added instance IDs for progressive reveal.
  //   - Already-present instances are NOT re-mounted (stable React keys via id).
  // ---------------------------------------------------------------------------
  const accumulateLayout = useCallback(
    (layout: Layout, proactive: boolean) => {
      // Reset the scratch list before each call so we start clean.
      pendingAlertTimerOpsRef.current = []

      setInstances((prev) => {
        const next = [...prev]
        const newIds: string[] = []

        for (const node of layout.nodes) {
          const sig = widgetSignature(node)
          const widgetType = node.widget.type

          if (proactive) {
            // --- PROACTIVE PATH: dedup by widget TYPE, not by full signature ---
            //
            // The backend may return semantically identical data with different
            // titles or in a different language (e.g. "DISCIPLINARY SUMMARY" EN
            // and "TARJETAS EN EL PARTIDO" ES). Because widgetSignature includes
            // the title, these produce different signatures but carry the same
            // data. Deduping by TYPE collapses them to ONE widget per type.

            // 1. Skip types the user explicitly dismissed via watch mode.
            if (dismissedAutoTypes.has(widgetType)) continue

            // 2. Check for an existing PROACTIVE instance of the same type.
            const existingProactiveIdx = next.findIndex(
              (i) => i.widget.type === widgetType && i.proactive,
            )
            if (existingProactiveIdx !== -1) {
              // UPDATE the existing proactive instance in place — keep id/slot/position.
              next[existingProactiveIdx] = {
                ...next[existingProactiveIdx],
                widget: node.widget,
                zIndex: node.zIndex ?? 10,
              }
              // If this is a proactive alert, reset its auto-dismiss timer (new message → 15s restart).
              if (widgetType === 'alert') {
                pendingAlertTimerOpsRef.current.push({
                  id: next[existingProactiveIdx].id,
                  sig,
                  reset: true,
                })
              }
              continue
            }

            // 3. Skip if a MANUAL instance of the same type already exists —
            //    the user explicitly requested it; don't clobber it with auto data.
            const hasManualOfType = next.some(
              (i) => i.widget.type === widgetType && !i.proactive,
            )
            if (hasManualOfType) continue

            // 4. Also skip the per-signature dismissed set (backwards compat).
            if (dismissedSignatures.has(sig)) continue

            // 5. Cooldown check for proactive alerts: if this exact alert signature
            //    was auto-closed within ALERT_COOLDOWN_MS, skip it so the watch loop
            //    cannot immediately re-add the just-dismissed alert (no flicker).
            //    A DIFFERENT alert message has a different signature and is not blocked.
            if (widgetType === 'alert') {
              const closedAt = recentlyAutoClosedAlerts.get(sig)
              if (closedAt !== undefined && Date.now() - closedAt < ALERT_COOLDOWN_MS) continue
            }

            // 6. No existing instance of this type — ADD as new proactive instance.
          } else {
            // --- MANUAL PATH: identity-based dedup (unchanged behavior) ---
            //
            // The user explicitly asked for this widget. Re-enable its type and
            // signature for future proactive updates, then check for an existing
            // instance to update in place.
            dismissedSignatures.delete(sig)
            dismissedAutoTypes.delete(widgetType)
          }

          // Check for existing instance with same signature (manual path uses
          // identity dedup; proactive falls through here only for new additions).
          const existingIdx = proactive
            ? -1 // proactive updates were already handled above (continue)
            : next.findIndex(
                (i) =>
                  widgetSignature({ widget: i.widget, slot: i.slot, zIndex: i.zIndex }) === sig,
              )

          if (existingIdx !== -1) {
            // UPDATE in place — preserve id, slot, manualPos, and placed position.
            next[existingIdx] = {
              ...next[existingIdx],
              widget: node.widget,
              zIndex: node.zIndex ?? 10,
            }
            // Sync lastKnownScore from manual scoreboard updates.
            if (node.widget.type === 'scoreboard') {
              const [h, a] = node.widget.teams
              lastKnownScore = { home: h, away: a, minute: node.widget.minute }
            }
          } else {
            // ADD as new instance.
            // Enforce cap: evict oldest non-dragged instance if needed.
            if (next.length >= MAX_INSTANCES) {
              const evictIdx = next.reduce<number>((oldest, inst, idx) => {
                if (inst.manualPos !== null) return oldest
                if (oldest === -1) return idx
                return inst.insertionOrder < next[oldest].insertionOrder ? idx : oldest
              }, -1)

              if (evictIdx !== -1) {
                console.log('[klai] Evicting oldest widget to make room:', next[evictIdx].widget.type)
                next.splice(evictIdx, 1)
              }
            }

            const id = nextInstanceId()
            next.push({
              id,
              widget: node.widget,
              slot: node.slot,
              zIndex: node.zIndex ?? 10,
              manualPos: null,
              dragOffset: null,
              proactive,
              insertionOrder: instanceCounter,
              // New instances start unplaced — resolver will position them on next
              // measure pass and then lock them in via placedSlot/placedOffsetY.
              placedSlot: null,
              placedOffsetY: 0,
            })
            newIds.push(id)

            // Sync lastKnownScore from any new scoreboard widget (manual or proactive).
            if (node.widget.type === 'scoreboard') {
              const [h, a] = node.widget.teams
              lastKnownScore = { home: h, away: a, minute: node.widget.minute }
            }

            // Schedule auto-dismiss for new PROACTIVE alert instances only.
            // Manual alerts (proactive=false) are user-requested and must not auto-close.
            if (proactive && widgetType === 'alert') {
              pendingAlertTimerOpsRef.current.push({ id, sig, reset: false })
            }
          }
        }

        // Queue new IDs for progressive reveal.
        if (newIds.length > 0) {
          // Sort new IDs by reveal order before queuing.
          const newInstances = next.filter((i) => newIds.includes(i.id))
          const sorted = [...newInstances].sort((a, b) => {
            const rankDiff = revealRank(a.widget.type) - revealRank(b.widget.type)
            if (rankDiff !== 0) return rankDiff
            return a.zIndex - b.zIndex
          })

          revealQueueRef.current.push(...sorted.map((i) => i.id))

          // Start the reveal timer if not already running.
          if (revealTimerRef.current === null) {
            // Reveal first one immediately.
            const firstId = revealQueueRef.current.shift()
            if (firstId) {
              setRevealedIds((r) => new Set([...r, firstId]))
            }

            if (revealQueueRef.current.length > 0) {
              const interval = setInterval(() => {
                const nextId = revealQueueRef.current.shift()
                if (nextId) {
                  setRevealedIds((r) => new Set([...r, nextId]))
                }
                if (revealQueueRef.current.length === 0) {
                  clearInterval(interval)
                  revealTimerRef.current = null
                }
              }, REVEAL_INTERVAL_MS)
              revealTimerRef.current = interval
            }
          }
        }

        return next
      })

      // Schedule any pending alert timers collected during the updater.
      // Done here (outside the updater) so React's strict-mode double-invoke
      // of updaters does not create duplicate timers.
      for (const op of pendingAlertTimerOpsRef.current) {
        scheduleAlertTimer(op.id, op.sig, op.reset)
      }
      pendingAlertTimerOpsRef.current = []
    },
    [scheduleAlertTimer],
  )

  // Close a single widget instance by ID.
  // userInitiated=true (default) means the USER clicked the close button —
  // the widget's signature is added to dismissedSignatures so watch mode
  // cannot re-open it. Proactive instances also add their type to
  // dismissedAutoTypes so the watch loop suppresses that type going forward.
  const closeInstance = useCallback((id: string, userInitiated = true) => {
    // If the closed instance is the AUTO scoreboard, clear its tracked ID
    // so future score-state ticks can re-create it once appropriate.
    if (id === autoScoreboardInstanceId) {
      autoScoreboardInstanceId = null
    }

    // Clear any pending auto-dismiss timer for this instance — user beat it to it.
    const existingTimer = alertTimersRef.current.get(id)
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer)
      alertTimersRef.current.delete(id)
    }

    setInstances((prev) => {
      if (userInitiated) {
        const inst = prev.find((i) => i.id === id)
        if (inst) {
          const sig = widgetSignature({ widget: inst.widget, slot: inst.slot, zIndex: inst.zIndex })
          dismissedSignatures.add(sig)
          // If the closed widget was proactive, suppress its TYPE so the watch
          // loop cannot re-open a same-type widget (even under a different title
          // or language). Only user-initiated closes add to dismissedAutoTypes;
          // "Clear all" resets both sets so watch mode gets a clean slate.
          if (inst.proactive) {
            dismissedAutoTypes.add(inst.widget.type)
          }
        }
      }
      return prev.filter((i) => i.id !== id)
    })
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    measureRefs.current.delete(id)
  }, [])

  // Persist drag offset (relative to slot anchor) for a widget instance.
  // x and y are the motion-value offsets from DraggableWidget.
  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    setInstances((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              // dragOffset holds the actual visual delta from the slot anchor.
              dragOffset: { x, y },
              // manualPos acts as a non-null sentinel: the collision resolver
              // reads it to exclude this widget from relocation and to compute
              // its obstacle rect. We store the offset here too so the obstacle
              // rect calculation in resolveOverlapsForInstances can derive the
              // widget's actual viewport position (slotAnchor + dragOffset).
              manualPos: { x, y },
            }
          : i,
      ),
    )
  }, [])

  // Apply a ControlAction returned by the backend — called from handleQuery when
  // the model chose control_widgets instead of render_layout.
  const applyControlAction = useCallback(
    (action: ControlAction) => {
      switch (action.action) {
        case 'close': {
          // Close each targeted instance using the same path as the X button:
          // adds the widget's signature to dismissedSignatures and, if proactive,
          // adds its type to dismissedAutoTypes so watch mode won't resurface it.
          for (const targetId of action.targetIds) {
            // Only call if the instance actually exists — ignore unknown ids gracefully.
            const exists = instancesRef.current.some((i) => i.id === targetId)
            if (exists) {
              closeInstance(targetId, true)
            }
          }
          break
        }
        case 'move': {
          // Reposition one widget to a new slot.
          // Clear dragOffset/manualPos and placedSlot so the resolver places it
          // at the new slot on the next measure pass, then locks it there.
          const exists = instancesRef.current.some((i) => i.id === action.targetId)
          if (exists) {
            setInstances((prev) =>
              prev.map((inst) =>
                inst.id === action.targetId
                  ? {
                      ...inst,
                      slot: action.slot,
                      // Clear drag state so the new slot anchor takes effect.
                      dragOffset: null,
                      manualPos: null,
                      // Clear the placed slot so the resolver re-positions at the new slot.
                      placedSlot: null,
                      placedOffsetY: 0,
                    }
                  : inst,
              ),
            )
          }
          break
        }
        case 'clear_all': {
          // Same as the "Clear all" button — full reset including dismissed sets.
          setInstances([])
          setRevealedIds(new Set())
          measureRefs.current.clear()
          lastNodeFingerprintRef.current = ''
          setPlacements(new Map())
          dismissedSignatures.clear()
          dismissedAutoTypes.clear()
          lastSuggestionSignatureRef.current = ''
          autoScoreboardInstanceId = null
          // Clear all alert timers and the cooldown map so watch mode gets a clean slate.
          for (const timer of alertTimersRef.current.values()) {
            clearTimeout(timer)
          }
          alertTimersRef.current.clear()
          recentlyAutoClosedAlerts.clear()
          break
        }
      }
    },
    [closeInstance],
  )

  // Listen for intent queries dispatched by the content script (manual queries).
  useEffect(() => {
    async function handleQuery(event: Event) {
      const { text, image } = (event as CustomEvent<{ text: string; image?: string }>).detail
      if (!text) return

      // Manual query takes precedence — reset the proactive dedup signature.
      lastSuggestionSignatureRef.current = ''

      setStatusState({ status: 'loading' })

      try {
        // Build a compact description of every active widget instance so the
        // backend can resolve management references like "close the scoreboard".
        const activeWidgets = instancesRef.current.map((inst) => ({
          id: inst.id,
          type: inst.widget.type,
          label: deriveWidgetLabel(inst),
        }))

        // Include the current session history so the backend can resolve
        // conversational references (e.g. "and his stats?", "the other team?").
        const body: {
          text: string
          image?: string
          history?: HistoryEntry[]
          activeWidgets?: Array<{ id: string; type: string; label: string }>
        } = { text }
        if (image) body.image = image
        if (sessionHistory.length > 0) body.history = [...sessionHistory]
        if (activeWidgets.length > 0) body.activeWidgets = activeWidgets

        const response = await fetch(`${BACKEND_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}))
          throw new Error(
            `Backend returned ${response.status}: ${errBody.error ?? 'Unknown error'}`
          )
        }

        const rawData = await response.json()

        // Validate with the top-level ResponseSchema — handles Layout, bare widget,
        // and the new ControlAction type.
        const parsed = ResponseSchema.safeParse(rawData)
        if (!parsed.success) {
          throw new Error(`Invalid response schema from backend: ${parsed.error.message}`)
        }

        // --- Branch: control action vs layout/widget ---
        const controlParsed = ControlActionSchema.safeParse(parsed.data)
        if (controlParsed.success) {
          // The model chose to manage existing widgets — apply directly.
          setStatusState({ status: 'idle' })
          applyControlAction(controlParsed.data)
          // Control actions are not added to session history (they are not content).
          return
        }

        // Normalize to a Layout regardless of whether we got a bare widget or a layout.
        const layout = normalizeToLayout(parsed.data)
        if (!layout) {
          throw new Error('Could not normalize response to a layout')
        }

        // Append this manual interaction to session history (capped at SESSION_HISTORY_MAX).
        pushHistory(text, layout)

        setStatusState({ status: 'idle' })
        // Accumulate — do NOT clear existing widgets.
        accumulateLayout(layout, false)
      } catch (err) {
        setStatusState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
        // Auto-dismiss error after 5 seconds.
        setTimeout(() => setStatusState({ status: 'idle' }), 5000)
      }
    }

    window.addEventListener('klai:query', handleQuery)
    return () => window.removeEventListener('klai:query', handleQuery)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accumulateLayout])

  // Ref to the current instances so the suggestion handler can read it without stale closure.
  const instancesRef = useRef<WidgetInstance[]>([])
  instancesRef.current = instances

  // ---------------------------------------------------------------------------
  // Fill-the-gap scoreboard: klai:score-state handler.
  //
  // Each tick the service worker captures scoreState from Stage 1 (haiku).
  // This handler decides whether to show or hide the AUTO scoreboard:
  //
  //   scorebugVisible === true  → broadcast shows its own score → hide/remove AUTO
  //   scorebugVisible === false → broadcast hides score → show AUTO (if we have data
  //                               and the user has not dismissed scoreboards)
  //
  // A MANUAL scoreboard (proactive=false) is never touched by this handler.
  // dismissedAutoTypes('scoreboard') is respected — if the user closed the auto
  // scoreboard, we do not re-open it until they either "Clear all" or issue a
  // manual scoreboard query (which removes the type from dismissedAutoTypes).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handleScoreState(event: Event) {
      const state = (event as CustomEvent<ScoreState>).detail
      if (!state) return

      // Update lastKnownScore when the broadcast is showing a readable score.
      if (state.scorebugVisible && state.home && state.away) {
        lastKnownScore = {
          home: state.home,
          away: state.away,
          minute: state.minute,
        }
      }

      if (state.scorebugVisible) {
        // Broadcast shows its own score — remove AUTO scoreboard if present.
        if (autoScoreboardInstanceId !== null) {
          const idToRemove = autoScoreboardInstanceId
          autoScoreboardInstanceId = null
          // Remove from instances without marking as user-dismissed (proactive auto-remove).
          // We do NOT add to dismissedAutoTypes here so that the auto scoreboard can
          // reappear on the next cutaway.
          setInstances((prev) => prev.filter((i) => i.id !== idToRemove))
          setRevealedIds((prev) => {
            const next = new Set(prev)
            next.delete(idToRemove)
            return next
          })
          measureRefs.current.delete(idToRemove)
        }
        return
      }

      // scorebugVisible === false — ensure AUTO scoreboard is visible if:
      //   1. We have a last known score.
      //   2. The user has not dismissed 'scoreboard' via the X button.
      //   3. There is no manual scoreboard already on screen.
      if (!lastKnownScore) return
      if (dismissedAutoTypes.has('scoreboard')) return

      const score = lastKnownScore

      // Pre-compute the scoreboard widget and determine if we need a new instance.
      // Generate the new ID outside the updater to avoid strict-mode double-call issues.
      const scoreboardWidget = {
        type: 'scoreboard' as const,
        teams: [
          { name: score.home.name, score: score.home.score },
          { name: score.away.name, score: score.away.score },
        ] as [{ name: string; score: number }, { name: string; score: number }],
        ...(score.minute !== undefined ? { minute: score.minute } : {}),
      }

      // If no tracked auto instance exists yet, pre-allocate an ID so we can
      // assign autoScoreboardInstanceId before the updater runs.
      const pendingNewId = autoScoreboardInstanceId === null ? nextInstanceId() : null
      if (pendingNewId !== null) {
        autoScoreboardInstanceId = pendingNewId
      }
      const trackedId = autoScoreboardInstanceId!

      setInstances((prev) => {
        // Check for a manual scoreboard — never replace or hide it.
        const hasManualScoreboard = prev.some(
          (i) => i.widget.type === 'scoreboard' && !i.proactive,
        )
        if (hasManualScoreboard) return prev

        // Check whether the AUTO scoreboard instance already exists.
        const existingAutoIdx = prev.findIndex((i) => i.id === trackedId)

        if (existingAutoIdx !== -1) {
          // UPDATE existing AUTO scoreboard widget data in place (score may have changed).
          const next = [...prev]
          next[existingAutoIdx] = {
            ...next[existingAutoIdx],
            widget: scoreboardWidget,
          }
          return next
        }

        // ADD new AUTO scoreboard instance (pendingNewId path).
        // Enforce cap: evict oldest non-dragged instance if needed.
        const next = [...prev]
        if (next.length >= MAX_INSTANCES) {
          const evictIdx = next.reduce<number>((oldest, inst, idx) => {
            if (inst.manualPos !== null) return oldest
            if (oldest === -1) return idx
            return inst.insertionOrder < next[oldest].insertionOrder ? idx : oldest
          }, -1)
          if (evictIdx !== -1) {
            next.splice(evictIdx, 1)
          }
        }

        next.push({
          id: trackedId,
          widget: scoreboardWidget,
          slot: 'top-left',
          zIndex: 10,
          manualPos: null,
          dragOffset: null,
          proactive: true,
          insertionOrder: instanceCounter,
          placedSlot: null,
          placedOffsetY: 0,
        })

        // Enqueue for progressive reveal.
        revealQueueRef.current.push(trackedId)
        if (revealTimerRef.current === null) {
          const firstId = revealQueueRef.current.shift()
          if (firstId) {
            setRevealedIds((r) => new Set([...r, firstId]))
          }
          if (revealQueueRef.current.length > 0) {
            const interval = setInterval(() => {
              const nextRevealId = revealQueueRef.current.shift()
              if (nextRevealId) setRevealedIds((r) => new Set([...r, nextRevealId]))
              if (revealQueueRef.current.length === 0) {
                clearInterval(interval)
                revealTimerRef.current = null
              }
            }, REVEAL_INTERVAL_MS)
            revealTimerRef.current = interval
          }
        }

        return next
      })
    }

    window.addEventListener('klai:score-state', handleScoreState)
    return () => window.removeEventListener('klai:score-state', handleScoreState)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for proactive suggestions from the watch-mode polling loop.
  useEffect(() => {
    function handleSuggestion(event: Event) {
      const layout = (event as CustomEvent<unknown>).detail

      // Normalize and validate.
      const parsed = ResponseSchema.safeParse(layout)
      if (!parsed.success) return
      const normalized = normalizeToLayout(parsed.data)
      if (!normalized) return

      // Dedup: skip if the signature matches the last shown suggestion.
      const sig = layoutSignature(normalized)
      if (sig === lastSuggestionSignatureRef.current) return

      // Apply the new suggestion. Proactive widgets persist until the user
      // closes them (X button → adds type to dismissedAutoTypes) or "Clear all".
      lastSuggestionSignatureRef.current = sig

      accumulateLayout(normalized, true)
    }

    window.addEventListener('klai:suggestion', handleSuggestion)
    return () => window.removeEventListener('klai:suggestion', handleSuggestion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accumulateLayout])

  // Clean up timers on unmount.
  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) {
        clearInterval(revealTimerRef.current)
        revealTimerRef.current = null
      }
      // Clear all pending alert auto-dismiss timers to prevent post-unmount state updates.
      for (const timer of alertTimersRef.current.values()) {
        clearTimeout(timer)
      }
      alertTimersRef.current.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for voice pipeline state changes dispatched by the content script.
  useEffect(() => {
    function handleVoiceState(event: Event) {
      const { state: vs } = (event as CustomEvent<{ state: string }>).detail
      if (vs === 'listening' || vs === 'transcribing' || vs === 'idle') {
        setVoiceState(vs as VoiceIndicatorState)
      }
    }
    window.addEventListener('klai:voice-state', handleVoiceState)
    return () => window.removeEventListener('klai:voice-state', handleVoiceState)
  }, [])

  // Fallback video rect when no <video> is found: treat the full viewport as the rect.
  const effectiveRect = videoRect ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)

  // ---------------------------------------------------------------------------
  // Pre-render: deduplicate slots across all instances.
  // Dragged instances are fixed. Non-dragged instances are resolved against
  // each other and against fixed instances as obstacles.
  // ---------------------------------------------------------------------------
  const deduplicatedInstances = instances.length > 0
    ? deduplicateSlotsForInstances(instances, effectiveRect)
    : []

  // Build fingerprint: sorted list of "id::slot" keys.
  const nodeFingerprint = deduplicatedInstances
    .map((i) => `${i.id}::${i.slot}`)
    .sort()
    .join('|')

  // ---------------------------------------------------------------------------
  // Phase 2: Measure → resolve overlaps (post-layout)
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (deduplicatedInstances.length === 0) return
    if (nodeFingerprint === lastNodeFingerprintRef.current) return

    lastNodeFingerprintRef.current = nodeFingerprint

    // Collect measured rects from the hidden measurement layer refs.
    const measuredRects = new Map<string, DOMRect>()
    for (const inst of deduplicatedInstances) {
      const el = measureRefs.current.get(inst.id)
      if (el) {
        measuredRects.set(inst.id, el.getBoundingClientRect())
      }
    }

    const resolved = resolveOverlapsForInstances(deduplicatedInstances, measuredRects, effectiveRect)
    setPlacements(resolved)

    // Persist resolved placements onto newly-placed instances so they become
    // fixed obstacles in subsequent resolver runs. Existing instances whose
    // placedSlot is already set are not touched — their position is locked.
    setInstances((prev) => {
      let changed = false
      const next = prev.map((inst) => {
        // Skip dragged (manualPos handles them) and already-placed instances.
        if (inst.manualPos !== null || inst.placedSlot !== null) return inst
        const placement = resolved.get(inst.id)
        if (!placement) return inst
        changed = true
        return { ...inst, placedSlot: placement.slot, placedOffsetY: placement.offsetY }
      })
      return changed ? next : prev
    })
  })

  // Whether any proactive widget is currently in the instance list.
  const hasProactive = instances.some((i) => i.proactive)

  // "Clear all" control — only shown when 2+ widgets are present.
  const showClearAll = instances.length >= 2

  return (
    <div style={{ pointerEvents: 'none', width: '100%', height: '100%', position: 'relative' }}>
      {/* Loading indicator — anchored top-left of the video */}
      <AnimatePresence>
        {statusState.status === 'loading' && (
          <motion.div
            key="klai-loading"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              top: effectiveRect.top + SLOT_PADDING,
              left: effectiveRect.left + SLOT_PADDING,
              background: 'rgba(0,0,0,0.6)',
              color: '#facc15',
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 8,
              fontFamily: 'monospace',
              pointerEvents: 'none',
            }}
          >
            Building layout...
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message — anchored top-left of the video */}
      <AnimatePresence>
        {statusState.status === 'error' && (
          <motion.div
            key="klai-error"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              top: effectiveRect.top + SLOT_PADDING,
              left: effectiveRect.left + SLOT_PADDING,
              background: 'rgba(200,0,0,0.7)',
              color: '#fff',
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 8,
              fontFamily: 'monospace',
              maxWidth: 320,
              pointerEvents: 'none',
            }}
          >
            {statusState.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice capture indicator — anchored top-center of the video. */}
      <AnimatePresence>
        {voiceState !== 'idle' && (
          <motion.div
            key="klai-voice-indicator"
            initial={{ opacity: 0, y: -10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            style={{
              position: 'fixed',
              top: effectiveRect.top + SLOT_PADDING,
              left: effectiveRect.left + effectiveRect.width / 2,
              transform: 'translateX(-50%)',
              background: 'rgba(10,10,14,0.72)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 999,
              padding: '5px 14px 5px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              pointerEvents: 'none',
              zIndex: 2147483646,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              fontWeight: 500,
              color: '#fff',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Pulsing dot — red for listening, white for transcribing */}
            {voiceState === 'listening' ? (
              <motion.span
                animate={{ scale: [1, 1.45, 1], opacity: [1, 0.55, 1] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ef4444',
                  flexShrink: 0,
                }}
              />
            ) : (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.75)',
                  flexShrink: 0,
                }}
              />
            )}

            {/* Mic SVG — shown only during listening */}
            {voiceState === 'listening' && (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ flexShrink: 0, opacity: 0.9 }}
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}

            {voiceState === 'listening' ? 'Listening...' : 'Transcribing...'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Proactive "Auto" chip — shown when any proactive widget is active */}
      <AnimatePresence>
        {hasProactive && (
          <motion.div
            key="klai-auto-chip"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              bottom: window.innerHeight - effectiveRect.bottom + SLOT_PADDING + 4,
              right: window.innerWidth - effectiveRect.right + SLOT_PADDING,
              background: 'rgba(250, 204, 21, 0.15)',
              border: '1px solid rgba(250, 204, 21, 0.5)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              color: '#facc15',
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 999,
              fontFamily: 'monospace',
              letterSpacing: '0.03em',
              pointerEvents: 'none',
              zIndex: 2147483646,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" />
            </svg>
            Auto
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Clear all" button — shown when 2+ widgets are present */}
      <AnimatePresence>
        {showClearAll && (
          <motion.button
            key="klai-clear-all"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setInstances([])
              setRevealedIds(new Set())
              measureRefs.current.clear()
              lastNodeFingerprintRef.current = ''
              setPlacements(new Map())
              // Clear dismissed signatures and types so watch mode can resurface
              // everything from a clean slate after "Clear all".
              dismissedSignatures.clear()
              dismissedAutoTypes.clear()
              lastSuggestionSignatureRef.current = ''
              autoScoreboardInstanceId = null
              // Clear all alert timers and the cooldown map so alerts can resurface.
              for (const timer of alertTimersRef.current.values()) {
                clearTimeout(timer)
              }
              alertTimersRef.current.clear()
              recentlyAutoClosedAlerts.clear()
            }}
            style={{
              position: 'fixed',
              bottom: window.innerHeight - effectiveRect.bottom + SLOT_PADDING + 4,
              right: window.innerWidth - effectiveRect.right + SLOT_PADDING + (hasProactive ? 60 : 0),
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.18)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 11,
              fontWeight: 500,
              padding: '3px 9px',
              borderRadius: 999,
              fontFamily: 'monospace',
              letterSpacing: '0.02em',
              pointerEvents: 'auto',
              cursor: 'pointer',
              zIndex: 2147483646,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            aria-label="Clear all widgets"
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
            Clear all
          </motion.button>
        )}
      </AnimatePresence>

      {/*
        Hidden measurement layer — ALL instances rendered at opacity:0,
        pointerEvents:none so the useLayoutEffect measure pass can collect
        real DOM rects for every widget immediately.

        All instances use slotStyle for positioning in the measurement layer.
        For dragged widgets, resolveOverlapsForInstances shifts the measured
        rect by dragOffset to compute the true on-screen obstacle rect.
        This means measurement position = slot anchor for every widget, which
        is consistent and avoids stale absolute positions.
      */}
      {deduplicatedInstances.map((inst) => {
        const WidgetComponent = getWidget(inst.widget.type)
        if (!WidgetComponent) return null

        const placement = placements.get(inst.id)
        const resolvedSlot = (placement?.slot ?? inst.slot) as Slot
        const offsetY = placement?.offsetY ?? 0

        // Always use slotStyle — the drag offset is applied separately in the
        // overlap resolver (measuredRect + dragOffset = true obstacle rect).
        const style: React.CSSProperties = slotStyle(resolvedSlot, effectiveRect, offsetY)

        return (
          <div
            key={`measure::${inst.id}`}
            ref={(el) => {
              if (el) measureRefs.current.set(inst.id, el)
              else measureRefs.current.delete(inst.id)
            }}
            aria-hidden="true"
            style={{ ...style, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
          >
            <WidgetComponent data={inst.widget} />
          </div>
        )
      })}

      {/*
        Main widget renderer — AnimatePresence with popLayout for smooth exits.
        Each instance uses its stable ID as the React key so existing widgets
        are NOT re-mounted when new ones arrive (stable keys = stable motion trees).

        Progressive reveal:
          Only instances whose ID is in revealedIds are rendered.
          New instances are added to revealedIds one at a time via the reveal timer.
          Existing instances remain in revealedIds — they do NOT re-animate.

        Drag model (motion-value base+offset, free drag):
          The container div's top/left is ALWAYS the slot anchor — it never
          changes on drag or after drag. The drag offset lives entirely inside
          DraggableWidget as useMotionValue(x/y), initialized from inst.dragOffset
          so the widget stays put across re-renders (e.g. when new widgets arrive).
          onDragEnd persists the cumulative x/y motion-value offset, not an
          absolute viewport position, so there is no jump when React re-renders.
          No dragConstraints are used — constraints in absolute viewport
          coordinates are in the wrong space for this model and clamp movement
          to only one direction. Free drag allows left, right, up, and down.

        Pointer-events:
          The overlay root is pointerEvents:none (click-through for video).
          Each DraggableWidget sets pointerEvents:auto on its motion.div so
          drag and click events are captured only where a widget exists.
      */}
      <AnimatePresence mode="popLayout">
        {deduplicatedInstances
          .filter((inst) => revealedIds.has(inst.id))
          .map((inst) => {
            const placement = placements.get(inst.id)
            const resolvedSlot = (placement?.slot ?? inst.slot) as Slot
            const offsetY = placement?.offsetY ?? 0

            // The container ALWAYS uses the slot anchor as its top/left base.
            // Drag displacement is applied inside DraggableWidget via motion
            // values (x/y), not by changing this container's CSS position.
            // This is the key fix: the base never changes, so there is no jump.
            const containerStyle: React.CSSProperties = {
              ...slotStyle(resolvedSlot, effectiveRect, offsetY),
              zIndex: inst.zIndex ?? 10,
              pointerEvents: 'none',
            }

            return (
              <div key={inst.id} style={containerStyle}>
                <DraggableWidget
                  instanceId={inst.id}
                  widget={inst.widget}
                  delay={0}
                  initialOffset={inst.dragOffset}
                  onClose={closeInstance}
                  onDragEnd={handleDragEnd}
                />
              </div>
            )
          })}
      </AnimatePresence>
    </div>
  )
}
