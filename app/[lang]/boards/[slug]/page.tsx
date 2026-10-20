import { LOCALES } from '@/lib/locales'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { isBoardSlug, BOARD_META } from '@/lib/boards'
import { isLocale } from '@/app/[lang]/dictionaries'
import BoardPageView, { boardMetadata } from '@/components/board-view'

/** 页内补齐走 after() 挂在响应之后,给它留出执行时间(Vercel 按平台上限取小)。 */
export const maxDuration = 60

export async function generateStaticParams() {
  const out: Array<{ lang: string; slug: string }> = []
  for (const lang of LOCALES) {
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
