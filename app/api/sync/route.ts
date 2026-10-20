import { dbUrlConfigured } from '@/lib/snapshot'
import { isBoardSlug, type BoardSlug } from '@/lib/boards'
import { syncAllBoards } from '@/lib/sync'

export const maxDuration = 300

export const GET = handle
export const POST = handle

/** 数据同步端点(唯一的进货通道):cron Actions 每 30 分钟敲一次,也可手动触发。
 * CRON_SECRET 配置后需要 Bearer 头;未配置时仅限本地/内网使用。 */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization') ?? ''
    const q = url.searchParams.get('secret') ?? ''
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  // ?boards=0(或环境 GHB_SYNC_BOARDS=0):跳过榜单本体、只跑描述收割
  // ?only=milestone:只同步单榜(运修/即时修数据用)
  const boardsOnly = url.searchParams.get('boards') === '0' || process.env.GHB_SYNC_BOARDS === '0'
  const onlyParam = url.searchParams.get('only')
  const onlyBoard = onlyParam && isBoardSlug(onlyParam) ? (onlyParam as BoardSlug) : undefined
  const summary = await syncAllBoards({ boardsOnly, onlyBoard })
  return Response.json({
    net: dbUrlConfigured() ? 'database' : 'no-database-url (disk-only)',
    ok: summary.failed.length === 0,
    keys: `${summary.ok}/${summary.total}`,
    failed: summary.failed,
    pruned: summary.pruned,
    durationMs: summary.durationMs,
  })
}
