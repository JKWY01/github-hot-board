'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { Locale } from '@/lib/types'

export default function LangSwitch({ current }: { current: Locale }) {
  const pathname = usePathname() || '/'
  const router = useRouter()

  const goTo = (next: Locale) => {
    if (next === current) return
    const parts = pathname.split('/')
    if (parts[1] === current) {
      parts[1] = next
    } else {
      parts.splice(1, 0, next)
    }
    router.push(parts.join('/') || `/${next}`)
    router.refresh()
  }

  return (
    <span
      className="inline-flex items-center rounded-full border-[0.5px] border-black/10 bg-white/70 p-0.5 text-[12px] font-semibold"
      role="group"
      aria-label="Language / 语言"
    >
      <button
        type="button"
        onClick={() => goTo('zh')}
        aria-current={current === 'zh' ? 'true' : undefined}
        className={`rounded-full px-2.5 py-1 transition-colors ${
          current === 'zh' ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'
        }`}
      >
        中
      </button>
      <button
        type="button"
        onClick={() => goTo('en')}
        aria-current={current === 'en' ? 'true' : undefined}
        className={`rounded-full px-2.5 py-1 transition-colors ${
          current === 'en' ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'
        }`}
      >
        EN
      </button>
    </span>
  )
}
