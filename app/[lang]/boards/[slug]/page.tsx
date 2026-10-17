import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { isBoardSlug, BOARD_META } from '@/lib/boards'
import { isLocale } from '@/app/[lang]/dictionaries'
import BoardPageView, { boardMetadata } from '@/components/board-view'

// 同上：fill 需要在配额节流队列里等待自己的时间片
export const staticPageGenerationTimeout = 240

export async function generateStaticParams() {
  const out: Array<{ lang: string; slug: string }> = []
  for (const lang of ['zh', 'en']) {
    for (const slug of Object.keys(BOARD_META)) {
      out.push({ lang, slug })
    }
  }
  return out
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>
}): Promise<Metadata> {
  const { lang, slug } = await params
  if (!isLocale(lang) || !isBoardSlug(slug)) return {}
  return boardMetadata(lang, slug)
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>
}) {
  const { lang, slug } = await params
  if (!isLocale(lang) || !isBoardSlug(slug)) notFound()

  return <BoardPageView lang={lang} slug={slug} />
}
