import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { isLocale } from '@/app/[lang]/dictionaries'
import { LOCALES } from '@/lib/locales'
import { getRepoArchiveCached, isRepoFullName } from '@/lib/repoarchive'
import { readBoardNeighbors, readRepoDescs, readDiscoverMeta, readRepoStatusFacts, readSiblingRepos, readTopicPeers } from '@/lib/snapshot'
import { serveRepoDoc } from '@/lib/repodocs'
import RepoArchiveView, { repoArchiveMetadata } from '@/components/repo-archive'
import RepoUnavailable, { RepoUnavailableBody } from '@/components/RepoUnavailable'

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
  const archive = await withTimeout(getRepoArchiveCached(fullName), 9000)
  // 超时 = 暂时故障:显式 metadata 级 noindex(robots 字段是 Next 合并树的原生 key,
  // 页面值覆盖 layout 的 index,follow,不产生重复 meta 标签)。与 body 的降级视图
  // RepoUnavailable 保持同一判定源;组件内提升的 meta 是双保险(实测双 meta 场景
  // 爬虫取最严格,但显式字段消除了重复标签本身)。
  if (archive === TIMEOUT) return { robots: { index: false, follow: false } }
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
  // 超时 ≠ 不存在。实测(2026-10-28 本地生产构建+故障注入):[lang]/layout 的 await
  // 完成前 Next 已发出响应头,此处无论 throw 还是 notFound 都只能流中处理 ——
  // 产出"200 + noindex + 空壳"并被 CDN 当正常页缓存 13h+(生产 5 URL 实锤)。
  // 所以超时分支不改变状态码,改渲染诚实的降级视图(RepoUnavailable):
  // 可见正文说明"数据暂时不可用"+ <meta robots noindex> 压过 layout 的 index,follow,
  // 搜索引擎不收录;正常完成的渲染照常缓存(脏窗 ≤5min),DB 恢复后自愈。
  if (archiveRes === TIMEOUT)
    return (
      <>
        <RepoUnavailable />
        <RepoUnavailableBody />
      </>
    )
  const archive = archiveRes
  if (!archive) notFound()

  // 状态三件套(license/push/issues,2026-10-25 起随拍采集)+ 同类项目(主题邻居)
  // discoverMeta 同时供英雄区 chips(语言/主题):取不到不渲染,不许编
  const [statusFactsRaw, topicPeersRaw, metaRaw] = await Promise.all([
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
    // chips 是锦上添花:超时给 null,英雄区退化为纯文字(原样)
    withTimeout(readDiscoverMeta().then((m) => m.get(fullName) ?? null), 4500).catch(() => null),
  ])
  const statusFacts = unTimeout(statusFactsRaw)
  const topicPeers = unTimeout(topicPeersRaw)
  const repoMeta = unTimeout(metaRaw)

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

  // README 正文(与抽屉 API 共用 serveRepoDoc,评审五轮统一读序):
  // 目标语缓存 → 上游语言探测 → 上游失败时英文缓存降级;超时(上游内部预算外)按无文档处理
  const served = unTimeout(await withTimeout(serveRepoDoc(fullName, lang), 9000))
  const readmeHtml = served?.html ?? null

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
      repoMeta={repoMeta ? { language: repoMeta.language, topics: repoMeta.topics } : undefined}
    />
  )
}
