import { cacheLife } from 'next/cache'
import Link from 'next/link'
import { withDb } from '@/lib/snapshot'
import { ArrowDownIcon, ArrowUpIcon } from './Icons'
import { fmtNum } from '@/lib/format'
import { liveStrings } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'

/** 24h 爬动榜:我们自有快照的对账 —— 相邻拍里名次真搬过的行。
 *  相比"每 60s 假动画",这是诚实的爬坡感:数据说什么,就演什么。 */

interface Mover {
  repo: string
  was_rank: number
  now_rank: number
  climb: number
}

async function fetchMovers24h(slug: string): Promise<Mover[] | undefined> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 })
  return withDb(async (sql) =>
    sql<Mover[]>`
      WITH win AS (
        SELECT min(taken_at) AS oldest, max(taken_at) AS newest
        FROM board_snapshots
        WHERE board = ${slug} AND language = '' AND taken_at > now() - interval '24 hours'
      )
      SELECT o.repo AS repo, o.rank AS was_rank, n.rank AS now_rank, (o.rank - n.rank) AS climb
      FROM (SELECT * FROM board_snapshots, win WHERE board = ${slug} AND language = '' AND taken_at = oldest) o
      JOIN (SELECT * FROM board_snapshots, win WHERE board = ${slug} AND language = '' AND taken_at = newest) n
        ON o.repo = n.repo
      WHERE o.rank IS DISTINCT FROM n.rank
      ORDER BY climb DESC, o.rank ASC
      LIMIT 10`,
  )
}

export default async function MoversStrip({ slug, locale }: { slug: string; locale: Locale }) {
  const movers = await fetchMovers24h(slug)
  // 库凉(DB 不可用):安静退场,不占版面
  if (!movers) return null
  const strings = liveStrings(locale)
  const ups = movers.filter((m) => m.climb > 0)
  const downs = movers.filter((m) => m.climb < 0).slice(0, 4)

  if (ups.length === 0 && downs.length === 0) {
    return (
      <div className="mb-5 text-[12px] text-sub">{strings.moversEmpty}</div>
    )
  }

  return (
    <div className="mb-5 rounded-[18px] border-[0.5px] border-black/10 bg-[#fafafa] px-3.5 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sub">
          {strings.moversTitle}
        </span>
        {ups.map((m) => (
          <Link
            key={m.repo}
            href={`/${locale}/repo/${m.repo}`}
            className="inline-flex max-w-[260px] items-center gap-1 rounded-full bg-black/6 px-2.5 py-1 text-[11.5px] text-ink/80 transition-colors hover:text-ink"
          >
            <span className="truncate">{m.repo}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-good tabular-nums">
              <ArrowUpIcon size={9} />
              {m.climb > 1 ? m.climb : ''}
            </span>
          </Link>
        ))}
        {downs.map((m) => (
          <Link
            key={m.repo}
            href={`/${locale}/repo/${m.repo}`}
            className="inline-flex max-w-[260px] items-center gap-1 rounded-full bg-black/6 px-2.5 py-1 text-[11.5px] text-ink/60 transition-colors hover:text-ink"
          >
            <span className="truncate">{m.repo}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-bad tabular-nums">
              <ArrowDownIcon size={9} />
              {Math.abs(m.climb) > 1 ? Math.abs(m.climb) : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
