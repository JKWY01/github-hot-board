import { after } from 'next/server'
import { fetchDescLng, harvestRepoDescs } from './github'
import { isLocale, LOCALES, type Locale } from './locales'
import { readAllHeadRepos, readProbes, readRepoDescs, upsertProbe, upsertRepoDesc } from './snapshot'
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

/** 每次榜单读请求最多排入补齐的仓库数:3 路并发 + 配额节奏下,首访约 40s 内全批收敛。 */
const FILL_BATCH = 12

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
  // Vercel serverless 下裸浮动 Promise 会随响应被冻结——必须用 after() 挂在响应之后继续跑,
  // 本地长驻进程行为不变;构建期/静态预渲染时(IN_BUILD 门禁)本分支不可达。
  if (wants.length > 0) after(() => fillQueue(wants, viewer))
  return { ...base, items }
}

/** 顺序富化改小并发(3 路):配额节流仍是全局串行,多路只是把网络等待重叠起来,
 * 首次覆盖一批仓库的墙钟时间约缩到 1/3;去重与退避保持原样。 */
const FILL_CONCURRENCY = 3

async function fillQueue(fullNames: string[], viewer: Locale): Promise<void> {
  // 先滤掉在途与退避中的,再切批并占位 —— 否则排头的失败仓库会把名额占死,后面的仓库永远轮不上。
  // 顺手清扫过期失败记录(六轮审查):长驻进程下 Map 只进不出会无界增长。
  const now = Date.now()
  if (failedAt.size > 256) {
    for (const [k, t] of failedAt) if (now - t >= FAIL_BACKOFF_MS) failedAt.delete(k)
  }
  const pending: string[] = []
  for (const full of fullNames) {
    if (pending.length >= FILL_BATCH) break
    const id = `${full}|${viewer}`
    if (inFlight.has(id)) continue
    const failed = failedAt.get(id)
    if (failed && now - failed < FAIL_BACKOFF_MS) continue
    inFlight.add(id)
    pending.push(full)
  }
  let next = 0
  const worker = async () => {
    for (;;) {
      const full = pending[next++]
      if (!full) return
      const id = `${full}|${viewer}`
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
  await Promise.all(Array.from({ length: FILL_CONCURRENCY }, worker))
}

/** lang 参数是否为可用的站点语言(不含 en——en 无需描述富化)。 */
export function viewerLocale(raw: string | null): Locale | null {
  if (!raw || raw === 'en') return null
  return isLocale(raw) ? raw : null
}

/** 探测结论的新鲜期:resolved=true 的 (仓库, 语言) 30 天内不再探测,
 * 到期后会再收割一次,顺带接住上游新加的翻译。 */
export const PROBE_FRESH_MS = 30 * 24 * 3600_000

/** 同步期主动收割:库里缺、上游有的语种描述,随每轮同步收进 repo_desc(站点读取路径依旧只查库)。
 * 队列 = 各榜头合并出仓库集合,按热度分(榜序×10000+行号)升序 —— overall 首位、分面榜其后。
 * 单仓扫描一次拿齐全部站点语言;已决且未过期的仓库整仓跳过;
 * 预算内尽力而为,收不完的下一轮继续(Actions 每 6 小时一轮,几天内全库收敛)。 */
export async function prefillRepoDescs(opts: {
  boardOrder: string[]
  budgetMs?: number
}): Promise<{ repos: number; descs: number }> {
  const stat = { repos: 0, descs: 0 }
  if (IN_BUILD || !process.env.DATABASE_URL) return stat
  const deadline = Date.now() + (opts.budgetMs ?? 180_000)
  const queue = await readAllHeadRepos(opts.boardOrder)
  if (queue.length === 0) return stat
  console.error(
    `[prefill] queue=${queue.length} budget=${Math.round((opts.budgetMs ?? 180_000) / 1000)}s`,
  )
  const siteLocales = LOCALES.filter((l) => l !== 'en')
  const resolved = await readProbes(
    queue,
    // 只读当前轮可能要处理的头部(预算有限,后面大概率轮不到;读多无益也无害)
    PROBE_FRESH_MS,
  )
  for (const full of queue) {
    if (Date.now() > deadline) break
    if (siteLocales.every((l) => resolved.get(`${full}|${l}`) === true)) continue
    try {
      const h = await harvestRepoDescs(full)
      stat.repos += 1
      const got = Object.keys(h.descs).length
      if (got > 0) console.error(`[prefill] ${full} +${got}/${siteLocales.length}`)
      for (const locale of h.resolved) {
        await upsertProbe(full, locale, true)
        const desc = h.descs[locale]
        if (desc && (await upsertRepoDesc(full, locale, desc))) stat.descs += 1
      }
    } catch {
      // 单仓失败不断整轮:该仓未决语种下一轮自动重试
    }
  }
  return stat
}
