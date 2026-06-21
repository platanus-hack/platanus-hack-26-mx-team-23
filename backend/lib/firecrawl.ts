// Firecrawl v2 client — web search + scrape.
// Used by the /api/generate agent loop (tool: web_research) so Claude can fetch
// real-world facts before composing the overlay.
//
// Docs: https://docs.firecrawl.dev  (v2 endpoints: /v2/search, /v2/scrape)
// Key is server-side only (FIRECRAWL_API_KEY); never exposed to the extension.

const FIRECRAWL_BASE = 'https://api.firecrawl.dev'

// Hard caps so a tool_result never floods the model context.
const MAX_RESULTS = 5
const MAX_MARKDOWN_PER_RESULT = 1500
const MAX_TOTAL_CHARS = 6000

interface FetchOpts {
  timeoutMs?: number
}

async function postJson(
  path: string,
  body: unknown,
  { timeoutMs = 8000 }: FetchOpts = {}
): Promise<unknown> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) throw new Error('FIRECRAWL_API_KEY not set')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${FIRECRAWL_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Firecrawl ${path} returned ${res.status}: ${text.slice(0, 200)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function clamp(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

/**
 * Web search with inline page content (markdown). Returns a compact, model-ready
 * markdown digest of the top results.
 */
export async function firecrawlSearch(query: string): Promise<string> {
  const json = (await postJson('/v2/search', {
    query,
    limit: MAX_RESULTS,
    sources: ['web'],
    scrapeOptions: { formats: ['markdown'] },
  })) as {
    data?: {
      web?: Array<{ title?: string; url?: string; description?: string; markdown?: string }>
    } | Array<{ title?: string; url?: string; description?: string; markdown?: string }>
  }

  // v2 returns { data: { web: [...] } }; tolerate a flat array too.
  const results = Array.isArray(json.data)
    ? json.data
    : (json.data?.web ?? [])

  if (!results.length) return `No web results found for "${query}".`

  const blocks: string[] = []
  let total = 0
  for (const r of results) {
    const body = clamp(r.markdown ?? r.description ?? '', MAX_MARKDOWN_PER_RESULT)
    const block = `## ${r.title ?? 'Untitled'}\n${r.url ?? ''}\n${body}`.trim()
    if (total + block.length > MAX_TOTAL_CHARS) break
    blocks.push(block)
    total += block.length
  }
  return blocks.join('\n\n---\n\n')
}

/**
 * Scrape a single URL to markdown. Used when Claude already knows the exact page.
 */
export async function firecrawlScrape(url: string): Promise<string> {
  const json = (await postJson('/v2/scrape', {
    url,
    formats: ['markdown'],
  })) as { data?: { markdown?: string } }

  const markdown = json.data?.markdown ?? ''
  if (!markdown) return `No content scraped from ${url}.`
  return clamp(markdown, MAX_TOTAL_CHARS)
}
