import { clientIpOf, slidingWindow } from '@/lib/ratelimit'
import { isRepoFullName } from '@/lib/reposhape'
import { pushConfigured, saveSubscription } from '@/lib/push'
import { isLocale } from '@/lib/locales'

/** Web Push 订阅(关注页"跨线提醒"开关)。
 *  POST /api/push/subscribe { endpoint, keys:{p256dh,auth}, locale, repos[] }
 *  无账号:端点即身份,关注页一键退订即刻删除。VAPID 未配置 → 503(客户端根本不会展示开关)。 */

const rate = slidingWindow()

export async function POST(request: Request) {
  if (!pushConfigured()) {
    return Response.json({ ok: false, reason: 'push-not-configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!rate.allow(clientIpOf(request), 10, 60_000)) {
    return Response.json({ ok: false, reason: 'rate' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } })
  }

  let body: {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
    locale?: unknown
    repos?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, reason: 'bad-json' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  // 只接受 https 推送端点(浏览器推送服务一律 https)
  if (!/^https:\/\/[^\s]{10,400}$/.test(endpoint)) {
    return Response.json({ ok: false, reason: 'bad-endpoint' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''
  if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return Response.json({ ok: false, reason: 'bad-keys' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const locale = typeof body.locale === 'string' && isLocale(body.locale) ? body.locale : 'en'
  const repos = Array.isArray(body.repos)
    ? body.repos.filter((r): r is string => typeof r === 'string' && isRepoFullName(r)).slice(0, 20)
    : []

  const ok = await saveSubscription({ endpoint, p256dh, auth, locale, repos })
  if (!ok) return Response.json({ ok: false, reason: 'db' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
