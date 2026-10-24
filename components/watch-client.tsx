'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { liveStrings } from '@/app/[lang]/dictionaries'
import type { Locale } from '@/lib/types'
import { fmtNum } from '@/lib/format'
import { ForkIcon, StarIcon } from './Icons'
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
}

const SEEN_KEY = 'ghb.watch.seen.v1'

function readSeen(): Record<string, { s: number; t: number }> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, { s: number; t: number }>) : {}
  } catch {
    return {}
  }
}

export default function WatchClient({ locale }: { locale: Locale }) {
  const strings = liveStrings(locale)
  const [ready, setReady] = useState(false)
  const [entries, setEntries] = useState<WatchEntry[]>([])
  const [status, setStatus] = useState<Record<string, WatchStatus>>({})
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  const [fetching, setFetching] = useState(false)
  const lastFetchKey = useRef('')

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
    if (st.stars !== undefined && st.cutoff !== undefined) return st.stars >= st.cutoff ? '300+?' : '300+'
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
                            <Link
                              href={`/${locale}/repo/${e.f}`}
                              className="truncate text-[14px] font-semibold text-ink hover:underline"
                            >
                              {e.f}
                            </Link>
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
                          <WatchBell fullName={e.f} states={{ cap: strings.watchCap, on: strings.watchTitle }} />
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
