import Link from 'next/link'

import { BOARD_ORDER } from '@/lib/boards'
import type { Dict } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'
import LangSwitch from './LangSwitch'

export default function Footer({ dict }: { dict: Dict }) {
  const locale: Locale = dict.locale
  return (
    <footer className="border-t-[0.5px] border-black/10 bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_auto]">
          <div className="max-w-md">
            <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-sub">
              {dict.meta.siteName}
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink/70">{dict.footer.about}</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink/70">{dict.footer.sourceBody}</p>
          </div>

          <div>
            <p className="text-[13px] font-semibold text-ink">{dict.footer.boardsTitle}</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] text-ink/65">
              {BOARD_ORDER.map((slug) => (
                <li key={slug}>
                  <Link className="transition-colors hover:text-accent" href={`/${locale}/boards/${slug}`} prefetch={false}>
                    {dict.shortBoards[slug]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[13px] font-semibold text-ink">{dict.footer.langTitle}</p>
            <div className="mt-3">
              <LangSwitch current={locale} />
            </div>
            <Link
              className="mt-4 inline-block text-[13px] text-ink/65 transition-colors hover:text-accent-strong"
              href={`/${locale}/history/overall`}
              prefetch={false}
            >
              {dict.history.title} →
            </Link>
            {/* 数据健康入口:固定双语硬标签(与 not-found 同款先例),不占字典位 */}
            <br />
            <Link
              className="mt-1.5 inline-block text-[13px] text-ink/65 transition-colors hover:text-accent-strong"
              href={`/${locale}/status`}
              prefetch={false}
            >
              Status · 数据健康 →
            </Link>
            <br />
            <Link
              className="mt-1.5 inline-block text-[13px] text-ink/65 transition-colors hover:text-accent-strong"
              href={`/${locale}/discover`}
              prefetch={false}
            >
              Discover · 发现 →
            </Link>
            <p className="mt-4 max-w-[220px] text-[12px] leading-relaxed text-sub">{dict.footer.disclaimer}</p>
          </div>
        </div>

        <div className="mt-10 border-t-[0.5px] border-black/10 pt-5 text-[12px] text-sub">
          {dict.footer.copyright}
        </div>
      </div>
    </footer>
  )
}
