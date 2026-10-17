import 'server-only'

import { mkdirSync, statSync, openSync, closeSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanDesc } from './parse'

const TOKEN = (process.env.GITHUB_TOKEN ?? '').trim()

/** Data Cache 生命周期：有 token 冷却 5 分钟；匿名放宽到 15 分钟。 */
export const GH_TTL_SECONDS = TOKEN ? 300 : 900
export const TRENDING_TTL_SECONDS = 900
export const HAS_GITHUB_TOKEN = Boolean(TOKEN)

export class RateLimitError extends Error {
  constructor(message = 'GitHub rate limit exceeded') {
    super(message)
    this.name = 'RateLimitError'
  }
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-hot-board(+https://github.com)',
  }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  return headers
}

interface GhSearchRepo {
  id: number
  full_name: string
  html_url: string
  description: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  language: string | null
  created_at: string
  pushed_at: string
  topics?: string[]
}

interface GhSearchResponse {
  items?: GhSearchRepo[]
}

const TIME_BUDGET_MS = 10_000
const SCRAPE_TIME_BUDGET_MS = 15_000

/* ------------------------- GitHub 请求全局平滑节流 ------------------------- */
/* 构建期 7 个 worker 并发填缓存会在 1 秒内打出几十个 Search 请求，触发
 * GitHub「二级限流」（403 且不扣主配额，冷却 ~1 分钟）。这里用 tmp 目录锁
 * 把任意进程内的 GitHub 请求间隔拉平：有 token ≈ 每 2.1s ≤30/min，匿名 ≈ 每 6.2s ≤10/min。
 * 运行时请求极少排队，二台 Vercel 流量下自身即有空闲窗口。 */

const LOCK_DIR = join(tmpdir(), 'ghb-quota')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function quotaSlot(): Promise<void> {
  const interval = Number(process.env.GHB_FETCH_INTERVAL_MS) || (TOKEN ? 2_100 : 6_200)
  for (;;) {
    try {
      mkdirSync(LOCK_DIR, { recursive: true })
      const marker = join(LOCK_DIR, 'last')
      let last = 0
      try {
        last = statSync(marker).mtimeMs
      } catch {
        /* 首次无标记 */
      }
      const wait = last + interval - Date.now()
      if (wait <= 0) {
        // 排他占用时间片（他人随后重读 mtime 会看到更新后的值并继续等待）
        const fd = openSync(marker, 'w')
        closeSync(fd)
        utimesSync(marker, new Date(), new Date())
        return
      }
      await sleep(Math.min(wait, 10_000) + 30)
    } catch {
      // 节流失败不应阻塞请求
      return
    }
  }
}

async function ghJson(url: string): Promise<unknown> {
  await quotaSlot()
  const res = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(TIME_BUDGET_MS),
    next: { revalidate: GH_TTL_SECONDS },
  })
  if (res.status === 403 || res.status === 429) {
    throw new RateLimitError(`GitHub rate limited [${res.status}] ${url}`)
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${url}`)
  }
  return res.json()
}

function mapRepo(repo: GhSearchRepo): BoardRepoFields {
  const [owner, name] = repo.full_name.split('/')
  return {
    id: repo.id,
    fullName: repo.full_name,
    owner: owner ?? '',
    name: name ?? repo.full_name,
    htmlUrl: repo.html_url,
    avatarUrl: `https://github.com/${owner ?? 'github'}.png`,
    desc: repo.description ? cleanDesc(repo.description) : null,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    issues: repo.open_issues_count,
    language: repo.language,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    topics: (repo.topics ?? []).slice(0, 3),
  }
}

type BoardRepoFields = {
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
  createdAt: string
  pushedAt: string
  topics: string[]
}

export interface GhSearchOptions {
  sort?: string
  order?: string
  perPage?: number
  pages?: number
}

/** Search API 仓库搜索；pages=2 表示并发取前两页。 */
export async function ghSearch(
  q: string,
  { sort = 'stars', order = 'desc', perPage = 100, pages = 1 }: GhSearchOptions = {},
): Promise<BoardRepoFields[]> {
  const urls = Array.from(
    { length: Math.max(1, pages) },
    (_, i) =>
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=${order}&per_page=${perPage}&page=${i + 1}`,
  )

  const settled = await Promise.allSettled(urls.map(ghJson))
  const items: BoardRepoFields[] = []
  let firstError: unknown = null
  let sawRateLimit = false

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const payload = result.value as GhSearchResponse
      items.push(...(payload.items ?? []).map(mapRepo))
    } else {
      firstError ||= result.reason
      if (result.reason instanceof RateLimitError) sawRateLimit = true
    }
  }

  if (items.length === 0 && firstError) {
    throw sawRateLimit
      ? new RateLimitError('GitHub Search rate limited')
      : firstError
  }
  return items
}

export interface TrendingQuery {
  since: 'daily' | 'weekly' | 'monthly'
  language?: string
}

/** 抓取 github.com/trending 公开页面并解析。 */
export async function fetchTrendingPage({ since, language }: TrendingQuery): Promise<string> {
  await quotaSlot()
  const path = language ? `/trending/${encodeURIComponent(language.toLowerCase())}` : '/trending'
  const url = `https://github.com${path}?since=${since}`
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.8',
    },
    signal: AbortSignal.timeout(SCRAPE_TIME_BUDGET_MS),
    next: { revalidate: TRENDING_TTL_SECONDS },
  })
  if (res.status === 403 || res.status === 429) {
    throw new RateLimitError(`trending blocked [${res.status}]`)
  }
  if (!res.ok) {
    throw new Error(`trending page ${res.status}`)
  }
  return res.text()
}
