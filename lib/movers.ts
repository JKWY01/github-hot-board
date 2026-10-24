import { cacheLife } from 'next/cache'
import { withDb } from '@/lib/snapshot'

/** 24h 爬动查询:对账自家快照序列,列出窗口里名次真搬过的行。
 *  榜头爬动条(components/movers-strip)与 MCP get_board_movers 共用。
 *  相比"每 60s 假动画",这是诚实的爬坡感:数据说什么,就演什么。 */

export interface Mover {
  repo: string
  was_rank: number
  now_rank: number
  climb: number
}

export async function fetchMovers24h(slug: string, limit = 10): Promise<Mover[] | undefined> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 })
  return withDb(async (sql) =>
    sql<Mover[]>`
      WITH win AS (
        SELECT min(taken_at) AS oldest, max(taken_at) AS newest
        FROM board_snapshots
        WHERE board = ${slug} AND language = '' AND taken_at > now() - interval '24 hours'
      )
      SELECT o.repo AS repo, o.rank AS was_rank, n.rank AS now_rank, (o.rank - n.rank) AS climb
      FROM (SELECT * FROM board_snapshots, win WHERE board = ${slug} AND language = '' AND taken_at = oldest) o
      JOIN (SELECT * FROM board_snapshots, win WHERE board = ${slug} AND language = '' AND taken_at = newest) n
        ON o.repo = n.repo
      WHERE o.rank IS DISTINCT FROM n.rank
      ORDER BY climb DESC, o.rank ASC
      LIMIT ${limit}`,
  )
}
