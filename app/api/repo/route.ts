import { fetchRepoDoc, fetchRepoReadme } from '@/lib/github'
import { isLocale } from '@/lib/locales'
import { borrowRepoDocFetch, readRepoDoc } from '@/lib/repodocs'

/** 站内仓库页面接口:返回 GitHub 官方渲染好的 README HTML,给行点击抽屉用。
 * ?full=owner/name&lg=zh —— 首屏 README(站点语言协商,16 语;非法值回英文)
 * ?full=owner/name&path=docs/readme/README_zh.md —— 抽屉内就地翻页(语言切换/文档链)
 *
 * 首屏路径走 repo_docs 持久缓存(与档案页共用):命中零上游直出;
 * 未命中单飞实弹取一次并写后路入库 —— 并发同仓的后来者共享同一发,不重复打 GitHub。
 * 翻页路径(任意 .md)是文档级长尾,维持直连 + Next 服务端缓存语义。 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') ?? ''
  const lgRaw = url.searchParams.get('lg') ?? 'en'
  const locale = isLocale(lgRaw) ? lgRaw : 'en'
  const path = url.searchParams.get('path')

  if (path) {
    const readme = await fetchRepoDoc(full, path)
    if (!readme) {
      return Response.json({ ok: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    return Response.json({ ok: true, readme }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const cached = await readRepoDoc(full, locale)
  if (cached) {
    return Response.json({ ok: true, readme: cached, cached: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const readme = await borrowRepoDocFetch(full, locale, () => fetchRepoReadme(full, locale))
  if (!readme) {
    return Response.json({ ok: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return Response.json({ ok: true, readme }, { headers: { 'Cache-Control': 'no-store' } })
}
