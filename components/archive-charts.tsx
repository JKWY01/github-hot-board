'use client'

import { useEffect, useRef } from 'react'

import { fmtNum } from '@/lib/format'
import type { Locale } from '@/lib/types'

/** 档案页双图:累计 Star 走势 + 各榜名次走势。
 * echarts 只在浏览器里动态 import(useEffect 内),服务端渲染期零执行、零 SSR 风险;
 * 名次轴反向(rank 1 在上)+ 自适应缩放 —— 稳定名次也能读出"稳在 #k"的可视结论。 */

export type ChartDay = { day: string; value: number }
export type ChartSeries = { board: string; label: string; points: ChartDay[] }

const PALETTE = ['#0067d4', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#8e8e93', '#5856d6', '#32ade6', '#a2845e', '#e85d75']

function dateLabel(v: number): string {
  const d = new Date(v)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ArchiveCharts({
  starPoints,
  starLabel,
  starUnit,
  rankGroups,
  rankLabel,
  locale,
}: {
  starPoints: ChartDay[]
  starLabel: string
  starUnit: string
  rankGroups: ChartSeries[]
  rankLabel: string
  locale: Locale
}) {
  const starRef = useRef<HTMLDivElement>(null)
  const rankRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    ;(async () => {
      const echarts = await import('echarts/core')
      const { LineChart } = await import('echarts/charts')
      const { GridComponent, TooltipComponent, LegendComponent } = await import('echarts/components')
      const { CanvasRenderer } = await import('echarts/renderers')
      echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])
      if (disposed) return

      const baseTooltip = {
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const },
        borderWidth: 0,
        backgroundColor: 'rgba(255,255,255,0.96)',
        textStyle: { color: '#1d1d1f', fontSize: 12 },
        extraCssText: 'box-shadow:0 4px 18px rgba(0,0,0,0.12); border-radius:10px;',
      }

      const grid = { left: 10, right: 14, top: 30, bottom: 10, containLabel: true }

      // 轴标签:紧凑格式(1.4万)在相近量级会让所有刻度同文,轴用全数字;同日标签去重
      const axisNum = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US')
      const dayLabels = () => {
        let last = ''
        return (v: number) => {
          const s = dateLabel(v)
          if (s === last) return ''
          last = s
          return s
        }
      }

      // --- Star 走势 ---
      const starChart = echarts.init(starRef.current!)
      starChart.setOption({
        grid,
        tooltip: {
          ...baseTooltip,
          valueFormatter: (v: number) => `${fmtNum(v, locale)} ${starUnit}`,
        },
        xAxis: {
          type: 'time',
          axisLine: { lineStyle: { color: 'rgba(0,0,0,0.25)' } },
          axisTick: { show: false },
          axisLabel: { color: '#6e6e73', fontSize: 11, formatter: dayLabels() },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLabel: { color: '#6e6e73', fontSize: 11, formatter: (v: number) => axisNum.format(v) },
          splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
        },
        series: [
          {
            name: starLabel,
            type: 'line',
            data: starPoints.map((p) => [p.day, p.value]),
            lineStyle: { width: 2, color: '#0067d4' },
            itemStyle: { color: '#0067d4' },
            symbol: 'none',
            smooth: false,
            areaStyle: { color: 'rgba(0,103,212,0.10)' },
          },
        ],
      })

      // --- 名次走势(每榜一条线,rank 1 在上;整数刻度) ---
      const rankChart = echarts.init(rankRef.current!)
      rankChart.setOption({
        grid,
        tooltip: { ...baseTooltip, valueFormatter: (v: number) => `#${v}` },
        legend: {
          top: 0,
          left: 'center',
          icon: 'circle',
          itemWidth: 7,
          itemHeight: 7,
          itemGap: 14,
          textStyle: { color: '#1d1d1f', fontSize: 11 },
        },
        xAxis: {
          type: 'time',
          axisLine: { lineStyle: { color: 'rgba(0,0,0,0.25)' } },
          axisTick: { show: false },
          axisLabel: { color: '#6e6e73', fontSize: 11, formatter: dayLabels() },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          inverse: true,
          scale: true,
          minInterval: 1,
          axisLabel: { color: '#6e6e73', fontSize: 11, formatter: (v: number) => `#${v}` },
          splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
        },
        series: rankGroups.map((g, i) => ({
          name: g.label,
          type: 'line',
          data: g.points.map((p) => [p.day, p.value]),
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: rankGroups[i].points.length <= 16,
          lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
          itemStyle: { color: PALETTE[i % PALETTE.length] },
          smooth: false,
        })),
      })

      const ro = new ResizeObserver(() => {
        starChart.resize()
        rankChart.resize()
      })
      if (starRef.current) ro.observe(starRef.current)
      if (rankRef.current) ro.observe(rankRef.current)
      cleanup = () => {
        ro.disconnect()
        starChart.dispose()
        rankChart.dispose()
      }
    })()

    return () => {
      disposed = true
      if (cleanup) cleanup()
    }
  }, [starLabel, starUnit, rankLabel, locale, starPoints, rankGroups])

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-medium text-ink/60">{starLabel}</p>
        <div ref={starRef} className="h-[230px] w-full" />
      </div>
      <div>
        <p className="text-[13px] font-medium text-ink/60">{rankLabel}</p>
        <div ref={rankRef} className="h-[250px] w-full" />
      </div>
    </div>
  )
}
