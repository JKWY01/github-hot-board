import Link from 'next/link'

import { BOARD_ORDER } from '@/lib/boards'
import { getDict } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'
import { GithubIcon, LogoMark } from './Icons'
import LangSwitch from './LangSwitch'

export default function Nav({ locale }: { locale: Locale }) {
  const dict = getDict(locale)
  return (
    <header className="sticky top-0 z-50 border-b-[0.5px] border-black/10 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={`/${locale}`} className="flex shrink-0 items-center gap-2" aria-label={dict.meta.siteName}>
          <LogoMark size={20} />
          <span className="text-[15px] font-semibold tracking-tight">{dict.meta.siteName}</span>
        </Link>

        <nav aria-label={dict.footer.boardsTitle} className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {BOARD_ORDER.map((slug) => (
            <Link
              key={slug}
              href={`/${locale}/boards/${slug}`}
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-medium text-ink/65 transition-colors hover:bg-black/5 hover:text-ink"
            >
              {dict.shortBoards[slug]}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <LangSwitch current={locale} />
          <a
            href="https://github.com/trending"
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
