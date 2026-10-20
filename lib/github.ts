
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanDesc } from './parse'
import { LOCALES, LANG_LINK_TEXT, type Locale } from './locales'

/** 多账号池:GITHUB_TOKENS(逗号/空白分隔,一枚或一万枚)或 GITHUB_TOKEN(单枚,向后兼容)。
 * 每枚独立冷却;一枚烧完(主配额尽)自动换下一枚,进程内全局节奏随池子规模放宽。 */
const TOKENS = [
  ...new Set(
    (process.env.GITHUB_TOKENS ?? process.env.GITHUB_TOKEN ?? '')
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  ),
]
const TOKEN = TOKENS[0] ?? ''

/** Data Cache 生命周期：有 token 冷却 5 分钟；匿名放宽到 15 分钟。 */
export const GH_TTL_SECONDS = TOKENS.length ? 300 : 900
export const TRENDING_TTL_SECONDS = 900
export const HAS_GITHUB_TOKEN = Boolean(TOKENS.length)

export class RateLimitError extends Error {
  constructor(message = 'GitHub rate limit exceeded') {
    super(message)
    this.name = 'RateLimitError'
  }
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-hot-board(+https://github.com)',
  }
  const current = TOKENS[tokenIdx % TOKENS.length]
  if (current) headers.Authorization = `Bearer ${current}`
  return headers
}

/* ------------------------------ 多账号发牌 ------------------------------ */

let tokenIdx = 0
const tokenCooldown = new Map<string, number>()

/** 发牌轮转:冷却中的账号靠边,其余按序轮换;全部冷却时沿用当前(反正配额也换不到)。 */
function advanceToken(): void {
  for (let i = 1; i <= Math.min(TOKENS.length, 8); i++) {
    const idx = (tokenIdx + i) % TOKENS.length
    if ((tokenCooldown.get(TOKENS[idx]!) ?? 0) <= Date.now()) {
      tokenIdx = idx
      return
    }
  }
}

/** 一枚账号被上游拒绝(403/429)时挂冷却:主配额尽 → 冷却到 reset;次级限流(不扣配额)→ 60s。 */
function markTokenCooldown(res: Response): void {
  const current = TOKENS[tokenIdx % TOKENS.length]
  if (!current) return
  const remaining = res.headers.get('x-ratelimit-remaining')
  const resetSec = Number(res.headers.get('x-ratelimit-reset')) || 0
  if (remaining === '0' && resetSec > 0) tokenCooldown.set(current, resetSec * 1000)
  else tokenCooldown.set(current, Date.now() + 60_000)
}

interface GhSearchRepo {
  id: number
  full_name: string
  html_url: string
  description: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  language: string | null
  created_at: string
  pushed_at: string
  topics?: string[]
  owner?: { avatar_url?: string }
}

interface GhSearchResponse {
  items?: GhSearchRepo[]
}

const TIME_BUDGET_MS = 10_000
const SCRAPE_TIME_BUDGET_MS = 15_000

/* ------------------------- GitHub 请求全局平滑节流 ------------------------- */
/* 构建期 7 个 worker 并发填缓存会在 1 秒内打出几十个 Search 请求，触发
 * GitHub「二级限流」（403 且不扣主配额，冷却 ~1 分钟）。这里用 tmp 目录锁
 * 把任意进程内的 GitHub 请求间隔拉平：有 token ≈ 每 2.1s ≤30/min，匿名 ≈ 每 6.2s ≤10/min。
 * 运行时请求极少排队，二台 Vercel 流量下自身即有空闲窗口。 */

const LOCK_DIR = process.env.VERCEL ? join(tmpdir(), 'ghb-quota') : join(process.cwd(), '.data', 'quota')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 全局语速令牌（进程间经 tmp 目录 marker 的 mtime 排队，Search / Trending 各一条队列）：
 * 1) 读 marker mtime 得上次请求时刻；2) 睡到 last+interval；3) writeFileSync 戳新时刻；
 * 4) 戳完若发现被人以更晚时刻覆盖 → 让位重排。绝不在 fill 里无限等待：排队超 45s
 * 直接放行（宁可偶发双发，不可把构建/请求卡死——wx 排他认领曾在 marker 常存时死转）。 */
async function quotaSlot(label: string): Promise<void> {
  const trending = label.startsWith('trending:')
  const interval = Number(process.env.GHB_FETCH_INTERVAL_MS)
    || (trending
      ? 650
      : TOKENS.length === 0
        ? 6_200
        : TOKENS.length === 1
          ? 2_100
          // 池子越大,聚合配额越高:节奏按池子规模放宽(Search 每账号仍 30/min,地板 650ms)
          : Math.max(650, Math.round(2_100 / TOKENS.length)))
  const deadline = Date.now() + 45_000
  for (;;) {
    try {
      mkdirSync(LOCK_DIR, { recursive: true })
      const marker = join(LOCK_DIR, trending ? 'trending' : 'search')
      let last = 0
      try {
        last = statSync(marker).mtimeMs
      } catch {
        /* 首次无标记 */
      }
      const now = Date.now()
      const wait = last + interval - now
      if (wait <= 0) {
        // 戳新 mtime（创建或清空都会刷新）；失败的唯一情形是目录不可写 → 放行
        try {
          writeFileSync(marker, '')
        } catch {
          return
        }
        // 时隙与账号同时发牌:轮转移到冷却外的账号
        if (TOKENS.length > 0) advanceToken()
        // 末位写入者独得时间片：他人以更晚时刻覆盖 → 回炉重排
        if (statSync(marker).mtimeMs > now + 2) continue
        if (process.env.GHB_QUOTA_DEBUG) {
          console.error(`[quota/claim] ${label} interval=${interval} ts+${((now % 1_000_000) / 1000).toFixed(1)}s`)
        }
        return
      }
      if (now > deadline) {
        // 排队过久直接放行（如 7 worker 强争），绝不把 fill 卡到超时
        if (process.env.GHB_QUOTA_DEBUG) console.error(`[quota/giveup] ${label}`)
        return
      }
      await sleep(Math.min(wait, 10_000) + 30)
    } catch {
      // 节流失败绝不阻塞请求
      return
    }
  }
}

/** 头像直链解析:github.com/<owner>.png 走 302 且跳转响应 no-cache,
 * 浏览器每次都要重打跳转并携带 cookie,谈不上本地缓存。
 * 同步任务在这里换出 avatars CDN 直链(内容寻址,一年强缓存):
 * 浏览器加载一次之后全部命中磁盘,轮询零重复下载。
 * 进程内缓存 6 小时;解析失败回退 .png 形态,同步节奏不受影响。 */
type AvatarEntry = { url: string; at: number }
const avatarCache = new Map<string, AvatarEntry>()
const AVATAR_TTL_MS = 6 * 3600_000

export async function resolveAvatarUrl(owner: string): Promise<string> {
  const key = (owner || 'github').toLowerCase()
  const fallbackUrl = `https://github.com/${owner || 'github'}.png`
  const hit = avatarCache.get(key)
  if (hit && Date.now() - hit.at < AVATAR_TTL_MS) return hit.url
  try {
    await quotaSlot(`avatars:${key}`)
    const res = await fetch(`https://api.github.com/users/${owner}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(TIME_BUDGET_MS),
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const json = (await res.json()) as { avatar_url?: string }
      const cdn = json?.avatar_url
      if (cdn && cdn.includes('avatars.githubusercontent.com')) {
        const url = `${cdn}${cdn.includes('?') ? '&' : '?'}s=96`
        avatarCache.set(key, { url, at: Date.now() })
        return url
      }
    }
  } catch {
    // 解析失败不阻塞榜单;10 分钟后可重试,避免每拍钉着打
    avatarCache.set(key, { url: fallbackUrl, at: Date.now() - AVATAR_TTL_MS + 10 * 60_000 })
    return fallbackUrl
  }
  avatarCache.set(key, { url: fallbackUrl, at: Date.now() - AVATAR_TTL_MS + 10 * 60_000 })
  return fallbackUrl
}

/** 行点击抽屉:读取 GitHub 官方渲染的 README HTML(Accept: html+json)。
 * GitHub 自己完成 markdown 渲染与消毒 —— 这正是打开仓库页面时看到的内容本体。
 * 服务端共享缓存 1 小时:同一仓库的访客共用一份请求。
 *
 * 链接治理:GitHub 渲染后混着三种形态 —— 根相对(/owner/repo/raw/...)、
 * 同目录裸相对(docs/readme/README_zh.md)、绝对外链。裸相对进了抽屉会被
 * 浏览器解析到我们自己的域名上(404 那种),这里统一改写:
 *   文档链  → https://github.com/{full}/blob/{branch}/{dir}/{path}(抽屉内可继续翻)
 *   图片    → https://raw.githubusercontent.com/{full}/{branch}/{dir}/{path}(CDN 直链)
 *   外部链接 → 一律新标签;页内锚点保持原文,交给客户端就地滚动。
 *
 * 语言协商:站点语言(16 语)优先取仓库对应语言的 README(切换器解析+命名候选)。 */
const REPO_FULL_RE = /^[^/\s\\]{1,100}\/[^/\s\\]{1,120}$/

/** 各语言的 README 常见命名候选:切换器没给路径时按惯例兜底。
 * 只登记站点语言;组合覆盖 _/-/. 分隔与语言子标签,目录只收 docs/、docs/readme/、doc/ 三个高发位。 */
const LANG_README_PATHS: Partial<Record<Locale, string[]>> = {
  zh: [
    'README_zh-CN.md', 'README.zh-CN.md', 'README_zh.md', 'README.zh.md',
    'README_zh-Hans.md', 'README_CN.md', 'README-zh.md',
    'docs/README_zh-CN.md', 'docs/README_zh.md',
  ],
  'zh-TW': [
    'README_zh-TW.md', 'README.zh-TW.md', 'README_zh-Hant.md', 'README.zh-Hant.md',
    'README_TW.md', 'README_zh-tw.md', 'README-zh-TW.md',
    'docs/README_zh-TW.md', 'docs/readme/README_zh-TW.md', 'doc/README_zh-TW.md',
  ],
  ja: ['README_ja.md', 'README.ja.md', 'README_ja-JP.md', 'README.ja-JP.md', 'README_JA.md', 'README-ja.md', 'docs/README_ja.md', 'docs/readme/README_ja.md', 'doc/README_ja.md'],
  ko: ['README_ko.md', 'README.ko.md', 'README_ko-KR.md', 'README.ko-KR.md', 'README_KR.md', 'README-ko.md', 'docs/README_ko.md', 'docs/readme/README_ko.md'],
  de: ['README_de.md', 'README.de.md', 'README_de-DE.md', 'README.de-DE.md', 'README.German.md', 'README-DE.md', 'docs/README_de.md', 'docs/readme/README_de.md'],
  fr: ['README_fr.md', 'README.fr.md', 'README_fr-FR.md', 'README.fr-FR.md', 'README.French.md', 'docs/README_fr.md', 'docs/readme/README_fr.md'],
  es: ['README_es.md', 'README.es.md', 'README_es-ES.md', 'README.es-ES.md', 'README.Spanish.md', 'docs/README_es.md', 'docs/readme/README_es.md'],
  pt: ['README_pt-BR.md', 'README.pt-BR.md', 'README_pt.md', 'README.pt.md', 'README_pt-PT.md', 'README-PT.md', 'docs/README_pt-BR.md', 'docs/readme/README_pt-BR.md'],
  it: ['README_it.md', 'README.it.md', 'README_it-IT.md', 'README.Italian.md', 'docs/README_it.md', 'docs/readme/README_it.md'],
  ru: ['README_ru.md', 'README.ru.md', 'README_ru-RU.md', 'README-Russian.md', 'docs/README_ru.md', 'docs/readme/README_ru.md'],
  uk: ['README_uk.md', 'README.uk.md', 'README_ua.md', 'README_UA.md', 'README-ua.md', 'docs/README_uk.md', 'docs/readme/README_uk.md'],
  pl: ['README_pl.md', 'README.pl.md', 'README_pl-PL.md', 'README.Polish.md', 'docs/README_pl.md', 'docs/readme/README_pl.md'],
  tr: ['README_tr.md', 'README.tr.md', 'README_tr-TR.md', 'README.Turkish.md', 'docs/README_tr.md', 'docs/readme/README_tr.md'],
  vi: ['README_vi.md', 'README.vi.md', 'README_vn.md', 'README_VN.md', 'README-vi.md', 'docs/README_vi.md', 'docs/readme/README_vi.md'],
  id: ['README_id.md', 'README.id.md', 'README_id-ID.md', 'README_in.md', 'README-id.md', 'docs/README_id.md', 'docs/readme/README_id.md'],
}

async function githubHtml(url: string): Promise<string | null> {
  const attempts = Math.max(1, TOKENS.length)
  for (let i = 0; i < attempts; i++) {
    try {
      await quotaSlot(`md:${url.slice(-60)}`)
      const res = await fetch(url, {
        headers: { ...githubHeaders(), Accept: 'application/vnd.github.html+json' },
        signal: AbortSignal.timeout(TIME_BUDGET_MS),
        next: { revalidate: 3600 },
      })
      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          markTokenCooldown(res)
          continue
        }
        return null
      }
      const text = await res.text()
      // 防御性剥壳:预期返回片段,但若带了文档级标签一并去掉
      const cleaned = text
        .replace(/<!doctype[\s\S]*?>|<\/?(html|body)[^>]*>/gi, '')
        .trim()
      return cleaned || null
    } catch {
      return null
    }
  }
  return null
}

async function defaultBranch(full: string): Promise<string> {
  try {
    await quotaSlot(`branch:${full}`)
    const res = await fetch(`https://api.github.com/repos/${full}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(TIME_BUDGET_MS),
      next: { revalidate: 21600 },
    })
    if (!res.ok) return 'main'
    const j = (await res.json()) as { default_branch?: string }
    return j.default_branch || 'main'
  } catch {
    return 'main'
  }
}

/** 把 a/./b/../c 这类路径段归一化成干净的仓库根路径。 */
function normRel(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** 统一改写:剥壳 → 根相对补域 → 裸相对按文档目录落位 → 外链新标签。 */
function absolutizeMdHtml(html: string, full: string, branch: string, dir: string): string {
  let out = html.replace(/<!doctype[\s\S]*?>|<\/?(html|body)[^>]*>/gi, '').trim()
  const blobBase = `https://github.com/${full}/blob/${branch}`
  const rawBase = `https://raw.githubusercontent.com/${full}/${branch}`
  // 根相对(/owner/repo/raw/...)补 GitHub 域
  out = out.replace(/(src|href)="\/([^/])/g, '$1="https://github.com/$2')
  // 裸相对(含 ./ 与 ../)一律先并入文档目录、再做段归一化,.. 才有正确落点
  out = out.replace(/href="(?!(?:https?:|#|mailto:|javascript:))([^"]+)"/gi, (m, p1) => {
    const rel = dir ? `${dir}/${p1}` : p1
    return `href="${blobBase}/${normRel(rel)}"`
  })
  // 同目录裸相对的图片
  out = out.replace(/src="(?!(?:https?:|data:|#))([^"]+)"/gi, (m, p1) => {
    const rel = dir ? `${dir}/${p1}` : p1
    return `src="${rawBase}/${normRel(rel)}"`
  })
  // 外链新标签(页内锚点除外,交给客户端就地滚动)
  out = out.replace(/<a\b(?![^>]*\btarget=)(?![^>]*\bhref="#)/g, '<a target="_blank" rel="noopener noreferrer"')
  return out
}

/** 从语言切换器找同仓库的目标语言 README 路径。锚文本走 locales 的共用表,长正文不算。 */
function findLocalizedReadmePath(html: string, full: string, branch: string, locale: Locale): string | null {
  const rule = LANG_LINK_TEXT.find((r) => r.lg === locale)
  if (!rule) return null
  const malink = `https://github.com/${full}/blob/${branch}/`
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/g
  for (const m of html.matchAll(re)) {
    const href = m[1]
    const text = m[2].replace(/<[^>]+>/g, '').trim()
    if (!text || text.length > 24) continue
    if (!rule.re.test(text)) continue
    if (!/\.md$/i.test(href)) continue
    if (href.startsWith(malink)) return href.slice(malink.length)
  }
  return null
}

async function renderMarkdownFile(full: string, path: string, branch: string): Promise<string | null> {
  return githubHtml(
    `https://api.github.com/repos/${full}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`,
  )
}

/** 仓库页面(默认 README/目标语言 README),站点语言协商共用。
 * 切换器命中优先,命名候选兜底;全链路走服务端缓存(分支 6h、文档 1h),重复访问零新增成本。
 * 返回 localized:是否真的读到了该语言的版本 —— 行描述只认本地化版,
 * 默认英文版只给抽屉兜底,冒充 "某种语言的描述" 会把英文原句错标进语言槽。 */
async function fetchLocalizedReadme(full: string, locale: Locale): Promise<{ html: string | null; localized: boolean }> {
  if (!REPO_FULL_RE.test(full)) return { html: null, localized: false }
  const branch = await defaultBranch(full)
  const baseHtml = await githubHtml(`https://api.github.com/repos/${full}/readme`)
  if (!baseHtml) return { html: null, localized: false }
  const html = absolutizeMdHtml(baseHtml, full, branch, '')
  if (locale === 'en') return { html, localized: false }
  const candidates: string[] = []
  const hit = findLocalizedReadmePath(html, full, branch, locale)
  if (hit) candidates.push(hit)
  for (const p of LANG_README_PATHS[locale] ?? []) {
    if (!candidates.includes(p)) candidates.push(p)
  }
  // 探测有上限:切换器给了路径就多备几个命名候选兜底;没有切换器的仓库只浅探 3 个,
  // 否则无翻译的仓库会为每个语言打一串注定 404 的探测,把配额吃穿。
  for (const p of candidates.slice(0, hit ? 10 : 3)) {
    const localized = await renderMarkdownFile(full, p, branch)
    if (!localized) continue
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    return { html: absolutizeMdHtml(localized, full, branch, dir), localized: true }
  }
  return { html, localized: false }
}

export async function fetchRepoReadme(full: string, locale: Locale = 'en'): Promise<string | null> {
  return (await fetchLocalizedReadme(full, locale)).html
}

/** 抽屉内就地翻页:渲染同仓库任意 md 文档(语言切换/文档链接点进来走这里)。 */
export async function fetchRepoDoc(full: string, fromHref: string): Promise<string | null> {
  if (!REPO_FULL_RE.test(full)) return null
  // 相对链上的 ./ 与 ../ 段归一化为仓库根路径(与浏览器对 blob 页的解析一致)
  const parts: string[] = []
  for (const seg of fromHref.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const p = parts.join('/')
  if (!/^[\w./-]{1,160}\.md$/i.test(p)) return null
  const branch = await defaultBranch(full)
  const html = await renderMarkdownFile(full, p, branch)
  if (!html) return null
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
  return absolutizeMdHtml(html, full, branch, dir)
}

/** 站点给定语言的行描述:取该语言 README 的首句。en 不用取(默认版即英文)。
 * 读取全吃服务端缓存(分支 6h、README 1h、语言文档 1h),与抽屉共享。 */
export async function fetchDescLng(full: string, locale: Locale): Promise<string | null> {
  if (locale === 'en') return null
  const { html, localized } = await fetchLocalizedReadme(full, locale)
  return localized && html ? pickLeadLine(html, locale) : null
}

/** 根目录 README* 文件名一次列表(按仓库收割用):一次调用同时覆盖全部语言的命名候选,
 * 替代逐语言试错式探测 —— 无翻译的仓库不再为每种语言打一串注定 404 的调用。 */
async function listRootReadmeNames(full: string): Promise<string[]> {
  try {
    await quotaSlot(`rootlist:${full}`)
    const res = await fetch(`https://api.github.com/repos/${full}/contents/`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(TIME_BUDGET_MS),
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const arr = (await res.json()) as Array<{ name?: string }>
    return (Array.isArray(arr) ? arr : [])
      .map((f) => (typeof f?.name === 'string' ? f.name : ''))
      .filter((n) => /^readme/i.test(n))
  } catch {
    return []
  }
}

/** 按仓库一次性收割全部站点语言的行描述(同步期主动补齐用)。
 * 每仓固定 2 个上游调用(默认 README 渲染 + 根目录列表),语言文件确实命中才再花 1 次。
 * resolved = 给出确定结论的语种(拿到描述 / 有翻译但无可用首句 / 切换器与命名都没有);
 * 渲染失败那次不给结论,由调用方判为未决、下一轮同步重试。 */
export interface RepoHarvest {
  descs: Partial<Record<Locale, string>>
  resolved: Locale[]
}

export async function harvestRepoDescs(full: string): Promise<RepoHarvest> {
  const out: RepoHarvest = { descs: {}, resolved: [] }
  if (!REPO_FULL_RE.test(full)) return out
  const branch = await defaultBranch(full)
  const base = await githubHtml(`https://api.github.com/repos/${full}/readme`)
  if (!base) return out
  const baseHtml = absolutizeMdHtml(base, full, branch, '')
  const rootReadmes = await listRootReadmeNames(full)
  const lowerRoot = new Set(rootReadmes.map((n) => n.toLowerCase()))
  for (const locale of LOCALES) {
    if (locale === 'en') continue
    let path = findLocalizedReadmePath(baseHtml, full, branch, locale)
    if (!path) {
      for (const cand of LANG_README_PATHS[locale] ?? []) {
        if (!cand.includes('/') && lowerRoot.has(cand.toLowerCase())) {
          path = cand
          break
        }
      }
    }
    if (!path) {
      out.resolved.push(locale)
      continue
    }
    const file = await renderMarkdownFile(full, path, branch)
    if (!file) continue
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const lead = pickLeadLine(absolutizeMdHtml(file, full, branch, dir), locale)
    if (lead) out.descs[locale] = lead
    out.resolved.push(locale)
  }
  return out
}

/** 判定一句摘文属于目标语言:按文字系统给下限,徽章汤/英文正文混不进来。 */
function scriptOk(locale: string, t: string): boolean {
  const count = (re: RegExp) => (t.match(re)?.length ?? 0)
  switch (locale) {
    case 'zh':
    case 'zh-TW':
      return count(/[\u3400-\u9fff\uf900-\ufaff]/g) >= 6
    case 'ja':
      return count(/[\u3040-\u30ff]/g) >= 2 || count(/[\u3400-\u9fff]/g) >= 8
    case 'ko':
      return count(/[\uac00-\ud7af]/g) >= 4
    case 'ru':
    case 'uk':
      return count(/[\u0400-\u04ff]/g) >= 8
    default:
      // 拉丁系:词数与字母量双下限,广告行/占位串基本被挡在外面
      return t.split(' ').length >= 5 && count(/[A-Za-z\u00c0-\u017f]/g) >= 14
  }
}

/** 取"像人话"的首段当行描述:落在语言文字系统内、长度适中;
 * 排掉徽章汤与语言切换器(整段 · 分隔的链接)。 */
function pickLeadLine(html: string, locale: string): string | null {
  const ps = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? []
  for (const p of ps) {
    const t = p
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 10 || t.length > 140) continue
    if (!scriptOk(locale, t)) continue
    if (/(^|\s)·(\s|$)/.test(t)) continue
    return t
  }
  return null
}

async function ghJson(url: string): Promise<unknown> {
  const attempts = Math.max(1, TOKENS.length)
  for (let i = 0; i < attempts; i++) {
    await quotaSlot(url.slice(-40))
    const res = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(TIME_BUDGET_MS),
      next: { revalidate: GH_TTL_SECONDS },
    })
    if (res.status === 403 || res.status === 429) {
      // 该账号被拒:挂上冷却(主配额尽 / 次级限流),池里还有就换下一枚立刻重试
      markTokenCooldown(res)
      if (i < attempts - 1) continue
      throw new RateLimitError(`GitHub rate limited [${res.status}] ${url}`)
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status} on ${url}`)
    return res.json()
  }
  throw new RateLimitError('GitHub token pool exhausted')
}

function mapRepo(repo: GhSearchRepo): BoardRepoFields {
  const [owner, name] = repo.full_name.split('/')
  return {
    id: repo.id,
    fullName: repo.full_name,
    owner: owner ?? '',
    name: name ?? repo.full_name,
    htmlUrl: repo.html_url,
    avatarUrl: repo.owner?.avatar_url
      ? `${repo.owner.avatar_url}${repo.owner.avatar_url.includes('?') ? '&' : '?'}s=96`
      : `https://github.com/${owner ?? 'github'}.png`,
    desc: repo.description ? cleanDesc(repo.description) : null,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    issues: repo.open_issues_count,
    language: repo.language,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    topics: (repo.topics ?? []).slice(0, 3),
  }
}

type BoardRepoFields = {
  id: number
  fullName: string
  owner: string
  name: string
  htmlUrl: string
  avatarUrl: string
  desc: string | null
  stars: number
  forks: number
  issues: number
  language: string | null
  createdAt: string
  pushedAt: string
  topics: string[]
}

export interface GhSearchOptions {
  sort?: string
  order?: string
  perPage?: number
  pages?: number
}

/** Search API 仓库搜索；pages=2 表示并发取前两页。 */
export async function ghSearch(
  q: string,
  { sort = 'stars', order = 'desc', perPage = 100, pages = 1 }: GhSearchOptions = {},
): Promise<BoardRepoFields[]> {
  const urls = Array.from(
    { length: Math.max(1, pages) },
    (_, i) =>
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=${order}&per_page=${perPage}&page=${i + 1}`,
  )

  const settled = await Promise.allSettled(urls.map(ghJson))
  const items: BoardRepoFields[] = []
  let firstError: unknown = null
  let sawRateLimit = false

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const payload = result.value as GhSearchResponse
      items.push(...(payload.items ?? []).map(mapRepo))
    } else {
      firstError ||= result.reason
      if (result.reason instanceof RateLimitError) sawRateLimit = true
    }
  }

  if (items.length === 0 && firstError) {
    throw sawRateLimit
      ? new RateLimitError('GitHub Search rate limited')
      : firstError
  }
  return items
}

export interface TrendingQuery {
  since: 'daily' | 'weekly' | 'monthly'
  language?: string
  /** 抓前 N 页(trending 每页 25 条);仅第 1 页失败则照旧整批抛错。 */
  pages?: number
}

/** 抓取 github.com/trending 公开页面并解析(可多页拼接)。 */
export async function fetchTrendingPage({ since, language, pages = 1 }: TrendingQuery): Promise<string> {
  const path = language ? `/trending/${encodeURIComponent(language.toLowerCase())}` : '/trending'
  const chunks: string[] = []
  for (let page = 1; page <= Math.max(1, pages); page++) {
    await quotaSlot(`trending:${since}:${language ?? 'all'}`)
    const url = `https://github.com${path}?since=${since}${page > 1 ? `&page=${page}` : ''}`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.8',
      },
      signal: AbortSignal.timeout(SCRAPE_TIME_BUDGET_MS),
      next: { revalidate: TRENDING_TTL_SECONDS },
    })
    if (res.status === 403 || res.status === 429) {
      // 第 1 页被挡是致命的;后续页被挡则用已得页数继续(行数少些,诚实降级)
      if (page === 1) throw new RateLimitError(`trending blocked [${res.status}]`)
      break
    }
    if (!res.ok) {
      if (page === 1) throw new Error(`trending page ${res.status}`)
      break
    }
    chunks.push(await res.text())
  }
  return chunks.join('\n<!--page-->\n')
}
