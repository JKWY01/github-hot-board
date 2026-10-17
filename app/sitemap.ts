import type { MetadataRoute } from 'next'

import { BOARD_META, FACET_LANGUAGES } from '@/lib/boards'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = []

  for (const lang of ['zh', 'en'] as const) {
    entries.push({
      url: `${BASE}/${lang}`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 1,
    })
    for (const [slug, meta] of Object.entries(BOARD_META)) {
      entries.push({
        url: `${BASE}/${lang}/boards/${slug}`,
        lastModified: now,
        changeFrequency: 'hourly',
        priority: 0.9,
      })
      if (!meta.facets) continue
      for (const language of FACET_LANGUAGES) {
        entries.push({
          url: `${BASE}/${lang}/boards/${slug}/${language}`,
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.6,
        })
      }
    }
  }
  return entries
}
