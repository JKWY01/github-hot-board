import type { RepoAppearance } from './snapshot'

/** 仓库上榜徽章(shields.io flat 风格,自绘 SVG,零依赖)。
 *  作者贴进自己 README 的"荣誉证书":当前最好名次 / 曾上过榜 / 未上榜 三态。
 *  纯函数层:榜单中文名、取榜逻辑、SVG 构建 —— 全部可单测。 */

/** 榜 slug → 徽章上的中文短名(与站内 shortBoards 同口径,不引字典:徽章语言跟站牌走)。 */
export const BADGE_BOARD_NAMES: Record<string, string> = {
  overall: '总榜',
  weekly: '周榜',
  monthly: '月榜',
  annual: '年度新星',
  rising: '潜力榜',
  dark: '黑马榜',
  overlooked: '被忽视榜',
  controversial: '黑红榜',
  forks: 'Fork 之王',
  milestone: '里程碑',
}

export const BADGE_LABEL = 'GitHub 火线榜'

/** 与档案页同一"现役"口径:3 天内仍在拍 = current(lib/snapshot.ts readRepoArchiveRows)。 */
export interface BadgeInfo {
  state: 'current' | 'retired' | 'none'
  board?: string
  rank?: number
}

export function badgeInfoOf(appearances: RepoAppearance[]): BadgeInfo {
  const known = appearances.filter((a) => a.board in BADGE_BOARD_NAMES)
  if (known.length === 0) return { state: 'none' }
  const current = known.filter((a) => a.current)
  const pool = current.length > 0 ? current : known
  const best = pool.reduce((m, a) => (a.rank < m.rank ? a : m), pool[0])
  return current.length > 0
    ? { state: 'current', board: best.board, rank: best.rank }
    : { state: 'retired', board: best.board }
}

/** 徽章右值:周榜 #3 / 曾上黑马榜 / 未上榜。 */
export function badgeValueOf(info: BadgeInfo): string {
  if (info.state === 'current') return `${BADGE_BOARD_NAMES[info.board ?? ''] ?? '榜'} #${info.rank}`
  if (info.state === 'retired') return `曾上${BADGE_BOARD_NAMES[info.board ?? ''] ?? '榜'}`
  return '未上榜'
}

const COLORS: Record<BadgeInfo['state'], string> = {
  current: '#0071e3',
  retired: '#8e8e93',
  none: '#c7c7cc',
}

/** 近似字宽:汉字/全角 ≈ 字号,拉丁字母数字 ≈ 0.58 字号,空格 ≈ 0.32。
 *  shields 同款视觉不需要像素级精确,差 1-2px 无感。 */
export function textWidth(s: string, fontSize = 11): number {
  let w = 0
  for (const ch of s) {
    if (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) w += fontSize
    else if (ch === ' ') w += fontSize * 0.32
    else w += fontSize * 0.58
  }
  return w
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** shields.io "flat" 风格:左灰右彩,圆角 3,渐变罩面。 */
export function buildBadgeSvg(info: BadgeInfo): string {
  const value = badgeValueOf(info)
  const color = COLORS[info.state]
  const pad = 6
  const lw = Math.round(textWidth(BADGE_LABEL) + pad * 2)
  const vw = Math.round(textWidth(value) + pad * 2)
  const w = lw + vw
  const label = xmlEscape(BADGE_LABEL)
  const val = xmlEscape(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${val}">
  <title>${label}: ${val}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#50505a"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,'DejaVu Sans',sans-serif" font-size="11">
    <text x="${lw / 2}" y="15">${label}</text>
    <text x="${lw + vw / 2}" y="15">${val}</text>
  </g>
</svg>`
}
