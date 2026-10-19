import type { MetadataRoute } from 'next'

import { BOARD_META, FACET_LANGUAGES, facetLangSlug } from '@/lib/boards'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/** 每条 URL 携带 zh/en/x-default 三件套,与页面 <link rel="alternate"> 一致,降低双语文档的归并错误率。 */
function alternates(pathNoLang: string): MetadataRoute.Sitemap[number]['alternates'] {
  return {
    languages: {
      zh: `${BASE}/zh${pathNoLang}`,
      en: `${BASE}/en${pathNoLang}`,
      'x-default': `${BASE}/en${pathNoLang}`,
    },
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = []

  for (const lang of ['zh', 'en'] as const) {
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
