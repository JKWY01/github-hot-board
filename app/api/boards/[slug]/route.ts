import { hydrateBoardDescs, viewerLocale } from '@/lib/descfill'
import { getBoardDataCached, isBoardSlug } from '@/lib/boards'
import { RateLimitError } from '@/lib/github'
import type { LivePatch } from '@/lib/types'

/** 支持语言分面的榜单（与 UI 路由一致）。 */
const SUPPORTS_LANGUAGE = new Set(['overall', 'weekly', 'monthly'])

/** 给 after() 里的描述补齐留时间(Vercel 上按平台上限取小;本地无感)。 */
export const maxDuration = 60

/** CORS 预检:公开 GET API,允许任意来源跨域访问(gitstock 模式)。 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const url = new URL(request.url)
  const languageParam = url.searchParams.get('language') ?? undefined

  if (!isBoardSlug(slug)) {
    const notFound: LivePatch = {
      slug,
      items: [],
      generatedAt: new Date().toISOString(),
      error: { code: 'unknown', message: 'unknown board slug' },
    }
    return Response.json(notFound, { status: 404, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } })
  }

  const language = SUPPORTS_LANGUAGE.has(slug) ? languageParam : undefined

  try {
    // description_lang 是 gitstock 式公开 API 的习惯参数名(gitstock 验证过):
    // 与站内 lg 参数等价,给第三方开发者一个不用读文档就懂的入口。
    const viewer = viewerLocale(url.searchParams.get('lg') ?? url.searchParams.get('description_lang'))
    const base = await getBoardDataCached(slug, language)
    const data = viewer ? await hydrateBoardDescs(base, viewer) : base
    const patch: LivePatch = {
      slug,
      language,
      items: data.items,
      generatedAt: data.generatedAt,
      degraded: data.degraded,
      // 换芯后的新面:source(daily-stars 等)与官方新面孔栏必须透传,MCP/JSON 消费方才看得见
      source: data.source,
      ...(data.officialNewcomers ? { officialNewcomers: data.officialNewcomers } : {}),
    }
    return Response.json(patch, {
      headers: {
        'Cache-Control': 'no-store',
        // 公开只读数据,CORS 全开(gitstock 模式):浏览器端第三方应用可直接消费。
        'Access-Control-Allow-Origin': '*',
        // JSON 消费者的自助引导:四天数据里有真人 UA 直接消费此 API,
        // 指到 agent 说明书与可复用的榜单徽章 —— 把数据用户转成引用/外链源。
        'Link': '</llms.txt>; rel="help"',
        'X-Docs': 'https://git.vaiox.xyz/llms.txt (API guide, MCP server, badge embed)',
      },
    })
  } catch (error) {
    const patch: LivePatch = {
      slug,
      language,
      items: [],
      generatedAt: new Date().toISOString(),
      error: {
        code: error instanceof RateLimitError ? 'rate-limited' : 'upstream',
      },
    }
    return Response.json(patch, { headers: { 'Cache-Control': 'no-store' } })
  }
}
