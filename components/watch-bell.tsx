'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

import { BellIcon } from './Icons'

/** 关注 v1:纯本地(localStorage),不登录、不上传、不同步 —— 成本与债务同时为零。
 *  铃铛交互:未关注时点击弹气泡,先问"你的项目还是想关注监控"(决定分组),
 *  选完就地给出关注页入口(列表在哪看);已关注时点击直接移除,不打扰。 */

export type WatchTag = 'own' | 'see'
export interface WatchEntry {
  f: string
  t: WatchTag
  at: number
}

const KEY = 'ghb.watch.v1'
export const WATCH_EV = 'ghb-watch'
export const WATCH_CAP = 20

export interface WatchBellStrings {
  /** 提问:你的项目,还是想关注监控? */
  ask: string
  own: string
  see: string
  cap: string
  on: string
  /** 关注页入口文案(列表在哪看) */
  list: string
}

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

const PANEL_W = 248
const PANEL_H = 148 // 估算高度,用于底部翻转

export default function WatchBell({
  fullName,
  locale,
  strings,
}: {
  fullName: string
  locale: string
  strings: WatchBellStrings
}) {
  const [on, setOn] = useState(false)
  const [atCap, setAtCap] = useState(false)
  // null = 关;ask = 问分组;added = 已加入 + 列表入口
  const [panel, setPanel] = useState<null | 'ask' | 'added'>(null)
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  // 气泡经 portal 挂到 body:榜单行 li 带 will-change-transform,会成为 fixed 后代的
  // 包含块 —— 不出 portal 的话"fixed"其实是相对行定位,渲染位置全错(实测踩中)。
  const panelRef = useRef<HTMLSpanElement>(null)

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

  // 气泡开着时:点外部 / Esc / 滚动 都收起(滚动会让 fixed 定位失锚)
  useEffect(() => {
    if (!panel) return
    const close = () => setPanel(null)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // 只挂窗口级滚动(非捕获):捕获阶段会把任何元素内部的合成滚动也当关团信号,
    // 无障碍定位/聚焦微滚动会让气泡"秒关"(浏览器自动化实测踩中,真实用户同样可能中招)
    window.addEventListener('scroll', close, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close)
    }
  }, [panel])

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ top: r.bottom, left: r.left })
    setPanel('ask')
  }

  const click = () => {
    const cur = readWatch()
    if (cur.some((e) => e.f === fullName)) {
      writeWatch(cur.filter((e) => e.f !== fullName))
      setPanel(null)
      return
    }
    openPanel()
  }

  const pick = (t: WatchTag) => {
    const cur = readWatch()
    if (cur.length >= WATCH_CAP) return
    writeWatch([...cur, { f: fullName, t, at: Date.now() }])
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ top: r.bottom, left: r.left })
    setPanel('added')
  }

  // 底部放不下就往上翻
  const flip = rect !== null && rect.top + PANEL_H > (typeof window === 'undefined' ? 1e9 : window.innerHeight)
  const style: React.CSSProperties | undefined = rect
    ? {
        position: 'fixed',
        top: flip ? undefined : rect.top + 6,
        bottom: flip ? Math.max(8, (typeof window === 'undefined' ? 0 : window.innerHeight) - rect.top + 6) : undefined,
        left: Math.max(8, Math.min(rect.left, (typeof window === 'undefined' ? 1e9 : window.innerWidth) - PANEL_W - 8)),
        width: PANEL_W,
      }
    : undefined

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={click}
        aria-pressed={on}
        aria-haspopup="dialog"
        aria-expanded={panel !== null}
        aria-label={`watch ${fullName}`}
        title={atCap ? strings.cap : on ? strings.on : undefined}
        // SSR 首画一律描边(本地状态水合后才亮)——不给爬虫造态
        className={`flex h-7 w-7 items-center justify-center rounded-full border-[0.5px] transition-colors hover:bg-ink hover:text-white ${
          on ? 'border-accent text-accent hover:border-ink' : 'border-black/15 text-ink/65 hover:border-ink'
        }`}
      >
        <BellIcon size={13} filled={on} />
      </button>

      {panel && rect && style && createPortal(
        <span
          ref={panelRef}
          role="dialog"
          aria-label={strings.ask}
          style={style}
          className="z-[95] block rounded-2xl border-[0.5px] border-black/10 bg-white px-3.5 py-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
        >
          {panel === 'ask' && !atCap && (
            <>
              <span className="block text-[12px] font-semibold leading-snug text-ink">{strings.ask}</span>
              <span className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => pick('own')}
                  className="flex-1 rounded-full bg-black/6 px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-black/12"
                >
                  {strings.own}
                </button>
                <button
                  type="button"
                  onClick={() => pick('see')}
                  className="flex-1 rounded-full bg-black/6 px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-black/12"
                >
                  {strings.see}
                </button>
              </span>
            </>
          )}
          {panel === 'ask' && atCap && (
            <span className="block text-[12px] leading-snug text-bad">{strings.cap}</span>
          )}
          {panel === 'added' && (
            <>
              <span className="block text-[12px] font-semibold text-good">✓ {strings.on}</span>
              <Link
                href={`/${locale}/watch`}
                onClick={() => setPanel(null)}
                className="mt-1.5 inline-block text-[12.5px] font-medium text-accent-strong hover:underline"
              >
                {strings.list} →
              </Link>
            </>
          )}
        </span>,
        document.body,
      )}
    </span>
  )
}
