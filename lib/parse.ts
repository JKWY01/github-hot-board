/** 解析 github.com/trending 页面（纯函数，error 时返回空数组）。 */

export interface ParsedTrendingRepo {
  fullName: string
  desc: string | null
  language: string | null
  stars: number
  forks: number
  growth: number | null
  period: 'daily' | 'weekly' | 'monthly'
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+[0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    return ENTITIES[body] ?? match
  })
}

function readAnchorValue(block: string, hrefSuffix: string): number {
  const re = new RegExp(
    `href="\\/${hrefSuffix}"[\\s\\S]*?<\\/svg>([\\s\\S]*?)<\\/a>`,
  )
  const match = block.match(re)
  if (!match) return 0
  const digits = match[1].replace(/<[^>]*>/g, '').replace(/[^\d,]/g, '')
  const n = Number.parseInt(digits.replace(/,/g, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

function slugIsRepo(fullName: string): boolean {
  if (!fullName || fullName.includes(' ')) return false
  const segments = fullName.split('/')
  if (segments.length !== 2) return false
  const reserved = ['features', 'sponsors', 'topics', 'collections', 'trending', 'secure', 'about', 'pricing', 'team', 'enterprise', 'customer-stories', 'readme', 'login', 'explore', 'docs', 'orgs']
  return !reserved.includes(segments[0].toLowerCase())
}

/** 剥离仓库描述里的 emoji/符号字位（Apple 风格界面不展示 emoji）+ 规范空白。 */
export function cleanDesc(input: string): string {
  return input
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseTrendingHtml(
  html: string,
  fallbackPeriod: 'daily' | 'weekly' | 'monthly' = 'daily',
): ParsedTrendingRepo[] {
  const results: ParsedTrendingRepo[] = []
  if (!html || html.length < 500) return results
  const seen = new Set<string>()

  const chunks = html.split('<article').slice(1)
  for (const chunk of chunks) {
    const block = chunk.slice(0, chunk.indexOf('</article>'))
    if (block.length < 200) continue

    const nameMatch = block.match(
      /<h2[^>]*class="[^"]*lh-condensed[^"]*"[^>]*>\s*<a[^>]+href="\/([^"#?]+)"/,
    )
    const fullName = nameMatch?.[1] ?? ''
    if (!slugIsRepo(fullName)) continue
    // 多页拼接下同一仓库可能两次上榜,留首个
    if (seen.has(fullName)) continue
    seen.add(fullName)

    const descMatch = block.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)
    const desc = descMatch ? cleanDesc(decodeEntities(descMatch[1].replace(/<[^>]*>/g, ''))) : null

    const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</)
    const language = langMatch ? langMatch[1].trim() : null

    const stars = readAnchorValue(block, '[^"]*\\/stargazers')
    const forks = readAnchorValue(block, '[^"]*\\/forks')

    let period = fallbackPeriod
    let growth: number | null = null
    const growthMatch = block.match(
      /float-sm-right[\s\S]*?<\/svg>\s*([\d,]+)\s+stars this (day|week|month)/,
    )
    if (growthMatch) {
      growth = Number.parseInt(growthMatch[1].replace(/,/g, ''), 10)
      period =
        growthMatch[2] === 'day'
          ? 'daily'
          : growthMatch[2] === 'week'
            ? 'weekly'
            : 'monthly'
    }

    results.push({ fullName, desc, language, stars, forks, growth, period })
  }
  return results
}
