import { cacheLife } from 'next/cache'

import { facetLangSlug } from './facet'
import { isRepoFullName } from './reposhape'
import type { BoardData } from './types'

/** 数据底座(可选,零侵入):DATABASE_URL 配置后成为全站唯一数据源。
 *
 * 双表:
 *   board_head      —— 每键一行,站点读路径直接吃这行(payload JSONB),始终最新一拍
 *   board_snapshots —— 每次同步的明细行(逐仓逐名次),分析与「往日榜」的原料
 *
 * 未配置 DATABASE_URL 时一切 no-op:构建与请求零依赖,回退磁盘/按需拉取。
 * 表结构与索引首次写入时自动创建。
 *
 * 分析用法(接库后):
 *   -- 某仓库名次时序
 *   SELECT taken_at, rank FROM board_snapshots WHERE board='rising' AND repo='x/y' ORDER BY taken_at;
 *   -- 月度新星对比
 *   SELECT date_trunc('month', taken_at) m, count(DISTINCT repo)
 *   FROM board_snapshots WHERE board='rising' GROUP BY 1 ORDER BY 1;
 */

const DATABASE_URL = (process.env.DATABASE_URL ?? '').trim()
const RETENTION_DAYS = Number(process.env.SNAPSHOT_RETENTION_DAYS) || 60

type Sql = import('postgres').Sql

export function dbUrlConfigured(): boolean {
  return DATABASE_URL !== ''
}

/** 连接常驻(模块级单例):避免每次读库重建 TLS 握手(实测省 1-3s/次)。
 * max=8:同步风暴(writeHeadAndRows 逐榜大事务)+ 访客读(RSC 洞)/api 读同时上线,
 * 2 条会被写队列把读请求拖到秒级,导航洞渲染变长(体感就是切榜卡)。Neon 免费层上限远高于此。 */
let sqlSingleton: import('postgres').Sql | null = null
let tableReady = false

/** 全部 DDL 收拢到这里。访客读路径不再主动建表(冷启动省 1-6s),表缺失时按 42P01 自愈。 */
async function migrate(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS board_head (
      key          TEXT PRIMARY KEY,
      board        TEXT NOT NULL,
      language     TEXT NOT NULL DEFAULT '',
      source       TEXT NOT NULL,
      degraded     BOOLEAN NOT NULL DEFAULT false,
      item_count   INTEGER NOT NULL DEFAULT 0,
      generated_at TIMESTAMPTZ NOT NULL,
      taken_at     TIMESTAMPTZ NOT NULL,
      payload      JSONB NOT NULL
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS board_snapshots (
      taken_at        TIMESTAMPTZ NOT NULL,
      board           TEXT        NOT NULL,
      language        TEXT        NOT NULL DEFAULT '',
      source          TEXT        NOT NULL DEFAULT '',
      rank            INTEGER     NOT NULL,
      repo            TEXT        NOT NULL,
      stars           BIGINT      NOT NULL,
      forks           INTEGER     NOT NULL,
      metric          DOUBLE PRECISION NOT NULL DEFAULT 0,
      repo_created_at TIMESTAMPTZ
    )`
  // 往日榜(2026-10-19 起):明细表补 degraded 列(老库幂等迁移)
  await sql`ALTER TABLE board_snapshots ADD COLUMN IF NOT EXISTS degraded BOOLEAN NOT NULL DEFAULT false`
  // 项目状态三件套(2026-10-25 起采集):license/push/issues 随拍落列。
  // 老行 NULL = 未采集,页面如实标"未知"——历史不可凭空补。
  await sql`ALTER TABLE board_snapshots ADD COLUMN IF NOT EXISTS license TEXT`
  await sql`ALTER TABLE board_snapshots ADD COLUMN IF NOT EXISTS pushed_at TEXT`
  await sql`ALTER TABLE board_snapshots ADD COLUMN IF NOT EXISTS issues INTEGER`
  await sql`CREATE INDEX IF NOT EXISTS board_snapshots_repo_time ON board_snapshots (repo, taken_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS board_snapshots_board_time ON board_snapshots (board, language, taken_at DESC)`
  // 保留期清理走 taken_at 过滤:量级到千万行后,专用索引让 DELETE 不再全索引扫
  await sql`CREATE INDEX IF NOT EXISTS board_snapshots_taken_at ON board_snapshots (taken_at)`
  // 仓库级多语描述缓存(访问驱动渐进填充,跨全榜复用)
  await sql`
    CREATE TABLE IF NOT EXISTS repo_desc (
      full_name  TEXT PRIMARY KEY,
      payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  // 收割进度:(仓库, 语言) 的探测结论。resolved=true 表示有确定结论
  // (拿到描述 / 有翻译但无可用首句 / 该语言不存在),新鲜期内不再探测;
  // false 表示上次探测被网络/限流打断,下一轮同步立即重试。
  await sql`
    CREATE TABLE IF NOT EXISTS repo_desc_probe (
      full_name  TEXT NOT NULL,
      locale     TEXT NOT NULL,
      resolved   BOOLEAN NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (full_name, locale)
    )`
  // 过榜仓库名单(仓库粒度一行):proxy 的"存在名单"与 sitemap 的全量仓库源。
  // 之前两处都对 board_snapshots 做 DISTINCT 全表扫 —— 明细表按 60 天保留能涨到千万行级,
  // 每 5 分钟扫一次是真实的算力地雷;这里用小表(几万行、主键索引)承载同一语义,
  // 由 writeHeadAndRows 随拍 upsert、pruneOld 与明细同窗清理。
  await sql`
    CREATE TABLE IF NOT EXISTS repo_seen (
      repo      TEXT PRIMARY KEY,
      last_seen TIMESTAMPTZ NOT NULL
    )`
  // 一次性回填:只在 repo_seen 为空时跑(老库升级);GROUP BY 走 repo 索引,跑完即免。
  const seeded = await sql`SELECT 1 FROM repo_seen LIMIT 1`
  if (seeded.length === 0) {
    await sql`
      INSERT INTO repo_seen (repo, last_seen)
      SELECT repo, max(taken_at) FROM board_snapshots GROUP BY repo
      ON CONFLICT (repo) DO NOTHING`
  }
  tableReady = true
}

export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T | undefined> {
  if (!DATABASE_URL) return undefined
  try {
    if (!sqlSingleton) {
      const postgres = (await import('postgres')).default
      // max 5:库角色连接上限被多实例×并发爬取打爆过(too many connections);读路径双查并行 5 足够
      sqlSingleton = postgres(DATABASE_URL, {
        max: 5,
        idle_timeout: 30,
        connect_timeout: 10,
        // 诊断开关:GHB_SQL_DEBUG=1 时打印实际发送的 SQL 与参数个数
        debug: process.env.GHB_SQL_DEBUG
          ? (_conn, query, params) => {
              const dump = typeof query === 'string' ? query : JSON.stringify(query)
              console.error('[sql]', typeof query, String(dump).slice(0, 260), '| params:', Array.isArray(params) ? params.length : 0)
            }
          : undefined,
      })
    }
    const sql = sqlSingleton
    try {
      // 查询级竞速超时(20s):连接池被同步/并发爬取挤爆时,postgres 驱动会无界排队,
      // Lambda 到 maxDuration 被掐 → 200 空流被边缘缓存成毒对象(实测事故)。
      // 超时走下方 catch → 返回 undefined → 调用方走各自的兜底路径。
      // 20s 而非 10s:board_head 全量 payload 的 meta 扫描在国内线路 >10s,10s 会把
      // 冷 fill 掐成空 Map 被 'use cache' 固化(实测:discover 页空结果 2 小时)。
      return await Promise.race([
        fn(sql),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('db-query-timeout(20s)')), 20_000),
        ),
      ])
    } catch (error) {
      // 访客冷启动跳过了建表:撞到"表不存在"(42P01)时补一次迁移再重试,
      // 之后 tableReady 置位,正常路径零额外往返。
      const code = (error as { code?: string })?.code
      const msg = error instanceof Error ? error.message : String(error)
      if ((code === '42P01' || msg.includes('does not exist')) && !tableReady) {
        await migrate(sql)
        return await fn(sql)
      }
      throw error
    }
  } catch (error) {
    // 库不可用/连接死亡时绝不拖垮调用方(读路径会自动回退磁盘/现场拉取);
    // 丢弃单例连接,下一次调用用全新客户端重建(建表语句 IF NOT EXISTS 幂等)。
    sqlSingleton = null
    tableReady = false
    console.error('[snapshot]', error instanceof Error ? error.message : error)
    return undefined
  }
}

/** 与持久层/缓存同规则的数据键:`weekly` + `C++` → `weekly-cpp`。 */
export function dbKey(slug: string, language?: string): string {
  return language ? `${slug}-${facetLangSlug(language)}` : slug
}

/** 每 key 最新一拍:head 行 upsert(站点读的唯一入口)+ 明细追加。降级/失败快照也入冢,
 * 带好 source 与 degraded 标,历史连贯并让口径诚实。 */
/** 上一拍名次嵌进本拍载荷(board_head 只留最新,payload 里带 prevRank,
 * 任何访客打开页面都能直接看到相对上一轮同步的爬/掉榜,而不必恰好守在换拍一刻)。
 * 纯函数:上一拍存在就写(同名次也写)—— 前端"prevRank 缺省 = 真新进"的判定依赖此约定;
 * 上一拍没有的行不写字段。 */
export function withPrevRanks<T extends { fullName: string }>(
  items: T[],
  prevItems: Array<{ fullName: string }>,
): Array<T & { prevRank?: number }> {
  const prevOrder = new Map<string, number>()
  prevItems.forEach((it, i) => prevOrder.set(it.fullName, i))
  return items.map((item, index) => {
    const prev = prevOrder.get(item.fullName)
    if (prev === undefined) return item
    return { ...item, prevRank: prev }
  })
}

export async function writeHeadAndRows(slug: string, language: string | undefined, data: BoardData): Promise<boolean> {
  if (!DATABASE_URL) return false
  const takenAt = data.generatedAt ? new Date(data.generatedAt) : new Date()
  const key = dbKey(slug, language)
  return (await withDb(async (sql) => {
    // 真事务(2026-10-26 外部审查实锤"注释自称大事务实际没开"):三张表要么同拍全落,
    // 要么全回滚 —— 榜头更新而快照/过榜名单失败会造成页面、历史、档案入口三处口径分裂
    return (await sql.begin(async (tx) => {
      const rows = await tx`SELECT payload FROM board_head WHERE key = ${key} LIMIT 1`
      const prevItems = (rows[0] as { payload?: BoardData } | undefined)?.payload?.items ?? []
      const written: BoardData = { ...data, items: withPrevRanks(data.items, prevItems) }

      await tx`
        INSERT INTO board_head (key, board, language, source, degraded, item_count, generated_at, taken_at, payload)
        VALUES (${key}, ${slug}, ${language ?? ''}, ${written.source}, ${written.degraded ?? false}, ${written.items.length},
                ${takenAt}, ${takenAt}, ${tx.json(written as unknown as Parameters<typeof tx.json>[0])})
        ON CONFLICT (key) DO UPDATE SET
          board = EXCLUDED.board, language = EXCLUDED.language, source = EXCLUDED.source,
          degraded = EXCLUDED.degraded, item_count = EXCLUDED.item_count,
          generated_at = EXCLUDED.generated_at, taken_at = EXCLUDED.taken_at, payload = EXCLUDED.payload
        WHERE board_head.taken_at <= EXCLUDED.taken_at`

      const values = data.items.map((item, index) => ({
        taken_at: takenAt,
        board: slug,
        language: language ?? '',
        source: data.source,
        degraded: data.degraded ?? false,
        rank: index + 1,
        repo: item.fullName,
        stars: item.stars,
        forks: item.forks,
        metric:
          typeof item.slope === 'number'
            ? item.slope
            : typeof item.score === 'number'
              ? item.score
              : (item.gained ?? item.stars),
        repo_created_at: item.createdAt ? new Date(item.createdAt) : null,
        license: item.license ?? null,
        pushed_at: item.pushedAt ?? null,
        issues: typeof item.issues === 'number' ? item.issues : null,
      }))
      if (values.length) {
        await tx`
          INSERT INTO board_snapshots ${tx(
            values,
            'taken_at', 'board', 'language', 'source', 'degraded', 'rank', 'repo', 'stars', 'forks', 'metric', 'repo_created_at', 'license', 'pushed_at', 'issues',
          )}`
        // 过榜名单随拍更新(主键 upsert,几万行小表,毫秒级)
        await tx`
          INSERT INTO repo_seen ${tx(
            values.map((v) => ({ repo: v.repo, last_seen: v.taken_at })),
            'repo', 'last_seen',
          )}
          ON CONFLICT (repo) DO UPDATE SET last_seen = EXCLUDED.last_seen`
      }
      return true
    })) === true
  })) === true
}

/** 读路径:取某键最新一拍。返回 null(无库/无行/库不可用),由调用方回退。 */
export async function readBoardHead(key: string): Promise<{ data: BoardData; ageMs: number } | null> {
  if (!DATABASE_URL) return null
  return (await withDb(async (sql) => {
    const rows = await sql`
      SELECT payload, taken_at FROM board_head WHERE key = ${key} LIMIT 1`
    const row = rows[0] as { payload: unknown; taken_at: Date } | undefined
    if (!row) return null
    return {
      data: row.payload as BoardData,
      ageMs: Date.now() - Number(new Date(row.taken_at).getTime() || Date.now()),
    }
  })) ?? null
}

/** 保留期治理:明细行超龄即清理(head 表只留最新,天然自洁);
 * repo_seen 与明细同窗清理 —— 名单语义 = "保留期内上过榜的仓库";
 * repo_docs(README 渲染缓存,实测占库最大头)30 天轮换,冷门仓库按需重取。 */
export async function pruneOld(): Promise<number> {
  return (await withDb(async (sql) => {
    const result = await sql`
      DELETE FROM board_snapshots WHERE taken_at < now() - (${RETENTION_DAYS} || ' days')::interval`
    await sql`
      DELETE FROM repo_seen WHERE last_seen < now() - (${RETENTION_DAYS} || ' days')::interval`
    await sql`
      DELETE FROM repo_docs WHERE fetched_at < now() - interval '30 days'`
    return Number(result.count)
  })) ?? 0
}

/** 同榜邻居(档案页内链网):拿该榜基准口径(head 表最新 payload),以本仓库当前
 * 名次为中心取前后各 3 名,排除自己。读的是现成 board_head,零新查询成本。 */
export async function readBoardNeighbors(board: string, fullName: string) {
  const head = await readBoardHead(dbKey(board))
  const items = head?.data.items ?? []
  if (items.length === 0) return []
  const me = items.findIndex((it) => it.fullName === fullName)
  if (me < 0) return []
  const slice = items.slice(Math.max(0, me - 3), me + 4)
  return slice
    .filter((it) => it.fullName !== fullName)
    .map((it) => ({ fullName: it.fullName, rank: items.indexOf(it) + 1, stars: Number(it.stars) || 0 }))
}

/** 近 N 分钟在榜过的仓库(去重,上限 cap):IndexNow 催收清单的种子。 */
export async function readRecentRepos(mins = 35, cap = 100): Promise<string[]> {
  if (!DATABASE_URL) return []
  return (await withDb(async (sql) => {
    const rows = await sql`
      SELECT DISTINCT repo FROM board_snapshots
      WHERE taken_at > now() - (${mins} || ' minutes')::interval
      LIMIT ${cap}`
    return rows.map((r) => String(r.repo))
  })) ?? []
}

/** 概览(诊断用)。 */
export async function dbStats(): Promise<{ headKeys: number; rows: number } | null> {
  return (await withDb(async (sql) => {
    const head = await sql`SELECT count(*)::int AS n FROM board_head`
    const rows = await sql`SELECT count(*)::bigint AS n FROM board_snapshots`
    return { headKeys: Number((head[0] as { n: number }).n), rows: Number((rows[0] as { n: number }).n) }
  })) ?? null
}

/** 状态页用:全部榜头键的健康面(键/榜/语言/来源/是否降级/拍时刻/行数)。
 *  读的是 board_head 主键表(≤34 行),与站点读路径同源 —— 状态页所见即访客所得。 */
export interface HeadHealthRow {
  key: string
  board: string
  language: string
  source: string
  degraded: boolean
  itemCount: number
  takenAt: string
}

export async function readHeadHealth(): Promise<HeadHealthRow[] | null> {
  return (await withDb(async (sql) => {
    const rows = await sql`
      SELECT key, board, language, source, degraded, item_count, taken_at
      FROM board_head
      ORDER BY board, language`
    return (rows as unknown as Array<{
      key: string; board: string; language: string; source: string
      degraded: boolean; item_count: number; taken_at: Date
    }>).map((r) => ({
      key: r.key,
      board: r.board,
      language: r.language,
      source: r.source,
      degraded: Boolean(r.degraded),
      itemCount: Number(r.item_count),
      takenAt: new Date(r.taken_at).toISOString(),
    }))
  })) ?? null
}

/* ------------------------------ 往日榜(历史回看) ------------------------------ */

export interface HistoryDay {
  day: string // YYYY-MM-DD(UTC 日,取当日最后一拍)
  takenAt: string
}

export interface HistoryRow {
  rank: number
  repo: string
  stars: number
  forks: number
  metric: number
}

export interface HistorySnapshot {
  takenAt: string
  source: string
  degraded: boolean
  rows: HistoryRow[]
}

/** 某榜可看的日期清单(最多 limit 天,最新在前)。v1 只存基准口径(language = '')。 */
export async function readHistoryDays(board: string, limit = 30): Promise<HistoryDay[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  if (!/^[a-z-]{1,24}$/.test(board)) return []
  return (await withDb(async (sql) => {
    const rows = await sql`
      SELECT to_char(date_trunc('day', taken_at), 'YYYY-MM-DD') AS day,
             max(taken_at) AS taken_at
      FROM board_snapshots
      WHERE board = ${board} AND language = ''
      GROUP BY date_trunc('day', taken_at)
      ORDER BY day DESC LIMIT ${limit}`
    return (rows as unknown as Array<{ day: string; taken_at: Date }>).map((r) => ({
      day: r.day,
      takenAt: new Date(r.taken_at).toISOString(),
    }))
  })) ?? []
}

/** 取某一天的榜单快照(该日最后一拍)。返回 null = 那天没档案。 */
export async function readHistorySnapshot(board: string, day: string): Promise<HistorySnapshot | null> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  if (!/^[a-z-]{1,24}$/.test(board)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return (await withDb(async (sql) => {
    const tap = await sql`
      SELECT max(taken_at) AS taken_at
      FROM board_snapshots
      WHERE board = ${board} AND language = ''
        AND taken_at >= ${day}::timestamptz
        AND taken_at <  (${day}::timestamptz + interval '1 day')`
    const tapAt = (tap[0] as { taken_at: Date | null } | undefined)?.taken_at
    if (!tapAt) return null
    const rows = await sql`
      SELECT rank, repo, stars, forks, metric, source, degraded
      FROM board_snapshots
      WHERE board = ${board} AND language = '' AND taken_at = ${tapAt}
      ORDER BY rank ASC`
    const list = rows as unknown as Array<{ rank: number; repo: string; stars: number | string; forks: number | string; metric: number | string; source: string; degraded: boolean }>
    if (!list.length) return null
    return {
      takenAt: new Date(tapAt).toISOString(),
      source: list[0]?.source ?? '',
      degraded: list[0]?.degraded ?? false,
      rows: list.map((r) => ({
        rank: Number(r.rank),
        repo: r.repo,
        stars: Number(r.stars),
        forks: Number(r.forks),
        metric: Number(r.metric),
      })),
    }
  })) ?? null
}

/** 项目状态三件套:该仓库全部快照里最新的非空 license/pushed_at/issues。
 *  2026-10-25 起随拍采集:更早的行是 NULL,聚合自然回落到首拍之后的首个非空值;全空 = 未采集。 */
export interface RepoStatusFacts {
  license: string | null
  pushedAt: string | null
  issues: number | null
}

export async function readRepoStatusFacts(fullName: string): Promise<RepoStatusFacts> {
  const base: RepoStatusFacts = { license: null, pushedAt: null, issues: null }
  return (await withDb(async (sql) => {
    const rows = await sql`
      SELECT
        (array_agg(license   ORDER BY (license IS NOT NULL) DESC, taken_at DESC))[1] AS license,
        (array_agg(pushed_at ORDER BY (pushed_at IS NOT NULL) DESC, taken_at DESC))[1] AS pushed_at,
        (array_agg(issues    ORDER BY (issues IS NOT NULL) DESC, taken_at DESC))[1] AS issues
      FROM board_snapshots WHERE repo = ${fullName}`
    const r = rows[0] as { license?: string | null; pushed_at?: string | null; issues?: number | null } | undefined
    return {
      license: r?.license ?? null,
      pushedAt: r?.pushed_at ?? null,
      issues: r?.issues != null ? Number(r.issues) : null,
    }
  })) ?? base
}

/** 同类项目(主题邻居):扫全部榜头 payload 的 topics(现役口径),
 *  与目标仓库共享 ≥1 主题者,按共享数→星数排,取前 N。零上游成本。 */
export interface TopicPeer {
  fullName: string
  sharedTopics: string[]
  stars: number
}

export async function readTopicPeers(fullName: string, topicsOf: string[], limit = 6): Promise<TopicPeer[]> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 })
  if (topicsOf.length === 0) return []
  const want = new Set(topicsOf.map((t) => t.toLowerCase()))
  // 主题交集必须下推库端(jsonb_exists_any 只回命中行):把 board_head 全部 payload
  // 拉到 JS 过滤曾是档案页断流真因 —— 几 MB 跨境一跑 2 分钟+,占满连接池拖死同页
  // 其他查询(readDiscoverMeta 同款教训,5079868)。
  const rows = (await withDb(async (sql) =>
    sql`
      SELECT it->>'fullName' AS full_name, (it->>'stars') AS stars, it->'topics' AS topics
      FROM board_head, jsonb_array_elements(payload->'items') AS it
      WHERE item_count > 0
        AND it->>'fullName' IS NOT NULL
        AND it->>'fullName' <> ${fullName}
        AND jsonb_exists_any(it->'topics', ${topicsOf.map((t) => t.toLowerCase())})`
  )) as unknown as Array<{ full_name: string; stars: string | number; topics: string[] | null }> | null
  if (!rows) throw new Error('topic-peers unavailable (db unreachable/timeout)')
  const peers = new Map<string, { stars: number; shared: Set<string> }>()
  for (const row of rows) {
    // 大小写在 JS 端复核(GitHub topics 惯例全小写,库里 jsonb_exists_any 已精确命中)
    const shared = (row.topics ?? []).filter((t) => want.has(String(t).toLowerCase()))
    if (shared.length === 0) continue
    const stars = Number(row.stars ?? 0)
    const cur = peers.get(row.full_name)
    if (cur) {
      for (const t of shared) cur.shared.add(t)
      if (stars > cur.stars) cur.stars = stars
    } else {
      peers.set(row.full_name, { stars, shared: new Set(shared) })
    }
  }
  return [...peers.entries()]
    .map(([name, v]) => ({ fullName: name, stars: v.stars, sharedTopics: [...v.shared] }))
    .sort((a, b) => b.sharedTopics.length - a.sharedTopics.length || b.stars - a.stars)
    .slice(0, limit)
}

/** 发现页元数据:榜头 payload 汇总出 repo → {language, topics, createdAt, stars}。 */
export interface DiscoverMeta {
  language: string | null
  topics: string[]
  createdAt?: string
}

export async function readDiscoverMeta(): Promise<Map<string, DiscoverMeta & { stars: number }>> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 })
  const out = new Map<string, DiscoverMeta & { stars: number }>()
  // fill 失败(库不可达/超时)必须抛错:'use cache' 会把空 Map 缓存 2h,变成毒空结果
  // 库端展开 jsonb,只回轻量元组 —— 拉整包 payload(几 MB 跨境)曾是 discover 冷 fill
  // 20s 都跑不完的真因;展开后亚秒。
  const ok = await withDb(async (sql) => {
    const rows = await sql`
      SELECT it->>'fullName' AS full_name,
             (it->>'stars') AS stars,
             it->>'language' AS language,
             it->'topics' AS topics,
             it->>'createdAt' AS created_at
      FROM board_head, jsonb_array_elements(payload->'items') AS it
      WHERE item_count > 0 AND it->>'fullName' IS NOT NULL`
    for (const r of rows as unknown as Array<{ full_name: string; stars: string; language: string | null; topics: string[] | null; created_at: string | null }>) {
      if (out.has(r.full_name)) continue
      out.set(r.full_name, {
        stars: Number(r.stars ?? 0),
        language: r.language ?? null,
        topics: Array.isArray(r.topics) ? r.topics : [],
        createdAt: r.created_at ?? undefined,
      })
    }
    return true
  })
  if (!ok) throw new Error('discover-meta unavailable (db unreachable/timeout)')
  return out
}

/** sitemap 用:所有"曾经上榜过"的仓库(语义与明细保留期同窗)。读 repo_seen 小表,
 * 不再对 board_snapshots 做全表 DISTINCT(千万行级,每次都是数秒扫描)。 */
export async function readDistinctRepos(): Promise<string[]> {
  return (await withDb(async (sql) => {
    const rows = await sql`SELECT repo FROM repo_seen`
    return (rows as unknown as Array<{ repo: string }>).map((r) => r.repo).sort()
  })) ?? []
}

/** 过榜仓库名单(proxy 的"存在性"判定源):几万行小表,索引全扫,毫秒级。 */
export async function readRepoSeenRepos(): Promise<string[] | null> {
  return (await withDb(async (sql) => {
    const rows = await sql`SELECT repo FROM repo_seen`
    return (rows as unknown as Array<{ repo: string }>).map((r) => r.repo)
  })) ?? null
}

/** 仓库档案页读取:(repo) → 最近一拍的全部上榜记录 + 近 30 天基准口径每日名次。
 * 站点档案页与 sitemap 共用;读路径零上游请求,只碰明细表(repo 索引直查)。 */
export interface RepoAppearance {
  board: string
  language: string
  rank: number
  stars: number
  forks: number
  metric: number
  source: string
  degraded: boolean
  takenAt: string
  /** true = 3 天内仍在拍(现役);false = 退榜老兵最后一次的记录。 */
  current: boolean
}

export interface RepoDayRank {
  day: string
  board: string
  rank: number
  metric: number
  /** 拍摄当时的仓库全量星数(与所在榜无关):档案页 star 走势线的数据源。 */
  stars: number
}

export async function readRepoArchiveRows(fullName: string): Promise<{
  appearances: RepoAppearance[]
  daily: RepoDayRank[]
  lastSeenAt: string | null
}> {
  if (!isRepoFullName(fullName)) {
    return { appearances: [], daily: [], lastSeenAt: null }
  }
  const base: { appearances: RepoAppearance[]; daily: RepoDayRank[]; lastSeenAt: string | null } = { appearances: [], daily: [], lastSeenAt: null }
  return (await withDb(async (sql) => {
    // 每个 (榜, 语言) 的"最近一次在榜"记录 —— 不限时间窗:
    // taken_at 在 3 天内 = 现役(current);更早 = 退榜老兵(档案页诚实展示最后一次数据)。
    // 两查无依赖,并行发(省一次 Neon 往返串行,冷访明显变快)。
    const [rows, band] = await Promise.all([
      sql`
        SELECT DISTINCT ON (board, language)
               board, language, rank, stars, forks, metric, source, degraded, taken_at
        FROM board_snapshots
        WHERE repo = ${fullName}
        ORDER BY board, language, taken_at DESC`,
      sql`
        SELECT DISTINCT ON (board, date_trunc('day', taken_at))
               to_char(date_trunc('day', taken_at), 'YYYY-MM-DD') AS day,
               board, rank, metric, stars
        FROM board_snapshots
        WHERE repo = ${fullName} AND language = '' AND taken_at > now() - interval '30 days'
        ORDER BY board, date_trunc('day', taken_at), taken_at DESC`,
    ]) as unknown as [
      Array<{ board: string; language: string; rank: number; stars: number | string; forks: number; metric: number | string; source: string; degraded: boolean; taken_at: Date }>,
      Array<{ day: string; board: string; rank: number; metric: number | string; stars: number | string }>,
    ]
    // current 判定锚点 = 查询内最新一拍(数据侧"现在"),不读墙钟 ——
    // 本函数被 'use cache' 的档案页调用,cache 域禁动态 API(实测生产预渲染 throw 断流)。
    const maxTakenMs = rows.reduce((m, r) => Math.max(m, new Date(r.taken_at).getTime()), 0)
    const appearances = rows.map((r) => {
      const takenAt = new Date(r.taken_at)
      return {
        board: r.board,
        language: r.language,
        rank: Number(r.rank),
        stars: Number(r.stars),
        forks: Number(r.forks),
        metric: Number(r.metric),
        source: r.source,
        degraded: r.degraded,
        takenAt: takenAt.toISOString(),
        current: maxTakenMs - takenAt.getTime() < 3 * 24 * 3600_000,
      }
    })

    // 近 30 天、基准口径(language='')每日最后一拍的 (榜, 名次, 星总量) 序列:档案页走势图用。
    // stars = 拍摄当时的仓库全量星数(与所在榜无关),所以星线可以跨榜拼接。
    const daily = band.map(
      (r) => ({ day: r.day, board: r.board, rank: Number(r.rank), metric: Number(r.metric), stars: Number(r.stars) }),
    )

    const lastSeenAt = appearances.reduce<string | null>((m, a) => (m === null || a.takenAt > m ? a.takenAt : m), null)
    return { appearances, daily, lastSeenAt }
  })) ?? base
}

/** 仓库级多语描述(repo 粒度只存一份,横跨十张榜复用):payload = { [locale]: 首句描述 }。
 * 读路径合并进榜单载荷;缺口由访问驱动的后台补齐(lib/descfill)渐进写入。 */
export async function readRepoDescs(
  fullNames: string[],
): Promise<Map<string, Record<string, string>>> {
  const out: Map<string, Record<string, string>> = new Map()
  if (fullNames.length === 0) return out
  await withDb(async (sql) => {
    const rows = await sql`SELECT full_name, payload FROM repo_desc WHERE full_name = ANY(${fullNames})`
    for (const row of rows) {
      out.set(String(row.full_name), (row.payload ?? {}) as Record<string, string>)
    }
  })
  return out
}

/** 单语写入(jsonb 合并,不动其他语种已得结果)。 */
export async function upsertRepoDesc(fullName: string, locale: string, desc: string): Promise<boolean> {
  if (!fullName || !locale || !desc) return false
  return await withDb(async (sql) => {
    const fresh = sql.json({ [locale]: desc } as Record<string, string>)
    await sql`
      INSERT INTO repo_desc (full_name, payload) VALUES (${fullName}, ${fresh})
      ON CONFLICT (full_name) DO UPDATE SET
        payload = repo_desc.payload || ${fresh},
        updated_at = now()`
    return true
  }) ?? false
}

/** 读收割进度(新鲜期内的 resolved 行):`repo|locale` → 是否已有确定结论。 */
export async function readProbes(fullNames: string[], maxAgeMs: number): Promise<Map<string, boolean>> {
  const out: Map<string, boolean> = new Map()
  if (fullNames.length === 0) return out
  await withDb(async (sql) => {
    const secs = Math.max(1, Math.round(maxAgeMs / 1000))
    const rows = await sql`
      SELECT full_name, locale, resolved FROM repo_desc_probe
      WHERE full_name = ANY(${fullNames})
        AND updated_at > now() - ${secs} * interval '1 second'`
    for (const row of rows) out.set(`${row.full_name}|${row.locale}`, Boolean(row.resolved))
  })
  return out
}

/** 写一条探测结论:resolved=true = 有确定结论(30 天免重试);false = 中断,下一轮立即重试。 */
export async function upsertProbe(fullName: string, locale: string, resolved: boolean): Promise<void> {
  await withDb(async (sql) => {
    await sql`
      INSERT INTO repo_desc_probe (full_name, locale, resolved, updated_at)
      VALUES (${fullName}, ${locale}, ${resolved}, now())
      ON CONFLICT (full_name, locale) DO UPDATE SET
        resolved = ${resolved}, updated_at = now()`
  })
}

/** 汇总全部榜头条目出收割队列:仓库 → 最佳热度分(榜序 × 10000 + 行号),升序返回仓库列表。 */
export async function readAllHeadRepos(boardOrder: string[]): Promise<string[]> {
  const best: Map<string, number> = new Map()
  await withDb(async (sql) => {
    const rows = await sql`SELECT board, payload FROM board_head WHERE item_count > 0`
    for (const row of rows) {
      const idx = boardOrder.indexOf(String(row.board))
      if (idx < 0) continue
      const items = (row.payload?.items ?? []) as Array<{ fullName?: string }>
      for (let rank = 0; rank < items.length; rank++) {
        const full = items[rank]?.fullName
        if (!full) continue
        const score = idx * 10000 + rank
        const prev = best.get(full)
        if (prev === undefined || score < prev) best.set(full, score)
      }
    }
  })
  return [...best.entries()].sort((a, b) => a[1] - b[1]).map(([full]) => full)
}
