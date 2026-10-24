'use client'

import { useEffect, useState } from 'react'
import { BellIcon } from './Icons'

/** 关注 v1:纯本地(localStorage),不登录、不上传、不同步 —— 成本与债务同时为零。
 *  改组的意图变化都在 watch 页发生;铃铛只负责加入/移除。 */

export type WatchTag = 'own' | 'see'
export interface WatchEntry {
  f: string
  t: WatchTag
  at: number
}

const KEY = 'ghb.watch.v1'
export const WATCH_EV = 'ghb-watch'
export const WATCH_CAP = 20

export function readWatch(): WatchEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is WatchEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as WatchEntry).f === 'string' &&
        ((e as WatchEntry).t === 'own' || (e as WatchEntry).t === 'see'),
    )
  } catch {
    return []
  }
}

export function writeWatch(next: WatchEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, WATCH_CAP)))
  } catch {
    /* 隐私模式/配额:静默放弃 */
  }
  window.dispatchEvent(new CustomEvent(WATCH_EV))
}

export default function WatchBell({
  fullName,
  states,
}: {
  fullName: string
  /** “已关注/最多 20 个”等可用提示,来自字典;不给就退英文静默词 */
  states?: { cap?: string; on?: string }
}) {
  const [on, setOn] = useState(false)
  const [atCap, setAtCap] = useState(false)

  useEffect(() => {
    const sync = () => {
      const cur = readWatch()
      setOn(cur.some((e) => e.f === fullName))
      setAtCap(!cur.some((e) => e.f === fullName) && cur.length >= WATCH_CAP)
    }
    sync()
    window.addEventListener(WATCH_EV, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(WATCH_EV, sync)
      window.removeEventListener('storage', sync)
    }
  }, [fullName])

  const toggle = () => {
    const cur = readWatch()
    if (cur.some((e) => e.f === fullName)) {
      writeWatch(cur.filter((e) => e.f !== fullName))
      return
    }
    if (cur.length >= WATCH_CAP) return // 截满:铃铛不再收款,提示在 title
    writeWatch([...cur, { f: fullName, t: 'see', at: Date.now() }])
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={`watch ${fullName}`}
      title={atCap ? states?.cap : on ? (states?.on ?? 'watching') : undefined}
      // SSR 首画一律描边(本地状态水合后才亮)——不给爬虫造态
      className={`flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] transition-colors hover:bg-ink hover:text-white ${
        on ? 'border-accent text-accent hover:border-ink' : 'border-black/15 text-ink/65 hover:border-ink'
      }`}
    >
      <BellIcon size={15} filled={on} />
    </button>
  )
}
