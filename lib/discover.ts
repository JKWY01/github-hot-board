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

interface StarTrack {
  now: number
  pastAt: Date
  past: number
}

const DAY = 86_400_000

async function starTracks(): Promise<Map<string, StarTrack>> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 })
  const out = new Map<string, StarTrack>()
  await withDb(async (sql) => {
    // DISTINCT ON 双取(每仓最新一拍 / 6 天前或更早的最后一拍),走 (repo, taken_at DESC) 索引;
    // 此前 array_agg×3 全表聚合在 60 万行级要 30s,实测此形态毫秒级。
    const rows = await sql`
      WITH base AS (
        SELECT repo, stars, taken_at FROM board_snapshots WHERE language = ''
      ),
      latest AS (
        SELECT DISTINCT ON (repo) repo, stars, taken_at FROM base ORDER BY repo, taken_at DESC
      ),
      past AS (
        SELECT DISTINCT ON (repo) repo, stars, taken_at FROM base
        WHERE taken_at < now() - interval '6 days'
        ORDER BY repo, taken_at DESC
      )
      SELECT l.repo, l.stars AS now_stars, p.stars AS past_stars, p.taken_at AS past_at
      FROM latest l LEFT JOIN past p ON p.repo = l.repo`
    for (const r of rows as unknown as Array<{ repo: string; now_stars: string | number; past_stars?: string | number | null; past_at?: Date | string | null }>) {
      out.set(r.repo, {
        now: Number(r.now_stars),
        pastAt: new Date(r.past_at ?? 0),
        past: Number(r.past_stars ?? 0),
      })
    }
  })
  return out
}

export async function discoverQuery(f: DiscoverFilters): Promise<DiscoverRow[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })

  const [meta, tracks] = await Promise.all([readDiscoverMeta(), starTracks()])
  const cutoff = Date.now() - 6 * DAY

  const rows: DiscoverRow[] = []
  for (const [fullName, m] of meta) {
    const t = tracks.get(fullName)
    const stars = t?.now ?? m.stars
    const gain7 = t && t.pastAt.getTime() <= cutoff ? t.now - t.past : null
    rows.push({ fullName, stars, gain7, language: m.language, topics: m.topics, createdAt: m.createdAt })
  }

  const bandRange: Record<NonNullable<DiscoverFilters['band']>, [number, number]> = {
    s0: [0, 100],
    s1: [100, 1_000],
    s2: [1_000, 10_000],
    s3: [10_000, Number.POSITIVE_INFINITY],
  }
  const filtered = rows.filter((r) => {
    if (f.lang && (r.language ?? '').toLowerCase() !== f.lang.toLowerCase()) return false
    if (f.topic && !r.topics.some((t) => t.toLowerCase() === f.topic!.toLowerCase())) return false
    if (f.band) {
      const [lo, hi] = bandRange[f.band]
      if (r.stars < lo || r.stars >= hi) return false
    }
    if (f.age) {
      if (!r.createdAt) return false
      const created = Date.parse(r.createdAt)
      if (!Number.isFinite(created)) return false
      const days = f.age === 'year' ? 365 : Number(f.age)
      if (created < Date.now() - days * DAY) return false
    }
    return true
  })

  filtered.sort((a, b) =>
    f.sort === 'gain'
      ? (b.gain7 ?? -1) - (a.gain7 ?? -1) || b.stars - a.stars
      : b.stars - a.stars,
  )
  return filtered.slice(0, 60)
}

/** 筛选项(语言/主题 Top 榜):全库统计,与结果集无关(选项稳定不闪)。 */
export async function discoverFacets(): Promise<{ languages: Array<[string, number]>; topics: Array<[string, number]> }> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 })
  const meta = await readDiscoverMeta()
  const langs = new Map<string, number>()
  const topics = new Map<string, number>()
  for (const m of meta.values()) {
    if (m.language) langs.set(m.language, (langs.get(m.language) ?? 0) + 1)
    for (const t of m.topics) topics.set(t, (topics.get(t) ?? 0) + 1)
  }
  const top = (x: Map<string, number>, n: number) => [...x.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  return { languages: top(langs, 10), topics: top(topics, 12) }
}
