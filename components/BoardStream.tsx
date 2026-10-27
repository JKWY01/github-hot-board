import { notFound } from 'next/navigation'

import { getBoardDataCached, type BoardSlug } from '@/lib/boards'
import { hydrateBoardDescs } from '@/lib/descfill'
import { RateLimitError } from '@/lib/github'
import { jsonLdScript } from '@/lib/jsonld'
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
  // 换芯后主指标=score(增速百分比):rising=近 7 天绝对增量榜,dark=近 7 天增速榜,
  // 行数据来自星速层(无 slope 字段)。兜底口径(Search 日均)时 score 缺省,右列显示 0
  // 属可接受的降级形态(metricLabel 已随字典换新)。
  rising: { metric: 'score', secondary: 'stars', showSlope: false, showPushed: true },
  dark: { metric: 'score', secondary: 'stars', showPushed: true },
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
        dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListJsonLd(data.items, locale, slug, language)) }}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 px-1 text-[11.5px] text-sub">
        <span className="rounded-full border-[0.5px] border-black/10 bg-white px-2.5 py-1 font-medium text-ink/75">
          {data.source === 'github-trending'
            ? dict.ui.sourceGithubTrending
            : data.source === 'daily-stars'
              ? (locale === 'zh' ? '本站快照实测' : 'measured by our snapshots')
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
        // SSR 载荷只带前 100 行(实测 500 行全量让 RSC Flight 膨胀到 300KB+,跨境 TTFB 秒级劣化);
        // initialTruncated 通知列表挂载后立即静默补全,60s 轮询照旧。爬虫 SEO 信号由
        // ItemList JSON-LD(500 条全量)承担,不依赖 DOM 行数。
        initialItems={data.items.slice(0, 100)}
        initialTruncated={data.items.length > 100}
        // 名录只给全榜页:limit 型 compact 榜(首页三小卡)不需要 394 条内链
        roster={!limit && data.items.length > 100 ? data.items.slice(100) : undefined}
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

      {(data.officialNewcomers?.length ?? 0) > 0 && (
        <section className="mt-8 px-1">
          <h2 className="text-[13px] font-semibold text-ink">
            {locale === 'zh' ? '官方 Trending 新面孔' : 'New on official Trending'}
            <span className="ml-2 text-[11.5px] font-normal text-sub">
              {locale === 'zh' ? '官方已收录,本站快照尚未接到' : 'on the official list, not yet in our snapshots'}
            </span>
          </h2>
          <ul className="card mt-3 divide-y-[0.5px] divide-black/6">
            {data.officialNewcomers!.map((n) => (
              <li key={n.fullName}>
                <a
                  href={n.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{n.fullName}</span>
                    {n.desc && <span className="mt-0.5 block truncate text-[12px] text-sub">{n.desc}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-good">+{n.gained}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
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
) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const path = language ? `/${locale}/boards/${slug}/${language}` : `/${locale}/boards/${slug}`
  return {
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
  }
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
