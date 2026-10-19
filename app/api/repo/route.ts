import { fetchRepoReadme } from '@/lib/github'

/** 站内仓库页面接口(?full=owner/name):返回 GitHub 官方渲染好的 README HTML,给行点击抽屉用。 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') ?? ''
  const readme = await fetchRepoReadme(full)
  if (!readme) {
    return Response.json({ ok: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return Response.json({ ok: true, readme }, { headers: { 'Cache-Control': 'no-store' } })
}
