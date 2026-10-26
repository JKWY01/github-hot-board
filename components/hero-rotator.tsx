'use client'

import { useEffect, useState } from 'react'

/** 首页主标语轮播:三句价值主张循环淡入淡出(6s/句)。
 *  - SSR/爬虫首画固定渲染第一句(不注入随机,cacheComponents 契约友好,SEO 稳定)
 *  - 水合后客户端轮换;respect reduced-motion(只显示第一句不轮)
 *  - 淡入淡出用 CSS transition,不引依赖 */
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
      }, 400)
    }, 6000)
    return () => clearInterval(timer)
  }, [lines.length])

  const [top, gradient] = lines[idx] ?? lines[0] ?? ['', '']
  return (
    <h1
      className="hero-title rise mt-3 transition-opacity duration-400"
      style={{
        '--rise-delay': '120ms',
        opacity: fading ? 0 : 1,
      } as React.CSSProperties}
    >
      {top}
      <span className="gradient-text">{gradient}</span>
    </h1>
  )
}
