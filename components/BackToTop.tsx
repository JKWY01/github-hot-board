'use client'

import { useEffect, useState } from 'react'

/** 一键回顶:长榜单(总榜 500 行)读到深处才出现,浅层不打扰。
 * Apple 味白底描边小圆钮,与行尾动作组同款视觉;尊重 reduced-motion。 */
export default function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null

  return (
    <button
      type="button"
      aria-label="back to top"
      title="Back to top"
      onClick={() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
      }}
      // 挂载点:layout body 直下(与 NavProgress 同级),全站页面通用。
      // z-70:低于抽屉(z-90)与彩带/toast(z-80),高于页面内容;右下角避开档案页"回到榜单"链接的位置带
      className="backtotop-in fixed bottom-6 right-5 z-[70] flex h-10 w-10 items-center justify-center rounded-full border-[0.5px] border-black/12 bg-white/90 text-ink/70 shadow-[0_6px_24px_rgba(0,0,0,0.10)] backdrop-blur-md transition-colors hover:bg-ink hover:text-white motion-safe:active:scale-95"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 11.5V2.5M7 2.5L2.8 6.7M7 2.5l4.2 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
