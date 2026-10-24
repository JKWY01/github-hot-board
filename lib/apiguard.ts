import { createHash, timingSafeEqual } from 'node:crypto'

/** 内部端点鉴权(/api/sync、/api/snapshot、/api/refresh、/api/dbcheck)。
 *
 * 规则:
 *  - 配了 CRON_SECRET → 只认 `Authorization: Bearer <secret>` 头(常数时间比较)。
 *    不再接受 ?secret= query —— query 会进代理/Vercel 访问日志,密钥不该出现在那里。
 *  - 没配 CRON_SECRET → 仅放行本地回环请求(本地开发 `npm run dev` 直打 localhost)。
 *    此前的 fail-open 行为(公网任何人可触发 300s 同步烧配额)对部署环境是真实风险。
 *
 * Vercel Cron / GitHub Actions / 本地 sync-fetch.mjs 全部走 Bearer 头,均不受影响。 */

/** 常数时间密钥比较:先各自 sha256 定长再 timingSafeEqual,长度差异也不泄漏比较过程。 */
export function secretMatches(provided: string, secret: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

function bearerToken(request: Request): string {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
}

/** 是否本地回环请求:URL host 是 loopback,或反代后 XFF 首 IP 是私网/回环。 */
export function isLocalRequest(request: Request): boolean {
  let host = ''
  try {
    host = new URL(request.url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.local')) {
    return true
  }
  const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  if (!xff) return false
  if (xff === '::1') return true
  const m = xff.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const first = Number(m[1])
  return first === 10 || first === 127 || (first === 172 && Number(m[2]) >= 16 && Number(m[2]) <= 31) ||
    (first === 192 && Number(m[2]) === 168)
}

/** 统一守卫:返回 null = 放行;返回 Response = 直接作为路由响应(401)。 */
export function requireCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim() ?? ''
  if (secret) {
    if (secretMatches(bearerToken(request), secret)) return null
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  if (isLocalRequest(request)) return null
  return Response.json(
    { error: 'unauthorized', hint: 'set CRON_SECRET and send Authorization: Bearer <secret>' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  )
}
