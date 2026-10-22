import { withDb } from './snapshot'

/** 仓库文档快照(repo_docs):抽屉与档案页共用的持久 README 缓存层。
 * 动机:
 * ① 详情开盖不再每次实弹打 GitHub —— 配额省下、秒开(用户并发开同一个仓库只炸一次);
 * ② 档案页(爬虫主战场)服务端渲染 README 正文 —— 爬虫第一次看见详情内容(SEO 主粮);
 * ③ 香港服务器夜间批量预填 + 10 天轮换续鲜(en 键),运行时"未命中实时取并入库"补长尾。
 * 单飞(single-flight):同实例并发同仓请求共享一次上游调用;入库后全域秒读。 */

let ready: Promise<void> | null = null

async function ensure(): Promise<void> {
  await withDb(async (sql) => {
    await sql`CREATE TABLE IF NOT EXISTS repo_docs (
      full_name text NOT NULL,
      lang text NOT NULL,
      html text NOT NULL,
      bytes integer NOT NULL DEFAULT 0,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (full_name, lang)
    )`
  })
}

function boot(): Promise<void> {
  ready ??= ensure().catch((err: unknown) => {
    ready = null
    throw err
  })
  return ready
}

/** 盘库:命中返回渲染好的 README HTML;任何失败静默回 null(调用方走实弹路径)。 */
export async function readRepoDoc(full: string, lang: string): Promise<string | null> {
  try {
    await boot()
    const rows = (await withDb(async (sql) =>
      sql`SELECT html FROM repo_docs WHERE full_name = ${full} AND lang = ${lang} LIMIT 1`,
    )) as unknown as Array<{ html: string }> | undefined
    const row = rows?.[0]
    return row?.html || null
  } catch {
    return null
  }
}

/** 入库:一小时内不被覆盖(夜批与运行时谁先到谁为准,过期才续新)。 */
export async function storeRepoDoc(full: string, lang: string, html: string): Promise<void> {
  if (!html) return
  await boot()
  await withDb(async (sql) => {
    await sql`
      INSERT INTO repo_docs (full_name, lang, html, bytes)
      VALUES (${full}, ${lang}, ${html}, ${html.length})
      ON CONFLICT (full_name, lang) DO UPDATE
      SET html = EXCLUDED.html, bytes = EXCLUDED.bytes, fetched_at = now()
      WHERE repo_docs.fetched_at < now() - interval '1 hour'
    `
  })
}

/** 单飞借取:同仓同语并发时共享一次上游调用;命中即回写入库(写后路)。 */
const inflight = new Map<string, Promise<string | null>>()

export function borrowRepoDocFetch(
  full: string,
  lang: string,
  fetcher: () => Promise<string | null>,
): Promise<string | null> {
  const key = `${lang}|${full}`
  const current = inflight.get(key)
  if (current) return current
  const task = fetcher()
    .then(async (html) => {
      if (html) await storeRepoDoc(full, lang, html).catch(() => undefined)
      return html
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, task)
  return task
}
