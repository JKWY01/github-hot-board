'use client'

import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  value: number
  format: (n: number) => string
  className?: string
}

/** 数字补间：值变化时用 rAF 把旧值滚到新值；reduced motion 时直接跳变。 */
export default function CountUp({ value, format, className }: CountUpProps) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)

  useEffect(() => {
    if (prevRef.current === value) return
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      prevRef.current = value
      setDisplay(value)
      return
    }
    const from = prevRef.current
    const to = value
    const start = performance.now()
    const duration = 850
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (p < 1) {
        raf = requestAnimationFrame(step)
      } else {
        prevRef.current = value
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return <span className={className}>{format(display)}</span>
}
