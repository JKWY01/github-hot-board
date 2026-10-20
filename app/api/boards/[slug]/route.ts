import { hydrateBoardDescs, viewerLocale } from '@/lib/descfill'
import { getBoardDataCached, isBoardSlug } from '@/lib/boards'
import { RateLimitError } from '@/lib/github'
import type { LivePatch } from '@/lib/types'

/** 支持语言分面的榜单（与 UI 路由一致）。 */
const SUPPORTS_LANGUAGE = new Set(['overall', 'weekly', 'monthly'])

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
    return Response.json(notFound, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  const language = SUPPORTS_LANGUAGE.has(slug) ? languageParam : undefined

  try {
    const viewer = viewerLocale(url.searchParams.get('lg'))
    const base = await getBoardDataCached(slug, language)
    const data = viewer ? await hydrateBoardDescs(base, viewer) : base
    const patch: LivePatch = {
      slug,
      language,
      items: data.items,
      generatedAt: data.generatedAt,
      degraded: data.degraded,
      ...(data.error ? { error: { code: data.error.code } } : {}),
    }
    return Response.json(patch, { headers: { 'Cache-Control': 'no-store' } })
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
