import { NextResponse, type NextRequest } from 'next/server'

import { BOARD_SLUGS, FACET_BOARDS, facetLangFromSlug, facetLangSlug } from '@/lib/facet'
import { LOCALES, isLocale, matchLocaleFromTag, type Locale } from '@/lib/locales'

/** Accept-Language 最佳匹配; scraper/空头一律默认英文。 */
function preferredLocale(request: NextRequest): Locale {
  const header = request.headers.get('accept-language') || ''
  let bestQ = 0
  let best: Locale = 'en'
  let matched = false
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    let q = 1
    for (const param of params) {
      const trimmed = param.trim()
      if (trimmed.startsWith('q=')) {
        q = Number.parseFloat(trimmed.slice(2)) || 0
      }
    }
    const hit = matchLocaleFromTag(tag)
    if (hit && q > bestQ) {
      best = hit
      bestQ = q
      matched = true
    }
  }
  return matched ? best : 'en'
}

/** 真状态码的 404。cacheComponents 下动态参数的未知值会经共享壳 fill 出 200 soft-404,
 * 所以必须在路由前直接给 404;noindex 防止爬虫当质量页收录。 */
function notFound404(lang: string, pathname: string): NextResponse {
  const zh = lang === 'zh'
  return new NextResponse(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · GitHub 火线榜</title><meta name="robots" content="noindex"><link rel="canonical" href="/${lang}"></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB',sans-serif;color:#1d1d1f"><main style="text-align:center;padding:24px"><p style="letter-spacing:.18em;font-size:13px;font-weight:600;color:#0067d4">404</p><h1 style="font-size:34px;line-height:1.2;margin:.3em 0;font-weight:650">${zh ? '页面不存在' : 'Page not found'}</h1><p style="color:#6e6e73;font-size:15px">${zh ? '这个路径不存在,或从未存在过。' : 'This path does not exist — or never did.'}</p><p style="margin-top:24px"><a href="/${lang}" style="color:#0071e3">← ${zh ? '回到首页' : 'Back home'}</a></p><p style="color:rgba(0,0,0,.35);font-size:12px;margin-top:8px">${pathname}</p></main></body></html>`,
    {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    },
  )
}

/** Next 16 的 proxy.ts(旧称 middleware)。
 * 1) 根路径按 Accept-Language 跳 zh/en;
 * 2) 语言分面旧链接归一:'+'/'#'/百分号编码在路由匹配层就会失败(404 且被 ISR 缓存),
 *    必须在路由之前改写 —— raw 'c++'、'c%2B%2B'、被按空格解码的形态都 308 到 slug(/cpp);
 * 3) 未知榜单/语言参数直接给真 404(避免动态 fill 的 200 soft-404)。 */
export function proxy(request: NextRequest) {
  const seg = request.nextUrl.pathname.split('/')

  const langIsLocale = isLocale(seg[1] ?? '')

  // 未知语言段却带着榜单/历史路径 → 真 404(共享壳 fill 会把未知值吐成 200 软 404)
  if (
    !langIsLocale &&
    seg[1] &&
    (seg[2] === 'boards' || seg[2] === 'history')
  ) {
    return notFound404(seg[1], request.nextUrl.pathname)
  }

  // /{lang}/boards/{slug}
  if (seg.length === 4 && langIsLocale && seg[2] === 'boards') {
    if (!(BOARD_SLUGS as readonly string[]).includes(seg[3])) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    return // 已是预渲染榜单,放行走静态
  }

  // /{lang}/boards/{slug}/{language}
  if (seg.length === 5 && langIsLocale && seg[2] === 'boards') {
    if (!(BOARD_SLUGS as readonly string[]).includes(seg[3])) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    if (!(FACET_BOARDS as readonly string[]).includes(seg[3])) {
      // facets=false 的榜单没有语言子页,任何第四段都不存在(annual/joker、annual/python 等)
      return notFound404(seg[1], request.nextUrl.pathname)
    }

    let decoded = seg[4]
    try {
      decoded = decodeURIComponent(seg[4])
    } catch {
      decoded = seg[4]
    }
    const normalized = decoded
      .toLowerCase()
      .replaceAll('+', 'p')
      .replaceAll('#', 'sharp')
      .replaceAll(' ', '')
    const language = facetLangFromSlug(normalized)
    if (!language) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    const canonical = facetLangSlug(language)
    if (seg[4] === canonical) {
      return // 标准 slug,放行走预取页面
    }
    const url = request.nextUrl.clone()
    url.pathname = `/${seg[1]}/boards/${seg[3]}/${canonical}`
    return NextResponse.redirect(url, 308)
  }

  // /{lang}/history/{slug} 与 /{lang}/history/{slug}/{date}:未知榜 slug 与非法日期格式
  // 同样会经共享壳 fill 出 200 soft-404,必须在路由前给真 404。
  if (seg.length === 4 && langIsLocale && seg[2] === 'history') {
    if (!(BOARD_SLUGS as readonly string[]).includes(seg[3])) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    return
  }
  if (seg.length === 5 && langIsLocale && seg[2] === 'history') {
    if (!(BOARD_SLUGS as readonly string[]).includes(seg[3])) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(seg[4])) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    // 语义时间窗:上线日(2026-10-18)之前、今天(UTC)之后不可能有档案 → 真 404。
    // 窗口内但实际没存档的日期,由页内渲染为诚实的空态(该路由页本身 noindex)。
    const day = seg[4]
    const today = new Date().toISOString().slice(0, 10)
    if (day < '2026-10-18' || day > today) {
      return notFound404(seg[1], request.nextUrl.pathname)
    }
    return // 放行;日期语义(确实有档案与否)由页内判定
  }

  if (request.nextUrl.pathname !== '/') return
  const locale = preferredLocale(request)
  return NextResponse.redirect(new URL(`/${locale}`, request.url))
}

export const config = {
  // 语言段开放给全部注册语种,枚举交给 proxy 内部判定;
  // 排除 api/_next/静态资产,避免无谓地跑进 matcher。
  matcher: [
    '/',
    '/((?!api|_next|favicon.ico|icon.svg|robots.txt|sitemap.xml|manifest.webmanifest).*)',
  ],
}
