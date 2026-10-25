/** 每日 Star 增量的纯计算层(自有快照序列推导,可单测)。
 *  口径:输入按日去重后的累计 Star 点列(同日多拍取最大),增量 = 相邻两日差;
 *  首日无增量。峰值判定刻意保守:样本少或倍数不够都不标 —— 宁可少说,不可误报。 */

export interface DayPoint {
  day: string
  value: number
}

export interface DayDelta {
  day: string
  delta: number
}

/** 累计序列 → 每日增量序列(负增量保留:掉星也是事实)。 */
export function dailyStarDeltas(points: DayPoint[]): DayDelta[] {
  const out: DayDelta[] = []
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i]!.value - points[i - 1]!.value
    out.push({ day: points[i]!.day!, delta })
  }
  return out
}

/** 峰值日判定:最大单日增量 ≥ 3 星,且 ≥ 其余日子均值的 2.5 倍,且其余样本 ≥ 3 天。
 *  返回峰日(含诚实提示所需数据);不达标返回 null。 */
export function peakDay(deltas: DayDelta[]): (DayDelta & { avgOthers: number }) | null {
  if (deltas.length < 4) return null
  let maxIdx = 0
  for (let i = 1; i < deltas.length; i += 1) {
    if (deltas[i]!.delta > deltas[maxIdx]!.delta) maxIdx = i
  }
  const peak = deltas[maxIdx]!
  if (peak.delta < 3) return null
  const others = deltas.filter((_, i) => i !== maxIdx)
  const avgOthers = others.reduce((s, d) => s + d.delta, 0) / others.length
  if (avgOthers <= 0 ? peak.delta < 10 : peak.delta < avgOthers * 2.5) return null
  return { ...peak, avgOthers: Math.round(avgOthers * 10) / 10 }
}
