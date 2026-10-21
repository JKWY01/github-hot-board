import { dbKey, readBoardHead } from '@/lib/snapshot'
import { BOARD_META } from '@/lib/boards'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/** RSS 喂源(全局,en 口径):三大榜各取前五,每 30 分钟一轮同步后自动变新。
 * 阅读器聚合与爬虫的固定新鲜度入口;存档页仍是收录主战场。
 * cacheComponents 下不用段级 dynamic 配置——本路由本就每次请求现读库,无须声明。 */
export async function GET(): Promise<Response> {
  const feeds: Array<{ slug: keyof typeof BOARD_META; title: string; home: string }> = [
    { slug: 'weekly', title: 'Weekly surge', home: '/en/boards/weekly' },
    { slug: 'monthly', title: 'Monthly wave', home: '/en/boards/monthly' },
    { slug: 'overall', title: 'All-time greats', home: '/en/boards/overall' },
  ]
  const items: Array<{ title: string; link: string; pubDate: string }> = []
  let latest = new Date(0)
  for (const f of feeds) {
    const head = await readBoardHead(dbKey(f.slug))
    if (!head) continue
    const stamp = head.data.generatedAt || new Date().toISOString()
    const at = new Date(stamp)
    if (at > latest) latest = at
    for (const [idx, it] of head.data.items.slice(0, 5).entries()) {
      items.push({
        title: `#${idx + 1} ${it.fullName} · ${it.stars}☆ · ${f.title}`,
        link: `${BASE}/en/repo/${it.fullName}`,
        pubDate: at.toUTCString(),
      })
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>GitHub Hot Board · digest</title>
<link>${BASE}/en</link>
<description>Fresh open-source momentum snapshots: weekly / monthly / all-time top movers. Full per-repo archives on the site.</description>
<language>en</language>
<lastBuildDate>${latest.toUTCString()}</lastBuildDate>
${items.map((i) => `<item><title>${i.title.replace(/&/g, '&amp;')}</title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${i.pubDate}</pubDate></item>`).join('\n')}
</channel></rss>`
  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'max-age=600' },
  })
}
