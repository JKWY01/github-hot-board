import { LOCALES } from '@/lib/locales'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { connection } from 'next/server'

import { getDict, isLocale } from '@/app/[lang]/dictionaries'
import { isBoardSlug } from '@/lib/boards'
import { readHistoryDays, readHistorySnapshot } from '@/lib/snapshot'
import { HistoryView } from '@/components/history-view'

/** 工具页整树阻塞渲染:未知组合在渲染内 notFound → 真 404(共享壳流式会变成 200 软 404)。 */
export const instant = false

/** Next 16 要求根参数(lang)至少给一档;slug 留给运行时阻塞渲染。 */
export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>
}): Promise<Metadata> {
  const { lang, slug } = await params
  if (!isLocale(lang) || !isBoardSlug(slug)) return { robots: { index: false, follow: true } }
  const dict = getDict(lang)
  return {
    title: `${dict.history.title} · ${dict.boards[slug].name}`,
    robots: { index: false, follow: true },
  }
}

export default async function HistoryLatestPage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>
}) {
  const { lang, slug } = await params
  await connection() // 强制阻塞渲染:未知组合产生真 404(与 [date] 层同理)
  if (!isLocale(lang) || !isBoardSlug(slug)) notFound()

  const days = await readHistoryDays(slug)
  const latestDay = days[0]?.day
  const snapshot = latestDay ? await readHistorySnapshot(slug, latestDay) : null

  return (
    <HistoryView
      lang={lang}
      slug={slug}
      days={days}
      snapshot={snapshot}
      activeDay={latestDay ?? ''}
    />
  )
}
