import { dbStats, dbUrlConfigured } from '@/lib/snapshot'
import { requireCronAuth } from '@/lib/apiguard'

/** 库健康诊断:暴露基础设施状态(是否配库/行数),只该给运维看 —— 与 sync 同一守门。 */
export const GET = async (request: Request): Promise<Response> => {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const stats = await dbStats()
  return Response.json({
    urlConfigured: dbUrlConfigured(),
    stats: stats ?? { headKeys: 0, rows: 0, note: 'db unreachable or error (check server log [snapshot])' },
  })
}
