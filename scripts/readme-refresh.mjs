/**
 * README 榜单快照刷新(搜索引擎载体):从站点公开 /api/head 拉三大榜,
 * 把 MARKER 区间的 Markdown 表格重写;内容无变化时退出但不提交。
 * 用法:node scripts/readme-refresh.mjs(在 Actions 于每轮同步后执行)
 */
import { readFileSync, writeFileSync } from 'node:fs'

const MARK_START = '<!-- GHB:AUTO:START -->'
const MARK_END = '<!-- GHB:AUTO:END -->'
const base = (process.env.GHB_PUBLIC_BASE ?? 'https://git.vaiox.xyz').replace(/\/+$/, '')

const BOARDS = [
  {
    slug: 'weekly',
    title: '本周飙升 Top 10',
    link: `${base}/zh/boards/weekly`,
    note: '官方 Trending 周口径 · 每个名字都能点进档案页看 30 天名次曲线',
    cols: (it) => fmt(it.gained ?? 0),
    colLabel: '本周新增 Star',
  },
  {
    slug: 'monthly',
    title: '本月飙升 Top 10',
    link: `${base}/zh/boards/monthly`,
    note: '官方 Trending 月口径 · 长趋势看这里',
    cols: (it) => fmt(it.gained ?? 0),
    colLabel: '本月新增 Star',
  },
  {
    slug: 'overall',
    title: '累计 Star Top 10',
    link: `${base}/zh/boards/overall`,
    note: '史上最强口径 · 累计 Star 降序(排除 fork)',
    cols: () => '—',
    colLabel: '新增',
  },
]

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

async function head(slug) {
  const res = await fetch(`${base}/api/head/${slug}`, {
    headers: { 'user-agent': 'ghb-readme-bot/1.0' },
  })
  if (!res.ok) throw new Error(`${slug} http ${res.status}`)
  return res.json()
}

function table(board, data) {
  const items = (data.items ?? []).slice(0, 10)
  if (items.length === 0) return `*暂无数据(同步进行中)*`
  const lines = []
  lines.push(`**${board.title}** · [打开完整榜单 →](${board.link})`)
  lines.push('')
  lines.push(`| # | 项目 | 累计 Star | ${board.colLabel} |`)
  lines.push(`|---|---|---|---|`)
  for (const [i, it] of items.entries()) {
    const link = `${base}/zh/repo/${it.fullName}`
    lines.push(`| ${i + 1} | [${it.fullName}](${link}) | ${fmt(it.stars ?? 0)} | ${board.cols(it)} |`)
  }
  lines.push('')
  lines.push(`*${board.note}。数据抓取自公开 GitHub 口径,完整 ${items.length === 10 ? '25' : ''} 名与语言分榜见站点。*`)
  lines.push('')
  return lines.join('\n')
}

const sections = []
for (const b of BOARDS) {
  try {
    const data = await head(b.slug)
    sections.push(table(b, data))
  } catch (err) {
    console.error(`[readme] ${b.slug} FAILED ${err.message} — 保留现状跳过`)
  }
}
if (sections.length === 0) {
  console.error('[readme] 三榜全失败,README 不动')
  process.exit(0)
}

const block = [MARK_START, ...sections, MARK_END].join('\n')
const path = 'README.md'
const src = readFileSync(path, 'utf8')
const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`)
let out
if (re.test(src)) out = src.replace(re, block)
else {
  // 没有标记位时追加到文首介绍后(标题段之后)。
  const anchor = /^# .*\n/m
  out = src.replace(anchor, (m) => `${m}\n${block}\n`)
}
if (out === src) {
  console.log('[readme] 内容无变化,不提交')
  process.exit(0)
}
writeFileSync(path, out)
console.log('[readme] README 区块已刷新')
