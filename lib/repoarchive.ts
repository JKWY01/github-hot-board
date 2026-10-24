import { cacheLife, cacheTag } from 'next/cache'

import { isRepoFullName } from './reposhape'
import { readRepoArchiveRows, type RepoAppearance, type RepoDayRank } from './snapshot'

// 仓库名形状校验统一由 lib/reposhape 提供(全站单一事实源);此处再导出保持既有 import 兼容。
export { isRepoFullName }

/** 仓库档案:'use cache' 包装 —— (仓库) 一次会话最多重算一次,
 * 之后边缘缓存直接吞吐;标签挂在 'github' 上,可被 /api/refresh 统一刷新。 */
export interface RepoArchive {
  fullName: string
  htmlUrl: string
  /** 每个 (榜, 语言) 的最近一次在榜记录;current=true 为现役,false 为退榜老兵最后一次。 */
  appearances: RepoAppearance[]
  /** 近 30 天基准口径(language='')每日 (榜, 名次)。 */
  daily: RepoDayRank[]
  /** 在场记录里最新的 takenAt(页脚"更新于"来源)。 */
  updatedAt: string
  /** 最后一次出现在任何榜上的时刻(current 排除外也用它展示"还在过榜"). */
  lastSeenAt: string | null
  /** 基准口径最新一拍的 star/fork 总量(没有基准行就取在场第一条)。 */
  totalStars: number | null
  totalForks: number | null
}

export async function getRepoArchiveCached(fullName: string): Promise<RepoArchive | null> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 })
  cacheTag('github')

  if (!isRepoFullName(fullName)) return null
  const { appearances, daily, lastSeenAt } = await readRepoArchiveRows(fullName)
  // 历史(哪怕退榜多年)有任何一拍记录,档案就成立;从未上榜 → null(路由层诚实 404)。
  if (appearances.length === 0) return null

  const current = appearances.filter((a) => a.current)
  const pool = current.length > 0 ? current : appearances
  const base = pool.find((a) => a.language === '') ?? pool[0]
  const updatedAt = appearances.reduce((max, a) => (a.takenAt > max ? a.takenAt : max), appearances[0].takenAt)
  return {
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    appearances,
    daily,
    updatedAt,
    lastSeenAt,
    totalStars: base.stars,
    totalForks: base.forks,
  }
}
