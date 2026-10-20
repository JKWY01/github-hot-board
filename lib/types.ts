export type { Locale } from './locales'

export interface RepoLite {
  id: number
  fullName: string
  owner: string
  name: string
  htmlUrl: string
  avatarUrl: string
  desc: string | null
  /** 各站点语言的行描述(仓库对应语言 README 首句,同步时提取;没有就回 desc 原文) */
  descLng?: Record<string, string> | null
  stars: number
  forks: number
  /** GitHub 口径：含 PR */
  issues: number
  language: string | null
  /** ISO 时间；Trending 抓取项不存在 */
  createdAt?: string
  pushedAt?: string
  topics: string[]
}

export interface BoardItem extends RepoLite {
  /** Trending 官方口径的周期增量（day/week/month） */
  gained?: number
  sincePeriod?: 'daily' | 'weekly' | 'monthly'
  /** 星/天 斜率 */
  slope?: number
  /** 榜单专用得分（如争议指数） */
  score?: number
  /** 距离该星数阈值（里程碑榜） */
  milestoneTarget?: number
}

export type BoardSource =
  | 'github-search'
  | 'github-trending'
  | 'github-search-fallback'
  | 'github-error'

export interface BoardData {
  slug: string
  language?: string
  items: BoardItem[]
  source: BoardSource
  degraded?: boolean
  /** 上游取数失败时由 cached 包装层烘焙的价值（页面需显式标注，cacheTTL 到期自愈） */
  error?: { code: 'rate-limited' | 'upstream' }
  generatedAt: string
}

export interface LivePatch {
  slug: string
  language?: string
  items: BoardItem[]
  generatedAt: string
  degraded?: boolean
  error?: { code: 'rate-limited' | 'upstream' | 'unknown'; message?: string }
}
