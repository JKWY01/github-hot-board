import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/snapshot'
import { ghRepo } from '@/lib/ghrepo'
import type { BoardItem } from '@/lib/types'

/** 关注状态批量查询:关注页每行一个"现查的新鲜快照"。
 *  复用 search 的采集哲学:core API 直查(便宜)+ repo_desc 写回(
 *  星数以当次为准,回落行只当描述底料与 keyword 命中入口)。
 *  名次语义 v1 只挂总榜语境(在榜 #N / 300+ / 300+?)。 */

export interface WatchStatus {
  fullName: string
  stars?: number
  forks?: number
  pushedAt?: string
  desc?: Record<string, string>
  rank?: number
  cutoff?: number
  missing?: boolean
}

const FULL_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,120}$/

// 每 IP 滑窗限流:20 只一次请求,窗口放宽到 30/min
const WINDOW_MS = 60_000
const PER_WINDOW = 30
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const raw = (url.searchParams.get('fulls') ?? '').slice(0, 2400)
  const fulls = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => FULL_RE.test(s)),
    ),
  ).slice(0, 20)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (fulls.length === 0) return NextResponse.json({ ok: false, reason: 'empty' }, { status: 400 })
  if (throttled(ip)) return NextResponse.json({ ok: false, reason: 'rate' }, { status: 429 })

  const data = await withDb(async (sql): Promise<{ ok: boolean; items: WatchStatus[] }> => {
    // 总榜名次图与门槛(一次查询,全列表共用)
    const headRows = await sql<{ payload: unknown }[]>`
      SELECT payload FROM board_head WHERE board = 'overall' AND language = '' LIMIT 1`
    const headItems: BoardItem[] = Array.isArray((headRows[0]?.payload as { items?: BoardItem[] })?.items)
      ? ((headRows[0].payload as { items: BoardItem[] }).items as BoardItem[])
      : []
    const rankOf = new Map<string, number>()
    headItems.forEach((it, i) => rankOf.set(it.fullName, i + 1))
    const cutoff = headItems.length ? headItems[headItems.length - 1]?.stars : undefined

    const items: WatchStatus[] = []
    const settled = await Promise.allSettled(
      fulls.map(async (full) => {
        const rows = await sql<{ payload: Record<string, unknown> }[]>`
          SELECT payload FROM repo_desc WHERE full_name = ${full}`
        const descPayload = (rows[0]?.payload ?? {}) as Record<string, unknown>
        const gh = await ghRepo(full)
        if (gh) {
          const patch: Record<string, unknown> = {
            stars: gh.stars,
            forks: gh.forks,
            ...(gh.pushedAt ? { pushed_at: gh.pushedAt } : {}),
            ...(gh.desc ? { __gh: gh.desc } : {}),
          }
          await sql`
            INSERT INTO repo_desc (full_name, payload) VALUES (${full}, ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])})
            ON CONFLICT (full_name) DO UPDATE SET
              payload = repo_desc.payload || ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])}, updated_at = now()`
          return {
            fullName: full,
            stars: gh.stars,
            forks: gh.forks,
            pushedAt: gh.pushedAt,
            desc: { ...descPayload, ...(gh.desc ? { __gh: gh.desc } : {}) } as Record<string, string>,
            ...(rankOf.has(full) ? { rank: rankOf.get(full) } : {}),
            ...(cutoff !== undefined ? { cutoff } : {}),
          } satisfies WatchStatus
        }
        if (rows.length) {
          // GitHub 抖动/限流但库里有旧行:拿缓存顶上,不标 missing(数据可用)
          return {
            fullName: full,
            stars: typeof descPayload.stars === 'number' ? (descPayload.stars as number) : undefined,
            forks: typeof descPayload.forks === 'number' ? (descPayload.forks as number) : undefined,
            pushedAt: typeof descPayload.pushed_at === 'string' ? (descPayload.pushed_at as string) : undefined,
            desc: descPayload as Record<string, string>,
            ...(rankOf.has(full) ? { rank: rankOf.get(full) } : {}),
            ...(cutoff !== undefined ? { cutoff } : {}),
          } satisfies WatchStatus
        }
        return { fullName: full, missing: true, ...(cutoff !== undefined ? { cutoff } : {}) } satisfies WatchStatus
      }),
    )
    for (const r of settled) if (r.status === 'fulfilled') items.push(r.value)
    return { ok: true, items }
  })

  if (!data) return NextResponse.json({ ok: false, reason: 'db' }, { status: 503 })
  return NextResponse.json(data, {
    headers: { 'cache-control': 's-maxage=120, stale-while-revalidate=600' },
  })
}
