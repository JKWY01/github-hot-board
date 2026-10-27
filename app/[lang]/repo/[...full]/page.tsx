import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { isLocale } from '@/app/[lang]/dictionaries'
import { LOCALES } from '@/lib/locales'
import { getRepoArchiveCached, isRepoFullName } from '@/lib/repoarchive'
import { readBoardNeighbors, readRepoDescs, readDiscoverMeta, readRepoStatusFacts, readSiblingRepos, readTopicPeers } from '@/lib/snapshot'
import { borrowLocalizedRepoDocFetch, readRepoDocWithFallback } from '@/lib/repodocs'
import RepoArchiveView, { repoArchiveMetadata } from '@/components/repo-archive'

/** 超时哨兵(2026-10-26 六轮审查):超时/出错 resolve TIMEOUT,与"仓库不存在"(null)可区分 ——
 *  慢查询把在榜仓库当不存在打成 404,是收录面最怕的死链来源。 */
const TIMEOUT = Symbol('timeout')
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null | typeof TIMEOUT> {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(TIMEOUT) }
    }, ms)
    p.then((v) => {
      if (!done) { done = true; clearTimeout(timer); resolve(v) }
    }).catch(() => {
      if (!done) { done = true; clearTimeout(timer); resolve(TIMEOUT) }
    })
  })
}

/** 把 TIMEOUT 哨兵收敛成 null(消费端只分两态:有值/无值),超时与"真没有"统一走降级。 */
function unTimeout<T>(v: T | null | typeof TIMEOUT): T | null {
  return v === TIMEOUT ? null : (v ?? null)
}

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

  // 档案与描述两读无依赖,并行省一次跨境往返串行(冷访 1.7s→约减半)。
  // 所有库读一律限时(catch 只接 reject 接不住"挂住"):主链 9s,挂住就降级,
  // 绝不拖到 maxDuration 被掐成 200 空体(504 案的形态)。
  const [archiveRes, descsMap] = await Promise.all([
    withTimeout(getRepoArchiveCached(fullName), 9000),
    withTimeout(readRepoDescs([fullName]), 9000),
  ])
  // 超时 ≠ 不存在:库慢时抛 5xx(爬虫稍后重试),只有确认查无此仓(null)才 404 ——
  // 慢查询给在榜仓库打 404 会被 Search Console 收成死链(六轮审查 P1)
  if (archiveRes === TIMEOUT) throw new Error('repo archive timeout (db slow)')
  const archive = archiveRes
  if (!archive) notFound()

  // 状态三件套(license/push/issues,2026-10-25 起随拍采集)+ 同类项目(主题邻居)
  const [statusFactsRaw, topicPeersRaw] = await Promise.all([
    withTimeout(readRepoStatusFacts(fullName), 9000)
      .catch(() => ({ license: null, pushedAt: null, issues: null })),
    // 同类邻居是锦上添花:4.5s 上限(部署后首渲染=函数冷启动+洞冷,3.5s 实测常输一拍),
    // 慢就整段放弃(空数组),不许拖死档案页
    withTimeout(
      readDiscoverMeta()
        .then((meta) => {
          const mine = meta.get(fullName)
          return mine && mine.topics.length > 0 ? readTopicPeers(fullName, mine.topics) : []
        }),
      4500,
    ).catch(() => []),
  ])
  const statusFacts = unTimeout(statusFactsRaw)
  const topicPeers = unTimeout(topicPeersRaw)

  // 视角语言描述合并在缓存外(与榜单洞同一纪律):zh 页面用 zh 描述,缺翻译回落 en 原文。
  const descs = unTimeout(descsMap)?.get(fullName)
  const descText = descs?.[lang] ?? descs?.en ?? null

  // 同榜近邻(内链网):读现成 board_head payload,零新查询;失败静默,别拖档案页。
  // 语境选基准口径(总榜)优先 —— appearances 是字母序,拿第一个会拿去黑红榜的
  // 名次语境,和用户心里的总榜名次对不上(走查实测踩中)。
  const primary =
    archive.appearances.find((a) => a.board === 'overall' && a.language === '') ??
    archive.appearances.find((a) => a.language === '') ??
    archive.appearances[0]
  const related = primary
    ? unTimeout(await withTimeout(readBoardNeighbors(primary.board, fullName), 9000).catch(() => [])) ?? []
    : []

  // 同作者其他上榜仓(内链网第二层):repo_seen 小表前缀查,失败静默。
  const siblings = unTimeout(await withTimeout(readSiblingRepos(fullName), 4500).catch(() => [] as string[])) ?? []

  // README 正文(repo_docs 快照,抽屉与档案页共用一份):读序 = 目标语缓存 → en 缓存 → 实弹。
  // 实弹走语言感知借取:真翻译入目标语键,英文兜底只展示不入目标语键(回退污染修复,基线评审阶段1)。
  const cachedDoc = unTimeout(await withTimeout(readRepoDocWithFallback(fullName, lang), 9000))
  const borrowed = cachedDoc?.html
    ? null
    : unTimeout(await withTimeout(borrowLocalizedRepoDocFetch(fullName, lang), 4000))
  const readmeHtml = cachedDoc?.html ?? borrowed?.html ?? null

  return (
    <RepoArchiveView
      archive={archive}
      locale={lang}
      descText={descText}
      related={related ?? undefined}
      relatedBoard={primary?.board}
      siblings={siblings.length > 1 ? siblings : undefined}
      statusFacts={statusFacts ?? undefined}
      topicPeers={topicPeers ?? undefined}
      readmeHtml={readmeHtml}
    />
  )
}
