import { cacheLife } from 'next/cache'
import { revalidateTag } from 'next/cache'

import { withDb } from './snapshot'

/** 发现页 facets 预计算(2026-10-29 OOM 批④,独立提交):
 *  每次同步收尾时把全库语言/主题 Top 榜写入 board_head 行(key='__discover_facets__'),
 *  读路径直接读这一行,消掉每次冷 miss 的全量 jsonb_array_elements 扫描(实测 186-305ms/次)。
 *
 *  正确性纪律(外部评审):
 *  - 同步失败/首次初始化:__discover_facets__ 行不存在 → discoverFacetsCached 回落旧的全量扫描路径(行为不劣化);
 *  - 数据过期:行带 taken_at,读路径超 24h 视为 stale,同样回落全量(宁可慢不可错);
 *  - 空库/空数据:写入 { languages: [], topics: [] } 也是合法快照,不回落(空结果不等于没算);
 *  - 缓存失效:revalidateTag('discover-facets', 'max'),sync 收尾调用,下一读即新值。
 */

export const DISCOVER_FACETS_KEY = '__discover_facets__'
const FACETS_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface DiscoverFacets {
  languages: Array<[string, number]>
  topics: Array<[string, number]>
}

/** 同步收尾调用:全量扫描一次,落 board_head 行。失败不阻塞同步主流程(返回 false 记日志)。 */
export async function precomputeDiscoverFacets(): Promise<boolean> {
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
    const facets: DiscoverFacets = { languages: top(langs, 10), topics: top(topics, 12) }
    await sql`
      INSERT INTO board_head (key, board, language, source, degraded, item_count, generated_at, taken_at, payload)
      VALUES (${DISCOVER_FACETS_KEY}, 'discover', '', 'facets-precompute', false, 0, now(), now(),
              ${sql.json(facets as unknown as Parameters<typeof sql.json>[0])})
      ON CONFLICT (key) DO UPDATE SET
        source = EXCLUDED.source, generated_at = EXCLUDED.generated_at, taken_at = EXCLUDED.taken_at,
        payload = EXCLUDED.payload`
    return true
  })
  if (!ok) return false
  revalidateTag('discover-facets', 'max')
  return true
}

/** 读:预计算行新鲜则直接用(零扫描);不存在/超龄/损坏 → null(调用方回落全量)。 */
export async function readPrecomputedFacets(): Promise<DiscoverFacets | null> {
  try {
    const ok = await withDb(async (sql) => {
      const rows = await sql`
        SELECT payload, taken_at FROM board_head WHERE key = ${DISCOVER_FACETS_KEY} LIMIT 1`
      const row = rows[0] as { payload?: DiscoverFacets; taken_at?: Date | string } | undefined
      if (!row?.payload) return null
      const takenAt = row.taken_at ? new Date(row.taken_at) : null
      if (!takenAt || Number.isNaN(takenAt.getTime())) return null
      if (Date.now() - takenAt.getTime() > FACETS_MAX_AGE_MS) return null
      if (!Array.isArray(row.payload.languages) || !Array.isArray(row.payload.topics)) return null
      return row.payload
    })
    return ok ?? null
  } catch {
    // 真实 withDb 永不抛(内部 catch 返 undefined),防御未来变化;回落全量
    return null
  }
}
