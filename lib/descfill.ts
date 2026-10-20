import { fetchDescLng } from './github'
import { isLocale, type Locale } from './locales'
import { readRepoDescs, upsertRepoDesc } from './snapshot'
import type { BoardData } from './types'

/** 访问驱动的仓库描述本地化。
 *
 * 读取路径用 repo_desc(repo 粒度的多语首句缓存)把对应站点语言的描述合并进榜单,
 * 缺口的仓库排队到后台补齐,不阻塞响应——浏览器每 60s 的轮询自然把补上的描述送回来。
 * 这样总榜/搜索系/分面全部榜单的每一行都能按站点语言渐进本地化,
 * 而同步管线完全不背描述成本(访问越多覆盖越好,没人看的仓库永远不花配额)。 */

const IN_BUILD = process.env.NEXT_PHASE === 'phase-production-build'

/** 同一 (仓库, 语言) 的并发去重 + 失败退避(无该语言翻译的仓库 10 分钟内不重试)。 */
const inFlight = new Set<string>()
const failedAt = new Map<string, number>()
const FAIL_BACKOFF_MS = 10 * 60_000

/** 每次榜单读请求最多学徒补齐的仓库数:配额节奏下 60s 内可见增量。 */
const FILL_BATCH = 8

export async function hydrateBoardDescs(base: BoardData, viewer: Locale): Promise<BoardData> {
  // en 视角 = 仓库原文,零合并零补齐;构建期不打库不排队
  if (IN_BUILD || viewer === 'en' || !process.env.DATABASE_URL || base.items.length === 0) return base
  let descs: Map<string, Record<string, string>>
  try {
    descs = await readRepoDescs(base.items.map((it) => it.fullName))
  } catch {
    return base
  }
  const wants: string[] = []
  const items = base.items.map((it) => {
    const desc = descs.get(it.fullName)?.[viewer]
    if (!desc) {
      wants.push(it.fullName)
      return it
    }
    return { ...it, descLng: { ...(it.descLng ?? {}), [viewer]: desc } }
  })
  if (wants.length > 0) void fillQueue(wants, viewer)
  return { ...base, items }
}

/** 顺序补齐(单链,配额节流友好):先去重/退避,再逐仓库拉对应语言 README 首句入库。 */
async function fillQueue(fullNames: string[], viewer: Locale): Promise<void> {
  for (const full of fullNames.slice(0, FILL_BATCH)) {
    const id = `${full}|${viewer}`
    if (inFlight.has(id)) continue
    const failed = failedAt.get(id)
    if (failed && Date.now() - failed < FAIL_BACKOFF_MS) continue
    inFlight.add(id)
    try {
      const desc = await fetchDescLng(full, viewer)
      if (desc) {
        await upsertRepoDesc(full, viewer, desc)
        failedAt.delete(id)
      } else {
        failedAt.set(id, Date.now())
      }
    } catch {
      failedAt.set(id, Date.now())
    } finally {
      inFlight.delete(id)
    }
  }
}

/** lang 参数是否为可用的站点语言(不含 en——en 无需描述富化)。 */
export function viewerLocale(raw: string | null): Locale | null {
  if (!raw || raw === 'en') return null
  return isLocale(raw) ? raw : null
}
