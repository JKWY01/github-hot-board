import { clientIpOf, slidingWindow } from '@/lib/ratelimit'
import { removeSubscription } from '@/lib/push'

/** Web Push 退订:POST /api/push/unsubscribe { endpoint } —— 端点即刻删除,无残留。 */

const rate = slidingWindow()

export async function POST(request: Request) {
  if (!rate.allow(clientIpOf(request), 10, 60_000)) {
    return Response.json({ ok: false, reason: 'rate' }, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }
  let endpoint = ''
  try {
    const body = (await request.json()) as { endpoint?: unknown }
    if (typeof body.endpoint === 'string') endpoint = body.endpoint.trim()
  } catch {
    /* fallthrough */
  }
  if (!/^https:\/\/[^\s]{10,400}$/.test(endpoint)) {
    return Response.json({ ok: false, reason: 'bad-endpoint' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  await removeSubscription(endpoint)
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
