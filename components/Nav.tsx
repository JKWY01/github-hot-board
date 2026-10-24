import Link from 'next/link'

import { BOARD_ORDER, type BoardSlug } from '@/lib/boards'
import { getDict } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'
import { GithubIcon, LogoMark } from './Icons'
import LangSwitch from './LangSwitch'
import ThemeToggle from './ThemeToggle'
import NavLinks from './NavLinks'

export default function Nav({ locale }: { locale: Locale }) {
  const dict = getDict(locale)
  const items = BOARD_ORDER.map((slug) => ({ slug, label: dict.shortBoards[slug] }))
  return (
    <header className="sticky top-0 z-50 border-b-[0.5px] border-black/10 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={`/${locale}`} prefetch={false} className="flex shrink-0 items-center gap-2" aria-label={dict.meta.siteName}>
          <LogoMark size={20} />
          <span className="text-[15px] font-semibold tracking-tight">{dict.meta.siteName}</span>
        </Link>

        {/* NavLinks 的 usePathname 在请求渲染时自然有值(本路由 instant=false 全阻塞);
         * 不包 Suspense —— 壳会保留 fallback,未知仓库就变软 404。 */}
        <NavLinks locale={locale} items={items} />

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <LangSwitch current={locale} />
          <a
            href="https://github.com/JKWY01/github-hot-board"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="hidden text-ink/70 transition-colors hover:text-ink sm:block"
          >
            <GithubIcon size={17} />
          </a>
        </div>
      </div>
    </header>
  )
}
