import { NextResponse, type NextRequest } from 'next/server'

const LOCALES = ['zh', 'en'] as const

function preferredLocale(request: NextRequest): (typeof LOCALES)[number] {
  const header = request.headers.get('accept-language') || ''
  let best = ''
  let bestQ = 0
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    let q = 1
    for (const param of params) {
      const trimmed = param.trim()
      if (trimmed.startsWith('q=')) {
        q = Number.parseFloat(trimmed.slice(2)) || 0
      }
    }
    if (q > bestQ) {
      best = tag.toLowerCase()
      bestQ = q
    }
  }
  return best.startsWith('zh') ? 'zh' : 'en'
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== '/') return
  const locale = preferredLocale(request)
  return NextResponse.redirect(new URL(`/${locale}`, request.url))
}

export const config = {
  matcher: ['/'],
}
