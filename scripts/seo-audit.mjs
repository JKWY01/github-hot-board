#!/usr/bin/env node
/**
 * SEO 自动审计脚本(npm run seo:audit)
 *
 * 对线上站点做只读审计:抓取每类页面的代表样本,检查 11 项信号,
 * 输出 JSON + Markdown 报告。不修改任何线上资源。
 *
 * 设计纪律(对应整改任务第三节):
 * - 有意 noindex(watch/discover/status)与意外 noindex 区分对待,不误报;
 * - 全部检查基于真实 HTTP 响应,不假设实现;
 * - 抽样而非全量(5,731 仓 × 16 语不现实),样本按页面类型分层;
 * - 退出码:发现 P0 返回 1(CI 可用),否则 0。
 *
 * 用法:
 *   node scripts/seo-audit.mjs [--base https://git.vaiox.xyz] [--out reports] [--full]
 *   --full  英文档案样本 5→15 个,总样本 43→53(慢,约 1 分钟)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'


/** hreflang 目标 URL 纯函数:给定语言代码与当前样本路径,算期望的替代 URL。
 *  '/zh' → '/en';'/zh/boards/overall' → '/en/boards/overall';x-default 恒指 /en。
 *  独立导出供行为测试覆盖(/zh、/zh/boards/overall、/zh-TW/... 等形态)。 */
export function expectedHrefFor(lang, samplePath) {
  const stripped = samplePath.replace(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?)(?=\/|$)/, '')
  return `/${lang === 'x-default' ? 'en' : lang}${stripped}`
}

const BASE = argBase()
const OUT_DIR = argOut()
const UA_BOT = 'Mozilla/5.0 (compatible; GHQB-SeoAudit/1.0)'
const CONCURRENCY = 6
const TIMEOUT_MS = 20_000

/** 分层样本:覆盖首页/十榜/语言分榜/档案/往日榜/特殊页(含 4 语首页样本)。 */
function samples(full) {
  const langs = ['zh', 'en', 'es', 'pl']
  const boards = ['overall', 'weekly', 'monthly', 'annual', 'rising', 'dark', 'overlooked', 'controversial', 'forks', 'milestone']
  const facets = [
    ['zh', 'overall', 'python'], ['en', 'weekly', 'typescript'], ['zh', 'monthly', 'rust'],
    ['en', 'overall', 'javascript'], ['zh', 'weekly', 'cpp'],
  ]
  const repos = full
    ? ['vercel/next.js', 'morluto/rea', 'google/guava', 'freeCodeCamp/freeCodeCamp', 'sindresorhus/awesome', 'peach-mitao/peach', 'Gathin23/cleanyourtv', 'cloudflare/security-audit-skill', 'deepseek-ai/deepseek-harness', 'public-apis/public-apis', 'codecrafters-io/build-your-own-x', 'anthropics/claude-code', 'ruvnet/ruflo', 'stablyai/orca', 'Ebony-Vinyl/dsh-our-free-model']
    : ['vercel/next.js', 'morluto/rea', 'google/guava', 'peach-mitao/peach', 'freeCodeCamp/freeCodeCamp']
  const historyDays = recentDays(3)
  const out = []
  for (const l of langs) out.push({ kind: 'home', path: `/${l}`, noindexAllowed: false })
  out.push({ kind: 'root', path: '/', noindexAllowed: false, expectRedirect: true })
  for (const slug of boards) out.push({ kind: 'board', path: `/zh/boards/${slug}`, noindexAllowed: false })
  out.push({ kind: 'board', path: `/en/boards/overall`, noindexAllowed: false })
  for (const [l, slug, facet] of facets) out.push({ kind: 'facet', path: `/${l}/boards/${slug}/${facet}`, noindexAllowed: false })
  for (const repo of repos) out.push({ kind: 'repo', path: `/en/repo/${repo}`, noindexAllowed: false })
  out.push({ kind: 'repo', path: `/zh/repo/${repos[0]}`, noindexAllowed: false })
  out.push({ kind: 'repo', path: `/es/repo/${repos[2] ?? repos[0]}`, noindexAllowed: false })
  for (const slug of ['overall', 'weekly']) {
    out.push({ kind: 'history-index', path: `/zh/history/${slug}`, noindexAllowed: false })
    for (const day of historyDays) out.push({ kind: 'history-day', path: `/en/history/${slug}/${day}`, noindexAllowed: false })
  }
  // 有意 noindex 的工具页:发现/状态/关注(设计如此,审计只验证"确实 noindex + 可访问")
  out.push({ kind: 'tool-discover', path: '/zh/discover', noindexAllowed: true })
  out.push({ kind: 'tool-status', path: '/zh/status', noindexAllowed: true })
  out.push({ kind: 'tool-watch', path: '/zh/watch', noindexAllowed: true })
  out.push({ kind: 'guide', path: '/en/guide', noindexAllowed: false })
  out.push({ kind: 'feed', path: '/feed.xml', noindexAllowed: false })
  out.push({ kind: 'robots', path: '/robots.txt', noindexAllowed: false })
  out.push({ kind: 'sitemap-index', path: '/sitemap-index.xml', noindexAllowed: false })
  return out
}

function recentDays(n) {
  const out = []
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(Date.now() - i * 86_400_000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function argBase() {
  const i = process.argv.indexOf('--base')
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '')
  return process.env.SEQ_AUDIT_BASE ?? 'https://git.vaiox.xyz'
}
function argOut() {
  const i = process.argv.indexOf('--out')
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1]
  return 'reports/seo'
}

async function fetchPage(path, retry = true) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'user-agent': UA_BOT, 'accept-language': 'en' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const headers = Object.fromEntries(res.headers.entries())
    const body = res.status >= 200 && res.status < 400 && !path.endsWith('.xml') ? await res.text() : ''
    const ms = Date.now() - t0
    // 体积口径 = 解压后 HTML 的 UTF-8 字节数(body.length 是 UTF-16 代码单元,
    // 中文页面会虚高;传输体积(gzip/br)由性能报告独立记录,两者不混)
    const htmlBytes = Buffer.byteLength(body, 'utf8')
    return { ok: true, status: res.status, location: headers.location ?? null, headers, body, ms, bytes: htmlBytes }
  } catch (e) {
    // 网络抖动抗性:fetch 失败/超时重试一次,两次都败才算真问题(审计结论要可复现)
    if (retry) {
      await new Promise((r) => setTimeout(r, 1500))
      return fetchPage(path, false)
    }
    return { ok: false, error: String(e?.cause ?? e).slice(0, 120), ms: Date.now() - t0 }
  }
}

const isXml = (p) => p.endsWith('.xml') // robots.txt 要读 body 解析 Sitemap 行

/** 单页检查:返回问题数组。 */
function checkPage(sample, r) {
  const issues = []
  const url = `${BASE}${sample.path}`

  if (!r.ok) {
    issues.push({ url, type: 'fetch-failed', sev: 'P0', detail: r.error })
    return issues
  }
  if (sample.expectRedirect) {
    if (r.status !== 200 && ![301, 302, 307, 308].includes(r.status)) {
      issues.push({ url, type: 'unexpected-status', sev: 'P1', detail: `expect redirect, got ${r.status}` })
    }
    return issues
  }
  if (r.status !== 200) {
    // 有意 404 的样本(如未来日期)由 kind=history-day 的日期窗口保证不会出现
    issues.push({ url, type: 'http-status', sev: r.status >= 500 ? 'P0' : 'P1', detail: `got ${r.status}${r.location ? ` → ${r.location}` : ''}` })
    return issues
  }
  if (r.ms > 5_000) issues.push({ url, type: 'slow-response', sev: 'P2', detail: `${r.ms}ms` })
  if (isXml(sample.path) || sample.path === '/robots.txt') return issues // XML/robots 只查可达性

  const h = r.body
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(h)?.[1]?.trim() ?? ''
  const desc = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(h)?.[1]?.trim()
    ?? /<meta\s+content="([^"]*)"\s+name="description"/i.exec(h)?.[1]?.trim()
  const h1s = [...h.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]))
  const canonical = /<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(h)?.[1]
    ?? /<link\s+href="([^"]*)"\s+rel="canonical"/i.exec(h)?.[1]
  const robotsMeta = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(h)?.[1] ?? ''
  const hreflangs = [...h.matchAll(/<link\s+rel="alternate"[^>]*hrefLang="([^"]+)"[^>]*href="([^"]+)"/gi)].map((m) => ({ lang: m[1], href: m[2] }))
  const ldBlocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])

  // 1) title/desc/H1
  if (!title) issues.push({ url, type: 'missing-title', sev: 'P0', detail: '' })
  else if (title.length > 70) issues.push({ url, type: 'title-too-long', sev: 'P2', detail: `${title.length} chars` })
  if (!desc) issues.push({ url, type: 'missing-description', sev: 'P1', detail: '' })
  if (h1s.length === 0) issues.push({ url, type: 'missing-h1', sev: 'P1', detail: '' })
  else if (h1s.length > 1) issues.push({ url, type: 'multiple-h1', sev: 'P2', detail: `${h1s.length} h1` })

  // 2) noindex 有意/意外
  const noindex = /noindex/i.test(robotsMeta)
  if (noindex && !sample.noindexAllowed) issues.push({ url, type: 'unexpected-noindex', sev: 'P0', detail: robotsMeta })
  if (!noindex && sample.noindexAllowed) issues.push({ url, type: 'expected-noindex-missing', sev: 'P1', detail: 'tool page should stay noindex' })

  // 3) canonical
  if (!canonical) issues.push({ url, type: 'missing-canonical', sev: 'P1', detail: '' })
  else {
    const want = `${BASE}${sample.path}`
    if (canonical !== want) issues.push({ url, type: 'canonical-mismatch', sev: 'P1', detail: `canonical=${canonical} want=${want}` })
  }

  // 4) hreflang:精确断言(不是数数量)——16 语集合、x-default、重复码、目标 URL 形态、自指。
  //    期望集合与 lib/locales.ts 的 LOCALES 同步(脚本独立于 TS,改语言路由时两处同改)。
  const EXPECTED_LANGS = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'ru', 'uk', 'pl', 'tr', 'vi', 'id']
  if (['home', 'board', 'facet', 'repo', 'history-index', 'guide'].includes(sample.kind)) {
    const langs = hreflangs.map((x) => x.lang)
    const missing = EXPECTED_LANGS.filter((l) => !langs.includes(l))
    if (missing.length) issues.push({ url, type: 'hreflang-incomplete', sev: 'P1', detail: `missing: ${missing.join(',')}` })
    if (!langs.includes('x-default')) issues.push({ url, type: 'hreflang-missing-x-default', sev: 'P1', detail: '' })
    const dupes = langs.filter((l, i) => langs.indexOf(l) !== i)
    if (dupes.length) issues.push({ url, type: 'hreflang-duplicate', sev: 'P2', detail: dupes.join(',') })
    // 目标 URL 形态:每项必须是 /{lang}/<同一路径>(x-default → /en/...),跨语言链接错乱在此暴露
    for (const { lang, href } of hreflangs) {
      const want = `${BASE}${expectedHrefFor(lang, sample.path)}`
      if (href !== want) issues.push({ url, type: 'hreflang-wrong-target', sev: 'P1', detail: `${lang} → ${href} (want ${want})` })
    }
    const selfOk = hreflangs.some((x) => x.href === `${BASE}${sample.path}`)
    if (!selfOk) issues.push({ url, type: 'hreflang-missing-self', sev: 'P1', detail: '' })
  }

  // 5) 结构化数据:JSON-LD 必须是可解析对象(双重转义回归 = 解析成 string)
  for (const [i, block] of ldBlocks.entries()) {
    try {
      const parsed = JSON.parse(block)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        issues.push({ url, type: 'ld+json-not-object', sev: 'P0', detail: `block #${i} parses to ${Array.isArray(parsed) ? 'array' : typeof parsed}` })
      } else if (!('@type' in parsed)) {
        issues.push({ url, type: 'ld+json-missing-type', sev: 'P1', detail: `block #${i}` })
      }
    } catch (e) {
      issues.push({ url, type: 'ld+json-unparsable', sev: 'P0', detail: `block #${i}: ${String(e).slice(0, 80)}` })
    }
  }

  // 6) 主体内容可抓取:页面核心数据必须出现在无 JS 的 HTML 里(榜单行/档案名)
  if (sample.kind === 'board' && !/<li[ >]/.test(h) && !/<ol[ >]/.test(h)) {
    issues.push({ url, type: 'content-not-in-html', sev: 'P0', detail: 'no list markup for board rows' })
  }
  if (sample.kind === 'repo' && !sample.path.split('/').pop().includes('.')) {
    const repoName = decodeURIComponent(sample.path.split('/').pop() ?? '')
    if (repoName && !h.includes(repoName.split('/').pop() ?? '')) {
      issues.push({ url, type: 'content-not-in-html', sev: 'P0', detail: 'repo name absent from HTML' })
    }
  }

  // 7) 体积
  if (r.bytes > 1_200_000) issues.push({ url, type: 'page-too-heavy', sev: 'P2', detail: `uncompressed HTML ${Math.round(r.bytes / 1024)}KiB (utf8 bytes)` })

  return issues
}

/** sitemap 审计:分片可达 + 计数 + 与 robots 对照。 */
async function auditSitemaps(issues) {
  const robotsRes = await fetchPage('/robots.txt')
  const robots = robotsRes.ok ? robotsRes.body : ''
  const sitemapUrls = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1])
  const counts = {}
  for (const sm of sitemapUrls) {
    const path = sm.replace(BASE, '') || sm
    const r = await fetchPage(path)
    if (!r.ok || r.status !== 200) {
      issues.push({ url: sm, type: 'sitemap-unreachable', sev: 'P0', detail: r.ok ? `status ${r.status}` : r.error })
      continue
    }
    // XML 不进 body(fetchPage 对 XML 略过 body),单独拉
    const xml = await (await fetch(sm, { headers: { 'user-agent': UA_BOT }, signal: AbortSignal.timeout(TIMEOUT_MS) })).text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    counts[path] = locs.length
    // 抽第一条 URL 验证可达
    if (locs.length > 0) {
      const probe = locs[Math.floor(locs.length / 2)].replace(BASE, '')
      const pr = await fetchPage(probe)
      if (!pr.ok || pr.status !== 200) {
        // 诊断用被抽查页自身的失败信息(pr),不是 sitemap 请求的 r(评审实锤的变量误用)
        const detail = pr.ok ? `status ${pr.status}` : (pr.error ?? 'unknown')
        issues.push({ url: locs[Math.floor(locs.length / 2)], type: 'sitemap-dead-url', sev: 'P1', detail })
      }
    }
  }
  // robots 语义:discover 禁爬 + discover 页自身 noindex = 一致;若页面可访问但 sitemap 收录 = 矛盾
  const discoverInSitemap = await urlInSitemaps(sitemapUrls, '/discover')
  if (discoverInSitemap) issues.push({ url: `${BASE}/zh/discover`, type: 'sitemap-vs-robots-conflict', sev: 'P0', detail: 'discover is robots-disallowed but listed in sitemap' })
  return { counts }
}

async function urlInSitemaps(sitemapUrls, fragment) {
  for (const sm of sitemapUrls) {
    try {
      const xml = await (await fetch(sm, { headers: { 'user-agent': UA_BOT }, signal: AbortSignal.timeout(TIMEOUT_MS) })).text()
      if (xml.includes(fragment)) return true
    } catch { /* 网络抖动按未命中处理 */ }
  }
  return false
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

async function runPool(items, worker) {
  const out = new Array(items.length)
  let next = 0
  async function lane() {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane))
  return out
}

async function main() {
  const full = process.argv.includes('--full')
  const list = samples(full)
  console.error(`[seo-audit] base=${BASE} samples=${list.length}${full ? ' (full=53)' : ''}`)
  const results = await runPool(list, async (s) => ({ sample: s, r: await fetchPage(s.path) }))
  let issues = []
  for (const { sample, r } of results) issues.push(...checkPage(sample, r))
  const { counts: sitemapCounts } = await auditSitemaps(issues)

  // 每类页面 title 重复检测(同 kind 内 title 应互不相同)
  const byKind = new Map()
  for (const { sample, r } of results) {
    if (!r.ok || !r.body) continue
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(r.body)?.[1]?.trim()
    if (!title) continue
    const arr = byKind.get(sample.kind) ?? []
    arr.push({ title, url: `${BASE}${sample.path}` })
    byKind.set(sample.kind, arr)
  }
  for (const [kind, arr] of byKind) {
    const seen = new Map()
    for (const { title, url } of arr) {
      if (seen.has(title)) {
        // 跨语言同 title(仓库名全球唯一 + hreflang 已互译)= 设计权衡,降 P2;同语言重复才是缺陷
        const prev = seen.get(title)
        const langOf = (u) => u.split('/')[3] ?? ''
        const crossLang = langOf(prev) !== langOf(url)
        issues.push({ url, type: 'duplicate-title', sev: crossLang ? 'P2' : 'P1', detail: `same as ${prev} (${kind})` })
      } else seen.set(title, url)
    }
  }

  issues.sort((a, b) => a.sev.localeCompare(b.sev))

  const report = {
    base: BASE,
    generatedAt: new Date().toISOString(),
    // 可追溯性:auditSha=本次运行的脚本版本;deployedVersion=被审计站点实际运行版本,
    // 取不到就如实标 unknown,不猜测(两者区分:脚本变了 vs 网站变了)
    auditSha: (process.env.GIT_SHA ?? '').trim() || 'unknown',
    deployedVersion: (process.env.DEPLOYED_VERSION ?? '').trim() || 'unknown',
    sampleCount: list.length,
    sitemapCounts,
    issueCount: issues.length,
    bySeverity: { P0: issues.filter((i) => i.sev === 'P0').length, P1: issues.filter((i) => i.sev === 'P1').length, P2: issues.filter((i) => i.sev === 'P2').length },
    issues,
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17)
  writeFileSync(join(OUT_DIR, `seo-audit-${stamp}.json`), JSON.stringify(report, null, 2))
  writeFileSync(join(OUT_DIR, 'latest.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(OUT_DIR, 'latest.md'), toMarkdown(report))

  console.error(`[seo-audit] issues: P0=${report.bySeverity.P0} P1=${report.bySeverity.P1} P2=${report.bySeverity.P2}`)
  console.error(`[seo-audit] report: ${OUT_DIR}/latest.md`)
  // CI 阻断条件分级:P0 全阻断;hreflang-wrong-target 单独阻断(语言路由回归是最容易
  // 悄悄发生且最难人工察觉的一类);其余 P1/P2 只报告不阻塞(有意 noindex 的工具页等
  // 设计不应阻塞发布)。
  const wrongTarget = issues.filter((i) => i.type === 'hreflang-wrong-target').length
  process.exit(report.bySeverity.P0 > 0 || wrongTarget > 0 ? 1 : 0)
}

function toMarkdown(r) {
  const lines = []
  lines.push(`# SEO 审计报告`, ``, `- 站点:${r.base}`, `- 时间:${r.generatedAt}`, `- 审计器版本:${r.auditSha ?? 'unknown'}`, `- 生产部署版本:${r.deployedVersion ?? 'unknown'}(取不到不猜)`, `- 样本:${r.sampleCount} 页(问题条目数≠独立页面数)`, `- sitemap 计数:${JSON.stringify(r.sitemapCounts)}`, `- 问题:P0=${r.bySeverity.P0} P1=${r.bySeverity.P1} P2=${r.bySeverity.P2}`, ``)
  for (const sev of ['P0', 'P1', 'P2']) {
    const rows = r.issues.filter((i) => i.sev === sev)
    if (!rows.length) continue
    lines.push(`## ${sev}`, ``, `| 类型 | URL | 详情 |`, `|---|---|---|`)
    for (const i of rows) lines.push(`| ${i.type} | ${i.url.replace(r.base, '')} | ${i.detail.replace(/\|/g, '\\|')} |`)
    lines.push(``)
  }
  return lines.join('\n')
}

main().catch((e) => {
  console.error('[seo-audit] fatal', e)
  process.exit(2)
})
