import { BOARD_META, BOARD_ORDER, getBoardData } from './boards'
import type { BoardSlug } from './boards'
import { prefillRepoDescs } from './descfill'
import { BOARD_SLUGS, FACET_LANGUAGES } from './facet'
import { sendMilestonePushes } from './push'
import { savePersistedBoard } from './persist'
import { isRepoFullName } from './reposhape'
import { dbKey, pruneOld, upsertRepoDesc, writeDailyStars, writeHeadAndRows } from './snapshot'
import type { BoardData } from './types'

/** 数据同步任务:唯一的「进货」通道。定时触发(GitHub Actions 每 6 小时 / 本地 npm run sync / 外部 cron),
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
  descPrefill?: { repos: number; descs: number }
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
  // 星速层随拍收盘:只认总榜(2026-10-26 六轮审查实锤)——weekly/monthly 也是
  // language=undefined,原条件会把它们的子集收盘写进 repo_daily_stars,与 overall
  // 同日 ON CONFLICT 最后一写胜出,收盘价随同步顺序漂移。全仓收盘价只属于总榜。
  if (process.env.DATABASE_URL && target.slug === 'overall' && (target.language === undefined || target.language === '')) {
    const takenAt = data.generatedAt ? new Date(data.generatedAt) : new Date()
    if (!Number.isNaN(takenAt.getTime()) && data.items.length > 0) {
      const ok = await writeDailyStars(data.items.map((it) => ({ repo: it.fullName, takenAt, stars: it.stars })))
      if (!ok) console.error(`[sync] daily-stars write failed ${dbKey(target.slug, target.language)}`)
    }
  }
  // 原文描述就地入档(repo_desc.payload['en'],非破坏合并):
  // 同步已经在手GitHub 返回的 description,不再花一次请求;仓库档案页与收割兜底共用。
  if (process.env.DATABASE_URL) {
    const withDesc = data.items.filter((it) => it.desc)
    const pending: Promise<boolean>[] = []
    for (let i = 0; i < withDesc.length; i += 50) {
      pending.push(...withDesc.slice(i, i + 50).map((it) => upsertRepoDesc(it.fullName, 'en', it.desc as string)))
      if (pending.length >= 200) {
        await Promise.all(pending)
        pending.length = 0
      }
    }
    if (pending.length) await Promise.all(pending)
  }
  // 磁盘镜像:本地冷启动水合 + 数据库不可用时的兜底。
  savePersistedBoard(dbKey(target.slug, target.language), data)
}

export async function syncAllBoards(
  opts?: { boardsOnly?: boolean; onlyBoard?: BoardSlug },
): Promise<SyncSummary> {
  const started = Date.now()
  const targets = opts?.onlyBoard
    ? allSyncTargets().filter((t) => t.slug === opts.onlyBoard)
    : allSyncTargets()
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

  // 跳过榜单本体(沿用库里现存榜头)、只跑尾部描述收割:调用方传 boardsOnly 或 GHB_SYNC_BOARDS=0。
  // 本地手动触发时环境变量经 HTTP 传不到服务端进程,用 ?boards=0 参数才可靠。
  const doBoards = !(opts?.boardsOnly ?? process.env.GHB_SYNC_BOARDS === '0')

  for (const target of doBoards ? targets : []) {
    if (await runTarget(target)) ok += 1
    else failed.push(dbKey(target.slug, target.language))
  }

  // 补一轮重试(限流窗口常为分钟级,整轮跑完通常已过冷却)
  if (doBoards && failed.length > 0) {
    const retryTargets = targets.filter((t) => failed.includes(dbKey(t.slug, t.language)))
    for (const target of retryTargets) {
      if (await runTarget(target)) {
        ok += 1
        failed.splice(failed.indexOf(dbKey(target.slug, target.language)), 1)
      }
    }
  }

  const pruned = await pruneOld()

  // Web Push 跨线提醒:VAPID 未配置时零成本跳过;有订阅才逐个对账(每轮上限 300 发)。
  // 失败静默 —— 推送是馈赠,不是依赖。
  try {
    const pushStat = await sendMilestonePushes()
    if (pushStat.sent > 0 || pushStat.removed > 0) {
      console.error(`[push] subs=${pushStat.subs} sent=${pushStat.sent} removed=${pushStat.removed}`)
    }
  } catch {
    /* 推送失败不影响同步结果 */
  }

  // 同步尾部:主动收割仓库描述(库里缺、上游有的语种收进 repo_desc)。
  // Vercel 需给 route 的 300s 预算留余量;本地无单请求上限,放宽到 20 分钟收更多仓库。
  // 单榜运修(?only=)不走收割 —— 运修要的是立刻拿到对的数据,不是漫长尾巴。
  let descPrefill: SyncSummary['descPrefill']
  if (!opts?.onlyBoard) {
    try {
      const tailCeiling = process.env.VERCEL ? 240_000 : 1_200_000
      descPrefill = await prefillRepoDescs({
        boardOrder: BOARD_ORDER,
        budgetMs: Math.max(20_000, tailCeiling - (Date.now() - started)),
      })
      console.error(
        `[sync] desc-prefill repos=${descPrefill.repos} descs=${descPrefill.descs}`,
      )
    } catch (error) {
      console.error('[sync] desc-prefill FAILED', error instanceof Error ? error.message : error)
    }
  }

  // IndexNow 催收:(Bing/Yandex/Seznam 等即时索引联盟)把"近 35 分钟在榜过的仓库"
  // 以 /repo/ 档案页形式直接递给索引引擎,收录从"等爬虫月巡"变"分钟级入口"。
  // 失败静默(催收是馈赠,不是依赖);未配 INDEXNOW_KEY 的环境直接跳过。
  try {
    await pingIndexNow()
  } catch {
    /* 催收失败不影响同步结果 */
  }

  // 百度普通收录 API 实时推送:配额极小(新站约 10 条/日,日清日结),
  // 只推 zh 口径 + 进程内去重;失败/配额枯竭同样静默。
  try {
    await pingBaidu()
  } catch {
    /* 同上 */
  }

  return { total: targets.length, ok, failed, itemsWritten: ok, pruned, durationMs: Date.now() - started, descPrefill }
}

/** IndexNow 提交:host/key/keyLocation + urlList(≤100)。
 * 覆盖面:双主语种首页 + 今日往日榜(每榜当天页,日更新鲜度信号)+ 近 35 分钟在榜仓
 * 的 en/zh 双口径档案页。档案页 cap 收窄到 40 给往日榜留位(总 ≤100 硬上限)。 */
async function pingIndexNow(): Promise<void> {
  const key = (process.env.INDEXNOW_KEY ?? '').trim()
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  if (!key || !base) return
  const { readRecentRepos } = await import('./snapshot')
  const repos = (await readRecentRepos(35, 40)).filter(isRepoFullName)
  const urlList: string[] = [`${base}/en`, `${base}/zh`]
  const today = new Date().toISOString().slice(0, 10)
  for (const slug of BOARD_SLUGS) urlList.push(`${base}/en/history/${slug}/${today}`)
  for (const r of repos) urlList.push(`${base}/en/repo/${r}`, `${base}/zh/repo/${r}`)
  const batch = urlList.slice(0, 100)
  if (batch.length < 3) return
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: base.replace(/^https?:\/\//, ''), key, keyLocation: `${base}/indexnow-key.txt`, urlList: batch }),
    signal: AbortSignal.timeout(12_000),
  })
  console.error(`[indexnow] submitted=${batch.length} http=${res.status}`)
}

/** 百度推送去重:进程内 25h TTL(Vercel 实例的内存态,尽力而为;重复推送顶多浪费小配额)。 */
const baiduPushed = new Map<string, number>()
const BAIDU_DEDUP_TTL = 25 * 60 * 60_000

/** 百度普通收录 API 推送:data.zz.baidu.com,正文为换行分隔 URL。
 * 配额日清且新站仅 ~10 条/日 → 每轮最多 3 条、只推 zh 口径(百度只伺候中文),
 * 首页 zh 每天一次;配额枯竭/网络失败一律静默,绝不拖累同步。 */
async function pingBaidu(): Promise<void> {
  const endpoint = (process.env.BAIDU_PUSH_URL ?? '').trim()
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  if (!endpoint || !base) return
  const { readRecentRepos } = await import('./snapshot')
  const repos = (await readRecentRepos(35, 90)).filter(isRepoFullName)
  const now = Date.now()
  for (const [url, at] of baiduPushed) {
    if (now - at > BAIDU_DEDUP_TTL) baiduPushed.delete(url)
  }
  const candidates = [`${base}/zh`, ...repos.map((r) => `${base}/zh/repo/${r}`)]
  const fresh = candidates.filter((u) => !baiduPushed.has(u)).slice(0, 3)
  if (fresh.length === 0) return
  for (const url of fresh) baiduPushed.set(url, now) // 乐观标记:并发轮次不再重复烧配额
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: fresh.join('\n'),
      signal: AbortSignal.timeout(10_000),
    })
    const text = await res.text()
    console.error(`[baidu-push] ${fresh.length} 条 http=${res.status} ${text.slice(0, 80)}`)
    if (!res.ok) for (const url of fresh) baiduPushed.delete(url)
  } catch (error) {
    for (const url of fresh) baiduPushed.delete(url)
    console.error('[baidu-push] FAILED', error instanceof Error ? error.message : error)
  }
}
