import { notFound } from 'next/navigation'

import { getBoardDataCached, type BoardSlug } from '@/lib/boards'
import { hydrateBoardDescs } from '@/lib/descfill'
import { RateLimitError } from '@/lib/github'
import { getDict, isLocale, liveStrings, type BoardCopy } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'
import LiveBoardList from '@/components/LiveBoardList'

interface MetricConfig {
  metric: 'stars' | 'gained' | 'slope' | 'forks' | 'score' | 'gap'
  secondary: 'none' | 'stars' | 'forks'
  showSlope?: boolean
  showIssues?: boolean
  showPushed?: boolean
  variant?: 'default' | 'milestone'
}

const METRIC_BY_BOARD: Record<BoardSlug, MetricConfig> = {
  overall: { metric: 'stars', secondary: 'forks' },
  weekly: { metric: 'gained', secondary: 'stars' },
  monthly: { metric: 'gained', secondary: 'stars' },
  annual: { metric: 'stars', secondary: 'none', showSlope: true },
  rising: { metric: 'slope', secondary: 'stars', showSlope: false, showPushed: true },
  dark: { metric: 'slope', secondary: 'stars', showPushed: true },
  overlooked: { metric: 'stars', secondary: 'none', showIssues: true, showPushed: true },
  controversial: { metric: 'score', secondary: 'none', showIssues: true },
  forks: { metric: 'forks', secondary: 'stars' },
  milestone: { metric: 'gap', secondary: 'stars', showPushed: true, variant: 'milestone' },
}

/** Suspense 洞内容：服务端取榜单数据并渲染实时列表。所有 GitHub 请求都经过 fetch Data Cache。 */
export default async function BoardStream({
  slug,
  locale,
  language,
  limit,
  compact,
}: {
  slug: BoardSlug
  locale: Locale
  language?: string
  limit?: number
  compact?: boolean
}) {
  if (!isLocale(locale)) notFound()
  const dict = getDict(locale)
  const strings = liveStrings(locale)
  const config = METRIC_BY_BOARD[slug]
  const copy = dict.boards[slug]

  let data
  try {
    data = await getBoardDataCached(slug, language)
    if (locale !== 'en') data = await hydrateBoardDescs(data, locale)
  } catch (error) {
    // cached 包装层不应失败；这里仅为防御性兜底
    const limited = error instanceof RateLimitError
    return <BoardErrorCard locale={locale} slug={slug} copy={copy} limited={limited} />
  }

  if (data.error && data.items.length === 0) {
    return <BoardErrorCard locale={locale} slug={slug} copy={copy} limited={data.error.code === 'rate-limited'} />
  }

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: itemListJsonLd(data.items, locale, slug, language) }}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 px-1 text-[11.5px] text-sub">
        <span className="rounded-full border-[0.5px] border-black/10 bg-white px-2.5 py-1 font-medium text-ink/75">
          {data.source === 'github-trending'
            ? dict.ui.sourceGithubTrending
            : data.source === 'github-search-fallback'
              ? dict.ui.sourceGithubSearch
              : dict.ui.sourceGithubSearch}
        </span>
        {data.language && (
          <span className="rounded-full border-[0.5px] border-black/10 bg-white px-2.5 py-1 font-medium text-ink/75">
            {data.language} · {dict.ui.language}
          </span>
        )}
        {data.source === 'github-trending' && (
          <span className="rounded-full bg-good/10 px-2.5 py-1 font-medium text-good">
            {locale === 'zh' ? '官方标注 · 真实增量' : 'official delta · real'}
          </span>
        )}
        <span className="sr-only">{copy.name}</span>
      </div>

      <LiveBoardList
        key={`${slug}:${language ?? 'all'}`}
        slug={slug}
        locale={locale}
        currentLanguage={language}
        initialItems={data.items}
        initialGeneratedAt={data.generatedAt}
        initialDegraded={data.degraded}
        metric={config.metric}
        metricLabel={copy.metricLabel}
        metricHint={copy.metricHint}
        secondary={config.secondary}
        showSlope={config.showSlope}
        showIssues={config.showIssues}
        showPushed={config.showPushed}
        variant={config.variant}
        limit={limit}
        compact={compact}
        strings={strings}
      />
    </div>
  )
}

/** 取数失败时的显式标注卡：缓存的空榜 + 重试指引，cacheLife 到期后自愈。 */
/** ItemList 结构化排名信号:让搜索引擎把每个仓库的站内档案页当"列表条目"理解。
 * 链的是站内档案 URL(非 GitHub),条目名带官方名次与星数,页面上全部可见,无隐藏内容。 */
function itemListJsonLd(
  items: Array<{ fullName: string; stars: number }>,
  locale: Locale,
  slug: string,
  language?: string,
): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const path = language ? `/${locale}/boards/${slug}/${language}` : `/${locale}/boards/${slug}`
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${base}${path}#items`,
    name: 'GitHub Ranked',
    numberOfItems: items.length,
    itemListElement: items.slice(0, 150).map((it, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${base}/${locale}/repo/${it.fullName}`,
      name: `${it.fullName} · #${index + 1} · ${it.stars}`,
    })),
  })
}

function BoardErrorCard({
  locale,
  slug,
  copy,
  limited,
}: {
  locale: Locale
  slug: BoardSlug
  copy: BoardCopy
  limited: boolean
}) {
  const dict = getDict(locale)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
        <span className="rounded-full border-[0.5px] border-black/10 bg-[#fff8e6] px-2.5 py-1 text-[11.5px] font-medium text-bad">
          {limited ? dict.ui.rateLimited : `${dict.ui.sourceGithubSearch} / ${dict.ui.sourceGithubTrending}`}
        </span>
        <span className="sr-only">{copy.name}</span>
      </div>
      <div className="card px-6 py-10 text-center">
        <p className="text-[15px] font-semibold text-ink">{copy.name}</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-sub">
          {limited
            ? locale === 'zh'
              ? 'GitHub 接口需要几分钟冷却，本页稍后即可自动恢复。配置 GITHUB_TOKEN 后可大幅提升额度。'
              : 'The GitHub API needs a few minutes to cool down. This page recovers automatically. Configure GITHUB_TOKEN for a far larger quota.'
            : locale === 'zh'
              ? '数据源暂时不可用，页面稍后会自动重试。'
              : 'The data source is temporarily unavailable. This page retries automatically.'}
        </p>
        <a
          href={`${'/' + locale + '/boards/' + slug}`}
          className="mt-5 inline-flex items-center rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-white transition-opacity hover:opacity-80"
        >
          {locale === 'zh' ? '重试' : 'Retry'}
        </a>
      </div>
    </div>
  )
}
