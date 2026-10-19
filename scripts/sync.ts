import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 迷你 .env 加载器(避免为 CLI 引入 dotenv 依赖):兼容 .env.local 与 .env,不覆盖已有环境变量。
const loadLocalEnv = () => {
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(join(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        const key = m[1]
        let value = m[2]?.trim() ?? ''
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        if (!(key in process.env)) process.env[key] = value
      }
    } catch {
      // 文件不存在则跳过
    }
  }
}

const main = async () => {
  loadLocalEnv()
  const { syncAllBoards } = await import('../lib/sync')
  const summary = await syncAllBoards()
  console.error(
    `[sync] done: ${summary.ok}/${summary.total} ok | failed=[${summary.failed.join(',')}] | pruned=${summary.pruned} | ${(summary.durationMs / 1000).toFixed(0)}s`,
  )
  process.exit(summary.failed.length > 0 ? 1 : 0)
}

void main()
