import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { isLocale } from '@/app/[lang]/dictionaries'
import { LOCALES } from '@/lib/locales'
import { getRepoArchiveCached, isRepoFullName } from '@/lib/repoarchive'
import { readRepoDescs } from '@/lib/snapshot'
import RepoArchiveView, { repoArchiveMetadata } from '@/components/repo-archive'

/** 仓库档案页:/{lang}/repo/{owner}/{repo}
 * 变态式 SEO 主战场 —— "owner/repo" 是天然唯一、零竞争的精确匹配关键词;
 * 页面数据全部来自库('use cache',首访渲染后边缘缓存),未知仓库诚实 404。
 *
 * instant=false(整页阻塞渲染):未知仓库必须返回真实 404 状态码,
 * 流式壳会先把 200 刷出去(软 404 会被 Search Console 当垃圾 URL 收录)。
 * 阻塞还有两个红利:一次响应给爬虫完整 HTML;绕开 #412 那类部分预渲染回放 bug。
 * 代价是每次请求重跑渲染树,数据仍走 'use cache'(stale 300s),现在这个规模完全扛得住。 */
export const maxDuration = 30
export const instant = false

function fullNameOf(full: string[] | undefined): string {
  if (!full || full.length !== 2) return ''
  const fullName = `${full[0]}/${full[1]}`
  return isRepoFullName(fullName) ? fullName : ''
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; full: string[] }>
}): Promise<Metadata> {
  const { lang, full } = await params
  if (!isLocale(lang)) return {}
  const fullName = fullNameOf(full)
  if (!fullName) return {}
  const archive = await getRepoArchiveCached(fullName)
  if (!archive) return {}
  return repoArchiveMetadata(lang, archive)
}

/** [lang] 根段参数声明(十六语);[...full](3.8 万仓库名)故意不进预渲染。
 * 整路由 instant=false 走阻塞渲染:页面里不能有任何"保留 fallback"的 Suspense,
 * 否则壳先刷 200,未知仓库就成了软 404。 */
export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export default async function RepoPage({
  params,
}: {
  params: Promise<{ lang: string; full: string[] }>
}) {
  const { lang, full } = await params
  if (!isLocale(lang)) notFound()
  const fullName = fullNameOf(full)
  if (!fullName) notFound()

  // 档案与描述两读无依赖,并行省一次 Neon 往返串行(冷访 1.7s→约减半)
  const [archive, descsMap] = await Promise.all([
    getRepoArchiveCached(fullName),
    readRepoDescs([fullName]),
  ])
  if (!archive) notFound()

  // 视角语言描述合并在缓存外(与榜单洞同一纪律):zh 页面用 zh 描述,缺翻译回落 en 原文。
  const descs = descsMap.get(fullName)
  const descText = descs?.[lang] ?? descs?.en ?? null

  return <RepoArchiveView archive={archive} locale={lang} descText={descText} />
}
