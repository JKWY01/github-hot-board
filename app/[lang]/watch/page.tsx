import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getDict, isLocale, liveStrings } from '@/app/[lang]/dictionaries'
import WatchClient from '@/components/watch-client'
import { LOCALES } from '@/lib/locales'

/** 关注 v1:本地列表 + 现查状态。个人信息不入库不上传 —— 无新收录面,
 *  noindex 钉死,保持"爬虫看到 = 官方榜单"的收录纪律。
 *  跨线提醒(Web Push)是唯一的例外口,且明确告知:VAPID 未配置时整条链路不存在。 */

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
    title: `${liveStrings(lang).watchTitle} · ${getDict(lang).meta.siteName}`,
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
  // VAPID 公钥只读环境(构建期烘焙进静态壳;密钥不轮转的前提下足够)。未配置 → 不传,客户端不渲染开关。
  const pushKey = (process.env.VAPID_PUBLIC_KEY ?? '').trim() || undefined
  return <WatchClient locale={lang} pushKey={pushKey} />
}
