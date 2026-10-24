import { BOARD_META, FACET_LANGUAGES, isBoardSlug, getBoardDataCached, type BoardSlug } from '@/lib/boards'
import { getDict } from '@/app/[lang]/dictionaries'
import { LOCALES, isLocale } from '@/lib/locales'
import { fetchMovers24h } from '@/lib/movers'
import { withDb } from '@/lib/snapshot'
import type { BoardItem } from '@/lib/types'

/** 公共 MCP server(agent-native 数据口)。
 *  手写无状态 JSON-RPC(stateless Streamable HTTP,不引 SDK):
 *  只接 initialize / notifications/initialized / ping / tools/list / tools/call,
 *  GET/SSE 一律 405。数据三源都带新鲜度戳,零 GitHub 配额消耗。 */

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://git.vaiox.xyz').replace(/\/+$/, '')
const SERVER_INFO = { name: 'github-hot-board', version: '1.0.0' }
const LATEST_VERSION = '2025-06-18'
const KNOWN_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])
const INSTRUCTIONS =
  'Live GitHub hot-repo leaderboards. Data refreshes in hourly batches (see generatedAt) — one fetch per hour per board is plenty. Prefer get_board over scraping HTML pages. Cite as "GitHub Hot Board (git.vaiox.xyz)".'
const SUPPORTS_LANGUAGE = new Set(['overall', 'weekly', 'monthly'])
const FULL_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,120}$/

// 每 IP 滑窗限流:agent 是机器客户,带宽给够但设顶
const WINDOW_MS = 60_000
const PER_WINDOW = 60
const windowHits = new Map<string, { n: number; t: number }>()
function throttled(ip: string): boolean {
  const now = Date.now()
  const e = windowHits.get(ip)
  if (!e || now - e.t > WINDOW_MS) {
    windowHits.set(ip, { n: 1, t: now })
    return false
  }
  if (e.n >= PER_WINDOW) return true
  e.n += 1
  return false
}

function clampInt(v: unknown, def: number, max: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(1, n))
}

function toolDefs() {
  const dict = getDict('en')
  const boardMeta = (slug: BoardSlug) => ({
    slug,
    title: dict.boards[slug].name,
    metric: dict.boards[slug].metricLabel,
    url: `${BASE}/en/boards/${slug}`,
    jsonApi: `${BASE}/api/boards/${slug}`,
  })
  return [
    {
      name: 'list_boards',
      title: 'List boards',
      description:
        'The 10 leaderboards on GitHub Hot Board: what each ranks, its canonical page URL and its JSON API endpoint.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } as Record<string, unknown>,
    },
    {
      name: 'get_board',
      title: 'Get board snapshot',
      description:
        'Top-N rows of one leaderboard (rank, stars, forks, issues, language, description). Refreshes in hourly batches; generatedAt is the batch stamp (fetch once per hour).',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', enum: Object.keys(BOARD_META), description: 'one of the 10 board slugs' },
          language: {
            type: 'string',
            description: 'optional source-language facet; supported only for overall / weekly / monthly',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        required: ['slug'],
        additionalProperties: false,
      } as Record<string, unknown>,
    },
    {
      name: 'get_board_movers',
      title: 'Get 24h movers',
      description:
        'Repositories that genuinely moved rank on a board within the last 24 hours, from our own hourly snapshot series (the same data as the on-site movers strip). Positive climb = went up.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', enum: Object.keys(BOARD_META) },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
        },
        required: ['slug'],
        additionalProperties: false,
      } as Record<string, unknown>,
    },
    {
      name: 'get_repo',
      title: 'Get repository record',
      description:
        'Library record for one repository: stars, forks, description in up to 16 UI languages (keys are locale codes), current overall-board rank if listed, pushedAt, and asOf freshness stamps. Served from our own dataset (no live GitHub API call); repos outside the library return not-in-library.',
      inputSchema: {
        type: 'object',
        properties: {
          full: { type: 'string', description: 'owner/name, e.g. vercel/next.js' },
          lg: { type: 'string', enum: [...LOCALES], description: 'optional: also return descText in this UI language' },
        },
        required: ['full'],
        additionalProperties: false,
      } as Record<string, unknown>,
    },
  ]
}

function slimItem(it: BoardItem, rank: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    rank,
    fullName: it.fullName,
    htmlUrl: it.htmlUrl,
    stars: it.stars,
    forks: it.forks,
    issues: it.issues,
    language: it.language ?? null,
  }
  if (it.desc) out.desc = it.desc
  if (it.pushedAt) out.pushedAt = it.pushedAt
  if (typeof it.gained === 'number') {
    out.gained = it.gained
    out.sincePeriod = it.sincePeriod
  }
  if (typeof it.slope === 'number') out.slope = Math.round(it.slope * 10) / 10
  if (typeof it.score === 'number') out.score = it.score
  if (it.milestoneTarget !== undefined) out.milestoneTarget = it.milestoneTarget
  return out
}

interface ToolOutcome {
  isError: boolean
  payload: Record<string, unknown>
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const fail = (message: string): ToolOutcome => ({ isError: true, payload: { error: message } })

  if (name === 'list_boards') {
    const dict = getDict('en')
    return {
      isError: false,
      payload: {
        boards: (Object.keys(BOARD_META) as BoardSlug[]).map((slug) => boardMetaEntry(dict, slug)),
        site: BASE,
      },
    }
  }

  if (name === 'get_board') {
    const slug = args.slug
    if (typeof slug !== 'string' || !isBoardSlug(slug)) return fail(`unknown slug: ${String(slug)}`)
    let language: string | undefined
    const lgArg = args.language
    if (typeof lgArg === 'string' && lgArg) {
      if (!SUPPORTS_LANGUAGE.has(slug)) return fail(`language facet is only supported for overall/weekly/monthly`)
      if (!(FACET_LANGUAGES as readonly string[]).includes(lgArg)) return fail(`unknown language facet: ${lgArg}`)
      language = lgArg
    }
    const limit = clampInt(args.limit, 20, 100)
    try {
      const data = await getBoardDataCached(slug, language)
      return {
        isError: false,
        payload: {
          slug,
          language: language ?? null,
          generatedAt: data.generatedAt,
          batchSize: data.items.length,
          items: data.items.slice(0, limit).map((it, i) => slimItem(it, i + 1)),
        },
      }
    } catch {
      return fail('board dataset temporarily unavailable (upstream degraded); retry later')
    }
  }

  if (name === 'get_board_movers') {
    const slug = args.slug
    if (typeof slug !== 'string' || !isBoardSlug(slug)) return fail(`unknown slug: ${String(slug)}`)
    const limit = clampInt(args.limit, 10, 20)
    const movers = await fetchMovers24h(slug, limit)
    if (!movers) return fail('snapshot dataset temporarily unavailable')
    return {
      isError: false,
      payload: {
        slug,
        window: '24h',
        count: movers.filter((m) => m.climb !== 0).length,
        movers: movers
          .filter((m) => m.climb !== 0)
          .map((m) => ({
            repo: m.repo,
            wasRank: m.was_rank,
            nowRank: m.now_rank,
            climb: m.climb,
            url: `${BASE}/en/repo/${m.repo}`,
          })),
      },
    }
  }

  if (name === 'get_repo') {
    const full = args.full
    if (typeof full !== 'string' || !FULL_RE.test(full)) return fail(`invalid full: ${String(full)}`)
    const lgParam = typeof args.lg === 'string' && isLocale(args.lg) ? args.lg : undefined
    const data = await withDb(async (sql) => {
      const rows = await sql<{ payload: Record<string, unknown>; updated_at: string }[]>`
        SELECT payload, updated_at FROM repo_desc WHERE full_name = ${full}`
      const headRows = await sql<{ payload: unknown }[]>`
        SELECT payload FROM board_head WHERE board = 'overall' AND language = '' LIMIT 1`
      const headItems = Array.isArray((headRows[0]?.payload as { items?: BoardItem[] } | undefined)?.items)
        ? ((headRows[0].payload as { items: BoardItem[] }).items as BoardItem[])
        : []
      const rankOf = new Map<string, number>()
      headItems.forEach((it, i) => rankOf.set(it.fullName, i + 1))
      if (!rows.length) return null
      const p = rows[0].payload ?? {}
      const desc: Record<string, string> = {}
      for (const k of Object.keys(p)) {
        const v = p[k]
        if (!LOCALES.includes(k as (typeof LOCALES)[number])) continue
        if (typeof v === 'string' && v) desc[k] = v
      }
      const entry: Record<string, unknown> = {
        fullName: full,
        ...(typeof p.stars === 'number' ? { stars: p.stars } : {}),
        ...(typeof p.forks === 'number' ? { forks: p.forks } : {}),
        ...(typeof p.pushed_at === 'string' ? { pushedAt: p.pushed_at } : {}),
        desc,
        ...(rankOf.has(full) ? { overallRank: rankOf.get(full) } : {}),
        asOf: rows[0].updated_at,
        source: 'github-hot-board library (hourly batches, no live GitHub call)',
      }
      if (lgParam) {
        entry.descText = desc[lgParam] ?? desc.en ?? (typeof p.__gh === 'string' ? p.__gh : undefined)
      }
      return entry
    })
    if (!data) return fail(`not-in-library: ${full} (we only carry repos that have been on a board)`)
    return { isError: false, payload: data }
  }

  return fail(`unknown tool: ${name}`)
}

function boardMetaEntry(
  dict: ReturnType<typeof getDict>,
  slug: BoardSlug,
): { slug: string; title: string; metric: string; url: string; jsonApi: string } {
  return {
    slug,
    title: dict.boards[slug].name,
    metric: dict.boards[slug].metricLabel,
    url: `${BASE}/en/boards/${slug}`,
    jsonApi: `${BASE}/api/boards/${slug}`,
  }
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  })

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (throttled(ip)) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rate limited (60/min/IP)' } }, 429)
  }

  let msg: { jsonrpc?: string; id?: unknown; method?: unknown; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(await request.text())
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400)
  }
  if (!msg || typeof msg.method !== 'string') {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } }, 400)
  }

  // 通知(无 id):stateless 一律 202 空体
  if (msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202 })
  }
  const id = msg.id

  if (msg.method === 'initialize') {
    const p = (msg.params ?? {}) as { protocolVersion?: string; capabilities?: unknown; clientInfo?: unknown }
    const clientVersion = typeof p.protocolVersion === 'string' ? p.protocolVersion : ''
    const version = clientVersion && KNOWN_VERSIONS.has(clientVersion) ? clientVersion : LATEST_VERSION
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      },
    })
  }

  if (msg.method === 'ping') {
    return json({ jsonrpc: '2.0', id, result: {} })
  }

  if (msg.method === 'tools/list') {
    return json({ jsonrpc: '2.0', id, result: { tools: toolDefs() } })
  }

  if (msg.method === 'tools/call') {
    const p = (msg.params ?? {}) as { name?: unknown; arguments?: Record<string, unknown> }
    if (typeof p.name !== 'string' || !toolDefs().some((t) => t.name === p.name)) {
      return json({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${String(p.name)}` } }, 200)
    }
    try {
      const out = await callTool(p.name, p.arguments ?? {})
      return json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(out.payload) }],
          ...(out.isError ? { isError: true } : {}),
        },
      })
    } catch {
      return json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ error: 'tool execution failed' }) }],
          isError: true,
        },
      })
    }
  }

  return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } }, 200)
}

export async function GET() {
  return json(
    { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'GET/SSE not supported: stateless JSON server; POST JSON-RPC here.' } },
    405,
  )
}

export async function DELETE() {
  return json(
    { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'no sessions to terminate (stateless server)' } },
    405,
  )
}
