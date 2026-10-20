import type { MetadataRoute } from 'next'

import { BOARD_META, FACET_LANGUAGES, facetLangSlug } from '@/lib/boards'
import { LOCALES } from '@/lib/locales'
import { readDistinctRepos } from '@/lib/snapshot'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const REPO_CHUNK = 4000

/** 每条 URL 携带全部语言 + x-default 的 alternate 套件,与页面 <link rel="alternate"> 一致。 */
function alternates(pathNoLang: string): MetadataRoute.Sitemap[number]['alternates'] {
  const languages: Record<string, string> = {}
  for (const locale of LOCALES) {
    languages[locale] = `${BASE}/${locale}${pathNoLang}`
  }
  languages['x-default'] = `${BASE}/en${pathNoLang}`
  return { languages }
}

/** 分片 sitemap:'boards' 片(榜面)+ 按 4000 仓库一片的档案页片。
 * 范围 = 所有曾经上榜过的仓库(历史窗口不限),退榜老兵也有 URL。 */
export async function generateSitemaps(): Promise<Array<{ id: string | number }>> {
  if (!process.env.DATABASE_URL) return [{ id: 'boards' }]
  const repos = await readDistinctRepos()
  const ids: Array<{ id: string | number }> = [{ id: 'boards' }]
  for (let i = 0; i < Math.ceil(repos.length / REPO_CHUNK); i += 1) ids.push({ id: i })
  return ids
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const id = await props.id

  if (id !== 'boards') {
    const repos = await readDistinctRepos()
    const n = Number(id)
    const chunk = repos.slice(n * REPO_CHUNK, (n + 1) * REPO_CHUNK)
    return chunk.map((fullName) => ({
      url: `${BASE}/en/repo/${fullName}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.5,
      alternates: alternates(`/repo/${fullName}`),
    }))
  }

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
