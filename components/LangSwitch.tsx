'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'

import type { Locale } from '@/lib/types'

export default function LangSwitch({ current }: { current: Locale }) {
  const pathname = usePathname() || '/'
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const goTo = (next: Locale) => {
    if (next === current || isPending) return
    const parts = pathname.split('/')
    if (parts[1] === current) {
      parts[1] = next
    } else {
      parts.splice(1, 0, next)
    }
    // 目标页面是全静态产物,push 即可;refresh() 反而绕过预取让切换变慢
    startTransition(() => {
      router.push(parts.join('/') || `/${next}`)
    })
  }

  const btn = (next: Locale, label: string) => (
    <button
      type="button"
      onClick={() => goTo(next)}
      aria-pressed={current === next}
      className={`rounded-full px-2.5 py-1 transition-colors ${
        current === next ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'
      } ${isPending && current !== next ? 'opacity-40' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <span
      className={`inline-flex items-center rounded-full border-[0.5px] border-black/10 bg-white/70 p-0.5 text-[12px] font-semibold ${isPending ? 'animate-pulse' : ''}`}
      role="group"
      aria-label="Language / 语言"
      aria-busy={isPending || undefined}
    >
      {btn('zh', '中')}
      {btn('en', 'EN')}
    </span>
  )
}
