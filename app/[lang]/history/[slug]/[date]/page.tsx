import { LOCALES, altLangs } from '@/lib/locales'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { connection } from 'next/server'

import { getDict, isLocale } from '@/app/[lang]/dictionaries'
import { isBoardSlug } from '@/lib/boards'
import { readHistoryDays, readHistorySnapshot } from '@/lib/snapshot'
import { HistoryView } from '@/components/history-view'

/** slug/date 是运行时参数:connection() 强制阻塞渲染,未知日期在 notFound 内产生真 404;数据读取仍走 'use cache'(5 分钟)。 */
export const instant = false

/** Next 16 要求根参数(lang)至少给一档;slug 与 date 留给运行时按需渲染。 */
export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

/** 任意日期的往日榜:运行时首次访问回源库(读 cacheLife 5 分钟),之后走缓存。 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string; date: string }>
}): Promise<Metadata> {
  const { lang, slug, date } = await params
  if (!isLocale(lang) || !isBoardSlug(slug) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { robots: { index: false, follow: true } }
  }
  // metadata 阶段先于流式壳提交状态码:不存在的日期在这里给真 404。
  const days = await readHistoryDays(slug)
  if (!days.some((d) => d.day === date)) notFound()
  const dict = getDict(lang)
  return {
    title: `${date} · ${dict.history.title} · ${dict.boards[slug].name}`,
    description: `${date} — ${dict.history.subtitle}`,
    alternates: {
      canonical: `/${lang}/history/${slug}/${date}`,
      languages: altLangs(`/history/${slug}/${date}`),
    },
  }
}

export default async function HistoryDatePage({
  params,
}: {
  params: Promise<{ lang: string; slug: string; date: string }>
}) {
  const { lang, slug, date } = await params
  await connection() // 强制阻塞渲染:未知日期在 notFound 内产生真 404 状态码
  if (!isLocale(lang) || !isBoardSlug(slug)) notFound()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const days = await readHistoryDays(slug)
  // 未命中日期直接 404(不允许未来/空白日期 — 免得变成无限软 200)
  if (!days.some((d) => d.day === date)) notFound()
  const snapshot = await readHistorySnapshot(slug, date)

  return (
    <HistoryView
      lang={lang}
      slug={slug}
      days={days}
      snapshot={snapshot}
      activeDay={date}
    />
  )
}
