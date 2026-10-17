import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { BOARD_META, isBoardSlug, isFacetLanguage } from '@/lib/boards'
import { isLocale } from '@/app/[lang]/dictionaries'
import BoardPageView, { boardMetadata } from '@/components/board-view'

export async function generateStaticParams() {
  const out: Array<{ lang: string; slug: string; language: string }> = []
  for (const lang of ['zh', 'en']) {
    for (const [slug, meta] of Object.entries(BOARD_META)) {
      if (!meta.facets) continue
      for (const language of ['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'c++']) {
        out.push({ lang, slug, language })
      }
    }
  }
  return out
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string; language: string }>
}): Promise<Metadata> {
  const { lang, slug, language } = await params
  if (!isLocale(lang) || !isBoardSlug(slug) || !isFacetLanguage(language)) return {}
  return boardMetadata(lang, slug, language)
}

export default async function BoardLanguagePage({
  params,
}: {
  params: Promise<{ lang: string; slug: string; language: string }>
}) {
  const { lang, slug, language } = await params
  if (!isLocale(lang) || !isBoardSlug(slug) || !isFacetLanguage(language)) notFound()
  if (!BOARD_META[slug].facets) notFound()

  return <BoardPageView lang={lang} slug={slug} language={language} />
}
