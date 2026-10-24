import { describe, expect, it } from 'vitest'

import { nextThreshold, slopeStarsPerDay } from '../lib/boards'
import { facetLangFromSlug, facetLangSlug } from '../lib/facet'

describe('slopeStarsPerDay', () => {
  it('累计星 ÷ 站龄(不足一天按一天)', () => {
    const now = Date.now()
    const day = (n: number) => new Date(now - n * 86_400_000).toISOString()
    expect(slopeStarsPerDay({ stars: 1000, createdAt: day(10) })).toBeCloseTo(100, 5)
    expect(slopeStarsPerDay({ stars: 500, createdAt: day(0.1) })).toBe(500)
  })
  it('无 createdAt 或非法日期 → undefined', () => {
    expect(slopeStarsPerDay({ stars: 5 })).toBeUndefined()
    expect(slopeStarsPerDay({ stars: 5, createdAt: 'not-a-date' })).toBeUndefined()
  })
})

describe('nextThreshold(冲线语义:下一个没跨过的档)', () => {
  it('1k / 10k / 50k / 100k 阶梯', () => {
    expect(nextThreshold(999)).toBe(1_000)
    expect(nextThreshold(1_000)).toBe(10_000)
    expect(nextThreshold(50_001)).toBe(100_000)
  })
  it('全部跨完 → null(不占位)', () => {
    expect(nextThreshold(100_000)).toBeNull()
    expect(nextThreshold(999_999)).toBeNull()
  })
})

describe('facetLangSlug / facetLangFromSlug', () => {
  it('c++ → cpp 往返', () => {
    expect(facetLangSlug('c++')).toBe('cpp')
    expect(facetLangFromSlug('cpp')).toBe('c++')
  })
  it('大小写不敏感', () => {
    expect(facetLangSlug('C++')).toBe('cpp')
    expect(facetLangFromSlug('CPP')).toBe('c++')
  })
  it('全部语言可往返', () => {
    for (const lang of ['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'c++']) {
      expect(facetLangFromSlug(facetLangSlug(lang))).toBe(lang)
    }
  })
  it('未知 slug → undefined', () => {
    expect(facetLangFromSlug('cobol')).toBeUndefined()
  })
})
