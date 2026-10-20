import type { MetadataRoute } from 'next'

import { BOARD_META, FACET_LANGUAGES, facetLangSlug } from '@/lib/boards'
import { LOCALES } from '@/lib/locales'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/** 每条 URL 携带全部语言 + x-default 的 alternate 套件,与页面 <link rel="alternate"> 一致。 */
function alternates(pathNoLang: string): MetadataRoute.Sitemap[number]['alternates'] {
  const languages: Record<string, string> = {}
  for (const locale of LOCALES) {
    languages[locale] = `${BASE}/${locale}${pathNoLang}`
  }
  languages['x-default'] = `${BASE}/en${pathNoLang}`
  return { languages }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = []

  for (const lang of LOCALES) {
    entries.push({
      url: `${BASE}/${lang}`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 1,
      alternates: alternates(''),
    })
    for (const [slug, meta] of Object.entries(BOARD_META)) {
      const boardPath = `/boards/${slug}`
      entries.push({
        url: `${BASE}/${lang}${boardPath}`,
        lastModified: now,
        changeFrequency: 'hourly',
        priority: 0.9,
        alternates: alternates(boardPath),
      })
      if (!meta.facets) continue
      for (const language of FACET_LANGUAGES) {
        const facetPath = `${boardPath}/${facetLangSlug(language)}`
        entries.push({
          url: `${BASE}/${lang}${facetPath}`,
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.6,
          alternates: alternates(facetPath),
        })
      }
    }
  }
  return entries
}
