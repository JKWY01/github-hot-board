import { dbUrlConfigured } from '@/lib/snapshot'
import { requireCronAuth } from '@/lib/apiguard'
import { syncAllBoards } from '@/lib/sync'

export const maxDuration = 300

export const GET = handle
export const POST = handle

/** 数据同步端点(vercel.json 的 cron 目标;与 /api/sync 同一逻辑)。
 * 鉴权与 /api/sync 同源:Bearer 头 + 常数时间比较;无密钥时仅本地。 */
async function handle(request: Request): Promise<Response> {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const summary = await syncAllBoards()
  return Response.json({
    net: dbUrlConfigured() ? 'database' : 'no-database-url (disk-only)',
    ok: summary.failed.length === 0,
    keys: `${summary.ok}/${summary.total}`,
    failed: summary.failed,
    pruned: summary.pruned,
    durationMs: summary.durationMs,
  })
}
