// 本地/CI 触发同步端点的小工具:从 .env.local 读 CRON_SECRET(可选),POST /api/sync,打印摘要。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const loadEnvValue = (key) => {
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(join(process.cwd(), file), 'utf8')
      const line = raw.split('\n').find((l) => l.trim().startsWith(`${key}=`))
      if (line) return line.slice(line.indexOf('=') + 1).trim()
    } catch { /* skip */ }
  }
  return undefined
}

const base = process.env.GHB_SITE || 'http://localhost:3000'
const secret = process.env.CRON_SECRET || loadEnvValue('CRON_SECRET')

const res = await fetch(`${base}/api/sync`, {
  method: 'POST',
  headers: secret ? { authorization: `Bearer ${secret}` } : {},
})
const body = await res.text()
console.log(`http ${res.status}`)
console.log(body)
process.exit(res.ok ? 0 : 1)
