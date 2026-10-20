import { fetchRepoDoc, fetchRepoReadme } from '@/lib/github'
import { isLocale } from '@/lib/locales'

/** 站内仓库页面接口:返回 GitHub 官方渲染好的 README HTML,给行点击抽屉用。
 * ?full=owner/name&lg=zh —— 首屏 README(站点语言协商,16 语;非法值回英文)
 * ?full=owner/name&path=docs/readme/README_zh.md —— 抽屉内就地翻页(语言切换/文档链) */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') ?? ''
  const lgRaw = url.searchParams.get('lg') ?? 'en'
  const locale = isLocale(lgRaw) ? lgRaw : 'en'
  const path = url.searchParams.get('path')
  const readme = path ? await fetchRepoDoc(full, path) : await fetchRepoReadme(full, locale)
  if (!readme) {
    return Response.json({ ok: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return Response.json({ ok: true, readme }, { headers: { 'Cache-Control': 'no-store' } })
}
