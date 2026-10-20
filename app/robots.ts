import type { MetadataRoute } from 'next'

import { readDistinctRepos } from '@/lib/snapshot'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const REPO_CHUNK = 4000

/** robots.txt 动态产出:sitemap 分片数量跟着库里"历史上过榜"的仓库数走,
 * 仓库再多也不会出现指向不存在分片的死链。 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  let fragmentCount = 0
  try {
    fragmentCount = Math.ceil((await readDistinctRepos()).length / REPO_CHUNK)
  } catch {
    fragmentCount = 0
  }

  const sitemaps = [`${BASE}/sitemap/boards.xml`]
  for (let i = 0; i < fragmentCount; i += 1) {
    sitemaps.push(`${BASE}/sitemap/${i}.xml`)
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    sitemap: sitemaps,
  }
}
