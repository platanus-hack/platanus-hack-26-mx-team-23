import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ResponseSchema,
  LayoutSchema,
  WidgetNodeSchema,
  type Layout,
  type LayoutNode,
  type Slot,
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
    pointerEvents: 'none',
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
// Stable node key
// ---------------------------------------------------------------------------
// Derived from the widget's TYPE and its ORIGINAL (model-assigned) slot — NOT
// the resolved slot after collision resolution. This keeps the AnimatePresence
// key stable across relocations: a relocated widget does NOT remount; only its
// CSS position changes. If the model assigns a different widget type to the
// same slot on a new query, the old widget exits and the new one enters.
// ---------------------------------------------------------------------------
function nodeKey(node: LayoutNode): string {
  return `${node.slot}::${node.widget.type}`
}

// ---------------------------------------------------------------------------
// Phase 1: Slot deduplication (pre-render, pure JS, no DOM)
// ---------------------------------------------------------------------------
// If two nodes are assigned the same slot by the model, the higher-priority
// widget stays; the lower-priority one is relocated to the nearest free slot
// (in ALL_SLOTS order, skipping occupied slots and center-intersecting slots).
//
// "Nearest" = first available slot in the ALL_SLOTS priority order that is not
// already occupied by any node in the deduplicated set.
// ---------------------------------------------------------------------------
function deduplicateSlots(nodes: LayoutNode[], videoRect: DOMRect): LayoutNode[] {
  const noGo = centerNoGoZone(videoRect)
  const slotMap = new Map<string, LayoutNode>()

  // Sort by priority descending so higher-priority nodes claim their slot first.
  const sorted = [...nodes].sort(
    (a, b) => widgetPriority(b.widget.type) - widgetPriority(a.widget.type),
  )

  const relocated: LayoutNode[] = []

  for (const node of sorted) {
    if (!slotMap.has(node.slot)) {
      slotMap.set(node.slot, node)
    } else {
      // Slot occupied — find the nearest free, non-center-colliding slot.
      const freeSlot = ALL_SLOTS.find((s) => {
        if (slotMap.has(s)) return false
        // Rough estimate: treat widget as ~300x60 for relocation candidate check.
        const estRect = estimateSlotRect(s, videoRect, 300, 60)
        return !rectsIntersect(estRect, noGo)
      })

      if (freeSlot) {
        const movedNode: LayoutNode = { ...node, slot: freeSlot }
        slotMap.set(freeSlot, movedNode)
        relocated.push(movedNode)
      } else {
        // No free slot at all — keep the node in its original slot (will be
        // handled by the overlap-resolution pass with a vertical offset instead).
        slotMap.set(node.slot, node)
      }
    }
  }

  return [...slotMap.values()]
}

// ---------------------------------------------------------------------------
// Resolved placement state
// ---------------------------------------------------------------------------
// After the measure pass, each node's final slot and vertical offset are stored
// here. Keys match nodeKey(node) with the ORIGINAL slot.
// ---------------------------------------------------------------------------
interface ResolvedPlacement {
  slot: Slot
  offsetY: number
}

type PlacementMap = Map<string, ResolvedPlacement>

// ---------------------------------------------------------------------------
// Overlap resolution (post-measure pass)
// ---------------------------------------------------------------------------
// Given measured rects (keyed by nodeKey) and the deduplicated node list,
// detect pairwise intersections and relocate the lower-priority widget.
//
// Relocation strategy:
//   1. Try all remaining free slots (not occupied by any node in the placed set).
//   2. Among those, pick the first that doesn't intersect the center no-go zone
//      and doesn't intersect any already-placed widget rect.
//   3. If no clean slot exists, apply a vertical stack offset: push the lower-
//      priority widget down (for top-* slots) or up (for bottom-* slots) by the
//      overlapping widget's height + STACK_GAP.
//
// Returns a PlacementMap: originalKey → { resolvedSlot, offsetY }.
// ---------------------------------------------------------------------------
function resolveOverlaps(
  nodes: LayoutNode[],
  measuredRects: Map<string, DOMRect>,
  videoRect: DOMRect,
): PlacementMap {
  const noGo = centerNoGoZone(videoRect)

  // Work with a mutable array of placements sorted by priority descending.
  // Higher priority widgets are placed first; they own their position.
  const prioritized = [...nodes].sort(
    (a, b) => widgetPriority(b.widget.type) - widgetPriority(a.widget.type),
  )

  const placed: Array<{ key: string; slot: Slot; rect: DOMRect; offsetY: number }> = []
  const result: PlacementMap = new Map()

  for (const node of prioritized) {
    const key = nodeKey(node)
    const measuredRect = measuredRects.get(key)

    if (!measuredRect) {
      // Widget not yet measured — keep original slot, no offset.
      result.set(key, { slot: node.slot as Slot, offsetY: 0 })
      continue
    }

    const w = measuredRect.width
    const h = measuredRect.height

    // Try the node's current slot first.
    let chosenSlot: Slot = node.slot as Slot
    let chosenOffsetY = 0
    let chosenRect = measuredRect

    // Check if the current slot intersects the center no-go zone.
    const slotInCenter = rectsIntersect(measuredRect, noGo)

    // Check if this rect collides with any already-placed widget.
    const collidingWith = placed.find((p) => rectsIntersect(measuredRect, p.rect))

    if (slotInCenter || collidingWith) {
      // Attempt to find a clean alternative slot.
      const occupiedSlots = new Set(placed.map((p) => p.slot))
      const candidateSlot = ALL_SLOTS.find((s) => {
        if (occupiedSlots.has(s)) return false
        const estRect = estimateSlotRect(s, videoRect, w, h)
        if (rectsIntersect(estRect, noGo)) return false
        // Make sure it doesn't collide with any already-placed widget.
        return !placed.some((p) => rectsIntersect(estRect, p.rect))
      })

      if (candidateSlot) {
        chosenSlot = candidateSlot
        chosenOffsetY = 0
        chosenRect = estimateSlotRect(candidateSlot, videoRect, w, h)
      } else if (collidingWith) {
        // Last resort: stack vertically within the same horizontal region.
        // For top-* slots, push down; for bottom-* slots, push up.
        const isBottom = node.slot.startsWith('bottom')
        const stackOffset = isBottom
          ? collidingWith.rect.height + STACK_GAP
          : collidingWith.rect.height + STACK_GAP

        chosenSlot = node.slot as Slot
        chosenOffsetY = stackOffset
        // Approximate new rect after offset.
        const dy = isBottom ? -stackOffset : stackOffset
        chosenRect = new DOMRect(measuredRect.x, measuredRect.y + dy, w, h)
      }
      // If slotInCenter but no collision and no free slot: keep original
      // (can't fix center overlap without a free slot — let backend hint handle it).
    }

    placed.push({ key, slot: chosenSlot, rect: chosenRect, offsetY: chosenOffsetY })
    result.set(key, { slot: chosenSlot, offsetY: chosenOffsetY })
  }

  return result
}

// ---------------------------------------------------------------------------
// Auto-dismiss timeout for proactive suggestions (ms).
// ---------------------------------------------------------------------------
const SUGGESTION_AUTO_DISMISS_MS = 12000

// Derive a lightweight signature from a layout for dedup purposes.
// Uses widget types + key identifying fields so identical detections are ignored.
function layoutSignature(layout: Layout): string {
  return layout.nodes
    .map((n) => {
      const w = n.widget
      if (w.type === 'scoreboard') return `scoreboard:${w.teams.map((t) => `${t.name}:${t.score}`).join(',')}`
      if (w.type === 'alert') return `alert:${w.message}`
      if (w.type === 'timer') return `timer:${w.durationSeconds}`
      if (w.type === 'statpanel') return `statpanel:${w.title ?? ''}:${w.stats.map((s) => s.label).join(',')}`
      if (w.type === 'momentum') return `momentum:${w.teams.map((t) => `${t.name}:${t.probability}`).join(',')}`
      if (w.type === 'infocard') return `infocard:${w.title}`
      if (w.type === 'keypoints') return `keypoints:${(w.title ?? '')}:${w.points.join(',')}`
      if (w.type === 'definition') return `definition:${w.term}`
      return (w as { type: string }).type
    })
    .sort()
    .join('|')
}

type OverlayState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'layout'; data: Layout; proactive?: boolean }
  | { status: 'error'; message: string }

// Returns the reveal-order rank for a widget type.
// Lower rank = reveals earlier. Types absent from REVEAL_ORDER get rank = Infinity.
function revealRank(type: string): number {
  const idx = REVEAL_ORDER.indexOf(type)
  return idx === -1 ? Infinity : idx
}

// Sorts layout nodes into the deliberate reveal order.
// Primary: REVEAL_ORDER index (ascending). Secondary: zIndex (ascending).
function sortByRevealOrder(nodes: LayoutNode[]): LayoutNode[] {
  return [...nodes].sort((a, b) => {
    const rankDiff = revealRank(a.widget.type) - revealRank(b.widget.type)
    if (rankDiff !== 0) return rankDiff
    return (a.zIndex ?? 10) - (b.zIndex ?? 10)
  })
}

export function Overlay() {
  const [videoRect, setVideoRect] = useState<DOMRect | null>(null)
  const [state, setState] = useState<OverlayState>({ status: 'idle' })

  // PlacementMap computed by the measure pass.
  const [placements, setPlacements] = useState<PlacementMap>(new Map())

  // Number of nodes currently revealed during progressive assembly.
  // Starts at 0 when a new layout arrives; increments by 1 every REVEAL_INTERVAL_MS
  // until it reaches the total node count.
  const [revealedCount, setRevealedCount] = useState(0)

  // Ref that holds the active reveal interval so we can cancel it on unmount or
  // when a new query replaces the current layout.
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Refs for the hidden measurement layer — keyed by nodeKey (original slot::type).
  // The useLayoutEffect measure pass reads ONLY from this map.
  // Kept separate from any visible-layer refs so visible-layer unmount callbacks
  // cannot delete a measurement ref and corrupt the measure pass.
  const measureRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Refs for measuring each widget container after render.
  // keyed by nodeKey (original slot::type).
  const widgetRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Fingerprint of the current node set — used to detect when nodes change so
  // we only re-run the resolve pass when necessary (not on every render).
  const lastNodeFingerprintRef = useRef<string>('')

  // Signature of the last proactive suggestion shown — used to skip duplicate detections.
  const lastSuggestionSignatureRef = useRef<string>('')

  // Timer ref for auto-dismissing proactive suggestions.
  const suggestionDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Helper: clear the proactive auto-dismiss timer.
  function clearSuggestionTimer() {
    if (suggestionDismissTimerRef.current !== null) {
      clearTimeout(suggestionDismissTimerRef.current)
      suggestionDismissTimerRef.current = null
    }
  }

  // Helper: reset layout-related state before applying a new layout.
  function resetLayoutState() {
    if (revealTimerRef.current !== null) {
      clearInterval(revealTimerRef.current)
      revealTimerRef.current = null
    }
    clearSuggestionTimer()
    setRevealedCount(0)
    setPlacements(new Map())
    lastNodeFingerprintRef.current = ''
    measureRefs.current.clear()
    widgetRefs.current.clear()
  }

  // Listen for intent queries dispatched by the content script (manual queries).
  useEffect(() => {
    async function handleQuery(event: Event) {
      const { text, image } = (event as CustomEvent<{ text: string; image?: string }>).detail
      if (!text) return

      // Manual query takes precedence — clear any active proactive suggestion.
      lastSuggestionSignatureRef.current = ''
      resetLayoutState()

      setState({ status: 'loading' })

      try {
        // Include the current session history so the backend can resolve
        // conversational references (e.g. "and his stats?", "the other team?").
        const body: { text: string; image?: string; history?: HistoryEntry[] } = { text }
        if (image) body.image = image
        if (sessionHistory.length > 0) body.history = [...sessionHistory]

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

        // Validate with the top-level ResponseSchema — handles both Layout and bare widget.
        const parsed = ResponseSchema.safeParse(rawData)
        if (!parsed.success) {
          throw new Error(`Invalid response schema from backend: ${parsed.error.message}`)
        }

        // Normalize to a Layout regardless of whether we got a bare widget or a layout.
        const layout = normalizeToLayout(parsed.data)
        if (!layout) {
          throw new Error('Could not normalize response to a layout')
        }

        // Append this manual interaction to session history (capped at SESSION_HISTORY_MAX).
        // Proactive suggestions are intentionally excluded — they're not part of the user's
        // own conversational thread.
        pushHistory(text, layout)

        setRevealedCount(0)
        // Manual query — not proactive.
        setState({ status: 'layout', data: layout, proactive: false })
      } catch (err) {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
        // Auto-dismiss error after 5 seconds.
        setTimeout(() => setState({ status: 'idle' }), 5000)
      }
    }

    window.addEventListener('overlai:query', handleQuery)
    return () => window.removeEventListener('overlai:query', handleQuery)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ref to the current state so the suggestion handler can read it without stale closure.
  const stateRef = useRef<OverlayState>({ status: 'idle' })
  stateRef.current = state

  // Listen for proactive suggestions from the watch-mode polling loop.
  useEffect(() => {
    function handleSuggestion(event: Event) {
      const layout = (event as CustomEvent<unknown>).detail

      // Normalize and validate.
      const parsed = ResponseSchema.safeParse(layout)
      if (!parsed.success) return
      const normalized = normalizeToLayout(parsed.data)
      if (!normalized) return

      // Dedup: skip if the signature matches the currently shown suggestion.
      const sig = layoutSignature(normalized)
      if (sig === lastSuggestionSignatureRef.current) return

      // If a manual query layout is currently shown, do not override it.
      // Only override idle or a previous proactive suggestion.
      const current = stateRef.current
      if (current.status === 'layout' && !current.proactive) return

      // Apply the new suggestion — side effects outside setState.
      lastSuggestionSignatureRef.current = sig
      resetLayoutState()

      // Auto-dismiss after SUGGESTION_AUTO_DISMISS_MS.
      suggestionDismissTimerRef.current = setTimeout(() => {
        lastSuggestionSignatureRef.current = ''
        setState((s) => (s.status === 'layout' && s.proactive ? { status: 'idle' } : s))
      }, SUGGESTION_AUTO_DISMISS_MS)

      setState({ status: 'layout', data: normalized, proactive: true })
    }

    window.addEventListener('overlai:suggestion', handleSuggestion)
    return () => window.removeEventListener('overlai:suggestion', handleSuggestion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clean up auto-dismiss timer on unmount.
  useEffect(() => {
    return () => clearSuggestionTimer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fallback video rect when no <video> is found: treat the full viewport as the rect.
  const effectiveRect = videoRect ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)

  // ---------------------------------------------------------------------------
  // Phase 1: Slot deduplication (pre-render)
  // ---------------------------------------------------------------------------
  // Runs synchronously during render, before the DOM is updated. Resolves
  // same-slot conflicts using priority and slot availability.
  // Nodes are sorted by zIndex before deduplication so the slot-claiming order
  // is deterministic; then re-sorted into reveal order for progressive assembly.
  const deduplicatedNodes: LayoutNode[] =
    state.status === 'layout'
      ? deduplicateSlots(
          [...state.data.nodes].sort((a, b) => (a.zIndex ?? 10) - (b.zIndex ?? 10)),
          effectiveRect,
        )
      : []

  // Sorted into deliberate reveal order: scoreboard → statpanel/timer → alert.
  // This is the order nodes are passed to AnimatePresence for progressive reveal.
  const revealOrderedNodes: LayoutNode[] = sortByRevealOrder(deduplicatedNodes)

  // Build node fingerprint: sorted list of "originalSlot::type" keys.
  // Based on the full node set (not just revealed nodes) so the measure pass
  // runs against all nodes immediately when the layout arrives.
  const nodeFingerprint = deduplicatedNodes.map(nodeKey).sort().join('|')

  // ---------------------------------------------------------------------------
  // Progressive reveal: start a timer when a new layout arrives that increments
  // revealedCount by 1 every REVEAL_INTERVAL_MS until all nodes are visible.
  // The timer is cancelled on layout change (new query) and on unmount.
  //
  // Strategy for collision-resolver safety:
  //   All nodes are rendered in a hidden measurement layer (opacity:0,
  //   pointerEvents:none) from the moment the layout arrives. The
  //   useLayoutEffect measure pass therefore has access to ALL widget rects
  //   immediately — it computes final placements for the complete layout before
  //   the reveal sequence begins. As each node enters AnimatePresence it already
  //   knows its resolved slot and lands there directly, with no reshuffling.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (state.status !== 'layout') return

    const total = revealOrderedNodes.length

    // Reveal the first node immediately (count goes 0 → 1).
    setRevealedCount(1)

    if (total <= 1) return

    // Reveal subsequent nodes one by one.
    let count = 1
    const interval = setInterval(() => {
      count += 1
      setRevealedCount(count)
      if (count >= total) {
        clearInterval(interval)
        revealTimerRef.current = null
      }
    }, REVEAL_INTERVAL_MS)

    revealTimerRef.current = interval

    return () => {
      clearInterval(interval)
      revealTimerRef.current = null
    }
  // Re-run when the layout data itself changes (new query result).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Clean up reveal timer on unmount.
  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) {
        clearInterval(revealTimerRef.current)
        revealTimerRef.current = null
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Phase 2: Measure → resolve overlaps (post-layout)
  // ---------------------------------------------------------------------------
  // useLayoutEffect fires after DOM mutations but before paint. We measure all
  // widget containers from the hidden measurement layer (all nodes rendered),
  // detect pairwise intersections, and update the PlacementMap.
  // Guard: only re-run when the node fingerprint changes (not on every render).
  //
  // Because ALL nodes are pre-rendered in the hidden layer regardless of
  // revealedCount, this pass computes final placements for the COMPLETE layout
  // on the first render after a new layout arrives. Progressive reveal then
  // reveals each widget into its already-resolved slot — no reshuffling.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (deduplicatedNodes.length === 0) return
    if (nodeFingerprint === lastNodeFingerprintRef.current) return

    lastNodeFingerprintRef.current = nodeFingerprint

    // Collect measured rects from the hidden measurement layer refs.
    // measureRefs holds the hidden-layer divs (opacity:0, zIndex:-1) which are
    // rendered for ALL nodes regardless of revealedCount, making them the correct
    // and complete source for the collision resolver's measure pass.
    const measuredRects = new Map<string, DOMRect>()
    for (const node of deduplicatedNodes) {
      const key = nodeKey(node)
      const el = measureRefs.current.get(key)
      if (el) {
        measuredRects.set(key, el.getBoundingClientRect())
      }
    }

    // Run overlap resolution with measured dimensions.
    const resolved = resolveOverlaps(deduplicatedNodes, measuredRects, effectiveRect)
    setPlacements(resolved)
  })
  // Intentionally no deps array: useLayoutEffect runs after every render, but
  // the fingerprint guard inside ensures the resolution logic runs only when
  // nodes actually change. This is safe because the guard is pure + synchronous.

  return (
    <div style={{ pointerEvents: 'none', width: '100%', height: '100%', position: 'relative' }}>
      {/* Loading indicator — anchored top-left of the video */}
      <AnimatePresence>
        {state.status === 'loading' && (
          <motion.div
            key="overlai-loading"
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
        {state.status === 'error' && (
          <motion.div
            key="overlai-error"
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
            {state.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Hidden measurement layer — ALL nodes from the current layout rendered at
        opacity:0, pointerEvents:none, visually identical positions to their
        final resolved slots. This ensures the useLayoutEffect measure pass
        can collect real DOM rects for every widget immediately when the layout
        arrives, BEFORE the progressive reveal sequence begins. The collision
        resolver therefore computes final placements for the complete layout
        upfront; each widget that AnimatePresence reveals subsequently lands
        directly in its already-resolved slot without any reshuffling.

        These divs are aria-hidden and never interactive.
      */}
      {deduplicatedNodes.map((node) => {
        const WidgetComponent = getWidget(node.widget.type)
        if (!WidgetComponent) return null

        const key = nodeKey(node)
        const placement = placements.get(key)
        const resolvedSlot = (placement?.slot ?? node.slot) as Slot
        const offsetY = placement?.offsetY ?? 0
        const style = slotStyle(resolvedSlot, effectiveRect, offsetY)

        return (
          <div
            key={`measure::${key}`}
            ref={(el) => {
              // Write into the dedicated measurement ref map only.
              // The visible layer uses widgetRefs and must never touch this map.
              if (el) measureRefs.current.set(key, el)
              else measureRefs.current.delete(key)
            }}
            aria-hidden="true"
            style={{ ...style, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
          >
            <WidgetComponent data={node.widget} />
          </div>
        )
      })}

      {/*
        Slot-based layout renderer — single AnimatePresence wrapping revealed nodes.

        Mode: popLayout
          When a widget exits (query replacement or dismissal), popLayout pops it
          out of normal flow immediately so the remaining widgets can reflow into
          their positions without waiting for the exit animation to complete. This
          avoids the "ghost gap" problem you get with mode="sync" on multi-widget
          layouts. mode="wait" would block ALL entrances until ALL exits finish,
          creating a noticeable flash of empty screen between layouts.

        Keys: derived from ORIGINAL slot + widget.type via nodeKey().
          Stable across re-renders AND across collision relocation — a scoreboard
          originally assigned top-center keeps key "top-center::scoreboard" even
          if it gets relocated to top-left by the resolver. This ensures relocation
          is a CSS-only update: the component stays mounted, position changes
          smoothly without re-mounting the Framer Motion tree.

        Progressive reveal:
          revealOrderedNodes is sorted scoreboard → statpanel/timer → alert.
          Only the first revealedCount nodes are passed to AnimatePresence children;
          each mounts with delay=0 since the REVEAL_INTERVAL_MS timer is the stagger.
          No double-stagger: the timer replaces the old index*STAGGER_DELAY approach.

        Collision resolver:
          Phase 1 (deduplicateSlots): same-slot conflicts resolved by priority
          (alert > scoreboard > timer > statpanel). Lower-priority widget is
          relocated to the nearest free slot before first render.

          Phase 2 (useLayoutEffect measure pass): runs against the hidden
          measurement layer (all nodes). Computes the complete PlacementMap
          before reveal begins; revealed widgets land in their final slots directly.

        Center no-go zone:
          The central 40% of the video rect (both width and height) is excluded
          from all slot candidates during relocation. Widgets that land in the
          center zone due to the model's original assignment are relocated first.
      */}
      {/* Proactive "Auto" chip — shown when a suggestion is active */}
      <AnimatePresence>
        {state.status === 'layout' && state.proactive && (
          <motion.div
            key="overlai-auto-chip"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              // Place at bottom-right of the video, just above the bottom edge.
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

      <AnimatePresence mode="popLayout">
        {revealOrderedNodes.slice(0, revealedCount).map((node) => {
          const WidgetComponent = getWidget(node.widget.type)

          // Skip nodes whose widget type is not in the registry (graceful per-node fallback).
          if (!WidgetComponent) {
            console.warn('[overlai] Unknown widget type in layout node:', node.widget.type)
            return null
          }

          const key = nodeKey(node)

          // Look up resolved placement from the measure pass.
          // Falls back to the node's (deduplicated) slot with no offset on first render.
          const placement = placements.get(key)
          const resolvedSlot = (placement?.slot ?? node.slot) as Slot
          const offsetY = placement?.offsetY ?? 0

          const style = slotStyle(resolvedSlot, effectiveRect, offsetY)

          return (
            <div
              key={key}
              style={{ ...style, zIndex: node.zIndex ?? 10 }}
            >
              {/* delay=0: the REVEAL_INTERVAL_MS timer is the stagger; no double-delay. */}
              <WidgetComponent data={node.widget} delay={0} />
            </div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
