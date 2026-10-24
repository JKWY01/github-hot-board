'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { liveStrings } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'
import { fmtNum } from '@/lib/format'
import { BellIcon, ForkIcon, StarIcon } from './Icons'
import WatchBell, {
  readWatch,
  writeWatch,
  WATCH_EV,
  WATCH_CAP,
  type WatchEntry,
} from './watch-bell'

/** 关注页(纯本地):两组(你的项目 / 关注的项目),每行现查新鲜状态。
 *  delta = 本地 last-seen 与当次现查的星差("自上次访问 +N"),
 *  组内按 delta 排序 = 你的私人爬榜;不上传任何个人数据。 */

interface WatchStatus {
  fullName: string
  stars?: number
  forks?: number
  pushedAt?: string
  desc?: Record<string, string>
  rank?: number
  cutoff?: number
  missing?: boolean
  onBoard?: boolean
}

const SEEN_KEY = 'ghb.watch.seen.v1'
const PUSH_ENDPOINT_KEY = 'ghb.push.endpoint.v1'

function readSeen(): Record<string, { s: number; t: number }> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, { s: number; t: number }>) : {}
  } catch {
    return {}
  }
}

/** VAPID 公钥(base64url)→ PushManager 要的 Uint8Array(显式 ArrayBuffer,避开 TS5.7 泛型坑)。 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

async function postJson(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

export default function WatchClient({ locale, pushKey }: { locale: Locale; pushKey?: string }) {
  const strings = liveStrings(locale)
  const [ready, setReady] = useState(false)
  const [entries, setEntries] = useState<WatchEntry[]>([])
  const [status, setStatus] = useState<Record<string, WatchStatus>>({})
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  const [fetching, setFetching] = useState(false)
  const lastFetchKey = useRef('')

  /* ---- 跨线提醒(Web Push,可选):端点存本地,关注列表变化时静默续订 ---- */
  const [pushOn, setPushOn] = useState(false)
  const [pushBlocked, setPushBlocked] = useState(false)
  const pushBusyRef = useRef(false)

  useEffect(() => {
    if (!pushKey || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    void (async () => {
      const saved = localStorage.getItem(PUSH_ENDPOINT_KEY)
      if (!saved) return
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const sub = await reg?.pushManager.getSubscription()
        if (sub && sub.endpoint === saved) setPushOn(true)
        else localStorage.removeItem(PUSH_ENDPOINT_KEY)
      } catch {
        /* 隐私模式等:保持关 */
      }
    })()
  }, [pushKey])

  const togglePush = async () => {
    if (!pushKey || pushBusyRef.current) return
    pushBusyRef.current = true
    try {
      if (pushOn) {
        const endpoint = localStorage.getItem(PUSH_ENDPOINT_KEY)
        if (endpoint) await postJson('/api/push/unsubscribe', { endpoint })
        localStorage.removeItem(PUSH_ENDPOINT_KEY)
        try {
          const reg = await navigator.serviceWorker.getRegistration('/sw.js')
          await (await reg?.pushManager.getSubscription())?.unsubscribe()
        } catch {
          /* 退订失败不拦本地状态 */
        }
        setPushOn(false)
        return
      }
      if (typeof Notification === 'undefined' || (await Notification.requestPermission()) !== 'granted') {
        setPushBlocked(true)
        return
      }
      const reg = (await navigator.serviceWorker.getRegistration('/sw.js'))
        ?? (await navigator.serviceWorker.register('/sw.js'))
      const existing = await reg.pushManager.getSubscription()
      const sub = existing ?? (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushKey),
      }))
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
      const ok = await postJson('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        locale,
        repos: entries.map((e) => e.f),
      })
      if (!ok) {
        await sub.unsubscribe().catch(() => undefined)
        return
      }
      localStorage.setItem(PUSH_ENDPOINT_KEY, json.endpoint)
      setPushOn(true)
      setPushBlocked(false)
    } catch {
      /* 订阅链路任何失败:保持关,不抛错扰民 */
    } finally {
      pushBusyRef.current = false
    }
  }

  // 已开启后关注列表变化 → 3 秒静默续订(端点 upsert,服务器侧列表换新)
  useEffect(() => {
    if (!pushOn || entries.length === 0) return
    const t = setTimeout(() => {
      const endpoint = localStorage.getItem(PUSH_ENDPOINT_KEY)
      if (!endpoint) return
      void navigator.serviceWorker.getRegistration('/sw.js').then(async (reg) => {
        const sub = await reg?.pushManager.getSubscription()
        const json = sub?.toJSON()
        if (!json?.keys?.p256dh || !json.keys.auth) return
        await postJson('/api/push/subscribe', {
          endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          locale,
          repos: entries.map((e) => e.f),
        })
      })
    }, 3_000)
    return () => clearTimeout(t)
  }, [pushOn, entries, locale])

  useEffect(() => {
    const sync = () => setEntries(readWatch())
    sync()
    setReady(true)
    window.addEventListener(WATCH_EV, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(WATCH_EV, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!ready || entries.length === 0) return
    const fulls = entries.map((e) => e.f)
    const key = fulls.join(',')
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key
    let stale = false
    setFetching(true)
    fetch(`/api/watch?fulls=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((j: { ok: boolean; items?: WatchStatus[] }) => {
        if (stale) return
        setFetching(false)
        if (!j.ok) return
        const map: Record<string, WatchStatus> = {}
        for (const it of j.items ?? []) map[it.fullName] = it
        setStatus(map)
        // delta:对比本地 last-seen;写回当次星数作下次的基准
        const seen = readSeen()
        const nextDeltas: Record<string, number> = {}
        const nextSeen: Record<string, { s: number; t: number }> = { ...seen }
        for (const it of j.items ?? []) {
          if (typeof it.stars !== 'number') continue
          const prev = seen[it.fullName]
          if (prev && typeof prev.s === 'number') nextDeltas[it.fullName] = it.stars - prev.s
          nextSeen[it.fullName] = { s: it.stars, t: Date.now() }
        }
        setDeltas(nextDeltas)
        try {
          localStorage.setItem(SEEN_KEY, JSON.stringify(nextSeen))
        } catch {
          /* 隐私模式:放弃持久化,delta 照常显示一次 */
        }
      })
      .catch(() => {
        if (!stale) setFetching(false)
      })
    return () => {
      stale = true
    }
  }, [ready, entries])

  const describe = (d?: Record<string, string>) => d?.[locale] ?? d?.en ?? d?.__gh ?? null
  const rankChip = (st: WatchStatus): string | null => {
    if (st.rank !== undefined) return `#${st.rank}`
    if (st.stars !== undefined && st.cutoff !== undefined) return st.stars >= st.cutoff ? '500+?' : '500+'
    return null
  }
  const sortEntries = (list: WatchEntry[]) =>
    [...list].sort((a, b) => {
      const da = deltas[a.f]
      const db = deltas[b.f]
      const sa = status[a.f]?.stars ?? -1
      const sb = status[b.f]?.stars ?? -1
      if (da !== undefined || db !== undefined) return (db ?? -Infinity) - (da ?? -Infinity)
      return sb - sa
    })

  if (!ready) return <div className="py-16" />

  const groups: Array<{ tag: WatchEntry['t']; list: WatchEntry[]; other: WatchEntry['t']; label: string }> = [
    { tag: 'own', list: sortEntries(entries.filter((e) => e.t === 'own')), other: 'see', label: strings.watchOwn },
    { tag: 'see', list: sortEntries(entries.filter((e) => e.t === 'see')), other: 'own', label: strings.watchSee },
  ]

  return (
    <section className="mx-auto max-w-4xl px-5 pb-16 pt-10 sm:px-6">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">{strings.watchTitle}</h1>
      <p className="mt-2 text-[12.5px] text-sub">
        {strings.watchCap} · {strings.watchGone}
      </p>

      {/* 跨线提醒:仅在部署方配置了 VAPID 时出现;开启即把关注列表交给推送服务,关即刻删 */}
      {pushKey && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void togglePush()}
            aria-pressed={pushOn}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-colors ${
              pushOn ? 'bg-accent text-white' : 'border-[0.5px] border-black/15 bg-white text-ink/70 hover:border-ink hover:text-ink'
            }`}
          >
            <BellIcon size={13} filled={pushOn} />
            {strings.pushTitle} · {pushOn ? strings.pushOn : strings.pushOff}
          </button>
          {pushBlocked && <span className="text-[11.5px] text-bad">{strings.pushBlocked}</span>}
        </div>
      )}

      {ready && entries.length === 0 && (
        <div className="mt-10 rounded-[18px] border-[0.5px] border-black/10 bg-[#f8f8fa] px-5 py-8 text-center">
          <p className="text-[14px] text-ink/80">{strings.watchEmpty}</p>
          <Link
            href={`/${locale}/boards/overall`}
            className="mt-4 inline-flex rounded-full bg-ink px-4 py-1.5 text-[12.5px] text-white transition-opacity hover:opacity-80"
          >
            {strings.watchSee} →
          </Link>
        </div>
      )}

      {groups.map(
        (group) =>
          group.list.length > 0 && (
            <div key={group.tag} className="mt-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-sub">
                  {group.label} · {group.list.length}
                </h2>
                {fetching && <span className="text-[11px] text-sub">…</span>}
              </div>
              <ul className="overflow-hidden rounded-[18px] border-[0.5px] border-black/10 bg-surface">
                {group.list.map((e) => {
                  const st = status[e.f]
                  const delta = deltas[e.f]
                  const chip = st ? rankChip(st) : null
                  return (
                    <li key={e.f} className="border-b border-black/5 px-4 py-3 last:border-b-0 sm:px-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {st?.onBoard === false ? (
                              <a
                                href={`https://github.com/${e.f}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-[14px] font-semibold text-ink hover:underline"
                              >
                                {e.f}
                              </a>
                            ) : (
                              <Link
                                href={`/${locale}/repo/${e.f}`}
                                className="truncate text-[14px] font-semibold text-ink hover:underline"
                              >
                                {e.f}
                              </Link>
                            )}
                            {chip && (
                              <span className="shrink-0 rounded-full bg-black/8 px-2 py-0.5 text-[10.5px] tabular-nums text-ink/70">
                                {chip}
                              </span>
                            )}
                            {st?.missing && (
                              <span className="shrink-0 text-[11px] text-bad">{strings.watchGone}</span>
                            )}
                          </div>
                          {st && describe(st.desc) && (
                            <p className="mt-0.5 truncate text-[12px] text-sub">{describe(st.desc)}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2.5 text-[11.5px] tabular-nums text-sub">
                          {typeof st?.stars === 'number' && (
                            <span className="inline-flex items-center gap-1">
                              <StarIcon size={11} />
                              {fmtNum(st.stars, locale)}
                            </span>
                          )}
                          {typeof st?.forks === 'number' && st.forks > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ForkIcon size={11} />
                              {fmtNum(st.forks, locale)}
                            </span>
                          )}
                          {delta !== undefined && (
                            <span className={delta > 0 ? 'text-good' : 'text-sub'}>
                              {delta > 0 ? '+' : ''}
                              {fmtNum(delta, locale)}
                            </span>
                          )}
                          {delta !== undefined && (
                            <span className="hidden text-[10.5px] text-sub sm:inline">{strings.watchDelta}</span>
                          )}
                          <WatchBell
                            fullName={e.f}
                            locale={locale}
                            strings={{
                              ask: strings.watchAsk,
                              own: strings.watchOwn,
                              see: strings.watchSee,
                              cap: strings.watchCap,
                              on: strings.watchTitle,
                              list: strings.watchTitle,
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              writeWatch(entries.map((x) => (x.f === e.f ? { ...x, t: group.other } : x)))
                            }
                            className="rounded-full bg-black/6 px-2 py-0.5 text-[10.5px] text-ink/70 transition-colors hover:text-ink"
                          >
                            {group.other === 'own' ? strings.watchOwn : strings.watchSee}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ),
      )}
    </section>
  )
}
