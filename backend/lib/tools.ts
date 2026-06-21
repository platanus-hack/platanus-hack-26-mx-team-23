// Agent tool definitions + dispatcher for /api/generate.
//
// Two data tools: get_sports_data (ESPN — primary, World Cup live data) and
// web_research (Firecrawl — fallback for everything ESPN can't cover). Both are
// members of DATA_TOOLS; the agent loop executes any of them via runTool with no
// loop changes. runTool falls back to Firecrawl when ESPN returns no match.

import type Anthropic from '@anthropic-ai/sdk'
import { firecrawlSearch, firecrawlScrape } from '@/lib/firecrawl'
import { getSportsData, type SportsQuery } from '@/lib/espn'

export const WEB_RESEARCH_TOOL: Anthropic.Tool = {
  name: 'web_research',
  description:
    'Search the web for REAL facts you cannot determine from the screenshot alone — ' +
    'a player or person identity, current news, real-time statistics, standings, prices, etc. ' +
    'Provide a focused natural-language query. Optionally pass a specific url to scrape it directly. ' +
    'Returns markdown digests of the most relevant pages. ' +
    'Call this before render_layout when the user asks about something factual.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Focused search query, e.g. "Mexico national team starting XI today".',
      },
      url: {
        type: 'string',
        description: 'Optional: a specific page URL to scrape instead of searching.',
      },
    },
    required: ['query'],
  },
}

export const GET_SPORTS_DATA_TOOL: Anthropic.Tool = {
  name: 'get_sports_data',
  description:
    'PRIMARY source for live FIFA World Cup match data. ' +
    'Use this FIRST — before web_research — for ANY question about a live football/soccer match. ' +
    'Covers: score, possession/shots/cards & full match stats, goals/timeline, referee & venue & TV, ' +
    'match leaders (top scorer/most shots), lineups & formations, group standings, tournament record, ' +
    'recent form & head-to-head, betting odds, and match news. ' +
    'Pass the two team names exactly as you read them from the on-screen scorebug in `teams` ' +
    '(order does not matter; abbreviations are OK). If you cannot read the names, call it with no ' +
    'teams and it resolves the only live World Cup game. Returns authoritative real-time data ' +
    'for direct use in scoreboard/statpanel/alert/infocard/keypoints widgets. ' +
    'Only fall back to web_research if this returns no match.',
  input_schema: {
    type: 'object',
    properties: {
      teams: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Team names read from the scorebug, e.g. ["Netherlands","Sweden"]. Order/abbreviations OK.',
      },
      want: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'score', 'stats', 'events', 'info', 'leaders',
            'lineups', 'record', 'standings', 'form', 'odds', 'news', 'all',
          ],
        },
        description:
          'Which data section(s) to return — pass ONLY what the user asked, to keep the response small. ' +
          'Combine keys for combined questions. Mapping: ' +
          'who is winning/score → ["score"]; possession/shots/cards/stats → ["stats"]; goals/timeline → ["events"]; ' +
          'referee/stadium/venue/TV channel → ["info"]; top scorer/match figure/most shots → ["leaders"]; ' +
          'starting XI/formation/who is playing/substitutions → ["lineups"]; group table → ["standings"]; ' +
          'tournament record or points → ["record"]; recent form/head-to-head → ["form"]; betting odds → ["odds"]; ' +
          'latest news/headlines → ["news"]; "score and referee" → ["score","info"]. ' +
          'Omit or use ["all"] for a compact overview. Odds are returned raw (no probability math).',
      },
    },
    required: [],
  },
}

// Tools that fetch data (everything except the terminal render_layout tool).
// ESPN listed first to reinforce its priority over Firecrawl.
export const DATA_TOOLS: Anthropic.Tool[] = [GET_SPORTS_DATA_TOOL, WEB_RESEARCH_TOOL]

/**
 * Execute a data tool by name. Always resolves to a string (the tool_result
 * content). Never throws — failures degrade to an explanatory message so the
 * agent loop can continue and render the best answer it can.
 */
export async function runTool(name: string, input: unknown): Promise<string> {
  try {
    if (name === 'get_sports_data') {
      const { teams, want } = (input ?? {}) as { teams?: string[]; want?: SportsQuery['want'] }
      const result = await getSportsData({ teams, want })
      // Fallback to Firecrawl when ESPN can't resolve a match or errored.
      if (result.startsWith('ESPN_NO_MATCH:') || result.startsWith('ESPN_ERROR:')) {
        const teamStr = Array.isArray(teams) && teams.length ? teams.join(' vs ') : 'the current match'
        const fb = await firecrawlSearch(`FIFA World Cup ${teamStr} live score and stats today`)
        return `ESPN had no direct data (${result}). Web fallback:\n\n${fb}`
      }
      return result
    }
    if (name === 'web_research') {
      const { query, url } = (input ?? {}) as { query?: string; url?: string }
      if (url && typeof url === 'string') {
        return await firecrawlScrape(url)
      }
      if (query && typeof query === 'string') {
        return await firecrawlSearch(query)
      }
      return 'web_research called without a query or url.'
    }
    return `Unknown tool: ${name}`
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.warn('[klai] tool %s failed: %s', name, message)
    return `Tool "${name}" failed (${message}). Render the best answer you can from the screenshot.`
  }
}
