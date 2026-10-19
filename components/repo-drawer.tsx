'use client'

import { useEffect, useRef, useState } from 'react'

import type { BoardItem } from '@/lib/types'
import type { LiveStrings } from './LiveBoardList'

interface RepoInfo {
  fullName: string
  htmlUrl: string
  avatarUrl: string | null
  description: string | null
  stars: number
  forks: number
  issues: number
  watchers: number
  language: string | null
  topics: string[]
  createdAt: string | null
  pushedAt: string | null
  homepage: string | null
  license: string | null
}

const nf = new Intl.NumberFormat('en-US')

/** 行点击 → 站内抽屉:桌面右滑、移动底弹,开着的抽屉不挡身后的榜单照常翻新。
 * 立即用列表已知的数字打底,REST 档案随后补齐(关注数 / topics / 许可证等)。
 * 进出场变换自绘(rAF 两段式),不依赖任何 animate 插件;respect prefers-reduced-motion。 */
export default function RepoDrawer({
  fullName,
  item,
  rank,
  total,
  locale,
  strings,
  open,
  onClose,
  onPrev,
  onNext,
}: {
  fullName: string
  item: BoardItem | undefined
  rank: number
  total: number
  locale: string
  strings: LiveStrings
  open: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const drawer = strings.drawer
  const [info, setInfo] = useState<RepoInfo | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>('loading')
  const cacheRef = useRef(new Map<string, RepoInfo>())
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const cached = cacheRef.current.get(fullName)
    if (cached) {
      setInfo(cached)
      setState('ok')
      return
    }
    setInfo(null)
    setState('loading')
    const controller = new AbortController()
    fetch(`/api/repo?full=${encodeURIComponent(fullName)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const repo = j?.repo as RepoInfo | undefined
        if (repo) {
          cacheRef.current.set(fullName, repo)
          setInfo(repo)
          setState('ok')
        } else {
          setState('fail')
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('fail')
      })
    return () => controller.abort()
  }, [fullName])

  useEffect(() => {
    closeBtnRef.current?.focus()
    // 仅首次挂载聚焦;换仓/轮询重渲染不抢焦点
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  if (!item) return null

  const shown = open && entered
  const stars = info?.stars ?? item.stars
  const forks = info?.forks ?? item.forks
  const issues = info?.issues ?? item.issues
  const language = info?.language ?? item.language
  const description = info?.description ?? item.desc
  const loaded = state === 'ok'

  const gridCell = (label: string, value: number | '--', accent = false) => (
    <div className="rounded-2xl border-[0.5px] border-black/8 bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-sub">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${accent ? 'text-accent-strong' : 'text-ink'}`}>
        {typeof value === 'number' ? nf.format(value) : <span className="text-ink/30">{value}</span>}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={drawer.title}>
      <button
        type="button"
        aria-label={drawer.close}
        onClick={onClose}
        tabIndex={-1}
        className={`absolute inset-0 h-full w-full cursor-default bg-ink/25 ${shown ? 'opacity-100' : 'opacity-0'} motion-safe:transition-opacity motion-safe:duration-300`}
      />
      <aside
        aria-hidden={!shown}
        className={`absolute inset-y-0 right-0 flex w-[min(480px,94vw)] flex-col bg-white shadow-[0_0_60px_rgba(0,0,0,0.18)] max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[86dvh] max-sm:w-full max-sm:rounded-t-[22px] ${
          shown ? 'translate-x-0 max-sm:translate-y-0' : 'translate-x-full max-sm:translate-y-full'
        } motion-safe:transition-transform motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]`}
      >
        <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-black/8 px-5 py-3">
          <span className="rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white">
            {drawer.rank} {rank} / {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={rank <= 1}
              aria-label={drawer.prev}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink/60 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-35"
            >
              ← {drawer.prev}
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={rank >= total}
              aria-label={drawer.next}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink/60 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-35"
            >
              {drawer.next} →
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label={drawer.close}
              className="ml-1 grid h-8 w-8 place-items-center rounded-full text-ink/70 transition-colors hover:bg-black/5 hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {state === 'loading' && (
            <p className="text-[12.5px] text-sub" role="status">
              {drawer.loading}
            </p>
          )}
          {state === 'fail' && (
            <p className="mb-3 rounded-2xl border-[0.5px] border-black/10 bg-[#fff8e6] px-3.5 py-2 text-[12px] text-bad" role="status">
              {drawer.fail}
            </p>
          )}

          <div className="flex items-start gap-3">
            {(info?.avatarUrl ?? item.avatarUrl) && (
              <img
                src={(info?.avatarUrl ?? item.avatarUrl) as string}
                alt=""
                width={46}
                height={46}
                loading="lazy"
                decoding="async"
                className="h-[46px] w-[46px] shrink-0 rounded-full border-[0.5px] border-black/8 bg-surface object-cover"
              />
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold tracking-tight text-ink">{fullName}</h2>
              {language && <p className="mt-0.5 text-[12.5px] text-sub">{language}</p>}
            </div>
          </div>

          {description && <p className="mt-3 text-[13.5px] leading-relaxed text-ink/75">{description}</p>}

          <a
            href={item.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-black/[0.045] px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-black/[0.07] hover:text-accent-strong"
          >
            {drawer.open}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 8L8 2M8 2H3.5M8 2v4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            {gridCell('Stars', stars, true)}
            {gridCell('Forks', forks)}
            {gridCell('Issues', issues)}
            {gridCell(drawer.watchers, loaded && info ? info.watchers : '--')}
          </div>

          {loaded && info && info.topics.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {info.topics.map((t) => (
                <span key={t} className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[11.5px] text-ink/65">
                  {t}
                </span>
              ))}
            </div>
          )}

          {loaded && info && (
            <dl className="mt-5 space-y-2 text-[12.5px] text-ink/70">
              {info.createdAt && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">{drawer.created}</dt>
                  <dd className="tabular-nums">{fmtDate(info.createdAt, locale)}</dd>
                </div>
              )}
              {info.pushedAt && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">{drawer.pushed}</dt>
                  <dd className="tabular-nums">{fmtDate(info.pushedAt, locale)}</dd>
                </div>
              )}
              {info.license && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">{drawer.license}</dt>
                  <dd className="font-medium text-ink">{info.license}</dd>
                </div>
              )}
              {info.homepage && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">{drawer.homepage}</dt>
                  <dd className="truncate">
                    <a href={info.homepage} target="_blank" rel="noopener noreferrer" className="text-accent-strong hover:underline">
                      {info.homepage.replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          )}

          <p className="mt-6 border-t-[0.5px] border-black/6 pt-3 text-[11.5px] leading-relaxed text-ink/40">{drawer.cached}</p>
        </div>
      </aside>
    </div>
  )
}

function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d)
}
