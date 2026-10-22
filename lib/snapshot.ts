import { cacheLife } from 'next/cache'

import { facetLangSlug } from './facet'
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
  await sql`CREATE INDEX IF NOT EXISTS board_snapshots_repo_time ON board_snapshots (repo, taken_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS board_snapshots_board_time ON board_snapshots (board, language, taken_at DESC)`
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
  tableReady = true
}

export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T | undefined> {
  if (!DATABASE_URL) return undefined
  try {
    if (!sqlSingleton) {
      const postgres = (await import('postgres')).default
      sqlSingleton = postgres(DATABASE_URL, {
        max: 8,
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
      return await fn(sql)
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
export async function writeHeadAndRows(slug: string, language: string | undefined, data: BoardData): Promise<boolean> {
  if (!DATABASE_URL) return false
  const takenAt = data.generatedAt ? new Date(data.generatedAt) : new Date()
  const key = dbKey(slug, language)
  return (await withDb(async (sql) => {
    // 上一拍名次先读出来,嵌进本拍载荷(board_head 只留最新,payload 里带 prevRank,
    // 任何访客打开页面都能直接看到相对上一轮同步的爬/掉榜,而不必恰好守在换拍一刻)
    const rows = await sql`SELECT payload FROM board_head WHERE key = ${key} LIMIT 1`
    const prevItems = (rows[0] as { payload?: BoardData } | undefined)?.payload?.items ?? []
    const prevOrder = new Map<string, number>()
    prevItems.forEach((it, i) => prevOrder.set(it.fullName, i))
    const items = data.items.map((item, index) => {
      const prev = prevOrder.get(item.fullName)
      if (prev === undefined || prev === index) return item
      return { ...item, prevRank: prev }
    })
    const written: BoardData = { ...data, items }

    await sql`
      INSERT INTO board_head (key, board, language, source, degraded, item_count, generated_at, taken_at, payload)
      VALUES (${key}, ${slug}, ${language ?? ''}, ${written.source}, ${written.degraded ?? false}, ${written.items.length},
              ${takenAt}, ${takenAt}, ${sql.json(written as unknown as Parameters<typeof sql.json>[0])})
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
    }))
    if (values.length) {
      await sql`
        INSERT INTO board_snapshots ${sql(
          values,
          'taken_at', 'board', 'language', 'source', 'degraded', 'rank', 'repo', 'stars', 'forks', 'metric', 'repo_created_at',
        )}`
    }
    return true
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

/** 保留期治理:明细行超龄即清理(head 表只留最新,天然自洁)。 */
export async function pruneOld(): Promise<number> {
  return (await withDb(async (sql) => {
    const result = await sql`
      DELETE FROM board_snapshots WHERE taken_at < now() - (${RETENTION_DAYS} || ' days')::interval`
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

/** sitemap 用:所有"曾经上榜过"的仓库(全量时间窗,不限现役)。 */
export async function readDistinctRepos(): Promise<string[]> {
  return (await withDb(async (sql) => {
    const rows = await sql`SELECT DISTINCT repo FROM board_snapshots`
    return (rows as unknown as Array<{ repo: string }>).map((r) => r.repo).sort()
  })) ?? []
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
  if (!/^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.-]{1,64}$/.test(fullName)) {
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
        current: Date.now() - takenAt.getTime() < 3 * 24 * 3600_000,
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
