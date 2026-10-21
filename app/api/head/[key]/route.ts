import { NextResponse } from 'next/server'

import { isBoardSlug } from '@/lib/boards'
import { dbKey, readBoardHead } from '@/lib/snapshot'

/** 公开榜头数据(README 自动刷新 / 数据复用口):Bearer-free 只读,60s 边缘缓存。
 * 与站点读数同一来源(board_head),数字与页面所见一致。 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  if (!isBoardSlug(key)) return NextResponse.json({ error: 'unknown board' }, { status: 404 })
  const head = await readBoardHead(dbKey(key))
  if (!head) return NextResponse.json({ error: 'no data yet' }, { status: 404 })
  return NextResponse.json(head.data, {
    headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=600' },
  })
}
