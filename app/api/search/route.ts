import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/snapshot'
import { MILESTONE_THRESHOLDS } from '@/lib/boards'
import type { BoardItem } from '@/lib/types'

/** 站内搜索(方案 A+B+C):
 *  - owner/repo 精确:先查 repo_desc,缺 stars 现打一次 GitHub /repos 并写回(访客即采集器);
 *  - 关键词:在自己库的 2,633+ 仓多语描述里模糊匹配(零外部 API);
 *  - 名次语义:board_head 载荷里现成名次图 + 榜尾门槛,总榜外给 300+,里程碑给"差 N 到档"。
 *  结果卡是动态视图,不给任何新收录 URL。 */

const TOKENS = (process.env.GITHUB_TOKENS ?? process.env.GITHUB_TOKEN ?? '')
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean)
let tokenAt = 0

const DESC_LANG_KEYS = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'ru', 'uk', 'pl', 'tr', 'vi', 'id']

interface Hit {
  fullName: string
  stars?: number
  forks?: number
  pushedAt?: string
  desc?: Record<string, string>
  rank?: number
  cutoff?: number
}

// 简易每 IP 滑窗限流:搜索是人手速,不是爬虫节奏
const WINDOW_MS = 60_000
const PER_WINDOW = 15
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

const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

async function ghRepo(full: string): Promise<{ stars: number; forks: number; desc?: string; pushedAt?: string } | null> {
  if (!TOKENS.length) return null
  for (let attempt = 0; attempt < Math.min(3, TOKENS.length); attempt++) {
    const token = TOKENS[tokenAt++ % TOKENS.length]
    try {
      const res = await fetch(`https://api.github.com/repos/${full}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'ghb-hot-board',
        },
        cache: 'no-store',
      })
      if (res.ok) {
        const j = (await res.json()) as {
          stargazers_count?: number
          forks_count?: number
          description?: string
          pushed_at?: string
        }
        return {
          stars: j.stargazers_count ?? 0,
          forks: j.forks_count ?? 0,
          desc: typeof j.description === 'string' && j.description ? j.description : undefined,
          pushedAt: j.pushed_at,
        }
      }
      if (res.status === 404) return null
      // 403/429:轮换池里下一枚再试
    } catch {
      // 网络抖动:下一枚
    }
  }
  return null
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').slice(0, 200).trim()
  const board = (url.searchParams.get('board') ?? '').slice(0, 32)
  const language = (url.searchParams.get('language') ?? '').slice(0, 48)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'

  if (!q) return NextResponse.json({ ok: false, reason: 'empty' }, { status: 400 })
  if (throttled(ip)) return NextResponse.json({ ok: false, reason: 'rate' }, { status: 429 })

  const isExact = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,120}$/.test(q)

  const data = await withDb(async (sql) => {
    // 名次语义底座:本榜(优先语言分榜,退主榜)的名次图与榜尾门槛
    const headRows = await sql<{ payload: unknown }[]>`
      SELECT payload FROM board_head
      WHERE board = ${board} AND language IN (${language}, '') LIMIT 2`
    const head = headRows.find((r) => r.payload) ?? null
    const headItems: BoardItem[] = Array.isArray((head?.payload as { items?: BoardItem[] })?.items)
      ? ((head!.payload as { items: BoardItem[] }).items as BoardItem[])
      : []
    const rankOf = new Map<string, number>()
    headItems.forEach((it, i) => rankOf.set(it.fullName, i + 1))
    const cutoff = headItems.length ? headItems[headItems.length - 1]?.stars : undefined
    const derive = (full: string): Pick<Hit, 'rank' | 'cutoff'> => {
      const rank = rankOf.get(full)
      return { ...(rank !== undefined ? { rank } : {}), ...(cutoff !== undefined ? { cutoff } : {}) }
    }

    // 名次语义通用 OR 链(16 语描述一键覆盖;键为静态常量,字面拼接最稳)
    const like = `%${escLike(isExact ? q.split('/')[1].slice(0, 30) : q)}%`
    const LIKE_ALL = sql`(
      payload->>'en' ILIKE ${like} OR payload->>'zh' ILIKE ${like} OR payload->>'zh-TW' ILIKE ${like} OR
      payload->>'ja' ILIKE ${like} OR payload->>'ko' ILIKE ${like} OR payload->>'de' ILIKE ${like} OR
      payload->>'fr' ILIKE ${like} OR payload->>'es' ILIKE ${like} OR payload->>'pt' ILIKE ${like} OR
      payload->>'it' ILIKE ${like} OR payload->>'ru' ILIKE ${like} OR payload->>'uk' ILIKE ${like} OR
      payload->>'pl' ILIKE ${like} OR payload->>'tr' ILIKE ${like} OR payload->>'vi' ILIKE ${like} OR
      payload->>'id' ILIKE ${like}
    )`

    if (isExact) {
      const rows = await sql<{ payload: Record<string, unknown> }[]>`
        SELECT payload FROM repo_desc WHERE full_name = ${q}`
      const descPayload = (rows[0]?.payload ?? {}) as Record<string, unknown>
      let hit: Hit = { fullName: q, ...derive(q), desc: descPayload as Record<string, string> }

      if (typeof descPayload.stars !== 'number') {
        const gh = await ghRepo(q)
        if (gh) {
          const patch: Record<string, unknown> = {
            stars: gh.stars,
            forks: gh.forks,
            ...(gh.pushedAt ? { pushed_at: gh.pushedAt } : {}),
            ...(gh.desc ? { __gh: gh.desc } : {}),
          }
          await sql`
            INSERT INTO repo_desc (full_name, payload) VALUES (${q}, ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])})
            ON CONFLICT (full_name) DO UPDATE SET
              payload = repo_desc.payload || ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])}, updated_at = now()`
          hit = { ...hit, stars: gh.stars, forks: gh.forks, pushedAt: gh.pushedAt, desc: { ...descPayload, ...(gh.desc ? { __gh: gh.desc } : {}) } as Record<string, string> }
        } else if (!rows.length) {
          // Neither known in the library nor present on GitHub
          return { ok: true, kind: 'exact', results: [] as Hit[] }
        }
      } else {
        hit.stars = descPayload.stars as number
        hit.forks = typeof descPayload.forks === 'number' ? (descPayload.forks as number) : undefined
        hit.pushedAt = typeof descPayload.pushed_at === 'string' ? (descPayload.pushed_at as string) : undefined
      }

      // 顺手给 4 条库内相关(按 repo 段/描述的模糊亲缘)
      const related = await sql<{ full_name: string; payload: Record<string, unknown> }[]>`
        SELECT full_name, payload FROM repo_desc
        WHERE full_name <> ${q}
          AND (
            full_name ILIKE ${like}
            OR ${LIKE_ALL}
          )
        ORDER BY COALESCE((payload->>'stars')::numeric, -1) DESC
        LIMIT 4`
      const results: Hit[] = [hit, ...related.map((r) => {
        const p = r.payload as Record<string, unknown>
        return {
          fullName: r.full_name,
          stars: typeof p.stars === 'number' ? (p.stars as number) : undefined,
          forks: typeof p.forks === 'number' ? (p.forks as number) : undefined,
          pushedAt: typeof p.pushed_at === 'string' ? (p.pushed_at as string) : undefined,
          desc: p as Record<string, string>,
          ...derive(r.full_name),
        } satisfies Hit
      })]
      return { ok: true, kind: 'exact', results }
    }

    // 关键词:自家库的描述/仓全名里捞(like 已是全串)
    const rows = await sql<{ full_name: string; payload: Record<string, unknown> }[]>`
      SELECT full_name, payload FROM repo_desc
      WHERE full_name ILIKE ${like}
        OR ${LIKE_ALL}
      ORDER BY COALESCE((payload->>'stars')::numeric, -1) DESC
      LIMIT 8`
    const results: Hit[] = rows.map((r) => {
      const p = r.payload as Record<string, unknown>
      return {
        fullName: r.full_name,
        stars: typeof p.stars === 'number' ? (p.stars as number) : undefined,
        forks: typeof p.forks === 'number' ? (p.forks as number) : undefined,
        pushedAt: typeof p.pushed_at === 'string' ? (p.pushed_at as string) : undefined,
        desc: p as Record<string, string>,
        ...derive(r.full_name),
      } satisfies Hit
    })
    return { ok: true, kind: 'keyword', results }
  })

  if (!data) return NextResponse.json({ ok: false, reason: 'db' }, { status: 503 })
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } })
}
