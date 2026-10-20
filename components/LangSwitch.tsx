'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { LOCALES, LOCALE_LABEL } from '@/lib/locales'
import type { Locale } from '@/lib/types'

/** 语言切换:16 语下拉菜单。语言名一律用它自己的字(不翻译),当前项打勾。
 * 渲染期不读 usePathname()(运行时数据会让 ◐ 兜底预渲染失败);
 * 跳转目标在点击处理器里从 window.location 现取,行为与 usePathname 完全一致。 */
export default function LangSwitch({ current }: { current: Locale }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const rootRef = useRef<HTMLSpanElement>(null)

  // 点击外部 / ESC 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const goTo = (next: Locale) => {
    if (next === current || isPending) return
    const pathname = window.location.pathname || '/'
    const parts = pathname.split('/')
    if (parts[1] === current) {
      parts[1] = next
    } else {
      parts.splice(1, 0, next)
    }
    // 目标页面是静态产物,push 即可;refresh() 反而绕过预取让切换变慢
    startTransition(() => {
      router.push(parts.join('/') || `/${next}`)
      setOpen(false)
    })
  }

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        className={`flex items-center gap-1 rounded-full border-[0.5px] border-black/10 bg-white/70 px-2.5 py-1 text-[12px] font-semibold text-ink/70 transition-colors hover:text-ink motion-safe:active:scale-95 ${
          isPending ? 'opacity-40' : ''
        }`}
      >
        {LOCALE_LABEL[current]}
        <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" className={`text-ink/40 transition-transform motion-safe:duration-150 ${open ? 'rotate-180' : ''}`}>
          <path d="M2.5 3.75 5 6.25l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <span
        role="menu"
        aria-label="Language / 语言"
        className={`absolute right-0 top-full z-50 mt-1.5 grid w-[15.5rem] grid-cols-2 gap-0.5 rounded-2xl border-[0.5px] border-black/10 bg-white/85 p-1.5 shadow-lg shadow-black/10 backdrop-blur-xl motion-safe:transition motion-safe:origin-top-right motion-safe:duration-150 ${
          open ? 'pointer-events-auto opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95'
        }`}
      >
        {LOCALES.map((locale) => {
          const active = locale === current
          return (
            <button
              key={locale}
              type="button"
              role="menuitem"
              onClick={() => goTo(locale)}
              aria-current={active ? 'true' : undefined}
              className={`flex items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[12.5px] font-medium transition-colors ${
                active ? 'bg-ink text-white' : 'text-ink/75 hover:bg-black/4 hover:text-ink'
              }`}
            >
              {LOCALE_LABEL[locale]}
              {active && (
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.2 6.3 4.8 8.8l5-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )
        })}
      </span>
    </span>
  )
}
