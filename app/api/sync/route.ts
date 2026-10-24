import { dbUrlConfigured } from '@/lib/snapshot'
import { isBoardSlug, type BoardSlug } from '@/lib/boards'
import { requireCronAuth } from '@/lib/apiguard'
import { syncAllBoards } from '@/lib/sync'

export const maxDuration = 300

export const GET = handle
export const POST = handle

/** 数据同步端点(唯一的进货通道):cron Actions 每 30 分钟敲一次,也可手动触发。
 * 鉴权统一走 lib/apiguard:配 CRON_SECRET 时只认 Bearer 头(常数时间比较);
 * 未配置时仅放行本地回环 —— 公网部署不配密钥不再等于开放同步。 */
async function handle(request: Request): Promise<Response> {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const url = new URL(request.url)
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
