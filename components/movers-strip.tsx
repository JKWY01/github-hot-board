import Link from 'next/link'
import { ArrowDownIcon, ArrowUpIcon } from './Icons'
import { fmtNum } from '@/lib/format'
import { liveStrings } from '@/app/[lang]/dictionaries'
import { fetchMovers24h, type Mover } from '@/lib/movers'
import type { Locale } from '@/lib/types'

/** 24h 爬动榜:榜头部一行条栏,数据来自 lib/movers 的快照对账。 */

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
