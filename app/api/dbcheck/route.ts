import { dbStats, dbUrlConfigured } from '@/lib/snapshot'

export const GET = async (): Promise<Response> => {
  const stats = await dbStats()
  return Response.json({
    urlConfigured: dbUrlConfigured(),
    stats: stats ?? { headKeys: 0, rows: 0, note: 'db unreachable or error (check server log [snapshot])' },
  })
}
