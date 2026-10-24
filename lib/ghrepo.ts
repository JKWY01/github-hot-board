/** GitHub /repos 单仓现查(带 token 池轮换)。
 *  search 精确查与 watch 状态页共用;core API 便宜(5000/h/枚), pérdida可控。 */

const TOKENS = (process.env.GITHUB_TOKENS ?? process.env.GITHUB_TOKEN ?? '')
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean)
let tokenAt = 0

export interface GhRepoSnapshot {
  stars: number
  forks: number
  desc?: string
  pushedAt?: string
}

export async function ghRepo(full: string): Promise<GhRepoSnapshot | null> {
  if (!TOKENS.length) return null
  for (let attempt = 0; attempt < Math.min(3, TOKENS.length); attempt++) {
    const token = TOKENS[tokenAt++ % TOKENS.length]
    try {
      const res = await fetch(`https://api.github.com/repos/${full}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'ghb-hot-board',
        },
        cache: 'no-store',
      })
      if (res.ok) {
        const j = (await res.json()) as {
          stargazers_count?: number
          forks_count?: number
          description?: string
          pushed_at?: string
        }
        return {
          stars: j.stargazers_count ?? 0,
          forks: j.forks_count ?? 0,
          desc: typeof j.description === 'string' && j.description ? j.description : undefined,
          pushedAt: j.pushed_at,
        }
      }
      if (res.status === 404) return null
      // 403/429:轮换池里下一枚再试
    } catch {
      // 网络抖动:下一枚
    }
  }
  return null
}

/** deep 兜底:不走 quotaSlot(那是同步主路的全局节流档,排队能把请求拖到 40s),
 *  自带 6s 预算直打 Search API;被限流/超时就回空,前端给"没搜到"。
 *  频率护栏已在上游:每 IP 滑窗 15/min。 */
const DEEP_TIMEOUT_MS = 6_000
export interface DeepRepo {
  fullName: string
  stars: number
  forks: number
  desc: string | null
  pushedAt: string
}
export async function searchReposByName(term: string): Promise<DeepRepo[]> {
  if (!TOKENS.length) return []
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${term} in:name`)}&sort=stars&order=desc&per_page=6`
  for (let i = 0; i < Math.min(3, TOKENS.length); i++) {
    const token = TOKENS[tokenAt++ % TOKENS.length]
    try {
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'ghb-hot-board',
        },
        signal: AbortSignal.timeout(DEEP_TIMEOUT_MS),
        cache: 'no-store',
      })
      if (!res.ok) continue // 403/429 换池里下一枚
      const j = (await res.json()) as {
        items?: Array<{ full_name: string; stargazers_count?: number; forks_count?: number; description?: string | null; pushed_at?: string }>
      }
      return (j.items ?? []).slice(0, 6).map((it) => ({
        fullName: it.full_name,
        stars: it.stargazers_count ?? 0,
        forks: it.forks_count ?? 0,
        desc: typeof it.description === 'string' && it.description ? it.description : null,
        pushedAt: it.pushed_at ?? '',
      }))
    } catch {
      // 超时/网络:下一枚
    }
  }
  return []
}
