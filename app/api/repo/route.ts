import { fetchRepoInfo } from '@/lib/github'

/** 站内仓库档案接口(?full=owner/name)。给行点击抽屉用,默认不出站。 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') ?? ''
  const info = await fetchRepoInfo(full)
  if (!info) {
    return Response.json({ ok: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return Response.json({ ok: true, repo: info }, { headers: { 'Cache-Control': 'no-store' } })
}
