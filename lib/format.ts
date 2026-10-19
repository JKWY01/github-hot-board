import type { Locale } from './types'

const zhCompact = new Intl.NumberFormat('zh-CN', { notation: 'compact' })
const enCompact = new Intl.NumberFormat('en-US', { notation: 'compact' })

export function fmtNum(n: number, locale: Locale): string {
  const value = Number.isFinite(n) ? n : 0
  return (locale === 'zh' ? zhCompact : enCompact).format(value)
}

export function fmtSigned(n: number, locale: Locale): string {
  const abs = fmtNum(Math.abs(n), locale)
  if (n > 0) return `+${abs}`
  if (n < 0) return `-${abs}`
  return fmtNum(0, locale)
}

const zhTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const enTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const zhDay = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
})
const enDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
})

export function fmtTime(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return (locale === 'zh' ? zhTime : enTime).format(d)
}

/** 只到「号」:zh → 10月19日,en → Oct 19。榜单信息条用,弱化时刻精度。 */
export function fmtDay(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return (locale === 'zh' ? zhDay : enDay).format(d)
}

export function fmtSlope(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

export function fmtScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

export function fmtAgo(iso: string | undefined, locale: Locale): string {
  if (!iso) return '--'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '--'
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return locale === 'zh' ? '24 小时内' : '<24h'
  return locale === 'zh' ? `${days} 天前` : `${days}d ago`
}
