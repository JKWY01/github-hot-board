import { cacheLife, cacheTag } from 'next/cache'

import { readPrecomputedFacets } from './discover-facets-store'
import { readDiscoverMeta, withDb } from './snapshot'

/** 发现页数据层:库内组合筛选(语言/主题/Star 档/创建时间/排序)。
 *  近 7 天增量 = 自有快照对比(当日最新一拍 vs 6 天前或更早的最后一拍);
 *  入库不足 6 天的仓库无基线 → null,页面显示"—"(不猜)。
 *  'use cache' 按参数组合各自缓存 5 分钟,与站点读路径同一纪律。 */

export interface DiscoverRow {
  fullName: string
  stars: number
  gain7: number | null
  language: string | null
  topics: string[]
  createdAt?: string
}

export interface DiscoverFilters {
  lang?: string
  topic?: string
  band?: 's0' | 's1' | 's2' | 's3'
  age?: '7' | '30' | '90' | 'year'
  sort: 'stars' | 'gain'
}

export interface DiscoverRow {
  fullName: string
  stars: number
  gain7: number | null
  language: string | null
  topics: string[]
  createdAt?: string
}

/** 全部过滤/排序/限幅在库内完成:跨洋链路传 6381 行元组曾要 44s(冷 fill 超时毒缓存),
 *  只回最终 60 行后亚秒级。gain7 = 最新一拍 vs 6 天前或更早的最后一拍;无基线为 null(页面显示"—")。 */
const BAND_SQL: Record<NonNullable<DiscoverFilters['band']>, string> = {
  s0: '0 AND 100',
  s1: '100 AND 1000',
  s2: '1000 AND 10000',
  s3: '10000 AND 2147483647',
}
const AGE_SQL: Record<NonNullable<DiscoverFilters['age']>, string> = {
  '7': "now() - interval '7 days'",
  '30': "now() - interval '30 days'",
  '90': "now() - interval '90 days'",
  year: "now() - interval '365 days'",
}

/** lang 参数边界校验(2026-10-29 OOM 事故批,独立提交①)。
 *  生产事故链:ClaudeBot 用无界 topic/lang 组合打 /discover(每 miss=全量 JSONB 展开+新缓存键),
 *  限流只降速不封堵键空间。校验规则按外部评审三类拆分:
 *  ①【拒绝】非法 lang:非字母串/超长(>24)/明显注入形态(含引号括号百分号)→ 返回 null,
 *     上层直接短路,不进 'use cache'(拒绝类请求不产生缓存键=键空间有界);
 *  ②【放行】合法长尾 lang:任何"形如语言名"的词都正常查询(库里没有就自然空结果,不 404)——
 *     Top 榜是 UI 筛选选项,不是合法性边界,拿它当白名单会砍掉 SEO 长尾入口;
 *  ③【既有枚举】band/age/sort 已在 page 层枚举匹配,非法值落默认,无需重复校验。
 *  长度 24:GitHub 官方 languages 列表最长者(delphi/objc 类)远短于此,24 已宽裕。 */
export function sanitizeDiscoverLang(raw: string | undefined): string | null | undefined {
  if (!raw) return undefined
  if (raw.length > 24) return null
  if (!/^[a-zA-Z+#. -]+$/.test(raw)) return null
  // 大小写规范化(评审二轮②):SQL 侧 lower(lang) 语义等价,缓存键必须同语义同键,
  // 否则 TypeScript/typescript/TYPESCRIPT 三份缓存同内容(键空间 ×3 且全是重复计算)
  return raw.toLowerCase()
}

/** topic 参数边界校验(独立提交①,与 lang 同批)。
 *  topic 是 GitHub 官方 topics 命名空间:[a-z0-9-](官方规则),长度上限 35(github 实际限制 50,收紧到 35 留余量)。
 *  合法长尾 topic 全部放行(正常查询,空结果可缓存且键有界:字符集有界→组合有界);
 *  大小写混合/下划线等变体 → null 拒绝(爬虫的笛卡尔积变体正是靠这些绕过缓存键)。 */
export function sanitizeDiscoverTopic(raw: string | undefined): string | null | undefined {
  if (!raw) return undefined
  if (raw.length > 35) return null
  if (!/^[a-z0-9-]+$/.test(raw)) return null
  return raw
}

async function discoverFilteredUncached(f: DiscoverFilters): Promise<DiscoverRow[]> {
  const bandCond = f.band ? ` AND stars BETWEEN ${BAND_SQL[f.band]}` : ''
  const ageCond = f.age ? ` AND created_at IS NOT NULL AND created_at > ${AGE_SQL[f.age]}` : ''
  // lang/topic 是用户输入:必须参数化($1/$2),此前字符串拼接既是注入面,
  // 也让双引号被当标识符解析报 column does not exist(实测 python 组合全空)
  const params: string[] = []
  let langCond = ''
  if (f.lang) {
    params.push(f.lang)
    langCond = ` AND lower(lang) = lower($${params.length})`
  }
  let topicCond = ''
  if (f.topic) {
    params.push(f.topic)
    topicCond = ` AND topics @> jsonb_build_array($${params.length}::text)`
  }
  const order = f.sort === 'gain' ? 'COALESCE(gain7, -1) DESC, stars DESC' : 'stars DESC'
  // 去重必须先于 LIMIT(2026-10-26 外部审查实锤):同一仓库会出现在多个 board_head 行里,
  // 不归并会占满 60 个名额并挤出别的仓库。DISTINCT ON 保任一条(星数以最新快照为准)。
  // gain7 伪零修正:l.stars 有而 p.stars 无 = 历史基线不足,必须真 NULL(页面显示"—"),
  // 不得落 COALESCE 兜成 0 —— 0 是"六天里真的没涨",与"没法算"是两种事实。
  const rows = await withDb(async (sql) =>
    sql.unsafe(`
      WITH meta AS (
        SELECT DISTINCT ON (it->>'fullName')
               it->>'fullName' AS full_name,
               (it->>'stars')::bigint AS stars,
               it->>'language' AS lang,
               COALESCE(it->'topics', '[]'::jsonb) AS topics,
               (it->>'createdAt')::timestamptz AS created_at
        FROM board_head, jsonb_array_elements(payload->'items') AS it
        WHERE item_count > 0 AND it->>'fullName' IS NOT NULL
        ORDER BY it->>'fullName', (it->>'stars')::bigint DESC
      ),
      latest AS (
        SELECT DISTINCT ON (repo) repo, stars FROM board_snapshots
        WHERE language = '' ORDER BY repo, taken_at DESC
      ),
      past AS (
        SELECT DISTINCT ON (repo) repo, stars FROM board_snapshots
        WHERE language = '' AND taken_at < now() - interval '6 days'
        ORDER BY repo, taken_at DESC
      ),
      joined AS (
        SELECT m.full_name, COALESCE(l.stars, m.stars) AS stars,
               CASE WHEN p.stars IS NOT NULL AND l.stars IS NOT NULL
                    THEN l.stars - p.stars END AS gain7,
               m.lang, m.topics, m.created_at
        FROM meta m
        LEFT JOIN latest l ON l.repo = m.full_name
        LEFT JOIN past p ON p.repo = m.full_name
      )
      SELECT full_name, stars, gain7, lang, topics, created_at FROM joined
      WHERE TRUE ${langCond} ${topicCond}
        ${bandCond ? `AND stars BETWEEN ${BAND_SQL[f.band!]}` : ''}
        ${ageCond ? `AND created_at IS NOT NULL AND created_at > ${AGE_SQL[f.age!]}` : ''}
      ORDER BY ${order}
      LIMIT 60`, params),
  )
  if (!rows) throw new Error('discover unavailable (db unreachable/timeout)')
  return (rows as unknown as Array<{ full_name: string; stars: string | number; gain7: string | number | null; lang: string | null; topics: string[] | null; created_at: string | null }>).map((r) => ({
    fullName: r.full_name,
    stars: Number(r.stars),
    gain7: r.gain7 === null ? null : Number(r.gain7),
    language: r.lang,
    topics: Array.isArray(r.topics) ? r.topics : [],
    createdAt: r.created_at ?? undefined,
  }))
}

/** 查询入口(评审二轮重构):分层缓存治理——
 *  ①【常用组合】lang/topic 均在 facets Top 榜内 → 'use cache' 持久缓存
 *     (键空间 = Top10 lang × Top12 topic × 4 band × 4 age × 2 sort ≈ 有界数千,可治理);
 *  ②【合法长尾】不在 Top 榜 → 绕过 'use cache',直查库不落盘(进程内短 TTL 去重抖动),
 *     键空间再大也不产生持久缓存文件——这是"格式校验≠键数量收敛"缺口的真解;
 *  ③【拒绝类】上层已短路,不进本函数。
 *  常用判定用 f.facetsRef(调用方传入的 Top 榜引用,page 层已并行拿到,零额外查询)。 */
export type DiscoverQueryResult = { rows: DiscoverRow[]; status: 'ok' | 'overloaded' }

export async function discoverQuery(f: DiscoverFilters & { facetsRef?: { languages: Array<[string, number]>; topics: Array<[string, number]> } }): Promise<DiscoverQueryResult> {
  const inTopLang = !f.lang || (f.facetsRef?.languages ?? []).some(([l]) => l.toLowerCase() === f.lang)
  const inTopTopic = !f.topic || (f.facetsRef?.topics ?? []).some(([t]) => t.toLowerCase() === f.topic)
  if (inTopLang && inTopTopic) {
    // 持久缓存路径(facetsRef 是引用不参与序列化键——需剥离,否则整个 Top 榜进键)
    const { facetsRef: _omit, ...cacheable } = f
    return { rows: await discoverQueryCached(cacheable), status: 'ok' }
  }
  // 长尾路径:直查库,进程内 30s 微缓存挡同键抖动(不落盘、重启即清)
  return discoverQueryEphemeral(f)
}

async function discoverQueryCached(f: DiscoverFilters): Promise<DiscoverRow[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  return discoverFilteredUncached(f)
}

// ===== 长尾路径的三重资源边界(评审三轮 P0)=====
// 长尾微缓存:Map<key,{at,rows}>,容量与年龄双帽——溢出/过期即逐出,绝不持久化
const _ephemeral = new Map<string, { at: number; rows: DiscoverRow[] }>()
const EPHEMERAL_TTL_MS = 30_000
const EPHEMERAL_MAX = 500

// single-flight:同键并发共享一个在途 Promise(评审三轮 P0-1)
const _inflight = new Map<string, Promise<DiscoverQueryResult>>()

// 数据库并发硬上限(评审三轮 P0,评审四轮重写):信号量限制同时进行的昂贵长尾查询数。
// MAX_CONCURRENT=2:与生产读池 max=5 对齐留余量——长尾最多占 2 条连接/进程,
// 榜单页/API/同步永远有连接可用。注意这是单进程上限,多实例需实例级监控佐证。
const MAX_LONGTAIL_CONCURRENT = 2
let _running = 0
// 等待队列:waiter 对象(身份唯一,超时与释放都通过它查找——评审四轮 P0-1 修正:
// 原实现入队匿名函数与超时查找的 wake 引用不同,indexOf 永远 miss,超时项滞留队列
// 被后续 release 消费 → 槽位转交给已放弃的请求 → _running 计数泄漏)
const _waitQueue: Array<{ done: boolean; wake: (v: boolean) => void; timer: NodeJS.Timeout }> = []
// 队列等待预算:排队超过 → 可控降级(空结果),不让请求无限堆积。3s=冷 miss P99(~1s)的 3 倍。
const QUEUE_WAIT_BUDGET_MS = 3_000
// 队列容量硬上限(评审四轮 P0-2):超出立即降级,不创建新的等待 Promise/计时器。
// 50 = 2 在途 × 每查询 ~1s × 3s 预算窗口内的合理积压上界,超出即说明过载,快速失败优于深排队。
const QUEUE_MAX = 50
const LONGTAIL_DEGRADED: DiscoverRow[] = []
// 过载观测(评审四轮:降级要有明确状态与可观测计数,不伪装成正常查询)
const _overloadStats = { queueFullRejects: 0, budgetTimeouts: 0 }

async function acquireLongtailSlot(): Promise<'acquired' | 'budget-exceeded' | 'queue-full'> {
  if (_running < MAX_LONGTAIL_CONCURRENT) {
    _running++
    return 'acquired'
  }
  if (_waitQueue.length >= QUEUE_MAX) {
    _overloadStats.queueFullRejects++
    return 'budget-exceeded' // 立即降级,不创建等待者
  }
  return await new Promise<'acquired' | 'budget-exceeded'>((resolve) => {
    // waiter 身份唯一:done 幂等护栏(成功/超时只能走一条路,评审四轮 P0-1 要求)
    const waiter: { done: boolean; wake: (v: boolean) => void; timer: NodeJS.Timeout } = {
      done: false,
      wake: (v: boolean) => {
        if (waiter.done) return
        waiter.done = true
        clearTimeout(waiter.timer)
        resolve(v ? 'acquired' : 'budget-exceeded')
      },
      timer: null as unknown as NodeJS.Timeout,
    }
    waiter.timer = setTimeout(() => {
      // 超时:自己把自己从队列摘除(身份查找),槽位从未被转交
      const idx = _waitQueue.indexOf(waiter)
      if (idx >= 0) _waitQueue.splice(idx, 1)
      _overloadStats.budgetTimeouts++
      waiter.wake(false)
    }, QUEUE_WAIT_BUDGET_MS)
    _waitQueue.push(waiter)
  })
}

function releaseLongtailSlot(): void {
  _running--
  // 转交给队首【未完成】的等待者;waiter.wake 内部置 done,不会二次消费
  const next = _waitQueue.find(w => !w.done)
  if (next) {
    const idx = _waitQueue.indexOf(next)
    _waitQueue.splice(idx, 1)
    _running++
    next.wake(true)
  }
}

/** 过载状态观察口(评审五轮⑤:计数≠监控,需采集通道)。
 *  生产监控方案(随发版上线):①samples.sh 每 10 分钟采样时经 node -e 调本函数,追加到
 *  observe/samples.log 新列(queueFullRejects/budgetTimeouts 差值=该窗口过载次数);
 *  ②阈值告警:连续 3 个窗口 budgetTimeouts 增量 >100 → 评审/用户告警(=长尾持续过载);
 *  ③页面 '查询繁忙' 渲染次数另由 nginx $request_time+页面特征字采样(观察 p99 尾部)。 */
export function __testOnlyLongtailState(): { running: number; queued: number; inflight: number; queueFullRejects: number; budgetTimeouts: number } {
  return { running: _running, queued: _waitQueue.length, inflight: _inflight.size, queueFullRejects: _overloadStats.queueFullRejects, budgetTimeouts: _overloadStats.budgetTimeouts }
}

async function discoverQueryEphemeral(f: DiscoverFilters): Promise<DiscoverQueryResult> {
  const key = JSON.stringify([f.lang ?? null, f.topic ?? null, f.band ?? null, f.age ?? null, f.sort])
  const hit = _ephemeral.get(key)
  const now = Date.now()
  if (hit && now - hit.at < EPHEMERAL_TTL_MS) return { rows: hit.rows, status: 'ok' }
  // single-flight:在途同键共享(并发 N 个同键 = 1 次打库)
  const flight = _inflight.get(key)
  if (flight) return flight
  // exec 返回 [rows, degraded]:降级与结果分离(评审四轮 P1-2 修正——
  // 原实现降级空数组也被无条件写进 _ephemeral,30s 内同键命中空结果不再真查)
  const exec = (async (): Promise<DiscoverQueryResult> => {
    const slot = await acquireLongtailSlot()
    if (slot !== 'acquired') return { rows: LONGTAIL_DEGRADED, status: 'overloaded' } // 降级(预算超时或队列满)
    try {
      return { rows: await discoverFilteredUncached(f), status: 'ok' }
    } finally {
      releaseLongtailSlot()
    }
  })()
  _inflight.set(key, exec)
  try {
    const { rows, status } = await exec
    const degraded = status === 'overloaded'
    if (!degraded) {
      // 只有真实查询结果才进微缓存;降级不缓存,压力消退后同键立即真查
      if (_ephemeral.size >= EPHEMERAL_MAX) {
        // 最老逐出:Map 迭代序即插入序
        const oldest = _ephemeral.keys().next().value
        if (oldest !== undefined) _ephemeral.delete(oldest)
      }
      _ephemeral.set(key, { at: Date.now(), rows })
    }
    // 状态显式返回(评审五轮 P1:过载不再伪装成正常空结果,页面独立渲染繁忙提示)
    return { rows, status: degraded ? 'overloaded' : 'ok' }
  } finally {
    _inflight.delete(key)
  }
}

/** 筛选项(语言/主题 Top 榜):读预计算行(OOM 批④,零扫描);
 *  行不存在/超龄(>24h)/损坏 → 回落全量扫描(行为不劣化,宁可慢不可错)。 */
export async function discoverFacets(): Promise<{ languages: Array<[string, number]>; topics: Array<[string, number]> }> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 })
  // tag 关联(评审二轮④):revalidateTag('discover-facets','max') 需条目先关联 tag 才能命中;
  // 此前只 revalidate 不 cacheTag = 失效链路断开(同步更新后页面可能读到旧 facets)
  cacheTag('discover-facets')
  const precomputed = await readPrecomputedFacets()
  if (precomputed) return precomputed
  const ok = await withDb(async (sql) => {
    const rows = await sql`
      SELECT it->>'language' AS lang,
             it->'topics' AS topics
      FROM board_head, jsonb_array_elements(payload->'items') AS it
      WHERE item_count > 0`
    const langs = new Map<string, number>()
    const topics = new Map<string, number>()
    for (const r of rows as unknown as Array<{ lang: string | null; topics: string[] | null }>) {
      if (r.lang) langs.set(r.lang, (langs.get(r.lang) ?? 0) + 1)
      for (const t of Array.isArray(r.topics) ? r.topics : []) topics.set(t, (topics.get(t) ?? 0) + 1)
    }
    const top = (x: Map<string, number>, n: number) => [...x.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    return { languages: top(langs, 10), topics: top(topics, 12) }
  })
  if (!ok) throw new Error('discover-facets unavailable (db unreachable/timeout)')
  return ok
}
