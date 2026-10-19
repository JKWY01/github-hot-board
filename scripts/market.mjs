#!/usr/bin/env node
/**
 * 市场分析 CLI —— 查询 GH Archive 的公共 ClickHouse 镜像(2011→今全量 GitHub 事件)。
 * 零账号、零安装;数据源头: https://gharchive.org/(github_events 表)。
 *
 * 用法:
 *   node scripts/market.mjs repo vercel/next.js [--days 60] [--forks]
 *     → 单仓库星标/fork 逐日增量 + ASCII 曲线(看爆发日、拐点;自动兼容改名仓库)
 *   node scripts/market.mjs track agent [--months 12]
 *     → 赛道月度新星数 + 活跃仓库数(时代趋势:赛道是在涨还是在退)
 *   node scripts/market.mjs risers [--days 30] [--limit 15]
 *     → 全站任意时间窗的「涨星火箭榜」(历史任何月份都能复盘,不依赖自己的榜)
 *
 * ⚠️ 口径说明(2026-10 实测):
 *   1) 公共镜像为全量数据的 ~10% 抽样(track/risers/repo 的数值看相对形状/排名;
 *      绝对精确值用 BigQuery 公共数据集 githubarchive.day.* —— 免费 1TB/月查询额度)。
 *   2) 镜像最近 3-5 天灌注滞后,看「最近几天」时把窗口放长到 ≥14 天再解读。
 *   3) GitHub REST/GraphQL 的 stargazers/subscribers 明细端点已在 2026 平台侧撤下
 *      (本 CLI 因此全部走事件归档,不再依赖任何 GitHub API 明细端点)。
 *   4) 仓库改名后,历史事件仍按事件当时仓库名存储(如 facebook/react vs react/react),
 *      repo 命令已自动把两种口径都算上。
 *
 * 生产站点的榜单快照体系(自己的排位历史)见 README「数据与快照」章节。
 */

const ENDPOINT = 'https://play.clickhouse.com/?user=play'

async function ch(sql) {
  const res = await fetch(ENDPOINT, { method: 'POST', body: sql })
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.text()
}

function argum(name, def) {
  const i = process.argv.indexOf(name)
  if (i === -1) return def
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) && v > 0 ? v : def
}

function spark(values) {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const chars = '▁▂▃▄▅▆▇█'
  return values.map(v => chars[Math.min(7, Math.floor((v / max) * 7.99))]).join('')
}

function repoNames(full) {
  /* 处理改名:facebook/react → ('facebook/react' 与 'react')两种口径都要查 */
  const parts = full.split('/')
  const nameOnly = parts[parts.length - 1]
  return nameOnly && nameOnly !== full ? `repo_name IN ('${full}', '${nameOnly}')` : `repo_name = '${full}'`
}

const bar = (n, max, width = 40) => '█'.repeat(Math.min(width, Math.round((n / max) * width)))

/* ------------------------------ 命令实现 ------------------------------ */

async function cmdRepo() {
  const full = process.argv[3]
  if (!full || !full.includes('/')) { console.error('用法: node scripts/market.mjs repo <owner/name> [--days 60] [--forks]'); process.exit(1) }
  const days = argum('--days', 60)
  const forks = process.argv.includes('--forks')
  const ev = forks ? 'ForkEvent' : 'WatchEvent'

  console.log(`\n◆ ${full} 最近 ${days} 天 ${forks ? 'fork' : '星标'}逐日增量(公共镜像 ~10% 抽样,看形状)\n`)
  const tsv = await ch(`
    SELECT toDate(created_at) d, count() c
    FROM github_events
    WHERE ${repoNames(full)} AND event_type = '${ev}'
      AND created_at >= now() - INTERVAL ${days} DAY
    GROUP BY d ORDER BY d FORMAT TSV`)
  const rows = tsv.trim().split('\n').filter(Boolean).map(l => l.split('\t'))
  if (!rows.length) { console.log('(窗口内镜像无数据)'); return }
  const series = rows.map(r => Number(r[1]))
  const max = Math.max(...series, 1)
  for (const [d, c] of rows) console.log(`${d}  ${String(c).padStart(6)}  ${bar(Number(c), max)}`)
  console.log(`\n${spark(series)}  合计(抽样) ${series.reduce((a, b) => a + b, 0).toLocaleString()}`)
  const top = rows.reduce((a, b) => (Number(a[1]) >= Number(b[1]) ? a : b))
  console.log(`峰值日: ${top[0]}(${top[1]} 次)——对照当天是否有 HN/launch/热搜事件`)
  console.log('注:最近 3-5 天镜像灌注滞后,尾部偏低不代表真实;绝对值请用 BigQuery 全量表。')
}

async function cmdTrack() {
  const kw = process.argv[3]
  if (!kw) { console.error('用法: node scripts/market.mjs track <关键词> [--months 12]'); process.exit(1) }
  const months = argum('--months', 12)
  console.log(`\n◆ 赛道「${kw}」近 ${months} 个月 月度星标增量 / 活跃仓库数(时代趋势;\n  公共镜像 ~10% 抽样,月度形状与相对趋势可信)\n`)
  const tsv = await ch(`
    SELECT toStartOfMonth(created_at) m, count() stars, uniqCombined(repo_name) repos
    FROM github_events
    WHERE event_type = 'WatchEvent' AND repo_name ILIKE '%${kw}%'
      AND created_at >= toStartOfMonth(now()) - INTERVAL ${months} MONTH
    GROUP BY m ORDER BY m FORMAT TSV`)
  const rows = tsv.trim().split('\n').map(l => l.split('\t'))
  if (!rows[0] || !rows[0][0]) { console.log('(该时间段无数据)'); return }
  const stars = rows.map(r => Number(r[1]))
  console.log('月份        新星数(抽样)   活跃仓库')
  rows.forEach(([m, s, r]) => {
    console.log(`${m.slice(0, 7)}  ${Number(s).toLocaleString().padStart(10)}  ${String(r).padStart(8)}`)
  })
  console.log(`\n星标曲线  ${spark(stars, 24)}`)
  const tail = rows.slice(-1)[0]
  if (tail) console.log(`注:最后一个月(${tail[0].slice(0, 7)})受灌注滞后影响,解读时忽略或放长窗口。`)
  const half = Math.floor(stars.length / 2) || 1
  const a = stars.slice(0, half).reduce((x, y) => x + y, 0) / half
  const b = stars.slice(half).reduce((x, y) => x + y, 0) / Math.max(stars.length - half, 1)
  console.log(`前半段均值 ${Math.round(a).toLocaleString()} vs 后半段 ${Math.round(b).toLocaleString()} → ${b > a * 1.15 ? '加速中' : b < a * 0.85 ? '减速中' : '平稳'}`)
}

async function cmdRisers() {
  const days = argum('--days', 30)
  const limit = argum('--limit', 15)
  console.log(`\n◆ 全站火箭榜:近 ${days} 天星标增量 Top ${limit}(公共镜像口径,~10% 抽样,排名可信)\n`)
  const tsv = await ch(`
    SELECT repo_name, count() c
    FROM github_events
    WHERE event_type = 'WatchEvent' AND created_at >= now() - INTERVAL ${days} DAY
    GROUP BY repo_name ORDER BY c DESC LIMIT ${limit} FORMAT TSV`)
  const rows = tsv.trim().split('\n').filter(Boolean).map(l => l.split('\t'))
  const max = Math.max(...rows.map(r => Number(r[1])), 1)
  for (const [repo, c] of rows) {
    console.log(`${repo.slice(0, 44).padEnd(44)}  ${Number(c).toLocaleString().padStart(9)}  ${bar(Number(c), max, 30)}`)
  }
  console.log('\n提示:挑「星数低涨幅高」的条目即复刻候选早期信号;再用 repo 子命令看它的爆发日。')
}

const cmd = process.argv[2]
;({ repo: cmdRepo, track: cmdTrack, risers: cmdRisers }[cmd] ?? (() => {
  console.error('子命令: repo | track | risers  (参数见文件头注释)')
  process.exit(1)
}))().catch(e => { console.error('查询失败:', e.message); process.exit(1) })
