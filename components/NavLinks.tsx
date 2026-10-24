'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import PendingDot from './PendingDot'

import type { BoardSlug } from '@/lib/boards'

/** 顶部榜单导航:激活项黑底白字。
 * prefetch={false} 是刻意的:cacheComponents 下本页是"静态壳+数据洞"的部分预渲染,
 * 预取回落的 payload 是半截流(末尾挂 NN:C 未完结标记),Next 16.4.2 的共享缓存把它
 * 回放给真正的导航请求时,React 以 #412 "Connection closed" 概率性炸掉整个路由
 * (上游 vercel/next.js#97337,暂无修复版本)。关闭预取让每次点击都实时拉完整流,
 * 配合 [slug]/loading.tsx 的骨架过渡,体感几乎无差,稳定性优先。 */
export default function NavLinks({ items, locale }: { items: Array<{ slug: BoardSlug; label: string }>; locale: string }) {
  const pathname = usePathname() || ''
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // 手机上 10 个芯片要横滑,激活项常在屏外;进页把它滚进视野(横向居中,不动纵向)
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  return (
    <nav ref={navRef} aria-label="Boards" className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
      {items.map(({ slug, label }) => {
        const active = pathname.startsWith(`/${locale}/boards/${slug}`)
        return (
          <Link
            key={slug}
            href={`/${locale}/boards/${slug}`}
            prefetch={false}
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
