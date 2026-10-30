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
    // 评审十三/十四/十五轮:过载识别不依赖异常身份(生产 'use cache' 边界会重序列化
    // 异常,外层 instanceof 恒 false)——读【键级 generation】过载信号(见 _overloadGen 注释):
    // 只有【本请求期间】该键 generation 增大才认定本次过载。
    // 快照在调用前取——同键历史过载不会污染后续请求;同键并发共享同一次 throw。
    const myKey = buildDiscoverCacheKey(cacheable)
    const genBefore = _overloadGen.get(myKey) ?? 0
    try {
      return { rows: await discoverQueryCached(cacheable), status: 'ok' }
    } catch (e) {
      if ((_overloadGen.get(myKey) ?? 0) > genBefore) {
        // 本请求期间本键 generation 增大 = 本次调用(或与本调用合并的同键填充)遇到过载
        return { rows: [], status: 'overloaded' }
      }
      // 非过载(数据源不可用/超时等)继续上抛 → 页面渲染 degraded
      throw e
    }
  }
  // 长尾路径:直查库,进程内 30s 微缓存挡同键抖动(不落盘、重启即清)
  return discoverQueryEphemeral(f)
}

/** 持久路径过载信号(评审十一轮 P0 → 十三轮/十四轮迭代 → 十五代数定稿):
 *  过载必须经 throw 逃出 'use cache'(Next 对 throw 不写持久缓存——防瞬时过载固化),
 *  但【十三轮实锤】生产模式 'use cache' 边界会重序列化异常(原型/message 全被脱敏替换),
 *  外层 instanceof 恒 false——信号不能依赖异常身份跨边界。
 *  迭代史(每轮都被真框架实测纠错):十三轮全局计数器+时间窗=跨请求误判窗(十四轮否);
 *  十四轮键级时间戳标记=同键历史标记污染同键后续 DB 错(十五轮否:标记有效期不删=
 *  陈旧状态泄漏,删了又破坏同键并发等待者识别);
 *  十五轮定稿=键级 generation(单调代数):请求前快照同键 generation,catch 时比对——
 *  只有【本请求期间】该键 generation 增大才认定本次过载;不清除、不重置、无 TTL,
 *  容量天然有界(持久键空间 ≈7,150,见评审二轮键不变式),不存在"清理破坏在途引用"。
 *  真框架终验(Next 16.4.2 next start):同键过载 3 并发等待者全识别;同键紧接 DB 真错
 *  =degraded 不被历史标记污染;恢复后同键成功不受影响;跨键隔离(十四轮矩阵)沿用。
 */
class DiscoverOverloadedError extends Error {
  constructor() {
    super('discover overloaded (queue-full/budget-exceeded)')
    this.name = 'DiscoverOverloadedError'
  }
}

/** discoverQueryCached 的稳定缓存键:与长尾微缓存键同构(过滤维度全量入键)。
 *  必须与 'use cache' 实际参数序列化语义对齐——cacheable 恰好是纯 DiscoverFilters,
 *  无 facetsRef 等引用,故 JSON.stringify 稳定。 */
function buildDiscoverCacheKey(f: DiscoverFilters): string {
  return JSON.stringify([f.lang ?? null, f.topic ?? null, f.band ?? null, f.age ?? null, f.sort])
}

async function discoverQueryCached(f: DiscoverFilters): Promise<DiscoverRow[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  // 评审十轮:持久路径冷 miss 与长尾共享同一并发帽(单一全局 discover DB 预算=2)。
  // 同键并发由 'use cache' 填充合并;不同键冷 miss 此前无界——现在有帽。
  // 评审十一轮 P0 修复:严格信号量契约——未获得槽位(budget-exceeded/queue-full)
  // =不执行 SQL、不 release(此前无条件 release 会错误递减 _running 并击穿并发帽);
  // 过载=throw(不写持久缓存)。
  // 评审十三轮 P0+十五轮:throw 身份跨 'use cache' 边界会被生产模式抹掉——
  // 未获槽位时单调递增本键 generation(slot 判定权威,不依赖 instanceof),
  // 再 throw 普通 Error(身份丢给 Next 无所谓);外层用 generation 增量识别。
  const slot = await acquireDiscoverSlot()
  if (slot !== 'acquired') {
    // 单调递增该键的 generation(缓存作用域内,instanceof 不可靠此处也不用 instanceof——
    // slot 判定本身权威)。throw 后由外层用 generation 增量识别。
    const k = buildDiscoverCacheKey(f)
    _overloadGen.set(k, (_overloadGen.get(k) ?? 0) + 1)
    throw new DiscoverOverloadedError()
  }
  try {
    return await discoverFilteredUncached(f)
  } finally {
    releaseDiscoverSlot()
  }
}

// 键级过载信号(评审十五轮定稿):Map<缓存键, generation>——单调递增代数,不是时间戳。
// 判定:外层 catch 比较【调用前后】同键 generation;只有本请求期间增大=本次过载。
// 为什么不用时间戳标记(评审十四轮发现的坑):Map<key,at> 有效期内不删=同键历史标记
// 污染同键后续 DB 错;删了又破坏同键并发等待者的识别。generation 无清除时序问题。
// 容量天然有界:持久键空间 ≈7,150(评审二轮键不变式),无需 TTL/清理——
// 这就是不重置在途引用的根本解法(评审提醒:不为清理而重置 generation)。
const _overloadGen = new Map<string, number>()

// ===== 长尾路径的三重资源边界(评审三轮 P0)=====
// 长尾微缓存:Map<key,{at,rows}>,容量与年龄双帽——溢出/过期即逐出,绝不持久化
const _ephemeral = new Map<string, { at: number; rows: DiscoverRow[] }>()
const EPHEMERAL_TTL_MS = 30_000
const EPHEMERAL_MAX = 500

// single-flight:同键并发共享一个在途 Promise(评审三轮 P0-1)
const _inflight = new Map<string, Promise<DiscoverQueryResult>>()

// 数据库并发硬上限(评审三轮 P0,评审四轮重写):信号量限制同时进行的昂贵 Discover 查询数
// (持久路径冷 miss 与长尾共享,评审十轮起为单一全局预算)。
// Discover 查询最多占用 2 个并发槽位,为其他数据库操作保留连接池容量;
// 但其他业务之间仍共享同一连接池,这【不构成连接隔离保证】。注意这是单进程上限,多实例需实例级监控佐证。
const MAX_DISCOVER_DB_CONCURRENT = 2
let _running = 0
// 等待队列:waiter 对象(身份唯一,超时与释放都通过它查找——评审四轮 P0-1 修正:
// 原实现入队匿名函数与超时查找的 wake 引用不同,indexOf 永远 miss,超时项滞留队列
// 被后续 release 消费 → 槽位转交给已放弃的请求 → _running 计数泄漏)
const _waitQueue: Array<{ done: boolean; wake: (v: boolean) => void; timer: NodeJS.Timeout }> = []
// 队列等待预算:排队超过 → 可控降级(空结果),不让请求无限堆积。3s=冷 miss P99(~1s)的 3 倍。
const QUEUE_WAIT_BUDGET_MS = 3_000
// 队列容量硬上限(评审四轮 P0-2,六轮注记纠偏):超出立即降级,不创建新的等待 Promise/计时器。
// QUEUE_MAX = 50 是未经生产压测校准的【暂定工程阈值】——不再为它补造数学依据;
// 正式阈值待上线后结合实际到达率、查询耗时分布和业务允许的拒绝率确定。
const QUEUE_MAX = 50
const LONGTAIL_DEGRADED: DiscoverRow[] = []
// 过载观测(评审四轮:降级要有明确状态与可观测计数,不伪装成正常查询)
const _overloadStats = { queueFullRejects: 0, budgetTimeouts: 0 }

async function acquireDiscoverSlot(): Promise<'acquired' | 'budget-exceeded' | 'queue-full'> {
  if (_running < MAX_DISCOVER_DB_CONCURRENT) {
    _running++
    return 'acquired'
  }
  if (_waitQueue.length >= QUEUE_MAX) {
    _overloadStats.queueFullRejects++
    // 生产监控采集(评审六轮 P1-4):应用进程内直接输出结构化日志,采样侧 grep 'ghb-overload' 汇总
    console.error(JSON.stringify({ event: 'ghb-overload', kind: 'queue-full', running: _running, queued: _waitQueue.length, total: _overloadStats.queueFullRejects }))
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
      // queued = 摘除自身后的实际队列长度(七轮①:此前 length-1 会持续低估排队数)
      console.error(JSON.stringify({ event: 'ghb-overload', kind: 'budget-timeout', running: _running, queued: _waitQueue.length, total: _overloadStats.budgetTimeouts }))
      waiter.wake(false)
    }, QUEUE_WAIT_BUDGET_MS)
    _waitQueue.push(waiter)
  })
}

function releaseDiscoverSlot(): void {
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

/** 过载状态观察口(评审七轮②同步:实际部署方式,非 node -e 跨进程方案——
 *  _overloadStats 是服务进程内存状态,跨进程读只会读到零,已弃用)。
 *  实际链路:过载事件发生时【本进程】console.error 结构化日志(ghb-overload)
 *  → docker json log → HK observe/sample.sh v4 每 10 分钟直读 json log 文件过滤 10 分钟窗口,
 *  分列为 qf10m(queue-full)/bt10m(budget-timeout)两列。(v4 脚本全文见 docs/review 入库文档)
 *  告警阈值(候选,待基线校准):连续 3 窗口 budgetTimeouts 增量>100;queueFullRejects 独立规则待补。
 *  链路验证:queue-full 已隔离实测入日志(running=2/queued=50);budget-timeout 真实进程触发
 *  待部署后由 bt10m 观察(路径已由行为测试 Ⅳb 封死)。 */
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
    const slot = await acquireDiscoverSlot()
    if (slot !== 'acquired') return { rows: LONGTAIL_DEGRADED, status: 'overloaded' } // 降级(预算超时或队列满)
    try {
      return { rows: await discoverFilteredUncached(f), status: 'ok' }
    } finally {
      releaseDiscoverSlot()
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
