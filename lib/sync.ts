import { BOARD_META, BOARD_ORDER, getBoardData } from './boards'
import type { BoardSlug } from './boards'
import { FACET_LANGUAGES } from './facet'
import { savePersistedBoard } from './persist'
import { dbKey, pruneOld, writeHeadAndRows } from './snapshot'
import type { BoardData } from './types'

/** 数据同步任务:唯一的「进货」通道。定时触发(GitHub Actions 每 30 分钟 / 本地 npm run sync / 外部 cron),
 * 顺序把全部榜单(含语言分面)抓全量,写数据库(head + 明细)并镜像落盘 .data。
 * 站点读路径只吃 board_head —— 本任务的成功与否与访客完全解耦。
 *
 * 抓取内部自带:配额节流(search/trending 双队列)、Trending 被挡自动切搜索口径、45s 让位上限。
 * 每键失败登记,首轮结束后统一补一轮重试;仍失败则留用上一拍(head 不回退)。
 */

export interface SyncSummary {
  total: number
  ok: number
  failed: string[]
  itemsWritten: number
  pruned: number
  durationMs: number
}

interface SyncTarget {
  slug: BoardSlug
  language?: string
}

export function allSyncTargets(): SyncTarget[] {
  const targets: SyncTarget[] = []
  for (const slug of BOARD_ORDER) {
    const facets = BOARD_META[slug].facets ? [undefined, ...FACET_LANGUAGES] : [undefined]
    for (const language of facets) targets.push({ slug, language })
  }
  return targets
}

async function fetchOne(target: SyncTarget): Promise<BoardData> {
  return getBoardData(target.slug, target.language)
}

async function storeOne(target: SyncTarget, data: BoardData): Promise<void> {
  // 数据库(head + 明细)。库未配置/不可用时静默跳过,磁盘镜像照常。
  await writeHeadAndRows(target.slug, target.language, data)
  // 磁盘镜像:本地冷启动水合 + 数据库不可用时的兜底。
  savePersistedBoard(dbKey(target.slug, target.language), data)
}

export async function syncAllBoards(): Promise<SyncSummary> {
  const started = Date.now()
  const targets = allSyncTargets()
  const failed: string[] = []
  let ok = 0

  const runTarget = async (target: SyncTarget): Promise<boolean> => {
    const key = dbKey(target.slug, target.language)
    const t0 = Date.now()
    try {
      const data = await fetchOne(target)
      await storeOne(target, data)
      console.error(
        `[sync] ${key} items=${data.items.length} degraded=${data.degraded ?? false} source=${data.source} ${Date.now() - t0}ms`,
      )
      return true
    } catch (error) {
      console.error(`[sync] ${key} FAILED ${Date.now() - t0}ms ${error instanceof Error ? error.message : error}`)
      return false
    }
  }

  for (const target of targets) {
    if (await runTarget(target)) ok += 1
    else failed.push(dbKey(target.slug, target.language))
  }

  // 补一轮重试(限流窗口常为分钟级,整轮跑完通常已过冷却)
  if (failed.length > 0) {
    const retryTargets = targets.filter((t) => failed.includes(dbKey(t.slug, t.language)))
    for (const target of retryTargets) {
      if (await runTarget(target)) {
        ok += 1
        failed.splice(failed.indexOf(dbKey(target.slug, target.language)), 1)
      }
    }
  }

  const pruned = await pruneOld()
  return { total: targets.length, ok, failed, itemsWritten: ok, pruned, durationMs: Date.now() - started }
}
