import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/snapshot'
import { ghRepo } from '@/lib/ghrepo'
import { clientIpOf, slidingWindow } from '@/lib/ratelimit'
import { isRepoFullName } from '@/lib/reposhape'
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
  /** 站内是否有档案:无档案的行名链回落 GitHub(站内档案页对未上榜仓库是诚实 404) */
  onBoard?: boolean
}

// 每 IP 滑窗限流:20 只一次请求,窗口放宽到 30/min(共享实现,带条目修剪)
const WINDOW_MS = 60_000
const PER_WINDOW = 30
const rate = slidingWindow()

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const raw = (url.searchParams.get('fulls') ?? '').slice(0, 2400)
  const fulls = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(isRepoFullName),
    ),
  ).slice(0, 20)
  const ip = clientIpOf(req)
  if (fulls.length === 0) return NextResponse.json({ ok: false, reason: 'empty' }, { status: 400 })
  if (!rate.allow(ip, PER_WINDOW, WINDOW_MS)) return NextResponse.json({ ok: false, reason: 'rate' }, { status: 429 })

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
    // 档案存在性标注:关注列表里的仓库未必上过榜;无档案的行前端回落 GitHub 外链
    const names = items.map((it) => it.fullName)
    if (names.length > 0) {
      const seenRows = await sql`SELECT repo FROM repo_seen WHERE repo = ANY(${names})`
      const seen = new Set((seenRows as unknown as Array<{ repo: string }>).map((r) => r.repo))
      for (const it of items) it.onBoard = seen.has(it.fullName)
    }
    return { ok: true, items }
  })

  if (!data) return NextResponse.json({ ok: false, reason: 'db' }, { status: 503 })
  return NextResponse.json(data, {
    headers: { 'cache-control': 's-maxage=120, stale-while-revalidate=600' },
  })
}
