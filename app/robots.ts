import type { MetadataRoute } from 'next'

import { readDistinctRepos } from '@/lib/snapshot'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const REPO_CHUNK = 4000

/** AI 爬虫点名段;具体名单随生态增删。 */
const AI_AGENTS = [
  'ClaudeBot',
  'Claude-User',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Amazonbot',
  'Bytespider',
  'Meta-ExternalAgent',
]

/** robots.txt 动态产出:sitemap 分片数量跟着库里"历史上过榜"的仓库数走,
 * 仓库再多也不会出现指向不存在分片的死链。 */
/** 爬虫禁入的工具页:发现页 noindex 且不进 sitemap(工具语义,不参与排名),
 * 但实测 Googlebot/ClaudeBot 对 16 语 discover 反复深抓(6 天 5 万+ 次),
 * 白烧抓取预算 —— robots 明示禁入,预算让给榜单/档案页。真人访问不受影响。 */
const BOT_DISALLOW = ['/api/', '/discover']

export default async function robots(): Promise<MetadataRoute.Robots> {
  let fragmentCount = 0
  try {
    fragmentCount = Math.ceil((await readDistinctRepos()).length / REPO_CHUNK)
  } catch {
    fragmentCount = 0
  }

  const sitemaps = [`${BASE}/sitemap/boards.xml`, `${BASE}/sitemap/history.xml`]
  for (let i = 0; i < fragmentCount; i += 1) {
    sitemaps.push(`${BASE}/sitemap/${i}.xml`)
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: BOT_DISALLOW,
      },
      // AI 爬虫明文段:点名欢迎;/api/ 只对能拿走"榜单 JSON"的这一条口子开放
      //(/api/boards 是缓存烘焙的确定性数据,给得起;search/watch 带配额或个人语义,继续对爬虫关)。
      ...AI_AGENTS.map((agent) => ({
        userAgent: agent,
        allow: ['/', '/api/boards/'],
        disallow: BOT_DISALLOW,
      })),
    ],
    sitemap: sitemaps,
  }
}
