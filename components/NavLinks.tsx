'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import PendingDot from './PendingDot'

import type { BoardSlug } from '@/lib/boards'

/** 顶部榜单导航:激活项黑底白字。
 * prefetch="auto"(显式声明语义:主路径必须预取)——落地后很快点别的榜时,
 * 目标页 payload 随点击并行抢取,配合 [slug]/loading.tsx 即时切骨架,不再停在旧页干等。 */
export default function NavLinks({ items, locale }: { items: Array<{ slug: BoardSlug; label: string }>; locale: string }) {
  const pathname = usePathname() || ''
  return (
    <nav aria-label="Boards" className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
      {items.map(({ slug, label }) => {
        const active = pathname.startsWith(`/${locale}/boards/${slug}`)
        return (
          <Link
            key={slug}
            href={`/${locale}/boards/${slug}`}
            prefetch
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[12.5px] transition-colors ${
              active
                ? 'bg-ink font-semibold text-white'
                : 'font-medium text-ink/65 hover:bg-black/5 hover:text-ink'
            }`}
          >
            <PendingDot>{label}</PendingDot>
          </Link>
        )
      })}
    </nav>
  )
}
