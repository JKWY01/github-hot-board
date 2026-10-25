import { clientIpOf, slidingWindow } from '@/lib/ratelimit'
import { isRepoFullName } from '@/lib/reposhape'
import { readRepoArchiveRows } from '@/lib/snapshot'

/** 抽屉顶部迷你走势线的轻量数据口:近 30 天星数点列 + 现役最好名次(基准口径优先)。
 *  与档案页同源(board_snapshots),'use cache' 由调用方页面层承担,这里读路天然走库。 */
const rate = slidingWindow()

export async function GET(request: Request) {
  if (!rate.allow(clientIpOf(request), 20, 60_000)) {
    return Response.json({ ok: false, reason: 'rate' }, { status: 429, headers: { 'Retry-After': '60' } })
  }
  const full = new URL(request.url).searchParams.get('full') ?? ''
  if (!isRepoFullName(full)) {
    return Response.json({ ok: false, reason: 'bad-full' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const { appearances, daily } = await readRepoArchiveRows(full)
  if (appearances.length === 0 && daily.length === 0) {
    return Response.json({ ok: true, best: null, points: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
  // 星数点:按日取最后一拍(与档案页走势同一口径)
  const byDay = new Map<string, number>()
  for (const d of daily) byDay.set(d.day, Math.max(byDay.get(d.day) ?? 0, d.stars))
  const points = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, stars]) => ({ day, stars }))
  // 最好名次:现役基准口径优先,退现役任意,再退历史
  const current = appearances.filter((a) => a.current)
  const pool = current.length > 0 ? current : appearances
  const base = pool.find((a) => a.language === '') ?? pool[0]
  const best = base ? Math.min(...pool.filter((a) => a.language === base.language || current.length === 0).map((a) => a.rank)) : null
  return Response.json(
    { ok: true, best, points },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } },
  )
}
