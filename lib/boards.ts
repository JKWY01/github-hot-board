import { cacheLife, cacheTag } from 'next/cache'

import { RateLimitError, fetchTrendingPage, ghSearch, resolveAvatarUrl } from './github'
import { appendHistory, readPersistedBoard, savePersistedBoard } from './persist'
import { readBoardHead } from './snapshot'
import { cleanDesc, parseTrendingHtml } from './parse'
import type { BoardData, BoardItem } from './types'

/** 持久层水合上限:重建后(.next 数据缓存清空)优先读 .data 磁盘快照,
 * 不去打 GitHub。超龄(默认 30 分钟)才走真实拉取。 */
const HYDRATE_MAX_MIN = Number(process.env.PERSIST_HYDRATE_MAX_MIN) || 30

/** cacheKey 与文件名的共用键;语言用 URL 安全 slug(c++ → cpp)。 */
function persistKey(slug: BoardSlug, language?: string): string {
  return language ? `${slug}-${facetLangSlug(language)}` : slug
}

/** 历史行瘦身:只要时序分析所需的最小字段。 */
function toHistoryPayload(key: string, data: BoardData) {
  return {
    generatedAt: data.generatedAt,
    key,
    source: data.source,
    degraded: data.degraded ?? false,
    items: data.items.map((item: BoardItem, index: number) => ({
      rank: index + 1,
      repo: item.fullName,
      stars: item.stars,
      forks: item.forks,
      ...(item.slope !== undefined ? { slope: item.slope } : {}),
      ...(item.gained !== undefined ? { gained: item.gained } : {}),
      ...(item.score !== undefined ? { score: item.score } : {}),
    })),
  }
}

const DAY_MS = 86_400_000

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)

const YEAR_START = `${new Date().getUTCFullYear()}-01-01`

import { BOARD_SLUGS, FACET_LANGUAGES, facetDisplay, facetLangFromSlug, facetLangSlug, type FacetLanguage } from './facet'

/* 语言分面与 slug 工具的单一来源在 lib/facet.ts(纯数据,middleware 也会用到);这里原样再导出。 */
export { FACET_LANGUAGES, facetDisplay, facetLangFromSlug, facetLangSlug }
export type { FacetLanguage }

export type BoardSlug = (typeof BOARD_SLUGS)[number]

export interface BoardMeta {
  slug: BoardSlug
  /** 数据来自 trending 抓取时用得多 */
  trending: boolean
  facets: boolean
}

export const BOARD_ORDER: BoardSlug[] = [...BOARD_SLUGS]

export const BOARD_META: Record<BoardSlug, BoardMeta> = {
  overall: { slug: 'overall', trending: false, facets: true },
  weekly: { slug: 'weekly', trending: true, facets: true },
  monthly: { slug: 'monthly', trending: true, facets: true },
  annual: { slug: 'annual', trending: false, facets: false },
  rising: { slug: 'rising', trending: false, facets: false },
  dark: { slug: 'dark', trending: false, facets: false },
  overlooked: { slug: 'overlooked', trending: false, facets: false },
  controversial: { slug: 'controversial', trending: false, facets: false },
  forks: { slug: 'forks', trending: false, facets: false },
  milestone: { slug: 'milestone', trending: false, facets: false },
}

export function isBoardSlug(value: string): value is BoardSlug {
  return (BOARD_ORDER as string[]).includes(value)
}

export function isFacetLanguage(value: string): value is FacetLanguage {
  return (FACET_LANGUAGES as readonly string[]).includes(value)
}

function slopeStarsPerDay(repo: { stars: number; createdAt?: string }): number | undefined {
  if (!repo.createdAt) return undefined
  const age = (Date.now() - Date.parse(repo.createdAt)) / DAY_MS
  if (!Number.isFinite(age)) return undefined
  const days = Math.max(1, age)
  return repo.stars / days
}

interface PoolRepo {
  id: number
  fullName: string
  owner: string
  name: string
  htmlUrl: string
  avatarUrl: string
  desc: string | null
  stars: number
  forks: number
  issues: number
  language: string | null
  createdAt?: string
  pushedAt?: string
  topics: string[]
}

function toItems(repos: PoolRepo[], decorate?: (item: BoardItem, repo: PoolRepo) => void): BoardItem[] {
  return repos.map((repo) => {
    const item: BoardItem = { ...repo, slope: slopeStarsPerDay(repo) }
    decorate?.(item, repo)
    return item
  })
}

/* ---------------------------------- 榜单 ---------------------------------- */

export async function getOverallData(language?: string): Promise<BoardData> {
  const q = `stars:>1000 fork:false${language ? ` language:${language}` : ''}`
  // 星数排序第 2 页到 Top200(每页多 1 次 Search 调用,池子节奏下很便宜)
  const repos = await ghSearch(q, { pages: 2 })
  repos.sort((a, b) => b.stars - a.stars)
  return {
    slug: 'overall',
    items: toItems(repos).slice(0, 200),
    language,
    source: 'github-search',
    generatedAt: new Date().toISOString(),
  }
}

interface TrendingParams {
  period: 'weekly' | 'monthly'
  language?: string
}

export async function getTrendingBoardData({ period, language }: TrendingParams): Promise<BoardData> {
  let firstError: unknown = null
  try {
    const html = await fetchTrendingPage({ since: period, language })
    // 注:trending 官方页无真实分页(?page=2 回吐同页,实测 2026-10),行数即官方当日口径,不掺水。
    const parsed = parseTrendingHtml(html, period)
    if (parsed.length === 0) throw new Error('trending parse returned 0 items')

    const items: BoardItem[] = await Promise.all(
      parsed.map(async (entry) => {
        const [owner, name] = entry.fullName.split('/')
        return {
          id: hashFullName(entry.fullName),
          fullName: entry.fullName,
          owner: owner ?? '',
          name: name ?? entry.fullName,
          htmlUrl: `https://github.com/${entry.fullName}`,
          avatarUrl: await resolveAvatarUrl(owner ?? 'github'),
          desc: entry.desc,
          stars: entry.stars,
          forks: entry.forks,
          issues: 0,
          language: entry.language,
          topics: [],
          gained: entry.growth ?? undefined,
          sincePeriod: entry.period,
        }
      }),
    )
    return {
      slug: period,
      language,
      items,
      source: 'github-trending',
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    firstError = error
  }

  // 降级口径：新建仓库按星数排序（与官方 trending 不同，页面会明确标注）
  try {
    const days = period === 'weekly' ? 7 : 30
    const repos = await ghSearch(
      `created:>${isoDaysAgo(days)} stars:>100 fork:false${language ? ` language:${language}` : ''}`,
      { pages: 1 },
    )
    repos.sort((a, b) => b.stars - a.stars)
    return {
      slug: period,
      language,
      items: toItems(repos).slice(0, 50),
      source: 'github-search-fallback',
      degraded: true,
      generatedAt: new Date().toISOString(),
    }
  } catch {
    throw firstError
  }
}

export async function getAnnualData(): Promise<BoardData> {
  // 同总榜：第 1 页即今年的星数 Top100
  const repos = await ghSearch(`created:>${YEAR_START} stars:>10 fork:false`, { pages: 2 })
  repos.sort((a, b) => b.stars - a.stars)
  return {
    slug: 'annual',
    items: toItems(repos).slice(0, 200),
    source: 'github-search',
    generatedAt: new Date().toISOString(),
  }
}

export async function getRisingData(): Promise<BoardData> {
  const repos = await ghSearch(`created:>${isoDaysAgo(90)} stars:>10 fork:false`, { pages: 3 })
  repos.sort((a, b) => (slopeStarsPerDay(b as PoolRepo) ?? 0) - (slopeStarsPerDay(a as PoolRepo) ?? 0))
  return {
    slug: 'rising',
    items: toItems(repos).slice(0, 200),
    source: 'github-search',
    generatedAt: new Date().toISOString(),
  }
}

export async function getDarkData(): Promise<BoardData> {
  // 独立一口径：90 天内新建、30–1500 星，取斜率最高者（不复用 rising 的前 100 切片，
  // 否则过滤后经常为空——斜率排序天然偏向全新小仓库）。
  let repos: PoolRepo[] = []
  try {
    repos = await ghSearch(`created:>${isoDaysAgo(90)} stars:30..1500 fork:false`, { pages: 3 })
  } catch {
    repos = []
  }
  const filtered = repos
    .filter((repo) => repo.stars >= 30 && repo.stars <= 1500 && (slopeStarsPerDay(repo) ?? 0) > 0)
    .sort((a, b) => (slopeStarsPerDay(b) ?? 0) - (slopeStarsPerDay(a) ?? 0))
    .slice(0, 100)
  return {
    slug: 'dark',
    items: toItems(filtered),
    source: 'github-search',
    generatedAt: new Date().toISOString(),
    degraded: !filtered.length ? true : undefined,
  }
}

export async function getOverlookedData(): Promise<BoardData> {
  const repos = await ghSearch(
    `pushed:>${isoDaysAgo(30)} stars:100..800 fork:false`,
    { pages: 2, order: 'asc' },
  )
  repos.sort((a, b) => a.stars - b.stars)
  return {
    slug: 'overlooked',
    items: toItems(repos).slice(0, 200),
    source: 'github-search',
    generatedAt: new Date().toISOString(),
    degraded: !repos.length ? true : undefined,
  }
}

export async function getControversialData(): Promise<BoardData> {
  const pool = await getOverallData()
  const repos = pool.items
    .filter((item) => item.stars >= 3000)
    .map((item) => ({
      ...item,
      score: (item.forks * 2 + item.issues) / Math.max(1, item.stars),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 100)
  return {
    slug: 'controversial',
    items: repos,
    source: 'github-search',
    generatedAt: new Date().toISOString(),
  }
}

export async function getForksData(): Promise<BoardData> {
  // 同总榜：按 fork 排序第 1 页即 Top100
  const repos = await ghSearch('forks:>500 fork:false', { sort: 'forks', pages: 2 })
  repos.sort((a, b) => b.forks - a.forks)
  return {
    slug: 'forks',
    items: toItems(repos).slice(0, 200),
    source: 'github-search',
    generatedAt: new Date().toISOString(),
  }
}

export interface MilestoneThreshold {
  value: number
  quote: string
}

export const MILESTONE_THRESHOLDS = [1_000, 10_000, 50_000, 100_000] as const

export async function getMilestoneData(): Promise<BoardData> {
  const tenDaysAgo = isoDaysAgo(30)
  const settled = await Promise.allSettled(
    MILESTONE_THRESHOLDS.map((threshold) =>
      // 只搜未过线区间 [t-80, t-1]:窗口顶那种已跨线的仓库不占"差 0"位置
      ghSearch(`stars:${threshold - 80}..${threshold - 1} pushed:>${tenDaysAgo} fork:false`, {
        perPage: 50,
        pages: 1,
      }),
    ),
  )

  const byFull = new Map<string, BoardItem>()
  const errors: unknown[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      for (const repo of result.value) {
        const existing = byFull.get(repo.fullName)
        if (existing) continue
        const item: BoardItem = { ...repo, slope: slopeStarsPerDay(repo) as number | undefined }
        const target = nextThreshold(repo.stars)
        if (!target) continue // 已越过全部档位(≥100k):无线可冲,不占位
        item.milestoneTarget = target
        byFull.set(repo.fullName, item)
      }
    } else {
      errors.push(result.reason)
    }
  }

  const items = [...byFull.values()]
  if (items.length === 0 && errors.length > 0) {
    const anyRate = errors.some((e) => e instanceof RateLimitError)
    throw anyRate ? errors.find((e) => e instanceof RateLimitError) : errors[0]
  }

  items.sort((a, b) => remainingToTarget(a) - remainingToTarget(b))
  return {
    slug: 'milestone',
    items: items.slice(0, 200),
    source: 'github-search',
    generatedAt: new Date().toISOString(),
  }
}

/** 冲线语义:目标档 = 还没跨过的下一档(旧逻辑取"最近档"会把已跨线仓库判回原线,差值钳 0 冒充冠军)。 */
function nextThreshold(stars: number): number | null {
  for (const t of MILESTONE_THRESHOLDS) if (stars < t) return t
  return null
}

function remainingToTarget(item: BoardItem): number {
  if (!item.milestoneTarget) return Number.MAX_SAFE_INTEGER
  return Math.max(0, item.milestoneTarget - item.stars)
}

/* ---------------------------------- 调度 ---------------------------------- */

export async function getBoardData(
  slug: BoardSlug,
  language?: string,
): Promise<BoardData> {
  switch (slug) {
    case 'overall':
      return getOverallData(language)
    case 'weekly':
      return getTrendingBoardData({ period: 'weekly', language })
    case 'monthly':
      return getTrendingBoardData({ period: 'monthly', language })
    case 'annual':
      return getAnnualData()
    case 'rising':
      return getRisingData()
    case 'dark':
      return getDarkData()
    case 'overlooked':
      return getOverlookedData()
    case 'controversial':
      return getControversialData()
    case 'forks':
      return getForksData()
    case 'milestone':
      return getMilestoneData()
  }
}

function hashFullName(fullName: string): number {
  let hash = 5381
  for (let i = 0; i < fullName.length; i += 1) {
    hash = ((hash << 5) + hash + fullName.charCodeAt(i)) | 0
  }
  return hash
}

/**
 * Cache Components 专用包装：把"当前时间"等不稳定的值放进 'use cache' 作用域，
 * 让预渲染期的静态壳包含真实榜单内容；运行时按 cacheLife 周期后台再验证。
 * 内层所有 GitHub fetch 自带 Data Cache TTL（Vercel 持久化），保护 API 配额。
 */
export async function getBoardDataCached(
  slug: BoardSlug,
  language?: string,
): Promise<BoardData> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  // 统一打上 'github' 标签，/api/refresh 可用 revalidateTag 一键强制全站刷新。
  cacheTag('github')

  // 失败不向上抛：预渲染期的缓存填充阶段一旦有 rejection 会直接挂掉构建。
  // 这里烘焙一张"明确标注失败"的空榜卡，cacheLife 到期后自动重新拉数自愈。
  try {
    if (process.env.GHB_FILL_DEBUG) console.error(`[fill] enter ${slug}:${language ?? 'all'}`)
    const key = persistKey(slug, language)

    // ① 数据库优先(唯一数据源):只有同步任务联 GitHub,站点读路径 0 次上游请求。
    if (process.env.DATABASE_URL) {
      const head = await readBoardHead(key)
      const dbMaxAge = (Number(process.env.GHB_DB_MAX_MIN) || 90) * 60_000
      if (head && head.ageMs < dbMaxAge) {
        if (process.env.GHB_FILL_DEBUG) {
          console.error(`[fill] db-head ${slug}:${language ?? 'all'} age=${Math.round(head.ageMs / 1000)}s items=${(head.data as BoardData).items?.length ?? 0}`)
        }
        return head.data
      }
      if (process.env.GHB_FILL_DEBUG && head) console.error(`[fill] db-head-stale ${slug}:${language ?? 'all'} age=${Math.round(head.ageMs / 1000)}s`)
    }

    // ② 磁盘水合:重建/冷启动后(.next 数据缓存被清)优先吃上一轮的磁盘快照,不打 GitHub
    const persisted = readPersistedBoard(key)
    const maxAge = HYDRATE_MAX_MIN * 60_000
    if (
      persisted &&
      persisted.ageMs < maxAge &&
      (persisted.data as BoardData | null)?.items &&
      Array.isArray((persisted.data as BoardData).items)
    ) {
      const data = persisted.data as BoardData
      if (process.env.GHB_FILL_DEBUG) {
        console.error(`[fill] hydrated-from-disk ${slug}:${language ?? 'all'} age=${Math.round(persisted.ageMs / 1000)}s`)
      }
      return data
    }

    // ② 正路:真实拉取(GitHub Search / Trending,内部有配额节流与降级口径)
    const t0 = Date.now()
    const data = await getBoardData(slug, language)
    // ③ 落盘:最新快照 + 按月分段的历史拍(30 分钟一拍起,PERSIST_HISTORY_MIN 控制)
    savePersistedBoard(key, data)
    appendHistory(key, toHistoryPayload(key, data))
    if (process.env.GHB_FILL_DEBUG) console.error(`[fill] done ${slug}:${language ?? 'all'} ${Date.now() - t0}ms`)
    return data
  } catch (error) {
    if (process.env.GHB_FILL_DEBUG) console.error(`[fill] baked-error ${slug}:${language ?? 'all'} ${String(error).slice(0, 60)}`)
    // 陈库救护:上游拉取失败时不端空榜卡,只要库里还有任何一拍(哪怕超龄)就诚实地渲染它。
    // 数据旧但真,横幅标"口径降级";比一张错误卡对读者的价值高得多。
    try {
      const rescue = await readBoardHead(persistKey(slug, language))
      if (rescue?.data && Array.isArray((rescue.data as BoardData).items) && (rescue.data as BoardData).items.length > 0) {
        if (process.env.GHB_FILL_DEBUG) {
          console.error(`[fill] db-stale-rescue ${slug}:${language ?? 'all'} age=${Math.round(rescue.ageMs / 1000)}s`)
        }
        return rescue.data
      }
    } catch {
      // 数据库也死了:保留烘焙卡
    }
    return {
      slug,
      language,
      items: [],
      source: 'github-error',
      degraded: true,
      error: { code: error instanceof RateLimitError ? 'rate-limited' : 'upstream' },
      generatedAt: new Date().toISOString(),
    }
  }
}
