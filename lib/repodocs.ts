import { withDb } from './snapshot'
import { after } from 'next/server'

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
 * 读取顺序(serveRepoDoc,评审五/六/八轮定稿):
 * ① 目标语缓存且为真翻译 → 直接返回(快速路径);
 * ② 历史英文兜底副本不算命中 —— 仅作降级候选,继续上游语言探测(限时预算);
 * ③ 上游真翻译 → 返回并可即时替换已确认的历史兜底行(见 storeRepoDoc 例外);
 * ④ 上游失败/超时/异常 → 英文缓存降级 → 历史兜底候选 → 空结果
 *   (fallback: true;不写负缓存,可重试)。 */

let ready: Promise<void> | null = null

async function ensure(): Promise<void> {
  await withDb(async (sql) => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS repo_docs (
        full_name text NOT NULL,
        lang text NOT NULL,
        html text NOT NULL,
        bytes integer NOT NULL DEFAULT 0,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (full_name, lang)
      )`
    } catch (err) {
      // 建表竞态(评审十轮,隔离库多进程实测):IF NOT EXISTS 存在窗口 —— 多进程同时
      // 检查到"表不存在"并同时 CREATE,输家的报错不是 42P07 NOTICE 而是
      // 23505 duplicate key on pg_type_typname(隔离库 10 进程实验:1 OK/9 ERR)。
      // 表实际已由赢家建好,按成功处理;真错(权限/连接)不在此列,继续抛。
      const code = (err as { code?: string })?.code
      if (code === '23505' || code === '42P07') return
      throw err
    }
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
/** 识别三态(评审十轮):true=确认历史英文副本;false=查询成功且确认不是(真翻译);
 *  null=识别查询自身失败,来源未知 —— 上层不得当可信命中,按兜底候选继续探测(fail-closed)。 */
export type FallbackVerdict = boolean | null

export async function readRepoDocWithFallback(
  full: string,
  lang: string,
): Promise<{ html: string | null; fallback: FallbackVerdict }> {
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
  const isFallback = await withDb(async (sql): Promise<boolean> => {
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
  }).catch(() => null) // 识别查询失败 ≠「确认不是兜底」——三态语义,fail-closed(评审十轮)
  return { html: hit, fallback: isFallback === true ? true : isFallback === false ? false : null }
}

/** 入库:一小时内不被覆盖(夜批与运行时谁先到谁为准,过期才续新)。
 * localized=false(英文兜底)只允许写 en 键 —— 请求方拿去展示可以,
 * 冒充目标语言翻译落目标语言键就是本次要修的污染。
 * 例外(评审八轮):已确认的历史兜底行(非 en 键且内容与 en 行全文一致)不设防 ——
 * 真翻译一旦到手必须能即时替换它,否则旧英文副本靠 1h 防覆盖继续霸占目标语键;
 * 正常有效翻译(内容≠en)的防覆盖语义原样保留,en 键自身也照旧(条件限定 key<>'en',
 * 否则 en 行与自身比较恒真会击穿 en 键的防覆盖)。 */
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
      WHERE CASE
        -- ① 过期:直接放行,不碰摘要(评审九轮:OR 不保证求值顺序,
        --    大文档 md5 的成本必须靠 CASE 显式规避,不能赌执行计划)
        WHEN repo_docs.fetched_at < now() - interval '1 hour' THEN true
        -- ② en 键:窗口内照旧保护(例外只给历史兜底的非 en 行)
        WHEN ${key} = 'en' THEN false
        -- ③ 长度不同:必然不是「内容与 en 一致」的历史兜底,不进摘要
        WHEN (SELECT octet_length(html) FROM repo_docs
              WHERE full_name = ${full} AND lang = 'en')
             IS DISTINCT FROM octet_length(repo_docs.html) THEN false
        -- ④ 长度相同的非 en 行才做全文确认:历史兜底→放行即时替换
        ELSE md5(repo_docs.html) IS NOT DISTINCT FROM
             (SELECT md5(html) FROM repo_docs
              WHERE full_name = ${full} AND lang = 'en')
      END
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

/** 上游探测默认等待预算:与旧档案页 borrow 的 4s 对齐(github.ts 单请求 10s +
 * quotaSlot 排队可达 45s)。超预算不是失败:本次先降级英文缓存,绝不空手而归;
 * 后台探测尽力而为(经 after() 挂到请求生命周期,但受函数时限约束——档案页
 * maxDuration 30s,排队极端情况可能被冻结),不承诺下次必然命中,读序对 miss
 * 永远可重试兜底(评审七轮:不写"必然命中"这种未经线上证明的保证)。 */
const UPSTREAM_BUDGET_MS = 4_000

export async function serveRepoDoc(
  full: string,
  lang: string,
  opts: { upstreamMs?: number } = {},
): Promise<ServedDoc> {
  const hit = await readRepoDocWithFallback(full, lang)
  // 真翻译缓存(识别查询成功且确认不是兜底):快速路径直接返回。
  // 历史兜底(fallback:true)与「识别失败来源未知」(fallback:null)都不算可信命中 ——
  // 只作降级候选,继续上游探测找真 README,否则旧英文副本会永久霸占目标语键
  //(评审八轮:识别出污染却照常返回=半修复;评审十轮:识别查询失败同样不得放行)。fail-closed。
  if (hit.html && hit.fallback === false) {
    return { html: hit.html, fallback: false, cached: true }
  }
  const legacyCandidate = hit.html // 兜底候选(历史副本或来源未知的内容),上游失败时用
  // 只收敛「上游获取」的失败/超时/异常(评审六轮):会 reject 到这里的只剩上游网络/解析
  // 错误 —— 统一降级英文缓存。缓存写库异常在借取链内部已各自吞掉,不在这里二次吞;
  // 读库异常也不在此收敛(readRepoDoc 内部 catch 后按 miss 处理,仍走上游),
  // 任何数据库异常都不会被伪装成成功的目标语言响应。
  const budget = opts.upstreamMs ?? UPSTREAM_BUDGET_MS
  const upstream = borrowLocalizedRepoDocFetch(full, lang)
  // settled 跟踪:区分"上游已回来但空"与"超时仍在跑"(评审七轮:只有后者需要登记后台)
  let upstreamSettled = false
  const wrapped = upstream.then(
    (b) => {
      upstreamSettled = true
      return b as BorrowedDoc | null
    },
    (): BorrowedDoc | null => {
      upstreamSettled = true
      return null
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const bail = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budget)
  })
  let borrowed: BorrowedDoc | null
  try {
    borrowed = await Promise.race([wrapped, bail])
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (borrowed?.html) {
    return { html: borrowed.html, fallback: borrowed.fallback, cached: false }
  }
  // 超时路径:上游仍在跑 —— 显式挂到请求生命周期(Vercel 上响应即冻结裸 Promise,
  // after() 让它在响应后继续,仍受函数时限;尽力而为,见文件头注释)。wrapped 永不
  // reject(rejection 已映射为 null),after 回调无异常面。自托管长驻进程/单测环境
  // 无请求上下文时 after() 不可用,裸 Promise 本就能跑完 —— catch 兜住即可。
  if (!upstreamSettled) {
    try {
      after(() => wrapped)
    } catch {
      /* 非请求上下文(长驻进程/单测):进程存活,后台自会完成 */
    }
  }
  // 上游失败/超时降级(评审八轮补全):英文缓存优先;en 也缺时用历史兜底候选
  // (内容本就是英文原文);两者都无才空手而归。所有降级 fallback: true,如实标注。
  const en = await readRepoDoc(full, 'en')
  if (en) return { html: en, fallback: true, cached: true }
  if (legacyCandidate) return { html: legacyCandidate, fallback: true, cached: true }
  return { html: null, fallback: false, cached: false }
}
