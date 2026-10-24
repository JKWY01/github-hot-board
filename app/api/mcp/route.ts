import { BOARD_META, FACET_LANGUAGES, isBoardSlug, getBoardDataCached, type BoardSlug } from '@/lib/boards'
import { getDict } from '@/app/[lang]/dictionaries'
import { LOCALES, isLocale } from '@/lib/locales'
import { fetchMovers24h } from '@/lib/movers'
import { clientIpOf, slidingWindow } from '@/lib/ratelimit'
import { isRepoFullName } from '@/lib/reposhape'
import { withDb } from '@/lib/snapshot'
import type { BoardItem } from '@/lib/types'

/** 公共 MCP server(agent-native 数据口)。
 *  手写无状态 JSON-RPC(stateless Streamable HTTP,不引 SDK):
 *  只接 initialize / notifications/initialized / ping / tools/list / tools/call,
 *  GET/SSE 一律 405。数据三源都带新鲜度戳,零 GitHub 配额消耗。 */

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://git.vaiox.xyz').replace(/\/+$/, '')
const SERVER_INFO = { name: 'github-hot-board', version: '2.1.0' }
const LATEST_VERSION = '2026-07-28'
const KNOWN_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'])
const INSTRUCTIONS =
  'Live GitHub hot-repo leaderboards. Sync runs every ~30 minutes and batches do not change in between (see generatedAt) — one fetch per hour per board is plenty. get_board carries source + degraded: cite fallback methodology with care. Prefer get_board over scraping HTML pages. Cite as "GitHub Hot Board (git.vaiox.xyz)".'
const SUPPORTS_LANGUAGE = new Set(['overall', 'weekly', 'monthly'])

// 每 IP 滑窗限流:agent 是机器客户,带宽给够但设顶(共享实现,带条目修剪)
const WINDOW_MS = 60_000
const PER_WINDOW = 60
const rate = slidingWindow()

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
  const readOnly = { readOnlyHint: true } as Record<string, unknown>
  return [
    {
      name: 'list_boards',
      title: 'List boards',
      description:
        'The 10 leaderboards on GitHub Hot Board: what each ranks, its canonical page URL and its JSON API endpoint.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } as Record<string, unknown>,
      outputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          boards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                title: { type: 'string' },
                metric: { type: 'string' },
                url: { type: 'string' },
                jsonApi: { type: 'string' },
              },
              required: ['slug', 'title', 'metric', 'url', 'jsonApi'],
            },
          },
        },
        required: ['site', 'boards'],
      } as Record<string, unknown>,
      annotations: readOnly,
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
      outputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          language: { type: ['string', 'null'] },
          generatedAt: { type: 'string' },
          batchSize: { type: 'integer' },
          source: {
            type: 'string',
            description: 'github-search | github-trending | github-search-fallback — which upstream produced this batch',
          },
          degraded: {
            type: 'boolean',
            description: 'true = the official Trending scrape failed and a Search-based fallback methodology was served; cite with care (HTML pages show the same warning)',
          },
          items: { type: 'array', items: BOARD_ROW_SCHEMA },
        },
        required: ['slug', 'language', 'generatedAt', 'batchSize', 'source', 'degraded', 'items'],
      } as Record<string, unknown>,
      annotations: readOnly,
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
      outputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          window: { type: 'string' },
          count: { type: 'integer' },
          movers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                repo: { type: 'string' },
                wasRank: { type: 'integer' },
                nowRank: { type: 'integer' },
                climb: { type: 'integer' },
                url: { type: 'string' },
              },
              required: ['repo', 'wasRank', 'nowRank', 'climb', 'url'],
            },
          },
        },
        required: ['slug', 'window', 'count', 'movers'],
      } as Record<string, unknown>,
      annotations: readOnly,
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
      outputSchema: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          stars: { type: 'integer' },
          forks: { type: 'integer' },
          pushedAt: { type: 'string' },
          desc: { type: 'object', additionalProperties: { type: 'string' } },
          overallRank: { type: 'integer' },
          asOf: { type: 'string' },
          source: { type: 'string' },
          descText: { type: 'string' },
        },
        required: ['fullName', 'asOf', 'source'],
      } as Record<string, unknown>,
      annotations: readOnly,
    },
    {
      name: 'search_library',
      title: 'Search the library',
      description:
        'Search repositories tracked by this site, by owner/name (exact wins) or by keyword over descriptions (16 languages). Library-only: repos never listed on a board are not here. No live GitHub calls.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 80, description: 'owner/name fragment or keyword' },
          limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
        },
        required: ['q'],
        additionalProperties: false,
      } as Record<string, unknown>,
      outputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          count: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fullName: { type: 'string' },
                stars: { type: 'integer' },
                forks: { type: 'integer' },
                desc: { type: 'string' },
                overallRank: { type: 'integer' },
                url: { type: 'string' },
              },
              required: ['fullName', 'url'],
            },
          },
        },
        required: ['query', 'count', 'results'],
      } as Record<string, unknown>,
      annotations: readOnly,
    },
    {
      name: 'get_repo_history',
      title: 'Get rank history',
      description:
        'Time series of one repository on one board (default overall): hourly rank + star points from our own snapshot series. Our unique moat — this data exists on no other service. Empty result means the repo was not tracked in the window.',
      inputSchema: {
        type: 'object',
        properties: {
          full: { type: 'string', description: 'owner/name' },
          board: { type: 'string', enum: Object.keys(BOARD_META), default: 'overall' },
          days: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
        },
        required: ['full'],
        additionalProperties: false,
      } as Record<string, unknown>,
      outputSchema: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          board: { type: 'string' },
          days: { type: 'integer' },
          cadence: { type: 'string' },
          pointCount: { type: 'integer' },
          points: {
            type: 'array',
            items: {
              type: 'object',
              properties: { at: { type: 'string' }, rank: { type: 'integer' }, stars: { type: 'integer' } },
              required: ['at', 'rank', 'stars'],
            },
          },
        },
        required: ['fullName', 'board', 'days', 'cadence', 'pointCount', 'points'],
      } as Record<string, unknown>,
      annotations: readOnly,
    },
  ]
}

/** get_board 行结构(get_board 的 outputSchema 复用) */
const BOARD_ROW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    rank: { type: 'integer' },
    fullName: { type: 'string' },
    htmlUrl: { type: 'string' },
    stars: { type: 'integer' },
    forks: { type: 'integer' },
    issues: { type: 'integer' },
    language: { type: ['string', 'null'] },
    desc: { type: 'string' },
    pushedAt: { type: 'string' },
    gained: { type: 'integer' },
    sincePeriod: { type: 'string' },
    slope: { type: 'number' },
    score: { type: 'number' },
    milestoneTarget: { type: 'integer' },
  },
  required: ['rank', 'fullName', 'htmlUrl', 'stars', 'forks', 'issues', 'language'],
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
          // 诚实信号与 HTML/JSON 口子对齐:降级口径必须让 agent 看见
          source: data.source,
          degraded: data.degraded ?? false,
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
    if (typeof full !== 'string' || !isRepoFullName(full)) return fail(`invalid full: ${String(full)}`)
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

  if (name === 'search_library') {
    const q = typeof args.q === 'string' ? args.q.trim().slice(0, 80) : ''
    if (!q) return fail('empty query')
    const limit = clampInt(args.limit, 10, 25)
    const data = await withDb(async (sql) => {
      const headRows = await sql<{ payload: unknown }[]>`
        SELECT payload FROM board_head WHERE board = 'overall' AND language = '' LIMIT 1`
      const headItems = Array.isArray((headRows[0]?.payload as { items?: BoardItem[] } | undefined)?.items)
        ? ((headRows[0].payload as { items: BoardItem[] }).items as BoardItem[])
        : []
      const rankOf = new Map<string, number>()
      headItems.forEach((it, i) => rankOf.set(it.fullName, i + 1))
      const pat = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
      // 库内两路:全名命中优先,关键词扫 16 语描述(字面 IN 链,免 jsonb 类型比较坑)
      const rows = await sql<{ full_name: string; payload: Record<string, unknown> }[]>`
        SELECT full_name, payload FROM repo_desc
        WHERE lower(full_name) = lower(${q})
           OR full_name ILIKE ${pat}
           OR EXISTS (
             SELECT 1 FROM jsonb_each_text(payload) AS e(k, v)
             WHERE e.k IN ('en','zh','zh-TW','ja','ko','de','fr','es','pt','it','ru','uk','pl','tr','vi','id','__gh')
               AND e.v ILIKE ${pat}
           )
        ORDER BY (lower(full_name) = lower(${q})) DESC, (payload->>'stars')::bigint DESC NULLS LAST
        LIMIT ${limit}`
      return rows.map((r) => {
        const p = r.payload ?? {}
        const descText = typeof p.en === 'string' && p.en ? p.en : typeof p.__gh === 'string' ? p.__gh : undefined
        return {
          fullName: r.full_name,
          ...(typeof p.stars === 'number' ? { stars: p.stars } : {}),
          ...(typeof p.forks === 'number' ? { forks: p.forks } : {}),
          ...(descText ? { desc: descText } : {}),
          ...(rankOf.has(r.full_name) ? { overallRank: rankOf.get(r.full_name) } : {}),
          url: `${BASE}/en/repo/${r.full_name}`,
        }
      })
    })
    if (!data) return fail('library dataset temporarily unavailable')
    return { isError: false, payload: { query: q, count: data.length, results: data } }
  }

  if (name === 'get_repo_history') {
    const full = args.full
    if (typeof full !== 'string' || !isRepoFullName(full)) return fail(`invalid full: ${String(full)}`)
    const board = typeof args.board === 'string' && isBoardSlug(args.board) ? args.board : 'overall'
    const days = clampInt(args.days, 7, 30)
    const data = await withDb(async (sql) => {
      const rows = await sql<{ taken_at: string; rank: number; stars: number }[]>`
        SELECT taken_at, rank, stars FROM board_snapshots
        WHERE board = ${board} AND language = '' AND repo = ${full}
          AND taken_at > now() - (${days} || ' days')::interval
        ORDER BY taken_at ASC`
      // 降采样:最多 240 个点,密度降档不降形状
      const stride = Math.max(1, Math.ceil(rows.length / 240))
      const points = rows
        .filter((_, i) => i % stride === 0 || i === rows.length - 1)
        .map((r) => ({
          at: new Date(r.taken_at).toISOString(),
          rank: Number(r.rank),
          stars: Number(r.stars),
        }))
      return { cadence: stride > 1 ? `hourly (downsampled 1/${stride})` : 'hourly', points }
    })
    if (!data) return fail('snapshot dataset temporarily unavailable')
    if (data.points.length === 0) {
      return fail(`not tracked on ${board}: ${full} was not on this board in the last ${days} days`)
    }
    return {
      isError: false,
      payload: {
        fullName: full,
        board,
        days,
        cadence: data.cadence,
        pointCount: data.points.length,
        points: data.points,
      },
    }
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
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      // 限流回执带标准重试提示:agent 客户端按此退避,不必盲试
      ...(status === 429 ? { 'retry-after': '60' } : {}),
    },
  })

export async function POST(request: Request) {
  if (!rate.allow(clientIpOf(request), PER_WINDOW, WINDOW_MS)) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rate limited (60/min/IP); retry after 60s' } }, 429)
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
          structuredContent: out.payload,
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
