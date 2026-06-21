// Agent tool definitions + dispatcher for /api/generate.
//
// In this phase there is one data tool — web_research (Firecrawl). The structure
// is intentionally extensible: add get_sports_data (ESPN) later by appending a
// definition to DATA_TOOLS and a case to runTool, no refactor of the loop needed.

import type Anthropic from '@anthropic-ai/sdk'
import { firecrawlSearch, firecrawlScrape } from '@/lib/firecrawl'

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

// Tools that fetch data (everything except the terminal render_layout tool).
export const DATA_TOOLS: Anthropic.Tool[] = [WEB_RESEARCH_TOOL]

/**
 * Execute a data tool by name. Always resolves to a string (the tool_result
 * content). Never throws — failures degrade to an explanatory message so the
 * agent loop can continue and render the best answer it can.
 */
export async function runTool(name: string, input: unknown): Promise<string> {
  try {
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
