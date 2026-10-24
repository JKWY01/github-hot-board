import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { getBoardDataCached } from '@/lib/boards'
import { getDict, isLocale } from './dictionaries'
import { LOCALES, altLangs } from '@/lib/locales'
import type { Locale } from '@/lib/types'
import BoardStream from '@/components/BoardStream'
import Reveal from '@/components/Reveal'
import { fmtNum } from '@/lib/format'
import { guideFor } from '@/lib/guide'
import { jsonLdScript } from '@/lib/jsonld'

/** 页内 BoardStream 用 after() 挂描述补齐,给它留出执行时间(Vercel 按平台上限取小)。 */
export const maxDuration = 60

export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
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
      languages: altLangs(''),
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
              prefetch={false}
              className="inline-flex items-center rounded-full bg-accent px-6 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              {dict.boards.weekly.name}
            </Link>
            <Link
              href={`/${locale}/boards/overall`}
              prefetch={false}
              className="inline-flex items-center rounded-full border-[0.5px] border-black/15 bg-white px-6 py-3 text-[14px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              {dict.boards.overall.name}
            </Link>
          </div>
        </div>

        {/* 实时统计 —— 不包 Suspense(流式洞在 tab 隐藏/可见切换后回放会炸 #412,见 board-view 同注) */}
        <div className="rise mt-14" style={{ '--rise-delay': '380ms' } as React.CSSProperties}>
          <HeroStats locale={locale} />
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
                prefetch={false}
                className="text-[13.5px] font-medium text-accent-strong transition-opacity hover:opacity-75"
              >
                {dict.ui.viewAll} &rarr;
              </Link>
            </div>
            {/* 不包 Suspense:阻塞渲染,避免流式洞的 tab 恢复回放炸 #412 */}
            <BoardStream slug="weekly" locale={locale} compact limit={6} />
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
              prefetch={false}
              className="text-[13.5px] font-medium text-accent-strong transition-opacity hover:opacity-75"
            >
              {dict.ui.viewAll} &rarr;
            </Link>
          </div>
          <BoardStream slug="overall" locale={locale} compact limit={6} />
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
                prefetch={false}
                className="text-[13.5px] font-medium text-accent-strong transition-opacity hover:opacity-75"
              >
                {dict.ui.viewAll} &rarr;
              </Link>
            </div>
            <BoardStream slug="milestone" locale={locale} compact limit={6} />
          </div>
        </section>
      </Reveal>

      {/* SEO 价值块:信息差/找项目/赚钱 的可见正文落点(所有语言都有) */}
      <Reveal>
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
          <div className="max-w-xl">
            <p className="kicker">INFORMATION EDGE</p>
            <h2 className="section-title mt-1.5">{dict.home.valueTitle}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-sub">{dict.home.valueSub}</p>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { t: dict.home.brickOneTitle, d: dict.home.brickOneDesc },
              { t: dict.home.brickTwoTitle, d: dict.home.brickTwoDesc },
              { t: dict.home.brickThreeTitle, d: dict.home.brickThreeDesc },
            ].map((brick, i) => (
              <li key={i} className="h-full rounded-[22px] border-[0.5px] border-black/10 bg-white p-6">
                <h3 className="text-[16px] font-semibold tracking-tight text-ink">{brick.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-sub">{brick.d}</p>
              </li>
            ))}
          </ul>
        </section>
      </Reveal>

      {/* 榜单总览 */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6">
        <div className="max-w-xl">
          <p className="kicker">{dict.home.boardsKicker}</p>
          <h2 className="section-title mt-1.5">{dict.home.boardsTitle}</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-sub">{dict.home.boardsSub}</p>
          <p className="mt-3">
            <Link
              href={`/${locale}/guide`}
              prefetch={false}
              className="text-[13.5px] font-medium text-accent-strong transition-opacity hover:opacity-75"
            >
              {guideFor(lang).homeCta} &rarr;
            </Link>
          </p>
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
              <li key={board.key} className="h-full">
                <Reveal delay={(index % 3) * 60} className="h-full">
                  <Link
                    href={`/${locale}/boards/${board.slug}`}
                    prefetch={false}
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
                </Reveal>
              </li>
            ))}
        </ul>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
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

async function HeroStats({ locale }: { locale: Locale }) {
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
    // 后缀不硬编码:榜面规模随口径走,字典文案里已含"300"语义,避免再出现 Top 100/300 分歧
    { label: dict.home.heroStatStars, value: statA },
    { label: dict.home.heroStatRepos, value: statB },
    { label: dict.home.heroStatDaily, value: statC },
  ]

  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col-reverse rounded-[22px] border-[0.5px] border-black/10 bg-white px-6 py-5 text-center"
        >
          {/* 语义顺序 dt→dd;flex-col-reverse 让视觉保持数值在上 */}
          <dt className="mt-1 text-[12.5px] text-sub">{stat.label}</dt>
          <dd className="text-[26px] font-semibold tracking-tight tabular-nums text-ink">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
