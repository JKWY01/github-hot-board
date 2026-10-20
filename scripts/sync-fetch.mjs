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
// --prefill-only:POST ?boards=0 —— 跳过榜单本体,只跑库中现存榜头的描述收割(运修用)。
const boardsOnly = process.argv.includes('--prefill-only') ? '?boards=0' : ''

let res
try {
  res = await fetch(`${base}/api/sync${boardsOnly}`, {
    method: 'POST',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
} catch {
  // 同步在服务端可能仍在继续(head 写库逐 key 进行),别把进行中的同步说成失败
  console.log('请求超时或中断:服务端同步可能仍在进行,稍后看 /api/boards/* 是否更新。')
  process.exit(2)
}
const body = await res.text()
console.log(`http ${res.status}`)
console.log(body)
process.exit(res.ok ? 0 : 1)
