import { mkdirSync, readFileSync, renameSync, statSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 本地持久层:独立于 .next(重建/删除不丢),gitignore 不入库。
 * Vercel 只读 FS → 全部 no-op(线上由 Vercel 持久数据缓存 + 可选 Postgres 快照层承担)。
 *
 * 目录:
 *   .data/boards/{key}.json      最新数据快照(每次成功 fill 后原子落盘)
 *   .data/history/{key}.{YYYYMM}.jsonl  追加式历史,按月分段(时间可直接从文件名读出)
 *   .data/quota/                 配额节流 marker
 *
 * key 形如 `overall` / `weekly-python`(buildKey 与 board-data 缓存键一致)。
 */

const DURABLE = !process.env.VERCEL // Vercel:只读 FS,一律 no-op
export const DATA_DIR = join(process.cwd(), '.data')
const HISTORY_MIN = Number(process.env.PERSIST_HISTORY_MIN) || 30 // 历史最小拍间隔(分钟)

function keySafe(key: string): boolean {
  return /^[a-z0-9-]+$/i.test(key) // 防路径拼接注入
}

function boardFile(key: string): string {
  return join(DATA_DIR, 'boards', `${key}.json`)
}

function historyFile(key: string, at = new Date()): string {
  const month = `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, '0')}`
  return join(DATA_DIR, 'history', `${key}.${month}.jsonl`)
}

/** 读取落盘快照;返回 null(无/坏/过期)。ageMs 供调用方判新鲜度。
 * 磁盘上是包装层 { persistedAt, data: BoardData },这里拆包只回内层 BoardData。 */
export function readPersistedBoard(key: string): { data: unknown; ageMs: number } | null {
  if (!DURABLE || !keySafe(key)) return null
  try {
    const path = boardFile(key)
    const stat = statSync(path)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { persistedAt?: string; data?: unknown } | null
    if (!raw || raw.data === undefined || raw.data === null) return null
    return { data: raw.data, ageMs: Date.now() - stat.mtimeMs }
  } catch {
    return null
  }
}

/** 写最新快照(原子:tmp → rename),失败完全静默 —— 持久层永不影响主站。 */
export function savePersistedBoard(key: string, data: unknown): void {
  if (!DURABLE || !keySafe(key)) return
  try {
    const dir = join(DATA_DIR, 'boards')
    mkdirSync(dir, { recursive: true })
    const tmp = `${boardFile(key)}.tmp`
    writeFileSync(tmp, JSON.stringify({ persistedAt: new Date().toISOString(), data }))
    renameSync(tmp, boardFile(key))
  } catch {
    // 静默
  }
}

/** 追加历史一行;同 key 在 PERSIST_HISTORY_MIN 分钟内只记一拍。
 * payload 瘦身:榜位时序只要 rank/repo/数字,moving 到月文件即可被任意分析工具逐月读。 */
export function appendHistory(
  key: string,
  minimal: { generatedAt: string; items: Array<Record<string, number | string>> },
): void {
  if (!DURABLE || !keySafe(key)) return
  try {
    const path = historyFile(key)
    mkdirSync(join(path, '..'), { recursive: true })
    let lastT = 0
    try {
      const raw = readFileSync(path, 'utf8')
      const lines = raw.split('\n')
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]?.trim()
        if (!line) continue
        const last = JSON.parse(line) as { t: string }
        lastT = Date.parse(last.t)
        break
      }
    } catch {
      // 空文件/无上一行
    }
    const now = Date.parse(minimal.generatedAt)
    if (Number.isFinite(lastT) && now - lastT < HISTORY_MIN * 60_000) return // 拍间隔未到
    appendFileSync(path, `${JSON.stringify({ t: minimal.generatedAt, ...minimal, items: minimal.items })}\n`)
  } catch {
    // 静默
  }
}
