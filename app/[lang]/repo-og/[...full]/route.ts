import { getRepoArchiveCached } from '@/lib/repoarchive'
import { isRepoFullName } from '@/lib/reposhape'
import { ogShell } from '@/lib/og'

/** 仓库档案页 OG 分享图(catch-all 路由不允许再挂 opengraph-image 文件,故走普通路由;
 * 档案页 metadata 显式指向这里)。星数 + 最好名次 —— 档案页是 SEO 主战场,
 * 分享到 Telegram/X 不该是一行光秃标题。数据走档案页同源的 'use cache'。 */

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lang: string; full: string[] }> },
): Promise<Response> {
  const { full } = await params
  const fullName = full?.length === 2 ? `${full[0]}/${full[1]}` : ''

  let image: ReturnType<typeof ogShell>
  if (!isRepoFullName(fullName)) {
    image = ogShell({
      title: 'GITHUB',
      accent: 'HOT BOARD',
      sub: 'Live leaderboards for open source.',
      chips: [],
    })
  } else {
    const archive = await getRepoArchiveCached(fullName)
    if (!archive) {
      image = ogShell({
        title: fullName.slice(0, 34),
        accent: 'ARCHIVE',
        sub: 'Ranked archives with 30-day momentum on GitHub Hot Board.',
        chips: ['git.vaiox.xyz'],
      })
    } else {
      // 最好名次:现役基准口径优先(与页面名牌同语义)
      const current = archive.appearances.filter((a) => a.current)
      const pool = current.length > 0 ? current : archive.appearances
      const best = pool.reduce((m, a) => (a.rank < m.rank ? a : m), pool[0])
      image = ogShell({
        title: fullName.slice(0, 30),
        accent: archive.totalStars != null ? `${compact.format(archive.totalStars)} STARS` : 'ARCHIVE',
        sub: `Ranked archive with 30-day momentum${best ? ` · best #${best.rank}` : ''} on GitHub Hot Board.`,
        chips: [
          ...(archive.totalStars != null ? [`${compact.format(archive.totalStars)} STARS`] : []),
          ...(best ? [`BEST #${best.rank}`] : []),
          'git.vaiox.xyz',
        ],
      })
    }
  }

  const png = await image.arrayBuffer()
  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      'x-robots-tag': 'noindex',
    },
  })
}
