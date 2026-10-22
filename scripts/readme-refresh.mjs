/**
 * 榜单快照刷新(搜索引擎载体):从站点公开 /api/head 拉三大榜,
 * 1) 重写 README 的 MARKER 区间(Top 10 表);
 * 2) 在 rank/ 目录维护每周/每月独立快照页(Top 25 + 简介)——
 *    每页都是 github.com 域名下的新索引入口,周榜按 ISO 周滚动建档。
 * 内容无变化时不产生 diff(工作流按 git status 判断是否提交)。
 * 用法:node scripts/readme-refresh.mjs(Actions 于每轮同步后执行)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const MARK_START = '<!-- GHB:AUTO:START -->'
const MARK_END = '<!-- GHB:AUTO:END -->'
const base = (process.env.GHB_PUBLIC_BASE ?? 'https://git.vaiox.xyz').replace(/\/+$/, '')

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const cut = (s, n) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '')

/** ISO 周号(周一为一周之始,含 1 月 4 日的那周为第 1 周) */
function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)
  return { year: date.getUTCFullYear(), week }
}

const BOARDS = [
  {
    slug: 'weekly',
    title: '本周飙升 Top 10',
    link: `${base}/zh/boards/weekly`,
    note: '官方 Trending 周口径 · 每个名字都能点进档案页看 30 天名次曲线',
    colLabel: '本周新增 Star',
    col: (it) => fmt(it.gained ?? 0),
  },
  {
    slug: 'monthly',
    title: '本月飙升 Top 10',
    link: `${base}/zh/boards/monthly`,
    note: '官方 Trending 月口径 · 长趋势看这里',
    colLabel: '本月新增 Star',
    col: (it) => fmt(it.gained ?? 0),
  },
  {
    slug: 'overall',
    title: '累计 Star Top 10',
    link: `${base}/zh/boards/overall`,
    note: '史上最强口径 · 累计 Star 降序(排除 fork)',
    colLabel: '新增',
    col: () => '—',
  },
]

async function head(slug) {
  const res = await fetch(`${base}/api/head/${slug}`, {
    headers: { 'user-agent': 'ghb-readme-bot/1.0' },
  })
  if (!res.ok) throw new Error(`${slug} http ${res.status}`)
  return res.json()
}

function readmeTable(board, data) {
  const items = (data.items ?? []).slice(0, 10)
  if (items.length === 0) return `*暂无数据(同步进行中)*`
  const lines = []
  lines.push(`**${board.title}** · [打开完整榜单 →](${board.link})`)
  lines.push('')
  lines.push(`| # | 项目 | 累计 Star | ${board.colLabel} |`)
  lines.push(`|---|---|---|---|`)
  for (const [i, it] of items.entries()) {
    lines.push(`| ${i + 1} | [${it.fullName}](${base}/zh/repo/${it.fullName}) | ${fmt(it.stars ?? 0)} | ${board.col(it)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/** rank/ 快照页用:Top 25 + 简介列,内容更厚,喂长尾检索 */
function rankTable(slug, data) {
  const items = (data.items ?? []).slice(0, 25)
  if (items.length === 0) return null
  const label = slug === 'weekly' ? '本周新增 Star' : slug === 'monthly' ? '本月新增 Star' : 'Fork 数'
  const col = (it) => (slug === 'overall' ? fmt(it.forks ?? 0) : fmt(it.gained ?? 0))
  const lines = []
  lines.push(`| # | 项目 | 累计 Star | ${label} | 简介 |`)
  lines.push(`|---|---|---|---|---|`)
  for (const [i, it] of items.entries()) {
    lines.push(`| ${i + 1} | [${it.fullName}](${base}/zh/repo/${it.fullName}) | ${fmt(it.stars ?? 0)} | ${col(it)} | ${cut(it.desc, 60)} |`)
  }
  return lines.join('\n')
}

const RANK_META = {
  weekly: {
    file: (t) => `rank/${t.year}/weekly-${t.year}-W${String(t.week).padStart(2, '0')}.md`,
    h1: (t) => `GitHub 周榜快照 · ${t.year} 年第 ${t.week} 周`,
    blurb: '口径:官方 Trending 周页顺序 + 官方标注的本周新增星数。',
    board: '/zh/boards/weekly',
  },
  monthly: {
    file: (t) => `rank/${t.year}/monthly-${t.ym}.md`,
    h1: (t) => `GitHub 月榜快照 · ${t.ym}`,
    blurb: '口径:官方 Trending 月页,看长趋势。',
    board: '/zh/boards/monthly',
  },
  overall: {
    file: () => 'rank/overall.md',
    h1: () => 'GitHub 总榜快照 · 累计 Star 史上最强 Top 25',
    blurb: '口径:累计 Star 降序(排除 fork),开源世界的常青树。',
    board: '/zh/boards/overall',
  },
}

const BOARD_LINKS = [
  ['overall', '总榜'], ['weekly', '周榜'], ['monthly', '月榜'], ['annual', '年度新星'], ['rising', '90 天斜率'],
  ['dark', '黑马'], ['overlooked', '被忽视'], ['controversial', '黑红'], ['forks', 'Fork 之王'], ['milestone', '里程碑直播'],
].map(([slug, name]) => `[${name}](${base}/zh/boards/${slug})`).join(' · ')

function writeIfChanged(path, content) {
  try {
    if (readFileSync(path, 'utf8') === content) return false
  } catch {
    /* 新文件 */
  }
  writeFileSync(path, content)
  return true
}

const now = new Date()
const { year, week } = isoWeek(now)
const t = {
  year,
  week,
  ym: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
  today: now.toISOString().slice(0, 10),
}

const data = {}
for (const b of BOARDS) {
  try {
    data[b.slug] = await head(b.slug)
  } catch (err) {
    console.error(`[snapshot] ${b.slug} FAILED ${err.message} — 保留现状跳过`)
  }
}
if (!data.weekly && !data.monthly && !data.overall) {
  console.error('[snapshot] 三榜全失败,不动任何文件')
  process.exit(0)
}

// 1) README 区块(Top 10)
const sections = BOARDS.filter((b) => data[b.slug]).map((b) => readmeTable(b, data[b.slug]))
if (sections.length > 0) {
  const block = [MARK_START, ...sections, MARK_END].join('\n')
  const src = readFileSync('README.md', 'utf8')
  const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`)
  const out = re.test(src)
    ? src.replace(re, block)
    : src.replace(/^# .*\n/m, (m) => `${m}\n${block}\n`)
  if (out !== src) {
    writeFileSync('README.md', out)
    console.log('[snapshot] README 区块已刷新')
  } else {
    console.log('[snapshot] README 无变化')
  }
}

// 2) rank/ 每周/每月独立快照页(Top 25 + 简介),归档进年份目录
mkdirSync(`rank/${t.year}`, { recursive: true })
for (const [slug, m] of Object.entries(RANK_META)) {
  const d = data[slug]
  if (!d) continue
  const tbl = rankTable(slug, d)
  if (!tbl) continue
  const doc = [
    `# ${m.h1(t)}`,
    '',
    `> 由 [GitHub 火线榜](${base}/zh) 于 ${t.today} 自动刻录。${m.blurb}`,
    `> 完整榜单、语言分榜与每个项目的 30 天名次曲线:[${base}${m.board}](${base}${m.board})`,
    '',
    tbl,
    '',
    '---',
    '',
    `GitHub 火线榜:十个视角的开源热榜,中文界面,每小时自动更新 —— ${BOARD_LINKS}`,
    '',
  ].join('\n')
  const file = m.file(t)
  if (writeIfChanged(file, doc)) console.log(`[snapshot] ${file} 已刷新`)
  else console.log(`[snapshot] ${file} 无变化`)
}

// 3) 日刻录:rank/<year>/<today>.md —— 当天首拍建档,当日不再覆盖
// (日榜引擎:每天一枚独立文件,commit 即新增页面;30 分钟一轮的同步只改 README 与周/月滚动页)
const dailyFile = `rank/${t.year}/${t.today}.md`
if (existsSync(dailyFile)) {
  console.log(`[snapshot] ${dailyFile} 今日已建档,跳过`)
} else {
  const sp = data.weekly?.items?.[0]
  const parts = [
    `# GitHub 日榜快照 · ${t.today}`,
    '',
    `> 由 [GitHub 火线榜](${base}/zh) 于 ${t.today} 自动刻录(每日首拍建档)。`,
    `> 完整榜单、语言分榜与每个项目的 30 天名次曲线:[${base}/zh](${base}/zh)`,
    '',
  ]
  if (sp) {
    parts.push(
      `**今日最佳**:[${sp.fullName}](${base}/zh/repo/${sp.fullName}) — 本周 +${fmt(sp.gained ?? 0)} star。${cut(sp.desc, 90)}`,
      '',
    )
  }
  for (const b of BOARDS) {
    if (!data[b.slug]) continue
    const tbl = rankTable(b.slug, data[b.slug])
    if (tbl) parts.push(`### ${b.title}`, '', tbl, '')
  }
  parts.push(
    '---',
    '',
    `GitHub 火线榜:十个视角的开源热榜,中文界面,每小时自动更新 —— ${BOARD_LINKS}`,
    '',
  )
  writeFileSync(dailyFile, parts.join('\n'))
  console.log(`[snapshot] ${dailyFile} 已建档`)
}
