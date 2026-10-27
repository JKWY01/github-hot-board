import { withDb } from './snapshot'
import { fetchLocalizedReadme } from './github'
import type { Locale } from './locales'

/** 仓库文档快照(repo_docs):抽屉与档案页共用的持久 README 缓存层。
 * 动机:
 * ① 详情开盖不再每次实弹打 GitHub —— 配额省下、秒开(用户并发开同一个仓库只炸一次);
 * ② 档案页(爬虫主战场)服务端渲染 README 正文 —— 爬虫第一次看见详情内容(SEO 主粮);
 * ③ 香港服务器夜间批量预填 + 10 天轮换续鲜(en 键),运行时"未命中实时取并入库"补长尾。
 * 单飞(single-flight):同实例并发同仓请求共享一次上游调用;入库后全域秒读。
 *
 * 语言来源语义(2026-10-27 回退污染修复,数据库基线评审阶段1):
 * repo_docs 里一个 (full_name, lang) 键只允许存「该语言的真实翻译」。
 * 英文兜底(仓库没有该语言 README 时显示的原文)可以正常返回给页面,
 * 但绝不冒充目标语言翻译写进目标语言键 —— 否则同一份英文正文会以十几个
 * 语种键各存一份(生产实测 22,346 行/3,405 仓/1,029MB 纯冗余)。
 * 读取顺序:目标语言缓存 → 英文缓存 → 上游 GitHub(仅此时允许写缓存)。 */

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

/** 目标语缓存读取(serveRepoDoc 第①层):命中时做历史兜底识别,未命中返回 null。
 * 命中英文回退时返回 fallback: true,调用方无需区分内容,但测试与观测需要区分。 */
export async function readRepoDocWithFallback(
  full: string,
  lang: string,
): Promise<{ html: string | null; fallback: boolean }> {
  if (lang === 'en') return { html: await readRepoDoc(full, 'en'), fallback: false }
  const hit = await readRepoDoc(full, lang)
  if (!hit) {
    // 评审四轮(保守方案):不做 README 负向探测的持久化 ——
    // localized=false 无法区分「确认无翻译」与「GitHub 临时失败」,任何负缓存都可能把
    // 一次超时变成 30 天的错误结论,且与 repo_desc_probe 既有语义(resolved=false=待重试)
    // 冲突。目标语缓存缺失一律返回 null 交由上游探测:fetchLocalizedReadme 内部有
    // 1h 服务端缓存,重复探测成本低,且永远可重试。
    return { html: null, fallback: false }
  }
  // 历史污染兼容(评审二轮):存量库约 2 万行非英文键存的实际是英文原文
  //(修复前的回退落盘)。目标语言命中时在 DB 层 md5 比对同仓英文源:
  // 一致 → 是历史兜底,fallback: true(内容照常展示,语义正确);
  // 不一致 → 真翻译。比对在 SQL 内完成,不把两份大 HTML 拉到应用层。
  // en 源不存在的行无法证伪,按真翻译处理(保守,不误伤)。
  const isFallback = await withDb(async (sql) => {
    // 性能路径(评审三轮实测:全量 md5 对 2.2MB 大文档热态 23ms/冷态 102ms,不可接受):
    // 先比字节长度(PG 只读元数据,零 HTML 解压),长度不同必然不是兜底副本,直接 false;
    // 长度相同才做 md5 全文确认。p90 文档 98KB 时 md5 热态 ~0.1ms,大文档仅在"长度恰好相同"
    // 的罕见场景才付摘要成本。
    // 评审四轮:AND 不保证求值顺序(PG 优化器可重排),改用 CASE 分支让"先长度后摘要"
    // 成为代码语义而非执行计划巧合;IS DISTINCT FROM 同时覆盖任一行缺失(NULL)→ false。
    const rows = (await sql`
      SELECT CASE
        WHEN (SELECT octet_length(html) FROM repo_docs WHERE full_name = ${full} AND lang = ${lang})
          IS DISTINCT FROM (SELECT octet_length(html) FROM repo_docs WHERE full_name = ${full} AND lang = 'en')
        THEN false
        ELSE (SELECT md5(html) FROM repo_docs WHERE full_name = ${full} AND lang = ${lang})
           = (SELECT md5(html) FROM repo_docs WHERE full_name = ${full} AND lang = 'en')
      END AS same
    `) as unknown as Array<{ same: boolean }> | undefined
    return rows?.[0]?.same === true
  }).catch(() => false)
  return { html: hit, fallback: isFallback === true }
}

/** 入库:一小时内不被覆盖(夜批与运行时谁先到谁为准,过期才续新)。
 * localized=false(英文兜底)只允许写 en 键 —— 请求方拿去展示可以,
 * 冒充目标语言翻译落目标语言键就是本次要修的污染。 */
export async function storeRepoDoc(
  full: string,
  lang: string,
  html: string,
  localized = true,
): Promise<void> {
  if (!html) return
  // 非英文请求拿到英文兜底:内容归 en 键,目标语言键保持纯净(留待真翻译)
  const key = lang === 'en' || localized ? lang : 'en'
  await boot()
  await withDb(async (sql) => {
    await sql`
      INSERT INTO repo_docs (full_name, lang, html, bytes)
      VALUES (${full}, ${key}, ${html}, ${html.length})
      ON CONFLICT (full_name, lang) DO UPDATE
      SET html = EXCLUDED.html, bytes = EXCLUDED.bytes, fetched_at = now()
      WHERE repo_docs.fetched_at < now() - interval '1 hour'
    `
  })
}

/** 单飞借取:同仓同语并发时共享一次上游调用;命中即回写入库(写后路)。
 * fetcher 返回 localized 标志(真实翻译/英文兜底),入库按语义落键。 */
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

/** 语言感知的单飞借取:上游调用走 fetchLocalizedReadme(带语言协商),
 * localized=false 的英文兜底只展示不入目标语言键(入 en 键)。
 * 两层单飞语义保持:同 (lang,full) 并发共享一次上游;en 兜底另占 (en|full) 键。 */
const inflightLocalized = new Map<string, Promise<BorrowedDoc>>()

export interface BorrowedDoc {
  html: string | null
  /** 本次上游结果是否英文兜底(localized:false)——API 层据此统一 fallback 语义 */
  fallback: boolean
}

export function borrowLocalizedRepoDocFetch(
  full: string,
  lang: string,
): Promise<BorrowedDoc> {
  const key = `${lang}|${full}`
  const current = inflightLocalized.get(key)
  if (current) return current
  const task = fetchLocalizedReadme(full, lang as Locale)
    .then(async ({ html, localized }): Promise<BorrowedDoc> => {
      if (html) await storeRepoDoc(full, lang, html, localized).catch(() => undefined)
      // 评审四轮:不写任何探测账本 —— localized=false 无法区分「确认无翻译」与
      // 「上游临时失败」,负缓存会让一次超时变成 30 天错误结论。保持可重试语义。
      return { html, fallback: html !== null && !localized && lang !== 'en' }
    })
    .finally(() => {
      inflightLocalized.delete(key)
    })
  inflightLocalized.set(key, task)
  return task
}

/** 完整 README 读取服务(评审五轮:API 与档案页共用的统一读序)。
 * ① 目标语缓存命中(含历史兜底识别)→ 返回;
 * ② 上游语言探测(单飞+语言感知落键):真翻译或英文兜底,按 localized 语义;
 * ③ 上游失败/无内容 → 读已有英文缓存降级,fallback: true;
 * ④ 三层皆空 → null(调用方按各自错误策略处理)。
 * 任何失败都不写负缓存(评审四轮),后续请求可重新探测。
 * cached 标注 html 是否直接来自库缓存(①③)而非上游(②)。 */
export interface ServedDoc {
  html: string | null
  fallback: boolean
  cached: boolean
}

export async function serveRepoDoc(full: string, lang: string): Promise<ServedDoc> {
  const hit = await readRepoDocWithFallback(full, lang)
  if (hit.html) return { html: hit.html, fallback: hit.fallback, cached: true }
  const borrowed = await borrowLocalizedRepoDocFetch(full, lang)
  if (borrowed.html) return { html: borrowed.html, fallback: borrowed.fallback, cached: false }
  // 上游失败降级:库里的英文缓存(若有)比空页面对用户好得多;
  // fallback: true 如实标注,不冒充目标语言
  const en = await readRepoDoc(full, 'en')
  return { html: en, fallback: en !== null, cached: en !== null }
}
