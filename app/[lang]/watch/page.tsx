import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { isLocale, liveStrings } from '@/app/[lang]/dictionaries'
import WatchClient from '@/components/watch-client'
import { LOCALES } from '@/lib/locales'

/** 关注 v1:本地列表 + 现查状态。个人信息不入库不上传 —— 无新收录面,
 *  noindex 钉死,保持"爬虫看到 = 官方榜单"的收录纪律。 */

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  return {
    title: `${liveStrings(lang).watchTitle} · GitHub Hot Board`,
    description: undefined,
    robots: { index: false, follow: true },
  }
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  return <WatchClient locale={lang} />
}
