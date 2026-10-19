
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanDesc } from './parse'

const TOKEN = (process.env.GITHUB_TOKEN ?? '').trim()

/** Data Cache 生命周期：有 token 冷却 5 分钟；匿名放宽到 15 分钟。 */
export const GH_TTL_SECONDS = TOKEN ? 300 : 900
export const TRENDING_TTL_SECONDS = 900
export const HAS_GITHUB_TOKEN = Boolean(TOKEN)

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
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  return headers
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
    || (trending ? 650 : TOKEN ? 2_100 : 6_200)
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
 * 语言协商:站点为 zh 且仓库提供中文 README(切换器或常见命名)时优先取中文版。 */
const REPO_FULL_RE = /^[^/\s\\]{1,100}\/[^/\s\\]{1,120}$/

const ZH_README_PATHS = [
  'README_zh-CN.md',
  'README.zh-CN.md',
  'README_zh.md',
  'README.zh.md',
  'README_zh-Hans.md',
  'README.zh-Hans.md',
  'README_CN.md',
  'README-zh.md',
  'docs/README_zh-CN.md',
  'docs/README_zh.md',
  'docs/readme/README_zh-CN.md',
  'docs/readme/README_zh.md',
  'doc/README_zh.md',
  'docs/zh/README.md',
]

async function githubHtml(url: string): Promise<string | null> {
  try {
    await quotaSlot(`md:${url.slice(-60)}`)
    const res = await fetch(url, {
      headers: { ...githubHeaders(), Accept: 'application/vnd.github.html+json' },
      signal: AbortSignal.timeout(TIME_BUDGET_MS),
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
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

/** 从语言切换器(简体中文/繁體中文/中文…)找同仓库的中文 README 路径。 */
function findZhReadmePath(html: string, full: string, branch: string): string | null {
  const malink = `https://github.com/${full}/blob/${branch}/`
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/g
  for (const m of html.matchAll(re)) {
    const href = m[1]
    const text = m[2].replace(/<[^>]+>/g, '')
    if (!/简体中文|簡體中文|繁體中文|繁體中文|中文/.test(text)) continue
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

export async function fetchRepoReadme(full: string, locale = 'en'): Promise<string | null> {
  if (!REPO_FULL_RE.test(full)) return null
  const branch = await defaultBranch(full)
  const baseHtml = await githubHtml(`https://api.github.com/repos/${full}/readme`)
  if (!baseHtml) return null
  const html = absolutizeMdHtml(baseHtml, full, branch, '')
  if (locale === 'zh') {
    const candidates: string[] = []
    const zh = findZhReadmePath(html, full, branch)
    if (zh) candidates.push(zh)
    for (const p of ZH_README_PATHS) {
      if (!candidates.includes(p)) candidates.push(p)
    }
    // 探测有上限:命中即回,未命中回落默认版;每次尝试都带服务端缓存,重复访问零新增成本
    for (const p of candidates.slice(0, 9)) {
      const zhHtml = await renderMarkdownFile(full, p, branch)
      if (!zhHtml) continue
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
      return absolutizeMdHtml(zhHtml, full, branch, dir)
    }
  }
  return html
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

/** zh 站点行描述:优先仓库自身中文 README 的首句。三次读取全吃服务端缓存
 * (branch 6h、README 1h、中文文档 1h),与抽屉共享,重复同步几乎零成本。
 * 只认语言切换器里明确给出的中文版;没有就不硬猜,把同步成本守住。 */
export async function fetchZhDesc(full: string): Promise<string | null> {
  if (!REPO_FULL_RE.test(full)) return null
  try {
    const branch = await defaultBranch(full)
    const baseHtml = await githubHtml(`https://api.github.com/repos/${full}/readme`)
    if (!baseHtml) return null
    const zhPath = findZhReadmePath(absolutizeMdHtml(baseHtml, full, branch, ''), full, branch)
    if (!zhPath) return null
    const zhHtml = await renderMarkdownFile(full, zhPath, branch)
    if (!zhHtml) return null
    return pickLeadLine(zhHtml)
  } catch {
    return null
  }
}

/** 取中文 README 第一段"像人话"的句子当行描述:要有足量 CJK、长度适中;
 * 掉徽章汤(纯拉丁链)与语言切换器(整段 · 分隔的链接)。 */
function pickLeadLine(html: string): string | null {
  const ps = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? []
  for (const p of ps) {
    const t = p
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 10 || t.length > 140) continue
    if ((t.match(/[\u4e00-\u9fff]/g)?.length ?? 0) < 6) continue
    if (/(^|\s)·(\s|$)/.test(t)) continue
    return t
  }
  return null
}

async function ghJson(url: string): Promise<unknown> {
  await quotaSlot(url.slice(-40))
  const res = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(TIME_BUDGET_MS),
    next: { revalidate: GH_TTL_SECONDS },
  })
  if (res.status === 403 || res.status === 429) {
    throw new RateLimitError(`GitHub rate limited [${res.status}] ${url}`)
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${url}`)
  }
  return res.json()
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
}

/** 抓取 github.com/trending 公开页面并解析。 */
export async function fetchTrendingPage({ since, language }: TrendingQuery): Promise<string> {
  await quotaSlot(`trending:${since}:${language ?? 'all'}`)
  const path = language ? `/trending/${encodeURIComponent(language.toLowerCase())}` : '/trending'
  const url = `https://github.com${path}?since=${since}`
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
    throw new RateLimitError(`trending blocked [${res.status}]`)
  }
  if (!res.ok) {
    throw new Error(`trending page ${res.status}`)
  }
  return res.text()
}
