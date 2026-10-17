import Link from 'next/link'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { getBoardDataCached } from '@/lib/boards'
import { getDict, isLocale } from './dictionaries'
import BoardStream from '@/components/BoardStream'
import { BoardSkeleton } from '@/components/board-view'
import Reveal from '@/components/Reveal'
import { fmtNum } from '@/lib/format'

// build 期 use cache fill 与 GitHub 配额节流协同：允许单页生成最长 4 分钟
export const staticPageGenerationTimeout = 240

export async function generateStaticParams() {
  return [{ lang: 'zh' }, { lang: 'en' }]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  const dict = getDict(lang)
  return {
    description: dict.meta.homeDescription,
    keywords: dict.meta.homeKeywords.split('，').map((part) => part.trim()).filter(Boolean),
    alternates: {
      canonical: `/${lang}`,
      languages: { zh: '/zh', en: '/en', 'x-default': '/en' },
    },
    openGraph: {
      type: 'website',
      url: `/${lang}`,
      siteName: dict.meta.siteName,
      description: dict.meta.homeDescription,
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  const dict = getDict(lang)
  const locale = dict.locale

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-8 pt-16 sm:px-6 sm:pt-24">
        <div style={{ textAlign: 'center' }}>
          <p className="kicker rise" style={{ '--rise-delay': '40ms' } as React.CSSProperties}>
            {dict.home.heroKicker}
          </p>
          <h1 className="hero-title rise mt-3" style={{ '--rise-delay': '120ms' } as React.CSSProperties}>
            {dict.home.heroTitleTop}
            <span className="gradient-text">{dict.home.heroTitleGradient}</span>
          </h1>
          <p
            className="rise mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-sub"
            style={{ '--rise-delay': '220ms' } as React.CSSProperties}
          >
            {dict.home.heroSub}
          </p>
          <div
            className="rise mt-8 flex flex-wrap items-center justify-center gap-3"
            style={{ '--rise-delay': '300ms' } as React.CSSProperties}
          >
            <Link
              href={`/${locale}/boards/weekly`}
              className="inline-flex items-center rounded-full bg-accent px-6 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              {dict.boards.weekly.name}
            </Link>
            <Link
              href={`/${locale}/boards/overall`}
              className="inline-flex items-center rounded-full border-[0.5px] border-black/15 bg-white px-6 py-3 text-[14px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              {dict.boards.overall.name}
            </Link>
          </div>
        </div>

        {/* 实时统计 */}
        <div className="rise mt-14" style={{ '--rise-delay': '380ms' } as React.CSSProperties}>
          <Suspense fallback={<HeroSkeleton />}>
            <HeroStats locale={locale} />
          </Suspense>
        </div>
      </section>

      {/* 周榜速览 */}
      <Reveal>
        <section className="bg-surface py-14">
          <div className="mx-auto max-w-6xl px-5 sm:px-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="kicker">{dict.home.weeklySectionKicker}</p>
                <h2 className="section-title mt-1.5">{dict.home.weeklySectionTitle}</h2>
              </div>
              <Link
                href={`/${locale}/boards/weekly`}
                className="text-[13.5px] font-medium text-accent transition-opacity hover:opacity-75"
              >
                {dict.ui.viewAll} &rarr;
              </Link>
            </div>
            <Suspense fallback={<BoardSkeleton compact />}>
              <BoardStream slug="weekly" locale={locale} compact limit={6} />
            </Suspense>
          </div>
        </section>
      </Reveal>

      {/* 总榜速览 */}
      <Reveal>
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="kicker">ALL-TIME CHAMPIONS</p>
              <h2 className="section-title mt-1.5">{dict.shortBoards.overall} · {dict.ui.definition}</h2>
            </div>
            <Link
              href={`/${locale}/boards/overall`}
              className="text-[13.5px] font-medium text-accent transition-opacity hover:opacity-75"
            >
              {dict.ui.viewAll} &rarr;
            </Link>
          </div>
          <Suspense fallback={<BoardSkeleton compact />}>
            <BoardStream slug="overall" locale={locale} compact limit={6} />
          </Suspense>
        </section>
      </Reveal>

      {/* 里程碑直播 */}
      <Reveal>
        <section className="bg-surface py-14">
          <div className="mx-auto max-w-6xl px-5 sm:px-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="kicker">{dict.home.milestoneSectionKicker}</p>
                <h2 className="section-title mt-1.5">{dict.home.milestoneSectionTitle}</h2>
                <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-sub">
                  {dict.home.milestoneSectionSub}
                </p>
              </div>
              <Link
                href={`/${locale}/boards/milestone`}
                className="text-[13.5px] font-medium text-accent transition-opacity hover:opacity-75"
              >
                {dict.ui.viewAll} &rarr;
              </Link>
            </div>
            <Suspense fallback={<BoardSkeleton compact />}>
              <BoardStream slug="milestone" locale={locale} compact limit={6} />
            </Suspense>
          </div>
        </section>
      </Reveal>

      {/* 榜单总览 */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6">
        <div className="max-w-xl">
          <p className="kicker">{dict.home.boardsKicker}</p>
          <h2 className="section-title mt-1.5">{dict.home.boardsTitle}</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-sub">{dict.home.boardsSub}</p>
        </div>

        <ul className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([] as Array<{ key: string; num: number; slug: string; name: string; tagline: string; metric: string }>)
            .concat(
              (Object.keys(dict.boards) as Array<keyof typeof dict.boards>).map((slug, index) => ({
                key: slug,
                num: index + 1,
                slug,
                name: dict.boards[slug].name,
                tagline: dict.boards[slug].tagline,
                metric: dict.boards[slug].metricLabel,
              })),
            )
            .map((board, index) => (
              <Reveal key={board.key} delay={(index % 3) * 60}>
                <li>
                  <Link
                    href={`/${locale}/boards/${board.slug}`}
                    className="group flex h-full flex-col justify-between rounded-[22px] border-[0.5px] border-black/10 bg-white p-6 transition-shadow hover:shadow-[0_10px_36px_rgba(0,0,0,0.08)]"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold tabular-nums text-sub">
                          {String(board.num).padStart(2, '0')}
                        </span>
                        <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-ink/70">
                          {board.metric}
                        </span>
                      </div>
                      <h3 className="mt-3 text-[17px] font-semibold tracking-tight text-ink group-hover:text-accent">
                        {board.name}
                      </h3>
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-sub">{board.tagline}</p>
                    </div>
                    <span className="mt-5 text-[13px] font-medium text-accent">{dict.home.viewBoard} &rarr;</span>
                  </Link>
                </li>
              </Reveal>
            ))}
        </ul>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: dict.meta.siteName,
            url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/${lang}`,
            inLanguage: lang,
            description: dict.meta.homeDescription,
          }),
        }}
      />
    </div>
  )
}

async function HeroStats({ locale }: { locale: 'zh' | 'en' }) {
  const dict = getDict(locale)
  let statA = '—'
  let statB = '—'
  let statC = '—'
  try {
    const [overall, weekly, milestone] = await Promise.all([
      getBoardDataCached('overall'),
      getBoardDataCached('weekly').catch(() => null),
      getBoardDataCached('milestone').catch(() => null),
    ])
    if (overall.items.length > 0) {
      const lifetime = overall.items.reduce((sum, item) => sum + item.stars, 0)
      statA = fmtNum(lifetime, locale)
      statB = fmtNum(overall.items[overall.items.length - 1]?.stars ?? 0, locale)
    }
    if (weekly && !weekly.error && weekly.items.length > 0) {
      const gainedSum = weekly.items.reduce((sum, item) => sum + (item.gained ?? 0), 0)
      statC = `+${fmtNum(gainedSum, locale)}`
    } else if (milestone && !milestone.error && milestone.items.length > 0) {
      statC = `+${fmtNum(milestone.items.length, locale)}`
    }
  } catch {
    // 数据不可用时显示占位
  }

  const stats = [
    { label: `${dict.home.heroStatStars} · Top 300`, value: statA },
    { label: `${dict.home.heroStatRepos} · Top 100`, value: statB },
    { label: dict.home.heroStatDaily, value: statC },
  ]

  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-[22px] border-[0.5px] border-black/10 bg-white px-6 py-5 text-center"
        >
          <dd className="text-[26px] font-semibold tracking-tight tabular-nums text-ink">
            {stat.value}
          </dd>
          <dt className="mt-1 text-[12.5px] text-sub">{stat.label}</dt>
        </div>
      ))}
    </dl>
  )
}

function HeroSkeleton() {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-[22px] border-[0.5px] border-black/10 bg-white px-6 py-6">
          <div className="h-7 w-20 animate-pulse rounded bg-black/8" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-black/5" />
        </div>
      ))}
    </dl>
  )
}
