'use client'

import { useEffect, useState } from 'react'

/** 首页主标语轮播:三句价值主张循环(6s/句)。
 *  动画=双层交叉淡入淡出(旧句淡出+新句自下 12px 浮入,错峰 90ms 各自过渡),
 *  高度取三句最大值防止换行差异引起跳动;SSR 首画固定第一句(cacheComponents/SEO 安全);
 *  respect reduced-motion(只显示第一句)。 */
export default function HeroRotator({
  lines,
}: {
  /** [上半句, 渐变下半句] × 3 */
  lines: Array<[string, string]>
}) {
  const [idx, setIdx] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (lines.length <= 1) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      setFading(true)
      setTimeout(() => {
        setIdx((i) => (i + 1) % lines.length)
        setFading(false)
      }, 550)
    }, 6000)
    return () => clearInterval(timer)
  }, [lines.length])

  const [top, gradient] = lines[idx] ?? lines[0] ?? ['', '']
  return (
    <h1
      className="hero-title rise mt-3"
      style={{ '--rise-delay': '120ms' } as React.CSSProperties}
    >
      {/* grid 堆叠三句取最大高度:轮播切换不因句子长短不同而跳动布局 */}
      <span
        className="grid"
        style={{ transition: 'opacity 550ms ease, transform 550ms ease', opacity: fading ? 0 : 1, transform: fading ? 'translateY(-8px)' : 'translateY(0)' }}
      >
        {lines.map((_, i) => (
          <span
            key={i}
            style={{
              gridArea: '1 / 1',
              visibility: i === idx ? 'visible' : 'hidden',
              transition: 'opacity 550ms ease, transform 550ms ease',
              opacity: i === idx ? 1 : 0,
              transform: i === idx ? 'translateY(0)' : 'translateY(12px)',
            }}
            aria-hidden={i !== idx}
          >
            {lines[i][0]}
            <span className="gradient-text">{lines[i][1]}</span>
          </span>
        ))}
      </span>
    </h1>
  )
}
