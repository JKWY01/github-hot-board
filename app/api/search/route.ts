import { NextRequest, NextResponse } from 'next/server'
import { withDb } from '@/lib/snapshot'
import { MILESTONE_THRESHOLDS } from '@/lib/boards'
import { ghRepo, searchReposByName } from '@/lib/ghrepo'
import { clientIpOf, slidingWindow } from '@/lib/ratelimit'
import { isRepoFullName } from '@/lib/reposhape'
import type { BoardItem } from '@/lib/types'

/** 站内搜索(方案 A+B+C):
 *  - owner/repo 精确:先查 repo_desc,缺 stars 现打一次 GitHub /repos 并写回(访客即采集器);
 *  - 关键词:在自己库的 2,633+ 仓多语描述里模糊匹配(零外部 API);
 *  - 名次语义:board_head 载荷里现成名次图 + 榜尾门槛,总榜外给 300+,里程碑给"差 N 到档"。
 *  结果卡是动态视图,不给任何新收录 URL。 */

const DESC_LANG_KEYS = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'ru', 'uk', 'pl', 'tr', 'vi', 'id']

interface Hit {
  fullName: string
  stars?: number
  forks?: number
  pushedAt?: string
  desc?: Record<string, string>
  rank?: number
  cutoff?: number
}

// 简易每 IP 滑窗限流:搜索是人手速,不是爬虫节奏(共享实现,带条目修剪)
const WINDOW_MS = 60_000
const PER_WINDOW = 15
const rate = slidingWindow()

const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').slice(0, 200).trim()
  const board = (url.searchParams.get('board') ?? '').slice(0, 32)
  const language = (url.searchParams.get('language') ?? '').slice(0, 48)
  // deep=1 仅在用户确认"搜全站"后由前端带上;默认只查自家库
  const deep = url.searchParams.get('deep') === '1'
  const ip = clientIpOf(req)

  if (!q) return NextResponse.json({ ok: false, reason: 'empty' }, { status: 400 })
  if (!rate.allow(ip, PER_WINDOW, WINDOW_MS)) return NextResponse.json({ ok: false, reason: 'rate' }, { status: 429 })

  const isExact = isRepoFullName(q)

  const data = await withDb(async (sql) => {
    // 名次语义底座:本榜(优先语言分榜,退主榜)的名次图与榜尾门槛
    const headRows = await sql<{ payload: unknown }[]>`
      SELECT payload FROM board_head
      WHERE board = ${board} AND language IN (${language}, '') LIMIT 2`
    const head = headRows.find((r) => r.payload) ?? null
    const headItems: BoardItem[] = Array.isArray((head?.payload as { items?: BoardItem[] })?.items)
      ? ((head!.payload as { items: BoardItem[] }).items as BoardItem[])
      : []
    const rankOf = new Map<string, number>()
    headItems.forEach((it, i) => rankOf.set(it.fullName, i + 1))
    const cutoff = headItems.length ? headItems[headItems.length - 1]?.stars : undefined
    const derive = (full: string): Pick<Hit, 'rank' | 'cutoff'> => {
      const rank = rankOf.get(full)
      return { ...(rank !== undefined ? { rank } : {}), ...(cutoff !== undefined ? { cutoff } : {}) }
    }

    /** 库内无果并获用户确认:全站按名字搜一手(仅名字匹配),结果写回 repo_desc
     *  —— 搜索流量持续把库喂肥,这是和 README/描述收割同一个哲学。 */
    const fallbackByName = async (term: string): Promise<Hit[]> => {
      const found = await searchReposByName(term)
      const hits: Hit[] = []
      for (const it of found) {
        const patch: Record<string, unknown> = {
          stars: it.stars,
          forks: it.forks,
          pushed_at: it.pushedAt,
          ...(it.desc ? { __gh: it.desc } : {}),
        }
        await sql`
          INSERT INTO repo_desc (full_name, payload) VALUES (${it.fullName}, ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])})
          ON CONFLICT (full_name) DO UPDATE SET
            payload = repo_desc.payload || ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])}, updated_at = now()`
        hits.push({
          fullName: it.fullName,
          stars: it.stars,
          forks: it.forks,
          pushedAt: it.pushedAt,
          desc: it.desc ? { __gh: it.desc } : undefined,
          ...derive(it.fullName),
        })
      }
      return hits
    }


    // 名次语义通用 OR 链(16 语描述一键覆盖;键为静态常量,字面拼接最稳)
    const like = `%${escLike(isExact ? q.split('/')[1].slice(0, 30) : q)}%`
    const LIKE_ALL = sql`(
      payload->>'en' ILIKE ${like} OR payload->>'zh' ILIKE ${like} OR payload->>'zh-TW' ILIKE ${like} OR
      payload->>'ja' ILIKE ${like} OR payload->>'ko' ILIKE ${like} OR payload->>'de' ILIKE ${like} OR
      payload->>'fr' ILIKE ${like} OR payload->>'es' ILIKE ${like} OR payload->>'pt' ILIKE ${like} OR
      payload->>'it' ILIKE ${like} OR payload->>'ru' ILIKE ${like} OR payload->>'uk' ILIKE ${like} OR
      payload->>'pl' ILIKE ${like} OR payload->>'tr' ILIKE ${like} OR payload->>'vi' ILIKE ${like} OR
      payload->>'id' ILIKE ${like}
    )`

    if (isExact) {
      const rows = await sql<{ payload: Record<string, unknown> }[]>`
        SELECT payload FROM repo_desc WHERE full_name = ${q}`
      const descPayload = (rows[0]?.payload ?? {}) as Record<string, unknown>
      const hit: Hit = { fullName: q, ...derive(q), desc: descPayload as Record<string, string> }

      // owner/repo 精确:永远现打 /repos(core API 便宜,5000/h 池)保数据新鲜;
      // 库行只当"描述底料 + keyword 命中入口",stars 一律以这次现打为准,不用陈旧缓存误导人
      const gh = await ghRepo(q)
      if (gh) {
        const patch: Record<string, unknown> = {
          stars: gh.stars,
          forks: gh.forks,
          ...(gh.pushedAt ? { pushed_at: gh.pushedAt } : {}),
          ...(gh.desc ? { __gh: gh.desc } : {}),
        }
        await sql`
          INSERT INTO repo_desc (full_name, payload) VALUES (${q}, ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])})
          ON CONFLICT (full_name) DO UPDATE SET
            payload = repo_desc.payload || ${sql.json(patch as unknown as Parameters<typeof sql.json>[0])}, updated_at = now()`
        const fresh: Hit = {
          ...hit,
          stars: gh.stars,
          forks: gh.forks,
          pushedAt: gh.pushedAt,
          desc: { ...descPayload, ...(gh.desc ? { __gh: gh.desc } : {}) } as Record<string, string>,
        }

        // 顺手给 4 条库内相关(按 repo 段/描述的模糊亲缘)
        const related = await sql<{ full_name: string; payload: Record<string, unknown> }[]>`
          SELECT full_name, payload FROM repo_desc
          WHERE full_name <> ${q}
            AND (
              full_name ILIKE ${like}
              OR ${LIKE_ALL}
            )
          ORDER BY COALESCE((payload->>'stars')::numeric, -1) DESC
          LIMIT 4`
        const results: Hit[] = [fresh, ...related.map((r) => {
          const p = r.payload as Record<string, unknown>
          return {
            fullName: r.full_name,
            stars: typeof p.stars === 'number' ? (p.stars as number) : undefined,
            forks: typeof p.forks === 'number' ? (p.forks as number) : undefined,
            pushedAt: typeof p.pushed_at === 'string' ? (p.pushed_at as string) : undefined,
            desc: p as Record<string, string>,
            ...derive(r.full_name),
          } satisfies Hit
        })]
        return { ok: true, kind: 'exact', results }
      }

      if (!rows.length) {
        // 库外且 GitHub /repos 也 404(多半 owner 拼错):默认停在本站态,
        // 用户确认后(deep=1)按 repo 名在全站兜底一手,结果入库
        if (!deep) return { ok: true, kind: 'empty', results: [] as Hit[] }
        const results = await fallbackByName(q.split('/')[1].slice(0, 60))
        return { ok: true, kind: 'web', results }
      }

      // /repos 没通但库里有旧行(限流/网络抖动):拿库缓存顶上,聊胜于无
      return {
        ok: true,
        kind: 'exact',
        results: [{
          ...hit,
          stars: typeof descPayload.stars === 'number' ? (descPayload.stars as number) : undefined,
          forks: typeof descPayload.forks === 'number' ? (descPayload.forks as number) : undefined,
          pushedAt: typeof descPayload.pushed_at === 'string' ? (descPayload.pushed_at as string) : undefined,
        }],
      }
    }

    // 关键词:自家库的描述/仓全名里捞(like 已是全串)
    const rows = await sql<{ full_name: string; payload: Record<string, unknown> }[]>`
      SELECT full_name, payload FROM repo_desc
      WHERE full_name ILIKE ${like}
        OR ${LIKE_ALL}
      ORDER BY COALESCE((payload->>'stars')::numeric, -1) DESC
      LIMIT 8`
    const results: Hit[] = rows.map((r) => {
      const p = r.payload as Record<string, unknown>
      return {
        fullName: r.full_name,
        stars: typeof p.stars === 'number' ? (p.stars as number) : undefined,
        forks: typeof p.forks === 'number' ? (p.forks as number) : undefined,
        pushedAt: typeof p.pushed_at === 'string' ? (p.pushed_at as string) : undefined,
        desc: p as Record<string, string>,
        ...derive(r.full_name),
      } satisfies Hit
    })
    if (!rows.length) {
      // 自家库没命中:默认停在本站态,等用户确认再搜全站(顺手把结果喂进库)
      if (!deep) return { ok: true, kind: 'empty', results: [] as Hit[] }
      const results = await fallbackByName(q.slice(0, 60))
      return { ok: true, kind: 'web', results }
    }
    return { ok: true, kind: 'keyword', results }
  })

  if (!data) return NextResponse.json({ ok: false, reason: 'db' }, { status: 503 })
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } })
}
