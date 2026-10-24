'use client'

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  /** 毫秒 */
  delay?: number
}

/** 滚动进入视口后上浮显现（html.js 才生效，无 JS 全可见，SEO 友好）。 */
export default function Reveal({ children, className = '', delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('revealed')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('revealed')
            io.disconnect()
          }
        }
      },
      // 提前 160px 预触发:快速滚动/跳锚时入场动画在可见前就开始,
      // 不再出现"滚到即白屏一帧"的中间态(threshold 降到 0.05 同理)
      { threshold: 0.05, rootMargin: '160px 0px 0px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={`reveal ${className}`} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  )
}
