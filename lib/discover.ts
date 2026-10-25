import { cacheLife } from 'next/cache'

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

async function discoverFiltered(f: DiscoverFilters): Promise<DiscoverRow[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  const bandCond = f.band ? ` AND stars BETWEEN ${BAND_SQL[f.band]}` : ''
  const ageCond = f.age ? ` AND created_at IS NOT NULL AND created_at > ${AGE_SQL[f.age]}` : ''
  const langCond = f.lang ? ` AND lower(lang) = lower(${JSON.stringify(f.lang)})` : ''
  const topicCond = f.topic ? ` AND topics @> jsonb_build_array(${JSON.stringify(f.topic)})` : ''
  const order = f.sort === 'gain' ? 'COALESCE(gain7, -1) DESC, stars DESC' : 'stars DESC'
  // 条件段全部来自白名单常量/JSON.stringify 字面量,无用户可注入面
  const rows = await withDb(async (sql) =>
    sql.unsafe(`
      WITH meta AS (
        SELECT it->>'fullName' AS full_name,
               (it->>'stars')::bigint AS stars,
               it->>'language' AS lang,
               COALESCE(it->'topics', '[]'::jsonb) AS topics,
               (it->>'createdAt')::timestamptz AS created_at
        FROM board_head, jsonb_array_elements(payload->'items') AS it
        WHERE item_count > 0 AND it->>'fullName' IS NOT NULL
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
               l.stars - COALESCE(p.stars, l.stars) AS gain7,
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
      LIMIT 60`),
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

export async function discoverQuery(f: DiscoverFilters): Promise<DiscoverRow[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
  return discoverFiltered(f)
}

/** 筛选项(语言/主题 Top 榜):全库统计,与结果集无关(选项稳定不闪)。 */
export async function discoverFacets(): Promise<{ languages: Array<[string, number]>; topics: Array<[string, number]> }> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 })
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
