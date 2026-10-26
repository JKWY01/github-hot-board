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
  /** SPDX 标识(MIT/Apache-2.0/…);trending 抓取项与未采集时缺省 */
  license?: string | null
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
  /** 上一拍(上一次同步)的名次(0 基；本拍新入榜则缺省)——落库持久化,任何访客打开都能看到爬/掉徽章 */
  prevRank?: number
  /** 官方 Trending 同期收录标记(周/月榜自算增量榜的行内小标,双源互证) */
  officialTrending?: boolean
}

export type BoardSource =
  | 'github-search'
  | 'github-trending'
  | 'github-search-fallback'
  | 'github-error'
  | 'daily-stars'

/** 周/月榜自算口径的官方新面孔(官方 Trending 有、本站快照尚未收录的仓) */
export interface OfficialNewcomer {
  fullName: string
  stars: number
  gained: number
  desc: string | null
  htmlUrl: string
}

export interface BoardData {
  slug: string
  language?: string
  items: BoardItem[]
  source: BoardSource
  degraded?: boolean
  /** 上游取数失败时由 cached 包装层烘焙的价值（页面需显式标注，cacheTTL 到期自愈） */
  error?: { code: 'rate-limited' | 'upstream' }
  /** 周/月榜:官方 Trending 新面孔(本站尚未收录),官方数量 < 增量主榜数量 */
  officialNewcomers?: OfficialNewcomer[]
  /** 增量窗口实际覆盖天数(星速表建立初期 <7/<30,页面如实标注"数据积累中") */
  gainWindowDays?: number
  generatedAt: string
}

export interface LivePatch {
  slug: string
  language?: string
  items: BoardItem[]
  generatedAt: string
  degraded?: boolean
  source?: BoardSource
  officialNewcomers?: OfficialNewcomer[]
  error?: { code: 'rate-limited' | 'upstream' | 'unknown'; message?: string }
}
