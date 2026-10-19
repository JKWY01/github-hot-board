import Link from 'next/link'

import { isLocale, getDict } from '@/app/[lang]/dictionaries'
import { isBoardSlug } from '@/lib/boards'
import type { HistoryDay, HistorySnapshot } from '@/lib/snapshot'
import { GithubIcon } from './Icons'

const nf = (n: number) => new Intl.NumberFormat('en-US', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)

function fmtTime(iso: string, lang: string): string {
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(iso))
}

function fmtDay(iso: string, lang: string): string {
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

/** 往日榜视图:历史拍是纯快照 — 无轮询、无 FLIP、零客户端脚本(服务端直出)。 */
export function HistoryView({
  lang,
  slug,
  days,
  snapshot,
  activeDay,
}: {
  lang: string
  slug: string
  days: HistoryDay[]
  snapshot: HistorySnapshot | null
  activeDay: string
}) {
  if (!isLocale(lang) || !isBoardSlug(slug)) return null
  const dict = getDict(lang)
  const h = dict.history
  const copy = dict.boards[slug]

  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 pb-8 pt-14 sm:px-6 sm:pt-20">
        <p className="kicker">{dict.meta.siteName}</p>
        <h1 className="mt-3 text-4xl font-black leading-[1.08] tracking-tight text-ink sm:text-5xl">
          {h.title} · <span className="text-sub">{copy.name}</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink/70">{h.subtitle}</p>

        <div className="mt-6 flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-ink/55">{h.pickDate}:</span>
          {days.length === 0 ? (
            <span className="text-ink/45">{h.accumulating}</span>
          ) : (
            days.map((d) => {
              const active = d.day === activeDay
              return (
                <Link
                  key={d.day}
                  href={`/${lang}/history/${slug}/${d.day}`}
                  aria-current={active ? 'true' : undefined}
                  className={`rounded-full px-3 py-1.5 transition-colors ${
                    active ? 'bg-ink font-semibold text-white ring-[0.5px] ring-black/25' : 'font-medium text-ink/70 hover:bg-black/8 hover:text-ink'
                  }`}
                >
                  {fmtDay(d.day, lang)}
                  {d.day === days[0]?.day ? <span className="ml-1 text-[10.5px] opacity-70">{h.latest}</span> : null}
                </Link>
              )
            })
          )}
        </div>
      </section>

      <section className="bg-surface py-10">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          {!snapshot ? (
            <p className="py-16 text-center text-[15px] text-ink/55">{h.empty}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink/55">
                <span>
                  {fmtDay(activeDay, lang)} · {fmtTime(snapshot.takenAt, lang)} {dict.ui.dataUpdated}
                </span>
                <span>
                  {h.sourceLabel}: {snapshot.source === 'github-trending' ? dict.ui.sourceGithubTrending : dict.ui.sourceGithubSearch}
                  {snapshot.degraded ? ` · ${h.degradedNote}` : ''}
                </span>
                <span>{days.length} {h.daysCount}</span>
              </div>

              <ul className="card mt-5 list-none overflow-hidden">
                {snapshot.rows.map((r) => (
                  <li key={r.rank} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                    <span className="tabular-nums text-[13px] font-semibold text-ink/40">{String(r.rank).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {r.repo}
                        </span>
                        <a
                          href={`https://github.com/${r.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`GitHub · ${r.repo}`}
                          className="shrink-0 text-ink/28 transition-colors hover:text-accent"
                        >
                          <GithubIcon size={12} />
                        </a>
                      </div>
                      <span className="text-[12px] text-ink/50">
                        ★ {nf(r.stars)} · {dict.ui.forks} {nf(r.forks)}
                      </span>
                    </div>
                    <span className="tabular-nums text-[13px] text-ink/70">
                      {h.metricLabel} {nf(Math.round(r.metric * 10) / 10)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12.5px] leading-relaxed text-ink/45">{h.note}</p>
              <p className="mt-6">
                <Link href={`/${lang}/boards/${slug}`} className="text-[13px] font-medium text-accent-strong hover:underline">
                  ← {h.backToBoard}
                </Link>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
