import { describe, expect, it } from 'vitest'

import { dailyStarDeltas, peakDay, type DayPoint } from '../lib/stardelta'

const pts = (vals: number[]): DayPoint[] =>
  vals.map((v, i) => ({ day: `10-${String(10 + i).padStart(2, '0')}`, value: v }))

describe('dailyStarDeltas', () => {
  it('相邻两日差,首日无增量', () => {
    const d = dailyStarDeltas(pts([100, 110, 125, 125, 140]))
    expect(d.map((x) => x.delta)).toEqual([10, 15, 0, 15])
  })
  it('掉星保留负值', () => {
    const d = dailyStarDeltas(pts([100, 105, 103]))
    expect(d.map((x) => x.delta)).toEqual([5, -2])
  })
  it('单点/空列返回空', () => {
    expect(dailyStarDeltas(pts([5]))).toEqual([])
    expect(dailyStarDeltas([])).toEqual([])
  })
})

describe('peakDay(保守峰值判定)', () => {
  it('明显尖峰被识别', () => {
    // 均值 ~11,峰值 80:7 倍于均值
    const d = dailyStarDeltas(pts([100, 110, 122, 133, 213, 222, 235, 246]))
    const p = peakDay(d)
    expect(p?.delta).toBe(80)
    expect(p?.day).toBe('10-14')
  })
  it('平稳序列不标(倍数不够)', () => {
    const d = dailyStarDeltas(pts([100, 110, 121, 130, 142, 151]))
    expect(peakDay(d)).toBeNull()
  })
  it('样本不足 4 天不标', () => {
    expect(peakDay(dailyStarDeltas(pts([100, 200, 210])))).toBeNull()
  })
  it('峰值 <3 星不标(小数抖动不算尖峰)', () => {
    expect(peakDay(dailyStarDeltas(pts([10, 12, 13, 13, 14])))).toBeNull()
  })
  it('其余日均值 ≤0 时改为绝对门槛(≥10 星才算尖峰)', () => {
    const d = dailyStarDeltas(pts([100, 100, 100, 112, 112, 112]))
    expect(peakDay(d)?.delta).toBe(12)
    expect(peakDay(dailyStarDeltas(pts([100, 100, 100, 105, 105, 105])))).toBeNull()
  })
})
