// ESPN public API client — FIFA World Cup ONLY (no key required).
// Primary data source for the /api/generate agent loop (tool: get_sports_data),
// so Claude gets authoritative live match data before falling back to Firecrawl.
//
// Scope is intentionally locked to the World Cup: a single hardcoded league slug,
// no league-mapping table. This is the demo competition.
//
// Data is exposed as selectable SECTIONS via the `want` param so each call returns
// only what was asked (keeps the model context small). All section field paths are
// verified live against the World Cup summary payload.
//
// Endpoints (verified live):
//   GET site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
//   GET .../summary?event={id}
//   GET now.core.api.espn.com/v1/sports/news?sport=soccer  (news fallback)
// Docs: undocumented public API, may change without notice. No auth.

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const LEAGUE_SLUG = 'soccer/fifa.world' // LOCKED to the World Cup
const NOW_NEWS_URL = 'https://now.core.api.espn.com/v1/sports/news?sport=soccer&limit=5'

// Tighter than Firecrawl's 8s — this is latency-sensitive (voice → render).
const DEFAULT_TIMEOUT_MS = 6000
// Soft rate-limit guard; ESPN publishes no official limit but may block abuse.
const CACHE_TTL_MS = 20_000
const MAX_KEY_EVENTS = 5
const MAX_STATS = 8
// Bounded; individual section requests stay 400–1500 chars, even `all` < this.
const MAX_TOTAL_CHARS = 5000

// Stats we surface, in display order. Matched against normalized ESPN labels.
const WANTED_STATS = [
  'possession',
  'shots',
  'shotsontarget',
  'cornerkicks',
  'fouls',
  'yellowcards',
  'redcards',
  'saves',
  'offsides',
]

// --- Sections ---------------------------------------------------------------

export type SportsSection =
  | 'score'
  | 'stats'
  | 'events'
  | 'info'
  | 'leaders'
  | 'lineups'
  | 'record'
  | 'standings'
  | 'form'
  | 'odds'
  | 'news'

const ALL_SECTIONS: SportsSection[] = [
  'score', 'stats', 'events', 'info', 'leaders',
  'lineups', 'record', 'standings', 'form', 'odds', 'news',
]
// `all` = curated compact overview (NOT every section). info runs compact here.
const ALL_SET: SportsSection[] = ['score', 'stats', 'events', 'info']

export interface SportsQuery {
  teams?: string[] // names Claude read off the scorebug (0, 1, or 2)
  want?: Array<SportsSection | 'all'> | SportsSection | 'all'
}

// --- Narrow, defensive shapes (only the keys we read; all optional) ---
interface Team {
  displayName?: string
  shortDisplayName?: string
  abbreviation?: string
}
interface RecordItem {
  type?: string
  summary?: string
  displayValue?: string
}
interface Competitor {
  homeAway?: string
  score?: string | number
  team?: Team
  record?: RecordItem[]
  possession?: boolean
}
interface Status {
  type?: { description?: string; detail?: string; shortDetail?: string }
  displayClock?: string
}
interface Competition {
  competitors?: Competitor[]
  status?: Status
}
interface Event {
  id?: string
  name?: string
  date?: string
  status?: Status
  competitions?: Competition[]
}
interface Scoreboard {
  events?: Event[]
}
interface StatItem {
  name?: string
  label?: string
  displayValue?: string
}
interface BoxscoreTeam {
  team?: Team
  statistics?: StatItem[]
}
interface KeyEvent {
  type?: { text?: string }
  text?: string
  clock?: { displayValue?: string }
  scoringPlay?: boolean
}
interface Official {
  displayName?: string
  fullName?: string
  position?: { name?: string }
}
interface Venue {
  fullName?: string
  address?: { city?: string }
  capacity?: number
}
interface GameInfo {
  venue?: Venue
  officials?: Official[]
  attendance?: number
}
interface Athlete {
  displayName?: string
}
interface LeaderItem {
  displayValue?: string
  athlete?: Athlete
}
interface LeaderCategory {
  displayName?: string
  name?: string
  leaders?: LeaderItem[]
}
interface LeaderGroup {
  team?: Team
  leaders?: LeaderCategory[]
}
interface RosterPlayer {
  starter?: boolean
  jersey?: string
  athlete?: Athlete
  position?: { abbreviation?: string }
  subbedIn?: boolean
  subbedOut?: boolean
}
interface RosterTeam {
  team?: Team
  homeAway?: string
  formation?: string
  roster?: RosterPlayer[]
}
interface StandingStat {
  name?: string
  displayValue?: string
}
interface StandingEntry {
  team?: string
  stats?: StandingStat[]
}
interface StandingGroup {
  standings?: { entries?: StandingEntry[] }
}
interface Standings {
  header?: string
  groups?: StandingGroup[]
}
interface FormEvent {
  gameDate?: string
  score?: string
  atVs?: string
  gameResult?: string
  opponent?: string | { displayName?: string; abbreviation?: string }
}
interface FormTeam {
  team?: Team
  events?: FormEvent[]
}
interface OddsTeam {
  moneyLine?: number
  favorite?: boolean
  team?: Team
}
interface Odds {
  provider?: { name?: string }
  details?: string
  overUnder?: number
  homeTeamOdds?: OddsTeam
  awayTeamOdds?: OddsTeam
  drawOdds?: { moneyLine?: number }
}
interface NewsArticle {
  headline?: string
}
interface Summary {
  header?: { competitions?: Competition[] }
  boxscore?: { teams?: BoxscoreTeam[] }
  keyEvents?: KeyEvent[]
  gameInfo?: GameInfo
  leaders?: LeaderGroup[]
  rosters?: RosterTeam[]
  standings?: Standings
  lastFiveGames?: FormTeam[]
  headToHeadGames?: FormTeam[]
  odds?: Odds[]
  news?: { articles?: NewsArticle[] }
  broadcasts?: { media?: { name?: string; callLetters?: string } }[]
}
interface NewsFeed {
  headlines?: { headline?: string }[]
}

// --- HTTP + cache helpers (mirror lib/firecrawl.ts) ---

async function getJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`ESPN ${url} returned ${res.status}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Content-keyed cache shared across requests within a warm instance.
const cache = new Map<string, { at: number; data: unknown }>()

async function cachedGetJson(key: string, url: string): Promise<unknown> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data
  const data = await getJson(url)
  cache.set(key, { at: Date.now(), data })
  return data
}

function clamp(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ESPN's default scoreboard returns only the server's "today" (UTC) — but live
// matches are often bucketed under an adjacent UTC date (timezone offset), so a
// live game can be invisible to a today-only query. Query a yesterday→tomorrow
// window so we never miss the live match. Returns "YYYYMMDD-YYYYMMDD".
function dateWindow(): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  const now = new Date()
  const start = new Date(now)
  start.setUTCDate(now.getUTCDate() - 1)
  const end = new Date(now)
  end.setUTCDate(now.getUTCDate() + 1)
  return `${fmt(start)}-${fmt(end)}`
}

// Lowercase, strip diacritics + non-alphanumerics. "México"→"mexico", "Côte d'Ivoire"→"cotedivoire".
function norm(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function statusDesc(e: Event): string {
  return (
    e.status?.type?.description ??
    e.competitions?.[0]?.status?.type?.description ??
    ''
  )
}

function isLive(e: Event): boolean {
  const d = norm(statusDesc(e))
  return d.includes('inprogress') || d.includes('halftime') || d.includes('firsthalf') || d.includes('secondhalf')
}

function isFullTime(e: Event): boolean {
  return norm(statusDesc(e)).includes('fulltime')
}

// --- Team-name matching ---

function competitorStrings(c: Competitor): string[] {
  const t = c.team ?? {}
  return [t.displayName, t.shortDisplayName, t.abbreviation].filter(Boolean).map((s) => norm(s as string))
}

// Score how well an event matches the provided (normalized) team names.
function scoreEvent(e: Event, wanted: string[]): number {
  if (!wanted.length) return 0
  const comps = e.competitions?.[0]?.competitors ?? []
  let total = 0
  for (const w of wanted) {
    if (!w) continue
    let best = 0
    for (const c of comps) {
      for (const cand of competitorStrings(c)) {
        if (!cand) continue
        if (cand === w) best = Math.max(best, 3)
        else if (w.length >= 3 && (cand.includes(w) || w.includes(cand))) best = Math.max(best, 2)
        else if (w.length <= 4 && cand.startsWith(w)) best = Math.max(best, 2)
      }
    }
    total += best
  }
  return total
}

function resolveEvent(events: Event[], teams?: string[]): Event | null {
  if (!events.length) return null
  const wanted = (teams ?? []).map(norm).filter(Boolean)

  if (wanted.length) {
    const ranked = events
      .map((e) => ({ e, s: scoreEvent(e, wanted) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s
        // Tie-break: prefer live, then full-time, then by recency.
        const live = Number(isLive(b.e)) - Number(isLive(a.e))
        if (live !== 0) return live
        const ft = Number(isFullTime(b.e)) - Number(isFullTime(a.e))
        if (ft !== 0) return ft
        return (b.e.date ?? '').localeCompare(a.e.date ?? '')
      })
    if (ranked.length) return ranked[0].e
    // Names provided but none matched. Only auto-pick if exactly one game is live
    // (the "you're clearly watching THIS match" case). Otherwise return null so the
    // caller falls back to Firecrawl — the named teams probably aren't in the World Cup.
    const live = events.filter(isLive)
    return live.length === 1 ? live[0] : null
  }

  // No team names: always return a real World Cup game (never Firecrawl-hallucinate
  // when ESPN has actual fixtures). Prefer a live game; else the most recent.
  const liveEvents = events.filter(isLive)
  if (liveEvents.length) return liveEvents[0]
  return [...events].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]
}

// --- Shared extraction helpers ---

function teamLabel(t?: Team): string {
  return t?.displayName ?? t?.shortDisplayName ?? t?.abbreviation ?? 'Unknown'
}

function pickCompetitors(comps?: Competitor[]): { home?: Competitor; away?: Competitor } {
  const list = comps ?? []
  return {
    home: list.find((c) => c.homeAway === 'home') ?? list[0],
    away: list.find((c) => c.homeAway === 'away') ?? list[1],
  }
}

function recordLine(c?: Competitor): string {
  const wdl = c?.record?.find((r) => r.type === 'total')?.summary ?? ''
  const pts = c?.record?.find((r) => r.type === 'points')?.summary ?? ''
  if (!wdl && !pts) return ''
  return `${wdl}${pts ? ` (${pts} pts)` : ''}`
}

// --- Section context + registry ---

interface Ctx {
  event: Event
  summary: Summary | null
  home?: Competitor
  away?: Competitor
  homeName: string
  awayName: string
  news: NewsFeed | null
  compactInfo: boolean
}

function scoreSection(ctx: Ctx): string {
  const { event, summary, home, away, homeName, awayName } = ctx
  const headerComp = summary?.header?.competitions?.[0]
  const status = statusDesc(event) || headerComp?.status?.type?.description || 'Unknown'
  const clock =
    event.status?.displayClock ||
    headerComp?.status?.displayClock ||
    headerComp?.status?.type?.shortDetail ||
    event.status?.type?.shortDetail ||
    ''
  const lines = [
    `STATUS: ${status}${clock ? ` (${clock})` : ''}`,
    `SCORE: ${homeName} ${home?.score ?? '?'} - ${away?.score ?? '?'} ${awayName}   (home: ${homeName}, away: ${awayName})`,
  ]
  const hr = recordLine(home)
  const ar = recordLine(away)
  if (hr || ar) lines.push(`RECORD: ${homeName} ${hr || '—'} | ${awayName} ${ar || '—'}`)
  return lines.join('\n')
}

function boxTeam(summary: Summary | null, name: string): BoxscoreTeam | undefined {
  const teams = summary?.boxscore?.teams ?? []
  return teams.find((t) => norm(teamLabel(t.team)) === norm(name))
}

function statsSection(ctx: Ctx): string {
  const { summary, homeName, awayName } = ctx
  const teams = summary?.boxscore?.teams ?? []
  if (!teams.length) return ''
  const homeT = boxTeam(summary, homeName) ?? teams[0]
  const awayT = boxTeam(summary, awayName) ?? teams[1]

  const statMap = (t?: BoxscoreTeam) => {
    const m = new Map<string, { label: string; value: string }>()
    for (const s of t?.statistics ?? []) {
      const key = norm(s.label ?? s.name ?? '')
      if (key) m.set(key, { label: s.label ?? s.name ?? key, value: s.displayValue ?? '' })
    }
    return m
  }
  const hm = statMap(homeT)
  const am = statMap(awayT)

  const rows: string[] = []
  for (const key of WANTED_STATS) {
    if (rows.length >= MAX_STATS) break
    const h = hm.get(key)
    const a = am.get(key)
    if (!h && !a) continue
    const label = h?.label ?? a?.label ?? key
    rows.push(`- ${label}: ${h?.value ?? '—'} | ${a?.value ?? '—'}`)
  }
  if (!rows.length) return ''
  return [`STATS (${homeName} | ${awayName}):`, ...rows].join('\n')
}

function eventsSection(ctx: Ctx): string {
  const ke = ctx.summary?.keyEvents ?? []
  if (!ke.length) return ''
  const recent = ke.slice(-MAX_KEY_EVENTS)
  const evLines = recent
    .map((k) => {
      const c = k.clock?.displayValue ? `${k.clock.displayValue} ` : ''
      const kind = k.type?.text ? `${k.type.text} — ` : ''
      return `- ${c}${kind}${k.text ?? ''}`.trim()
    })
    .filter(Boolean)
  if (!evLines.length) return ''
  return ['RECENT KEY EVENTS:', ...evLines].join('\n')
}

function infoSection(ctx: Ctx): string {
  const gi = ctx.summary?.gameInfo
  if (!gi) return ''
  const lines: string[] = []
  const v = gi.venue
  if (v?.fullName) {
    const city = v.address?.city ? `, ${v.address.city}` : ''
    lines.push(`VENUE: ${v.fullName}${city}`)
  }
  const ref = gi.officials?.find((o) => norm(o.position?.name ?? '').includes('referee'))
  const refName = ref?.displayName ?? ref?.fullName
  if (refName) lines.push(`REFEREE: ${refName}`)
  // Compact mode (used by `all`): venue + referee only.
  if (!ctx.compactInfo) {
    if (typeof gi.attendance === 'number' && gi.attendance > 0) lines.push(`ATTENDANCE: ${gi.attendance}`)
    const media = ctx.summary?.broadcasts?.[0]?.media
    const tvName = media?.name ?? media?.callLetters
    if (tvName) lines.push(`TV: ${tvName}`)
  }
  return lines.length ? lines.join('\n') : ''
}

function leadersSection(ctx: Ctx): string {
  const groups = ctx.summary?.leaders ?? []
  if (!groups.length) return ''
  const lines: string[] = []
  for (const g of groups) {
    const tname = teamLabel(g.team)
    const cats = (g.leaders ?? []).slice(0, 3)
    const parts = cats
      .map((c) => {
        const top = c.leaders?.[0]
        const who = top?.athlete?.displayName
        if (!who) return ''
        const cat = c.displayName ?? c.name ?? ''
        return `${cat}: ${who}${top?.displayValue ? ` (${top.displayValue})` : ''}`
      })
      .filter(Boolean)
    if (parts.length) lines.push(`LEADERS ${tname}: ${parts.join('; ')}`)
  }
  return lines.length ? lines.join('\n') : ''
}

function lineupsSection(ctx: Ctx): string {
  const rosters = ctx.summary?.rosters ?? []
  if (!rosters.length) return ''
  const lines: string[] = []
  for (const r of rosters) {
    const tname = teamLabel(r.team)
    const starters = (r.roster ?? []).filter((p) => p.starter)
    const xi = starters
      .map((p) => {
        const pos = p.position?.abbreviation ? ` (${p.position.abbreviation})` : ''
        const num = p.jersey ? `#${p.jersey} ` : ''
        return `${num}${p.athlete?.displayName ?? '?'}${pos}`
      })
      .join(', ')
    const subsIn = (r.roster ?? [])
      .filter((p) => p.subbedIn)
      .map((p) => p.athlete?.displayName)
      .filter(Boolean)
    const header = `LINEUP ${tname}${r.formation ? ` (${r.formation})` : ''}:`
    const body = xi || '(not available)'
    lines.push(`${header} ${body}`)
    if (subsIn.length) lines.push(`  Subs in: ${subsIn.join(', ')}`)
  }
  return lines.length ? lines.join('\n') : ''
}

function recordSection(ctx: Ctx): string {
  const hr = recordLine(ctx.home)
  const ar = recordLine(ctx.away)
  if (!hr && !ar) return ''
  return `TOURNAMENT RECORD: ${ctx.homeName} ${hr || '—'} | ${ctx.awayName} ${ar || '—'}`
}

function standingsSection(ctx: Ctx): string {
  const groups = ctx.summary?.standings?.groups ?? []
  if (!groups.length) return ''
  const lines: string[] = [ctx.summary?.standings?.header || 'STANDINGS:']
  // Prefer the group containing one of our two teams; else the first group.
  const names = [norm(ctx.homeName), norm(ctx.awayName)]
  const group =
    groups.find((g) =>
      (g.standings?.entries ?? []).some((e) => names.includes(norm(e.team ?? '')))
    ) ?? groups[0]
  const entries = (group.standings?.entries ?? []).slice(0, 6)
  for (const e of entries) {
    const stat = (n: string) => e.stats?.find((s) => s.name === n)?.displayValue ?? '-'
    lines.push(
      `- ${e.team ?? '?'}  GP ${stat('gamesPlayed')}  ${stat('overall')}  ${stat('points')} pts  (rank ${stat('rank')})`
    )
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

function oppName(o: FormEvent['opponent']): string {
  if (!o) return ''
  return typeof o === 'string' ? o : o.displayName ?? o.abbreviation ?? ''
}

function formSection(ctx: Ctx): string {
  const lines: string[] = []
  for (const ft of ctx.summary?.lastFiveGames ?? []) {
    const tname = teamLabel(ft.team)
    const results = (ft.events ?? [])
      .slice(0, 5)
      .map((e) => {
        const opp = oppName(e.opponent)
        const sc = e.score ?? ''
        const res = e.gameResult ?? ''
        return `${e.atVs ?? ''} ${opp} ${sc}${res ? ` (${res})` : ''}`.trim()
      })
      .filter(Boolean)
    if (results.length) lines.push(`FORM ${tname}: ${results.join(' | ')}`)
  }
  const h2h = (ctx.summary?.headToHeadGames?.[0]?.events ?? []).slice(0, 4)
  if (h2h.length) {
    const items = h2h
      .map((e) => `${(e.gameDate ?? '').slice(0, 10)} ${e.score ?? ''}`.trim())
      .filter(Boolean)
    if (items.length) lines.push(`H2H (recent): ${items.join(' | ')}`)
  }
  return lines.length ? lines.join('\n') : ''
}

function oddsSection(ctx: Ctx): string {
  const o = ctx.summary?.odds?.[0]
  if (!o) return ''
  const lines: string[] = [`ODDS${o.provider?.name ? ` (${o.provider.name})` : ''}:`]
  if (o.details) lines.push(`- Line: ${o.details}`)
  if (typeof o.overUnder === 'number') lines.push(`- Over/Under: ${o.overUnder}`)
  const ml = (t?: OddsTeam) =>
    t && typeof t.moneyLine === 'number' ? `${teamLabel(t.team)} ${t.moneyLine > 0 ? '+' : ''}${t.moneyLine}` : ''
  const moneylines = [ml(o.homeTeamOdds), ml(o.awayTeamOdds)].filter(Boolean)
  if (typeof o.drawOdds?.moneyLine === 'number')
    moneylines.push(`Draw ${o.drawOdds.moneyLine > 0 ? '+' : ''}${o.drawOdds.moneyLine}`)
  if (moneylines.length) lines.push(`- Moneyline: ${moneylines.join(' | ')}`)
  lines.push('(Raw betting lines — not a probability estimate.)')
  return lines.join('\n')
}

function newsSection(ctx: Ctx): string {
  const fromSummary = (ctx.summary?.news?.articles ?? [])
    .map((a) => a.headline)
    .filter(Boolean) as string[]
  if (fromSummary.length) {
    return ['NEWS:', ...fromSummary.slice(0, 5).map((h) => `- ${h}`)].join('\n')
  }
  const fromFeed = (ctx.news?.headlines ?? [])
    .map((h) => h.headline)
    .filter(Boolean) as string[]
  if (fromFeed.length) {
    return ['NEWS (soccer):', ...fromFeed.slice(0, 5).map((h) => `- ${h}`)].join('\n')
  }
  return ''
}

const SECTIONS: Record<SportsSection, { fn: (ctx: Ctx) => string; cap: number }> = {
  score: { fn: scoreSection, cap: 400 },
  stats: { fn: statsSection, cap: 700 },
  events: { fn: eventsSection, cap: 500 },
  info: { fn: infoSection, cap: 400 },
  leaders: { fn: leadersSection, cap: 500 },
  lineups: { fn: lineupsSection, cap: 900 },
  record: { fn: recordSection, cap: 300 },
  standings: { fn: standingsSection, cap: 600 },
  form: { fn: formSection, cap: 500 },
  odds: { fn: oddsSection, cap: 300 },
  news: { fn: newsSection, cap: 500 },
}

// Resolve the `want` param into a concrete, bounded section list.
function normalizeWant(want: SportsQuery['want']): { sections: SportsSection[]; compactInfo: boolean } {
  const raw = want == null ? [] : Array.isArray(want) ? want : [want]
  const lowered = raw.map((s) => String(s).toLowerCase())
  const explicit = lowered.filter((s): s is SportsSection => (ALL_SECTIONS as string[]).includes(s))
  const isAll = lowered.length === 0 || lowered.includes('all')

  let sections: SportsSection[]
  let compactInfo = false
  if (isAll) {
    sections = [...ALL_SET]
    for (const s of explicit) if (!sections.includes(s)) sections.push(s)
    compactInfo = !explicit.includes('info') // curated info is compact unless explicitly asked
  } else {
    sections = explicit
  }
  sections = [...new Set(sections)].slice(0, 6)
  return { sections, compactInfo }
}

/**
 * Primary World Cup data fetch. Resolves scoreboard → match → summary, then emits
 * only the requested section(s). NEVER throws: returns a model-ready block, or an
 * `ESPN_NO_MATCH:` / `ESPN_ERROR:` sentinel so the caller can fall back to Firecrawl.
 */
export async function getSportsData(q: SportsQuery): Promise<string> {
  const { teams, want } = q ?? {}
  const { sections, compactInfo } = normalizeWant(want)
  try {
    const sb = (await cachedGetJson(
      'scoreboard',
      `${ESPN_BASE}/${LEAGUE_SLUG}/scoreboard?dates=${dateWindow()}`
    )) as Scoreboard
    const events = sb?.events ?? []
    if (!events.length) return 'ESPN_NO_MATCH: no World Cup events on the scoreboard right now.'

    const event = resolveEvent(events, teams)
    if (!event) {
      const names = teams && teams.length ? JSON.stringify(teams) : '(none provided)'
      return `ESPN_NO_MATCH: no live/recent FIFA World Cup game matched ${names}.`
    }

    // Try to enrich with the summary; degrade to scoreboard-only on failure.
    let summary: Summary | null = null
    if (event.id) {
      try {
        summary = (await cachedGetJson(
          `summary:${event.id}`,
          `${ESPN_BASE}/${LEAGUE_SLUG}/summary?event=${event.id}`
        )) as Summary
      } catch {
        summary = null // degrade: scoreboard already has names + scores + status
      }
    }

    // News may need a second fetch only when the summary carries no articles.
    let news: NewsFeed | null = null
    if (sections.includes('news') && !(summary?.news?.articles?.length)) {
      try {
        news = (await cachedGetJson('news', NOW_NEWS_URL)) as NewsFeed
      } catch {
        news = null
      }
    }

    const headerComp = summary?.header?.competitions?.[0]
    const sbComp = event.competitions?.[0]
    const { home, away } = pickCompetitors(headerComp?.competitors ?? sbComp?.competitors)
    const ctx: Ctx = {
      event,
      summary,
      home,
      away,
      homeName: teamLabel(home?.team),
      awayName: teamLabel(away?.team),
      news,
      compactInfo,
    }

    const blocks: string[] = [`ESPN FIFA World Cup — ${ctx.homeName} vs ${ctx.awayName}`]
    for (const key of sections) {
      const def = SECTIONS[key]
      const block = clamp(def.fn(ctx), def.cap)
      if (block) blocks.push(block)
    }
    if (sections.includes('score')) {
      blocks.push('NOTE: Live win-probability is not provided by ESPN for this competition.')
    }

    return clamp(blocks.join('\n\n'), MAX_TOTAL_CHARS)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return `ESPN_ERROR: ${message}`
  }
}
