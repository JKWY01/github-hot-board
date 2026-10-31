import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * robots.txt 禁入规则契约(2026-10-31 HK OOM 取证报告 §二:
 * Disallow 是【路径前缀匹配】——`/discover` 只罩裸路径,不匹配 /{lang}/discover。
 * 16 语前缀路径占 discover 流量 99%+,PerplexityBot/ClaudeBot 钻此洞。
 * 本测试锁:①裸路径禁 ②16 语前缀禁 ③不误伤其它页面 ④/api/ 口子保持。
 */

// mock specifier 必须匹配被测模块的解析路径:app/robots.ts import 的是 '@/lib/snapshot'
vi.mock('@/lib/snapshot', () => ({
  readDistinctRepos: vi.fn(async () => Array.from({ length: 100 }, (_, i) => `owner/repo${i}`)),
}))

const BASE = 'https://git.vaiox.xyz'
type RobotsOut = { rules: Array<{ userAgent: string | string[]; allow?: string | string[]; disallow?: string[] }> }
function pickDefault(mod: unknown): () => Promise<RobotsOut> {
  const m = mod as { default?: () => Promise<RobotsOut> } & Record<string, unknown>
  return typeof m === 'function' ? (m as unknown as () => Promise<RobotsOut>) : (m.default as () => Promise<RobotsOut>)
}

function robotMatchesRule(path: string, rule: string): boolean {
  // RFC 9309 前缀匹配 + * 通配符(爬虫通用语义:* = 任意字符序列)
  const pattern = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp('^' + pattern, 'i').test(path)
}

import * as robotsModule from '../app/robots'

describe('robots.txt 禁入契约(前缀洞修补)', () => {
  let disallow: string[]
  let aiDisallow: string[]
  let aiAllow: string[]
  beforeEach(async () => {
    const out = await pickDefault(robotsModule)()
    const star = out.rules.find((r) => r.userAgent === '*')!
    disallow = star.disallow ?? []
    const ai = out.rules.find((r) => r.userAgent === 'PerplexityBot')!
    aiDisallow = ai.disallow ?? []
    aiAllow = typeof ai.allow === 'string' ? [ai.allow] : ai.allow ?? []
  })

  it('① 裸路径 /discover 被禁(原规则保持)', () => {
    expect(disallow).toContain('/discover')
    expect(disallow.some((r) => robotMatchesRule('/discover', r))).toBe(true)
    expect(disallow.some((r) => robotMatchesRule('/discover?lang=x', r))).toBe(true)
  })

  it('② 16 语前缀 /{lang}/discover 全部被禁(修补目标)', () => {
    for (const p of ['/de/discover', '/zh/discover', '/zh-TW/discover', '/uk/discover?lang=TypeScript&band=s2', '/en/discover']) {
      const hit = [...disallow, ...aiDisallow].some((r) => robotMatchesRule(p, r))
      expect(hit, `${p} 应被禁`).toBe(true)
    }
  })

  it('③ 不误伤正常页面(榜单/档案/历史/首页全放行)', () => {
    const keep = ['/', '/zh', '/zh/boards/overall', '/en/boards/weekly', '/zh/repo/facebook/react', '/zh/history', '/feed.xml', '/zh/api-docs-nope-not-real']
    // 这些路径必须【不】命中任何 disallow 规则(allow: / 已放行)
    for (const p of keep) {
      const hit = disallow.some((r) => robotMatchesRule(p, r))
      expect(hit, `${p} 不应被禁`).toBe(false)
    }
  })

  it('④ /api/ 口子语义保持:泛禁 + AI 明文段对 /api/boards/ 放行', () => {
    expect(disallow).toContain('/api/')
    // AI 段 allow 优先(最长匹配原则,合规爬虫取更具体规则)
    expect(aiAllow).toContain('/api/boards/')
    expect(aiDisallow).toContain('/api/')
  })

  it('⑤ 规则清单最小化:只多一条通配,不夹带其它改动', () => {
    expect(disallow.sort()).toEqual(['/*/discover', '/api/', '/discover'].sort())
  })
})
