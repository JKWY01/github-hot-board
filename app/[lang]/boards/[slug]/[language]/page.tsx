import { LOCALES } from '@/lib/locales'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { BOARD_META, FACET_LANGUAGES, isBoardSlug, facetLangFromSlug, facetLangSlug, type FacetLanguage } from '@/lib/boards'
import { isLocale } from '@/app/[lang]/dictionaries'
import BoardPageView, { boardMetadata } from '@/components/board-view'

interface LanguageParams {
  lang: string
  slug: string
  language: string
}

/* URL 一律使用语言 slug(c++ → cpp,避免 '+' 在路径段里的解析歧义);
 * 数据层使用 GitHub 原生语言名。 */
export async function generateStaticParams() {
  const out: Array<{ lang: string; slug: string; language: string }> = []
  for (const lang of LOCALES) {
    for (const [slug, meta] of Object.entries(BOARD_META)) {
      if (!meta.facets) continue
      for (const language of FACET_LANGUAGES) {
        out.push({ lang, slug, language: facetLangSlug(language) })
      }
    }
  }
  return out
}

export async function generateMetadata({ params }: { params: Promise<LanguageParams> }): Promise<Metadata> {
  const { lang, slug, language: slugParam } = await params
  const language = facetLangFromSlug(slugParam)
  if (!isLocale(lang) || !isBoardSlug(slug) || !language) return {}
  return boardMetadata(lang, slug, language)
}

/** 兼容旧链接形态:raw 'c++'、'c%2B%2B'(解码后仍是 'c++')、'+' 被按空格解码的 'c  '。
 * 统一把 '+'/'#'/'空格' 归一成 slug 再比对。 */
function langFromLegacySlug(slugParam: string): FacetLanguage | undefined {
  const normalized = slugParam
    .toLowerCase()
    .replaceAll('+', 'p')
    .replaceAll('#', 'sharp')
    .replaceAll(' ', '')
  return facetLangFromSlug(normalized)
}

export default async function BoardLanguagePage({ params }: { params: Promise<LanguageParams> }) {
  const { lang, slug, language: slugParam } = await params
  const language = facetLangFromSlug(slugParam) ?? langFromLegacySlug(slugParam)
  if (!isLocale(lang) || !isBoardSlug(slug) || !language) notFound()
  if (!BOARD_META[slug as keyof typeof BOARD_META]?.facets) notFound()

  // 旧链接(raw c++ / %2B 形态)重定向到 slug 形态,SEO 归一
  const canonical = facetLangSlug(language as FacetLanguage)
  if (slugParam.toLowerCase() !== canonical) {
    redirect(`/${lang}/boards/${slug}/${canonical}`, 'replace')
  }

  return <BoardPageView lang={lang} slug={slug} language={language} />
}
