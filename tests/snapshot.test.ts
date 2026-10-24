import { describe, expect, it } from 'vitest'

import { dbKey, withPrevRanks } from '../lib/snapshot'
import { isRepoFullName } from '../lib/reposhape'
import { jsonLdScript } from '../lib/jsonld'
import { clientIpOf, slidingWindow } from '../lib/ratelimit'

describe('dbKey', () => {
  it('基准口径 = 裸 slug;语言分面用 URL 安全 slug', () => {
    expect(dbKey('overall')).toBe('overall')
    expect(dbKey('weekly', 'c++')).toBe('weekly-cpp')
    expect(dbKey('weekly', 'python')).toBe('weekly-python')
  })
})

describe('withPrevRanks(上一拍名次嵌入)', () => {
  const prev = [{ fullName: 'a/a' }, { fullName: 'b/b' }, { fullName: 'c/c' }]
  it('爬榜记 0 基 prevRank,名次不变不写字段', () => {
    const next = withPrevRanks(
      [{ fullName: 'b/b' }, { fullName: 'a/a' }, { fullName: 'c/c' }],
      prev,
    )
    expect(next[0]).toMatchObject({ fullName: 'b/b', prevRank: 1 })
    expect(next[1]).toMatchObject({ fullName: 'a/a' }) // prevRank 不出现
    expect(next[2]).toMatchObject({ fullName: 'c/c' })
  })
  it('新入榜不写字段;掉榜记原位', () => {
    const next = withPrevRanks(
      [{ fullName: 'x/x' }, { fullName: 'a/a' }],
      prev,
    )
    expect(next[0]).not.toHaveProperty('prevRank')
    expect(next[1]).toMatchObject({ prevRank: 0 })
  })
})

describe('isRepoFullName', () => {
  it('常规名字通过', () => {
    expect(isRepoFullName('vercel/next.js')).toBe(true)
    expect(isRepoFullName('a.b-c_d/e.f-g_h')).toBe(true)
  })
  it('多段/空段/非法字符/超长拒绝', () => {
    expect(isRepoFullName('a/b/c')).toBe(false)
    expect(isRepoFullName('a/')).toBe(false)
    expect(isRepoFullName('/b')).toBe(false)
    expect(isRepoFullName('a b/c')).toBe(false)
    expect(isRepoFullName('a/b<script>')).toBe(false)
    expect(isRepoFullName(`${'a'.repeat(101)}/b`)).toBe(false)
  })
})

describe('jsonLdScript(JSON-LD 出口转义)', () => {
  it('闭合 script 的载荷被转成 Unicode 转义,无法逃出 <script>', () => {
    const evil = { description: '</script><img src=x onerror=alert(1)>' }
    const out = jsonLdScript(evil)
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c')
    // 合法 JSON:转义是字符串内容级的,解析回原值
    expect(JSON.parse(out)).toEqual(evil)
  })
  it('U+2028/2029 行分隔符也被转义', () => {
    const out = jsonLdScript({ a: 'x\u2028y\u2029z' })
    expect(out).not.toMatch(/[\u2028\u2029]/)
  })
})

describe('slidingWindow(IP 滑窗限流)', () => {
  it('窗口内计数,超限拒绝', () => {
    const w = slidingWindow(() => 1_000)
    for (let i = 0; i < 5; i++) expect(w.allow('ip1', 5, 60_000)).toBe(true)
    expect(w.allow('ip1', 5, 60_000)).toBe(false)
    expect(w.allow('ip2', 5, 60_000)).toBe(true) // 互不影响
  })
  it('窗口滑动后恢复', () => {
    let now = 100_000
    const w = slidingWindow(() => now)
    for (let i = 0; i < 3; i++) w.allow('ip', 3, 1_000)
    expect(w.allow('ip', 3, 1_000)).toBe(false)
    now += 1_001
    expect(w.allow('ip', 3, 1_000)).toBe(true)
  })
})

describe('clientIpOf', () => {
  it('取 XFF 首段,缺失归 local', () => {
    const mk = (h?: string) => new Request('http://x/', h ? { headers: { 'x-forwarded-for': h } } : {})
    expect(clientIpOf(mk('1.2.3.4, 5.6.7.8'))).toBe('1.2.3.4')
    expect(clientIpOf(mk())).toBe('local')
  })
})
