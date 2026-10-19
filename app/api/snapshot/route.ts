import { dbUrlConfigured } from '@/lib/snapshot'
import { syncAllBoards } from '@/lib/sync'

export const maxDuration = 300

export const GET = handle
export const POST = handle

/** 数据同步端点(vercel.json 的 cron 目标;与 /api/sync 同一逻辑)。 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const url = new URL(request.url)
    const auth = request.headers.get('authorization') ?? ''
    const q = url.searchParams.get('secret') ?? ''
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
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
