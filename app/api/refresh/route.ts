import { revalidateTag } from 'next/cache'

import { requireCronAuth } from '@/lib/apiguard'

/**
 * 手动/定时强制刷新：revalidateTag('github') 使所有 'use cache' 榜单缓存失效，
 * 下一次访问会重新拉取 GitHub 数据。
 *
 * 鉴权(Vercel Cron 与手动调用同一条路):`Authorization: Bearer $CRON_SECRET`
 * (常数时间比较;未配置 CRON_SECRET 时仅本地可用)。
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  revalidateTag('github', 'max')
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
