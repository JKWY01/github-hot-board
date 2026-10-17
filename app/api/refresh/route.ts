import { revalidateTag } from 'next/cache'

/**
 * 手动/定时强制刷新：revalidateTag('github') 使所有 'use cache' 榜单缓存失效，
 * 下一次访问会重新拉取 GitHub 数据。
 *
 * 鉴权（二选一，均未设置时拒绝）：
 * - Vercel Cron：自动携带 `Authorization: Bearer $CRON_SECRET`；
 * - 手动调用：`?secret=<CRON_SECRET>` 或同样的 Authorization 头。
 *
 * 启用定时兜底刷新的 vercel.json 示例见 README.md。
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = process.env.CRON_SECRET?.trim()
  const provided =
    url.searchParams.get('secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (!secret || provided !== secret) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  revalidateTag('github', 'max')
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
