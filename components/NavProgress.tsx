'use client'

import { useEffect, useRef } from 'react'

/** 全局导航进度条:全站 prefetch={false} 的阻塞式导航在服务器响应前没有任何视觉
 * 反馈(慢 DB 冷访尤其像"点了没反应"),这里补一条 Apple 味的顶部细线。
 * 实现刻意不碰 router 状态(避开 #412 那一套):捕获阶段监听内部链接点击即起跑,
 * 轮询 URL 变化(或 5s 兜底)后收线。 */
export default function NavProgress() {
  const barRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef(0)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    let lastUrl = window.location.pathname + window.location.search + window.location.hash
    let running = false

    const start = () => {
      window.clearTimeout(timerRef.current)
      running = true
      bar.style.transition = 'none'
      bar.style.transform = 'scaleX(0)'
      bar.style.opacity = '1'
      // 强制回流,让归零态先生效,再开始爬升(慢速逼近让人感觉在动)
      void bar.offsetWidth
      bar.style.transition = 'transform 6s cubic-bezier(0.1, 0.55, 0.2, 1)'
      bar.style.transform = 'scaleX(0.86)'
      timerRef.current = window.setTimeout(finish, 5000)
    }

    const finish = () => {
      window.clearTimeout(timerRef.current)
      if (!running) return
      running = false
      bar.style.transition = 'transform .25s ease-out, opacity .35s ease .12s'
      bar.style.transform = 'scaleX(1)'
      bar.style.opacity = '0'
    }

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) return
      let sameOrigin = false
      try {
        sameOrigin = new URL(href, window.location.href).origin === window.location.origin
      } catch {
        sameOrigin = false
      }
      if (!sameOrigin) return
      if (a.target === '_blank' || a.hasAttribute('download')) return
      start()
    }

    const check = () => {
      const url = window.location.pathname + window.location.search + window.location.hash
      if (url !== lastUrl) {
        lastUrl = url
        finish()
      }
    }

    const poll = window.setInterval(check, 120)
    document.addEventListener('click', onClick, true)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timerRef.current)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  return (
    <div
      ref={barRef}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[80] h-[2.5px] w-full origin-left bg-accent opacity-0"
      style={{ transform: 'scaleX(0)' }}
    />
  )
}
