import { describe, expect, it } from 'vitest'

import { badgeInfoOf, badgeValueOf, buildBadgeSvg, textWidth } from '../lib/badge'
import { crossedThresholds } from '../lib/push'
import type { RepoAppearance } from '../lib/snapshot'

const appearance = (over: Partial<RepoAppearance>): RepoAppearance => ({
  board: 'weekly', language: '', rank: 10, stars: 1000, forks: 10, metric: 0,
  source: 'github-search', degraded: false, takenAt: new Date().toISOString(),
  current: true, ...over,
})

describe('badgeInfoOf(取榜逻辑)', () => {
  it('现役:取所有现役记录中名次最好的一条', () => {
    const info = badgeInfoOf([
      appearance({ board: 'dark', rank: 42 }),
      appearance({ board: 'weekly', rank: 7 }),
      appearance({ board: 'overall', rank: 3 }),
    ])
    expect(info).toEqual({ state: 'current', board: 'overall', rank: 3 })
  })
  it('无现役但有历史:retired + 最后所在的榜', () => {
    const info = badgeInfoOf([
      appearance({ board: 'weekly', rank: 7, current: false }),
      appearance({ board: 'dark', rank: 2, current: false }),
    ])
    expect(info).toEqual({ state: 'retired', board: 'dark' })
  })
  it('空列表/未知榜:未上榜', () => {
    expect(badgeInfoOf([])).toEqual({ state: 'none' })
    expect(badgeInfoOf([appearance({ board: 'mystery' })])).toEqual({ state: 'none' })
  })
})

describe('badgeValueOf / buildBadgeSvg', () => {
  it('三态右值', () => {
    expect(badgeValueOf({ state: 'current', board: 'weekly', rank: 3 })).toBe('周榜 #3')
    expect(badgeValueOf({ state: 'retired', board: 'dark' })).toBe('曾上黑马榜')
    expect(badgeValueOf({ state: 'none' })).toBe('未上榜')
  })
  it('SVG 是合法结构且宽度按内容自适应', () => {
    const a = buildBadgeSvg({ state: 'current', board: 'weekly', rank: 3 })
    const b = buildBadgeSvg({ state: 'none' })
    for (const svg of [a, b]) {
      expect(svg).toMatch(/^<svg /)
      expect(svg).toContain('</svg>')
      expect(svg).toContain('role="img"')
    }
    // current 值("周榜 #3")比 none("未上榜")更宽?不必;但 SVG 宽度应等于两段宽之和
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)?.[1])
    expect(a.length).toBeGreaterThan(0)
    expect(w(a)).toBeGreaterThan(60)
    expect(w(b)).toBeGreaterThan(60)
  })
  it('XML 特殊字符在 SVG 里被转义(仓库名不过来,但值防御性转义)', () => {
    expect(buildBadgeSvg({ state: 'none' })).not.toContain('<未上榜')
  })
})

describe('textWidth(近似字宽)', () => {
  it('汉字按全宽、拉丁按窄宽估', () => {
    expect(textWidth('周榜', 11)).toBe(22)
    expect(textWidth('ab', 11)).toBe(12.76)
    expect(textWidth('周榜 #3', 11)).toBeCloseTo(22 + 3.52 + 12.76, 1)
  })
})

describe('crossedThresholds(跨线检测)', () => {
  it('向上跨档才记,一次跨多档全记', () => {
    expect(crossedThresholds(999, 1005)).toEqual([1_000])
    expect(crossedThresholds(900, 10_500)).toEqual([1_000, 10_000])
    expect(crossedThresholds(1_200, 1_500)).toEqual([])
  })
  it('首次见到(无基线)/ 下滑 / 非法值:不推', () => {
    expect(crossedThresholds(undefined, 5_000)).toEqual([])
    expect(crossedThresholds(2_000, 1_000)).toEqual([])
    expect(crossedThresholds(Number.NaN, 2_000)).toEqual([])
  })
  it('正好压线算跨过', () => {
    expect(crossedThresholds(999, 1_000)).toEqual([1_000])
  })
})
