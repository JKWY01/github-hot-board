import { cookies } from 'next/headers'

import { readDistinctRepos } from '@/lib/snapshot'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const REPO_CHUNK = 4000

/** 手写 sitemap 根索引:Next 的分片 sitemap(generateSitemaps)不自动生成 /sitemap.xml,
 * 而 robots.txt 与各家站长工具都习惯摸根口。cookies() 强制请求时态,
 * 分片数跟库里过榜仓库数走(构建期烤死会让新分片外面看不见)。 */
export async function GET(): Promise<Response> {
  await cookies()
  let shards = 0
  try {
    shards = Math.ceil((await readDistinctRepos()).length / REPO_CHUNK)
  } catch {
    shards = 0
  }
  const now = new Date().toISOString()
  const urls = [`${BASE}/sitemap/boards.xml`]
  for (let i = 0; i < shards; i += 1) urls.push(`${BASE}/sitemap/${i}.xml`)
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <sitemap><loc>${url}</loc><lastmod>${now}</lastmod></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n')
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  })
}
