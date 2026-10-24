import { withDb } from './snapshot'
import { MILESTONE_THRESHOLDS } from './boards'
import { isLocale, type Locale } from './locales'

/** Web Push 跨线提醒(无账号,可选部署)。
 *
 * 隐私口径:不建用户体系。订阅只存浏览器推送端点 + 它声明的关注列表 + 界面语言,
 * 任何时刻可在关注页一键退订(端点即刻删除)。VAPID 密钥未配置时全链路静默跳过
 * (与 INDEXNOW_KEY/BAIDU_PUSH_URL 同款"可选环境变量"模式)。
 *
 * 触发口径:同步尾部跑。每个订阅按 board_snapshots 最近一拍(3 天窗口)读关注仓库
 * 的星数,与该订阅上次记录的 state 对比,向上跨过 1k/10k/50k/100k 才推;
 * 首次见到某仓库只记基线不推(避免订阅瞬间打扰)。 */

const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY ?? '').trim()
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY ?? '').trim()
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT ?? 'mailto:ops@localhost').trim()

export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE)
}

/** 纯函数:向上跨过了哪些档(可单测)。 */
export function crossedThresholds(prev: number | undefined, now: number): number[] {
  if (prev === undefined || !Number.isFinite(prev) || now <= prev) return []
  return MILESTONE_THRESHOLDS.filter((t) => prev < t && now >= t)
}

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  locale: string
  repos: string[]
}

async function ensureTable(sql: import('postgres').Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS push_sub (
      endpoint   TEXT PRIMARY KEY,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      locale     TEXT NOT NULL DEFAULT 'en',
      repos      JSONB NOT NULL DEFAULT '[]'::jsonb,
      state      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
}

export async function saveSubscription(sub: PushSubscriptionInput): Promise<boolean> {
  return (await withDb(async (sql) => {
    await ensureTable(sql)
    await sql`
      INSERT INTO push_sub (endpoint, p256dh, auth, locale, repos, updated_at)
      VALUES (${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${sub.locale},
              ${sql.json(sub.repos as unknown as Parameters<typeof sql.json>[0])}, now())
      ON CONFLICT (endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, locale = EXCLUDED.locale,
        repos = EXCLUDED.repos, updated_at = now()`
    return true
  })) ?? false
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await withDb(async (sql) => {
    await ensureTable(sql)
    await sql`DELETE FROM push_sub WHERE endpoint = ${endpoint}`
  })
}

/** 各语言推送文案(zh 之外先覆盖大语种,其余回落英文;文案短,不值得进 16 语字典)。 */
function pushText(locale: string, repo: string, threshold: number): { title: string; body: string } {
  const t = threshold.toLocaleString('en-US')
  switch (locale) {
    case 'zh':
      return { title: `${repo} 破 ${t} 星`, body: '刚跨过里程碑大关,去档案页看走势 →' }
    case 'zh-TW':
      return { title: `${repo} 突破 ${t} 星`, body: '剛跨過里程碑大關,去檔案頁看走勢 →' }
    case 'ja':
      return { title: `${repo} が ${t} スター到達`, body: 'マイルストーンを通過 — アーカイブで推移を見る →' }
    case 'ko':
      return { title: `${repo} ${t} 스타 돌파`, body: '마일스톤 통과 — 아카이브에서 추이 보기 →' }
    case 'ru':
      return { title: `${repo}: ${t} звёзд`, body: 'Рубеж пройден — открыть архив →' }
    default:
      return { title: `${repo} crossed ${t} stars`, body: 'Milestone reached — open the archive →' }
  }
}

const MAX_SENDS_PER_ROUND = 300

/** 同步尾部调用:逐订阅对账跨线并发推。返回统计(未配置/无订阅时零成本)。 */
export async function sendMilestonePushes(): Promise<{ subs: number; sent: number; removed: number }> {
  const stat = { subs: 0, sent: 0, removed: 0 }
  if (!pushConfigured()) return stat
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')

  const subs = (await withDb(async (sql) => {
    await ensureTable(sql)
    const rows = await sql`
      SELECT endpoint, p256dh, auth, locale, repos, state FROM push_sub
      WHERE updated_at > now() - interval '180 days'
      LIMIT 500`
    return rows as unknown as Array<{
      endpoint: string; p256dh: string; auth: string; locale: string
      repos: string[]; state: Record<string, number>
    }>
  })) ?? []
  if (subs.length === 0) return stat

  // 关注仓库的最近星数(全订阅合并一次查;3 天窗口内无拍的仓库视为无新数据)
  const allRepos = [...new Set(subs.flatMap((s) => (Array.isArray(s.repos) ? s.repos : [])))]
  const starsByRepo = new Map<string, number>()
  if (allRepos.length > 0) {
    await withDb(async (sql) => {
      const rows = await sql`
        SELECT DISTINCT ON (repo) repo, stars
        FROM board_snapshots
        WHERE repo = ANY(${allRepos}) AND taken_at > now() - interval '3 days'
        ORDER BY repo, taken_at DESC`
      for (const r of rows as unknown as Array<{ repo: string; stars: number | string }>) {
        starsByRepo.set(r.repo, Number(r.stars))
      }
    })
  }

  const webpush = (await import('web-push')).default
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  for (const sub of subs) {
    stat.subs += 1
    const state: Record<string, number> = { ...(sub.state ?? {}) }
    const repos = Array.isArray(sub.repos) ? sub.repos : []
    let subChanged = false
    let subRemoved = false

    for (const repo of repos) {
      const stars = starsByRepo.get(repo)
      if (stars === undefined) continue
      const prev = state[repo]
      const crossed = crossedThresholds(prev, stars)
      state[repo] = stars
      subChanged = true
      if (crossed.length === 0 || stat.sent >= MAX_SENDS_PER_ROUND) continue

      const threshold = crossed[crossed.length - 1]!
      const locale: Locale = isLocale(sub.locale) ? sub.locale : 'en'
      const text = pushText(locale, repo, threshold)
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            ...text,
            tag: `${repo}:${threshold}`,
            url: `${base}/${locale}/repo/${repo}`,
          }),
        )
        stat.sent += 1
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // 端点已失效(用户清了站点数据/浏览器换代):即刻除名
          await removeSubscription(sub.endpoint).catch(() => undefined)
          stat.removed += 1
          subRemoved = true
          break
        }
        // 其他错误(推送服务抖动):本订阅本轮放弃,下轮再试
        break
      }
    }

    if (!subRemoved && subChanged) {
      await withDb(async (sql) => {
        await sql`UPDATE push_sub SET state = ${sql.json(state as unknown as Parameters<typeof sql.json>[0])}, updated_at = now() WHERE endpoint = ${sub.endpoint}`
      }).catch(() => undefined)
    }
  }
  return stat
}
