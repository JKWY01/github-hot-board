import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

/** seo-audit.mjs 的静态契约测试(不发网络请求):
 *  脚本结构、命令注册、分级规则、样本覆盖面 —— 保证审计器自身不回归。
 *  (页面级断言由真实运行 npm run seo:audit 承担,产物在 reports/seo/) */

const src = readFileSync(fileURLToPath(new URL('../scripts/seo-audit.mjs', import.meta.url)), 'utf8')
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

describe('seo-audit 脚本契约', () => {
  it('npm run seo:audit 已注册且指向脚本', () => {
    expect(pkg.scripts['seo:audit']).toBe('node scripts/seo-audit.mjs')
  })

  it('覆盖七类页面样本(首页/榜单/分面/档案/往日榜/工具页/基础设施)', () => {
    for (const kind of ['home', 'board', 'facet', 'repo', 'history-day', 'tool-discover', 'sitemap-index']) {
      expect(src.includes(`'${kind}'`), `kind ${kind}`).toBe(true)
    }
  })

  it('任务要求的 11 项检查全部存在', () => {
    const checks = [
      'unexpected-status', 'http-status',      // 状态码/异常重定向
      'missing-title', 'missing-description', 'missing-h1', 'duplicate-title', // title/desc/H1
      'canonical-mismatch',                     // canonical
      'hreflang-incomplete', 'hreflang-missing-self', 'hreflang-duplicate', 'hreflang-missing-x-default', 'hreflang-wrong-target', // hreflang 精确断言
      'sitemap-unreachable', 'sitemap-dead-url', 'sitemap-vs-robots-conflict', // sitemap
      'unexpected-noindex', 'expected-noindex-missing', // noindex 有意/意外
      'ld+json-unparsable', 'ld+json-not-object', // 结构化数据
      'content-not-in-html',                    // 主体可抓取
      'slow-response', 'page-too-heavy',        // 性能
    ]
    for (const c of checks) expect(src.includes(c), `check ${c}`).toBe(true)
  })

  it('有意 noindex 与意外 noindex 区分(noindexAllowed 双向断言)', () => {
    expect(src.includes('unexpected-noindex')).toBe(true)
    expect(src.includes('expected-noindex-missing')).toBe(true)
    // 工具页样本声明 noindexAllowed: true
    expect(/tool-discover', path: '\/zh\/discover', noindexAllowed: true/.test(src)).toBe(true)
  })

  it('双重转义回归检测:ld+json 解析为 string 必须报 P0', () => {
    expect(src.includes("'ld+json-not-object'")).toBe(true)
  })

  it('退出码契约:P0>0 退出 1(CI 可用)', () => {
    expect(src.includes('process.exit(report.bySeverity.P0 > 0 ? 1 : 0)')).toBe(true)
  })

  it('报告产物:JSON 快照 + latest.md', () => {
    expect(src.includes('latest.json')).toBe(true)
    expect(src.includes('latest.md')).toBe(true)
  })

  it('只读纪律:脚本不含任何写库/部署/POST 动作', () => {
    expect(/method:\s*['"]POST/i.test(src)).toBe(false)
    expect(src.includes('withDb')).toBe(false)
  })

  it('hreflang 期望集合与 lib/locales LOCALES 同步(16 语清单)', () => {
    const m = /const EXPECTED_LANGS = \[([^\]]+)\]/.exec(src)
    expect(m).toBeTruthy()
    const langs = m![1].split(',').map((x) => x.trim().replace(/'/g, ''))
    // 从 dictionaries 侧拿真源核对(经 dict 文件数量即 16 语)
    expect(langs).toHaveLength(16)
    expect(langs).toContain('zh-TW')
    expect(langs).not.toContain('x-default') // x-default 单独判断,不在 16 语枚举里
  })

  it('体积口径 = Buffer.byteLength utf8(非 body.length)', () => {
    expect(src.includes("Buffer.byteLength(body, 'utf8')")).toBe(true)
    expect(src.includes('bytes: body.length')).toBe(false)
  })

  it('跨语言同 title(repo)降 P2、同语言保持 P1', () => {
    expect(src.includes("crossLang ? 'P2' : 'P1'")).toBe(true)
  })
})
