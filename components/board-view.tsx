import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { BOARD_META, BOARD_ORDER, FACET_LANGUAGES, facetDisplay, isBoardSlug, facetLangSlug, type BoardSlug } from '@/lib/boards'
import { getDict, isLocale, type BoardCopy } from '@/app/[lang]/dictionaries'
import { jsonLdScript } from '@/lib/jsonld'
import { altLangs } from '@/lib/locales'
import type { Locale } from '@/lib/types'
import BoardStream from '@/components/BoardStream'
import MoversStrip from '@/components/movers-strip'
import PendingChip from '@/components/PendingChip'

export default async function BoardPageView({
  lang,
  slug,
  language,
}: {
  lang: string
  slug: BoardSlug
  language?: string
}) {
  if (!isLocale(lang)) notFound()
  if (!isBoardSlug(slug)) notFound()
  const meta = BOARD_META[slug]
  if (language && !meta.facets) notFound()

  const dict = getDict(lang)
  const copy = dict.boards[slug]
  const dictMeta = dict.meta

  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 pb-10 pt-14 sm:px-6 sm:pt-20">
        <p className="kicker">{dictMeta.siteName}</p>
        <h1 className="hero-title mt-2">
          {copy.name}
          {language && <span className="text-sub"> · {facetDisplay(language)}</span>}
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-sub">{copy.tagline}</p>

        {meta.facets && (
          <nav aria-label={dict.ui.language} className="no-scrollbar mt-6 flex items-center gap-2 overflow-x-auto">
            <PendingChip href={`/${lang}/boards/${slug}`} active={!language}>
              {dict.ui.allLanguages}
            </PendingChip>
            {FACET_LANGUAGES.map((facet) => (
              <PendingChip key={facet} href={`/${lang}/boards/${slug}/${facetLangSlug(facet)}`} active={language === facet}>
                {facetDisplay(facet)}
              </PendingChip>
            ))}
          </nav>
        )}
      </section>

      {/* 不包 Suspense:流式洞在"切 tab 隐藏→切回"时会走 React 恢复回放,
          上游 #97337 让连接提前判死,直接炸成 #412 灰页(反复复现实锤)。
          数据走 'use cache'(编译期烘焙 + stale 300),整页阻塞渲染,安全且差不多快。 */}
      <section className="bg-surface py-10">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          {!language && <MoversStrip slug={slug} locale={lang} />}
          <BoardStream slug={slug} locale={lang} language={language} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="grid gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <h2 className="section-title">{dict.ui.definition}</h2>
            <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink/80">{copy.desc}</p>
            <ul className="mt-5 space-y-1.5 text-[13px] text-sub">
              <li>{dict.ui.sourceGithubSearch} / {dict.ui.sourceGithubTrending}</li>
              <li>{dict.ui.autoRefresh} · {dict.ui.dataUpdated}</li>
            </ul>
          </div>
          <div>
            <h2 className="text-[15px] font-semibold uppercase tracking-[0.14em] text-sub">{dict.ui.openQuestions}</h2>
            <div className="mt-4 space-y-5">
              {copy.faqs.map((faq) => (
                <div key={faq.q}>
                  <h3 className="text-[15px] font-semibold text-ink">{faq.q}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink/70">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-sub">{dict.ui.inlinks}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          <li key="history">
            <Link
              href={`/${lang}/history/${slug}`}
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-full border-[0.5px] border-black/10 bg-white px-3.5 py-2 text-[13px] font-medium text-ink/80 transition-colors hover:border-accent/40 hover:text-accent"
            >
              {dict.history.title} · {dict.shortBoards[slug]}
            </Link>
          </li>
          {BOARD_ORDER.filter((next) => next !== slug).map((next) => (
            <li key={next}>
              <Link
                href={`/${lang}/boards/${next}`}
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-full border-[0.5px] border-black/10 bg-white px-3.5 py-2 text-[13px] font-medium text-ink/80 transition-colors hover:border-accent/40 hover:text-accent"
              >
                {dict.shortBoards[next]}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(faqJsonLd(lang, slug, language, copy)),
        }}
      />
    </div>
  )
}

function faqJsonLd(
  lang: string,
  slug: BoardSlug,
  language: string | undefined,
  copy: BoardCopy,
) {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const path = language ? `/${lang}/boards/${slug}/${facetLangSlug(language)}` : `/${lang}/boards/${slug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${base}${path}#faq`,
    inLanguage: lang,
    mainEntity: copy.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  }
}

export function BoardSkeleton({ compact = false }: { compact?: boolean }) {
  const rows = compact ? 5 : 10
  return (
    <ul className="card list-none overflow-hidden" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 px-4 sm:px-5"
          style={{ paddingBlock: compact ? 14 : 20 }}
        >
          <div className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-black/6" />
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-[10px] bg-black/8" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded bg-black/8" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded bg-black/5" />
          </div>
          <div className="h-5 w-16 shrink-0 animate-pulse rounded bg-black/6" />
        </li>
      ))}
    </ul>
  )
}

/** 英文元标题的搜索意图增援(仅 metadata,UI/H1 一字不动):
 * "Weekly Surge" 对进站者够用,对搜索者是黑话——补上 GitHub Trending 本尊词。 */
const EN_TITLE_BOOST: Partial<Record<BoardSlug, string>> = {
  overall: 'GitHub Trending Overall',
  weekly: 'GitHub Trending This Week',
  monthly: 'GitHub Trending This Month',
  annual: 'GitHub New Stars This Year',
  rising: 'Fastest-Growing GitHub Repos',
  dark: 'Dark-Horse GitHub Projects',
  overlooked: 'Underrated GitHub Repos',
  controversial: 'GitHub Forks & Issues Index',
  forks: 'Most-Forked GitHub Repos',
  milestone: 'GitHub Star Milestones',
}

export function boardTitle(lang: string, slug: BoardSlug, language?: string): string {
  if (!isLocale(lang)) return ''
  const dict = getDict(lang)
  const copy = dict.boards[slug]
  const boost = lang === 'en' ? EN_TITLE_BOOST[slug] : undefined
  return language
    ? `${copy.name} · ${facetDisplay(language)}${boost ? ` · ${boost}` : ''}`
    : `${copy.name}${boost ? ` · ${boost}` : ''}`
}

export function boardMetadata(
  lang: Locale,
  slug: BoardSlug,
  language?: string,
): Metadata {
  const dict = getDict(lang)
  const copy = dict.boards[slug]
  const localePath = (locale: string) =>
    `/${locale}/boards/${slug}${language ? `/${facetLangSlug(language)}` : ''}`
  const title = boardTitle(lang, slug, language)
  return {
    title,
    description: copy.desc,
    alternates: {
      canonical: localePath(lang),
      languages: altLangs(`/boards/${slug}${language ? `/${facetLangSlug(language)}` : ''}`),
    },
    openGraph: {
      title,
      description: copy.tagline,
      url: localePath(lang),
      siteName: dict.meta.siteName,
      type: 'website',
      locale: lang,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: copy.tagline,
    },
    robots: { index: true, follow: true },
  }
}
