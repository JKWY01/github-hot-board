import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/** IndexNow 密钥文件:必须原样暴露在站点根(引擎拿它验证 key 所有权)。
 * await cookies() = cacheComponents 下的动态路由声明(段级 dynamic 不兼容)。 */
export async function GET(): Promise<Response> {
  await cookies()
  const key = (process.env.INDEXNOW_KEY ?? '').trim()
  if (!key) return new NextResponse('indexnow key not configured', { status: 404 })
  return new NextResponse(key, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
