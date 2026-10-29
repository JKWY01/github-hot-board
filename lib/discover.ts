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
  return raw
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

async function discoverFiltered(f: DiscoverFilters): Promise<DiscoverRow[]> {
  'use cache'
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 })
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
