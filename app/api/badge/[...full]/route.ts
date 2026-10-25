import { badgeInfoOf, buildBadgeSvg } from '@/lib/badge'
import { readRepoArchiveRows } from '@/lib/snapshot'
import { isRepoFullName } from '@/lib/reposhape'

/** 仓库上榜徽章:GET /api/badge/{owner}/{repo}(.svg 后缀可有可无,README 里带后缀更直观)。
 *  数据与档案页同源(board_snapshots 最近一拍 + 3 天现役口径),读不到库 → "未上榜"灰章,
 *  绝不 5xx —— 作者 README 里的图挂了比灰章难看得多。
 *  CDN 缓存 10 分钟,与同步节奏(6 小时)同数量级。 */

const SVG_HEADERS = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'cache-control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=1800',
} as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ full: string[] }> },
): Promise<Response> {
  const { full } = await params
  // /api/badge/owner/repo.svg 与 /api/badge/owner/repo 等价:末段 .svg 后缀剥掉再查
  const segs = [...(full ?? [])]
  const last = segs.length - 1
  if (last >= 0 && segs[last].length > 4 && segs[last].endsWith('.svg')) {
    segs[last] = segs[last].slice(0, -4)
  }
  const raw = segs.join('/')
  if (!isRepoFullName(raw)) {
    return new Response(buildBadgeSvg({ state: 'none' }), { headers: SVG_HEADERS })
  }
  const { appearances } = await readRepoArchiveRows(raw).catch(() => ({ appearances: [], daily: [], lastSeenAt: null }))
  return new Response(buildBadgeSvg(badgeInfoOf(appearances)), { headers: SVG_HEADERS })
}
