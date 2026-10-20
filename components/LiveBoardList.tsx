'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'

import type { BoardItem, Locale, LivePatch } from '@/lib/types'
import { fmtAgo, fmtDay, fmtNum, fmtSlope, fmtSigned } from '@/lib/format'
import CountUp from './CountUp'
import RepoDrawer from './repo-drawer'
import { ArrowDownIcon, ArrowUpIcon, ArchiveIcon, ClockIcon, ForkIcon, GithubIcon, IssueIcon, StarIcon } from './Icons'
import { celebrateBurst } from './celebrate'

export type LiveStrings = Awaited<ReturnType<typeof import('@/app/[lang]/dictionaries').liveStrings>>

export interface LiveBoardListProps {
  slug: string
  locale: Locale
  currentLanguage?: string
  initialItems: BoardItem[]
  initialGeneratedAt: string
  initialDegraded?: boolean
  metric: 'stars' | 'gained' | 'slope' | 'forks' | 'score' | 'gap'
  metricLabel: string
  metricHint: string
  secondary: 'none' | 'stars' | 'forks'
  showSlope?: boolean
  showIssues?: boolean
  showPushed?: boolean
  limit?: number
  compact?: boolean
  variant?: 'default' | 'milestone'
  pollMs?: number
  strings: LiveStrings
}

interface RowFlag {
  kind: 'up' | 'down'
  delta: number
}

const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

export default function LiveBoardList({
  slug,
  locale,
  currentLanguage,
  initialItems,
  initialGeneratedAt,
  initialDegraded,
  metric,
  metricLabel,
  metricHint,
  secondary = 'none',
  showSlope = false,
  showIssues = false,
  showPushed = false,
  limit,
  compact = false,
  variant = 'default',
  pollMs = 60_000,
  strings,
}: LiveBoardListProps) {
  const [items, setItems] = useState<BoardItem[]>(limit ? initialItems.slice(0, limit) : initialItems)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [degraded, setDegraded] = useState(Boolean(initialDegraded))
  const [stale, setStale] = useState(false)
  const [flags, setFlags] = useState<Record<string, RowFlag>>({})
  const [toasts, setToasts] = useState<Array<{ id: number; title: string; sub: string }>>([])

  const rowElsRef = useRef(new Map<string, HTMLLIElement>())
  // "x 天前"要拿墙钟当前时刻,预渲染期读 Date.now() 会让构建直接 fail——
  // 挂水合后自填一次锚点(poll 到新数据时也刷新),首帧先画 '--'
  const [nowAnchor, setNowAnchor] = useState(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  // #r=owner/name:仓库档案页"跳转到榜"的锚。数据在客户端撑出来(轮询流),
  // 浏览器原生 hash 跳转对不上动态行 —— 数据到货后自己滚动到目标行并划光一次。
  const locateRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (locateRef.current === undefined) {
      const m = window.location.hash.match(/^#r=([^&]+)/)
      locateRef.current = m ? decodeURIComponent(m[1]) : null
    }
  }, [])
  useEffect(() => {
    setNowAnchor(Date.now())
  }, [items])
  useEffect(() => {
    const target = locateRef.current
    if (!target || items.length === 0) return
    const el = rowElsRef.current.get(target)
    if (!el) return // 不在当前页面上限内的名次不滚,保持诚实
    locateRef.current = null
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // 客户端导航后 Next 会先做自己的滚动处理(hash 目标不存在时回顶),
    // 延迟一拍再定位,避免被 Next 的 scroll 覆盖。
    const scrollTimer = window.setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    }, 180)
    // 1s 后再校准一次:轮询换拍会改行高,首跳可能停在偏差位置
    const reassertTimer = window.setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    }, 1000)
    el.classList.add('row-locate')
    const flashTimer = window.setTimeout(() => el.classList.remove('row-locate'), 2800)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(reassertTimer)
      window.clearTimeout(flashTimer)
      el.classList.remove('row-locate')
    }
  }, [items])
  const pendingRef = useRef<{
    order: Map<string, number>
    rects: Map<string, number>
    stars: Map<string, number>
  } | null>(null)
  const lastPollRef = useRef(0)
  const toastSeq = useRef(0)
  /** 当前展示中的生成批 id:它决定 60s 轮询是否重算 FLIP/爬降标志。 */
  const genRef = useRef(initialGeneratedAt)

  /* ------------------------------- 轮询 ------------------------------- */

  const busyRef = useRef(false)

  const poll = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const params = new URLSearchParams()
      if (currentLanguage) params.set('language', currentLanguage)
      // 站点语言随请求带上:服务端按视角合并 descLng 并在后台补齐缺口
      params.set('lg', locale)
      const query = params.size > 0 ? `?${params.toString()}` : ''
      const res = await fetch(`/api/boards/${slug}${query}`, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      lastPollRef.current = Date.now()
      if (!res.ok) {
        setStale(true)
        return
      }
      const patch = (await res.json()) as LivePatch
      if (patch.error || !Array.isArray(patch.items)) {
        setStale(true)
        return
      }

      // 同一生成批(数据自上次同步未变):只刷新描述等字段;不重算 FLIP/标志,
      // 上一批的爬/降标志保持原样 —— 用户在每个周期内都能看到上一轮同步的搬运。
      if (patch.generatedAt === genRef.current) {
        const next = limit ? patch.items.slice(0, limit) : patch.items
        pendingRef.current = null
        setItems(next)
        setDegraded(Boolean(patch.degraded))
        setStale(false)
        return
      }

      // 新生成批(= 同步改写过榜单):拍快照做 FLIP;
      // 排序基准 = 上一生成批的定妆序,所以标志描述的是这轮同步带来的爬/掉榜。
      const rects = new Map<string, number>()
      const order = new Map<string, number>()
      const prevStars = new Map<string, number>()
      itemsRef.current.forEach((item, index) => {
        order.set(item.fullName, index)
        const el = rowElsRef.current.get(item.fullName)
        if (el) rects.set(item.fullName, el.getBoundingClientRect().top)
        prevStars.set(item.fullName, item.stars)
      })
      pendingRef.current = { order, rects, stars: prevStars }
      genRef.current = patch.generatedAt

      const next = limit ? patch.items.slice(0, limit) : patch.items
      setItems(next)
      setGeneratedAt(patch.generatedAt)
      setDegraded(Boolean(patch.degraded))
      setStale(false)
    } catch {
      setStale(true)
    } finally {
      busyRef.current = false
    }
  }, [slug, currentLanguage, limit])

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void poll()
    }
    const interval = window.setInterval(tick, pollMs)
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPollRef.current > 10_000) {
        tick()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll, pollMs])

  /* ---------------------------- FLIP + 庆祝 ---------------------------- */

  const pushToast = useCallback((title: string, sub: string) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((prev) => [{ id, title, sub }, ...prev].slice(0, 2))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4600)
  }, [])

  useLayoutEffect(() => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const nextFlags: Record<string, RowFlag> = {}
    const bursts: Array<() => void> = []

    items.forEach((item, index) => {
      const name = item.fullName
      const el = rowElsRef.current.get(name)
      const prevOrder = pending.order.get(name)
      const prevStars = pending.stars.get(name)

      if (prevOrder !== undefined && prevOrder !== index) {
        const delta = prevOrder - index
        nextFlags[name] = delta > 0 ? { kind: 'up', delta } : { kind: 'down', delta: -delta }
      }

      // 里程碑跨线庆祝
      if (variant === 'milestone' && item.milestoneTarget && prevStars !== undefined) {
        const target = item.milestoneTarget
        if (prevStars < target && item.stars >= target) {
          bursts.push(() => {
            celebrateBurst(el?.getBoundingClientRect() ?? null, 1.4)
            pushToast(
              `${strings.toastPrefix} ${item.fullName}`,
              `${fmtNum(target, locale)} ${strings.toastSuffix} · ${strings.crossedLabel}`,
            )
          })
        }
      }

      // 普通榜：冲进前三时来一发小庆祝
      if (variant === 'default' && prevOrder !== undefined && prevOrder > 2 && index <= 2) {
        if (!reduce) {
          bursts.push(() => {
            celebrateBurst(el?.getBoundingClientRect() ?? null, 1)
          })
        }
      }

      if (el && !reduce) {
        const oldTop = pending.rects.get(name)
        if (oldTop !== undefined) {
          const dy = oldTop - el.getBoundingClientRect().top
          if (dy !== 0) {
            el.style.transition = 'none'
            el.style.transform = `translateY(${dy}px)`
            void el.getBoundingClientRect()
            requestAnimationFrame(() => {
              el.style.transition = `transform 700ms ${FLIP_EASING}`
              el.style.transform = ''
            })
            const cleanup = () => {
              el.style.transition = ''
              el.removeEventListener('transitionend', cleanup)
            }
            el.addEventListener('transitionend', cleanup)
          }
        }
      }
    })

    setFlags(nextFlags)
    for (const burst of bursts) burst()
  }, [items, variant, locale, strings, pushToast])

  /* ------------------------------- 渲染 ------------------------------- */

  const formatPrimary = useCallback(
    (n: number): string => {
      switch (metric) {
        case 'gained':
          return fmtSigned(n, locale)
        case 'slope':
          return fmtSlope(n)
        case 'score':
          return n.toFixed(2)
        case 'gap':
          return fmtNum(Math.max(0, n), locale)
        default:
          return fmtNum(n, locale)
      }
    },
    [metric, locale],
  )

  const primaryOf = useCallback(
    (item: BoardItem): number => {
      switch (metric) {
        case 'gained':
          return Math.abs(item.gained ?? 0)
        case 'slope':
          return item.slope ?? 0
        case 'score':
          return item.score ?? 0
        case 'gap':
          return Math.max(0, (item.milestoneTarget ?? 0) - item.stars)
        case 'forks':
          return item.forks
        default:
          return item.stars
      }
    },
    [metric],
  )

  const primaryUsesCountUp = metric === 'stars' || metric === 'forks' || metric === 'gap'

  /* 点行抽屉:开着的抽屉不挡 60 秒轮询;切仓不重挂(内容原位切换)。 */
  const [drawerFull, setDrawerFull] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerItem, setDrawerItem] = useState<BoardItem | null>(null)
  const drawerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openDrawer = useCallback((full: string, item: BoardItem) => {
    if (drawerTimerRef.current) {
      clearTimeout(drawerTimerRef.current)
      drawerTimerRef.current = null
    }
    setDrawerItem(item)
    setDrawerFull(full)
    setDrawerOpen(true)
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    if (drawerTimerRef.current) clearTimeout(drawerTimerRef.current)
    drawerTimerRef.current = setTimeout(() => {
      setDrawerFull(null)
      setDrawerItem(null)
      drawerTimerRef.current = null
    }, 300)
  }, [])
  const drawerIndex = drawerFull ? items.findIndex((i) => i.fullName === drawerFull) : -1
  const drawerRank = drawerIndex >= 0 ? drawerIndex + 1 : 0
  // 邻居启发:抽屉稳定后预取上下名的 README,切换时省掉等待
  const drawerNeighbors = useMemo(() => {
    if (drawerIndex < 0) return []
    const next: string[] = []
    if (drawerIndex > 0) next.push(items[drawerIndex - 1].fullName)
    if (drawerIndex < items.length - 1) next.push(items[drawerIndex + 1].fullName)
    return next
  }, [drawerIndex, drawerFull, items])

  useEffect(() => {
    if (drawerFull && drawerOpen) rowElsRef.current.get(drawerFull)?.scrollIntoView({ block: 'nearest' })
  }, [drawerFull, drawerOpen])

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-ink">{metricLabel}</span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-sub">{metricHint}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-sub" suppressHydrationWarning>
          <span className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-bad' : 'bg-good'}`} aria-hidden="true" />
          <span>
            {strings.updated} {fmtDay(generatedAt, locale)}
          </span>
        </div>
      </div>

      {(degraded || stale) && (
        <div className="mb-3 rounded-2xl border-[0.5px] border-black/10 bg-[#fff8e6] px-3.5 py-2 text-[12px] text-bad">
          {stale ? strings.rateLimited : strings.degraded}
        </div>
      )}

      <ol className={`card list-none overflow-hidden ${compact ? '' : 'rounded-[22px]'}`}>
        {items.map((item, index) => {
          const live = flags[item.fullName]
          const prev = item.prevRank
          // 排序变化徽章:本地实时(换拍一刻 FLIP 同款)优先;否则回落到载荷里持久化的上一拍名次
          // —— 任何人任何时候打开页面都能直接看到上一轮同步的爬/掉,不必恰好守在换拍一刻。
          const flag =
            live ??
            (prev === undefined
              ? undefined
              : prev > index
                ? { kind: 'up' as const, delta: prev - index }
                : { kind: 'down' as const, delta: index - prev })
          const crossed =
            variant === 'milestone' && item.milestoneTarget ? item.stars >= item.milestoneTarget : false
          // 行描述按站点语言挑:载荷里备好的对应语言描述(descLng),没有就回仓库原文
          const shown = item.descLng?.[locale] || item.desc || null
          return (
            <li
              key={item.fullName}
              ref={(el) => {
                if (el) rowElsRef.current.set(item.fullName, el)
                else rowElsRef.current.delete(item.fullName)
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a,button')) return
                openDrawer(item.fullName, item)
              }}
              className={`will-change-transform cursor-pointer ${crossed ? 'bg-good/6' : index < 3 ? 'bg-surface/70' : ''} ${
                drawerFull === item.fullName && drawerOpen ? 'ring-1 ring-inset ring-accent/40' : ''
              } border-b-[0.5px] border-black/6 last:border-b-0`}
            >
              <div className={`flex items-center gap-3 px-4 sm:gap-4 sm:px-5 ${compact ? 'py-3' : 'py-4'}`}>
                <div
                  className={`w-8 shrink-0 text-right font-semibold tabular-nums ${compact ? 'text-[14px]' : 'text-[17px]'} ${
                    index < 3 ? 'text-accent' : 'text-sub'
                  } ${flag?.kind === 'up' && index <= 2 ? 'podium-flash' : ''}`}
                >
                  {index + 1}
                </div>

                <img
                  src={item.avatarUrl}
                  alt=""
                  width={compact ? 30 : 38}
                  height={compact ? 30 : 38}
                  loading="lazy"
                  className={`shrink-0 rounded-[10px] border-[0.5px] border-black/8 bg-surface object-cover ${compact ? 'h-[30px] w-[30px]' : 'h-[38px] w-[38px]'}`}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {/* 仓库名不再是外链:浏览不放走流量;真正想去的走行尾小门(明确意图下才出站) */}
                    <span className={`truncate font-semibold tracking-tight text-ink ${compact ? 'text-[13.5px]' : 'text-[15px]'}`}>
                      {item.fullName}
                    </span>
                    {/* 站内档案:SEO 可爬内链,也是读者进档案页的主入口;拦在 a 里不与行点击冲突 */}
                    <Link
                      href={`/${locale}/repo/${item.fullName}`}
                      prefetch={false}
                      aria-label={`${item.fullName} · ${strings.drawer.archive}`}
                      className="inline-flex h-7 shrink-0 items-center rounded-full bg-[#f5f5f7] px-2.5 text-ink/65 transition-colors hover:bg-black/8 hover:text-ink"
                      // 悬停预热:普通 GET 会在服务端把 'use cache' 档案缓存烧热,
                      // 真正点击时大概率是热渲染(只省时,不碰 RSC 路由,与 #412 无关)
                      onMouseEnter={() => {
                        fetch(`/${locale}/repo/${item.fullName}`).catch(() => {})
                      }}
                    >
                      <ArchiveIcon size={14} />
                    </Link>
                    {/* GitHub 门:黑底胶囊 + 字标,一眼可点(出站查看仓库详情) */}
                    <a
                      href={item.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`GitHub · ${item.fullName}`}
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-semibold tracking-tight text-white transition-opacity hover:opacity-80"
                    >
                      <GithubIcon size={14} />
                      GitHub
                    </a>
                    {flag && flagBadge(flag.kind, flag.delta, strings)}
                  </div>

                  {shown && (
                    <p className={`mt-0.5 text-sub ${compact ? 'line-clamp-1 text-[12px]' : 'line-clamp-2 text-[13px]'}`}>
                      {trimDesc(shown, compact ? 90 : 150)}
                    </p>
                  )}

                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-sub ${compact ? 'mt-0.5' : 'mt-1'}`}>
                    {item.language && <span>{item.language}</span>}
                    {metric !== 'forks' && (
                      <span className="inline-flex items-center gap-1">
                        <ForkIcon size={11} />
                        {fmtNum(item.forks, locale)}
                      </span>
                    )}
                    {showIssues && item.issues > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <IssueIcon size={11} />
                        {fmtNum(item.issues, locale)}
                      </span>
                    )}
                    {showSlope && item.slope !== undefined && item.slope > 0 && (
                      <span>
                        {fmtSlope(item.slope)} {strings.perDayUnit}
                      </span>
                    )}
                    {showPushed && item.pushedAt && (
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon size={11} />
                        {fmtAgo(item.pushedAt, locale, nowAnchor)}
                      </span>
                    )}
                    {secondary === 'stars' && metric !== 'stars' && (
                      <span className="inline-flex items-center gap-1">
                        <StarIcon size={11} />
                        {fmtNum(item.stars, locale)}
                      </span>
                    )}
                    {secondary === 'forks' && metric !== 'forks' && (
                      <span className="inline-flex items-center gap-1">
                        <ForkIcon size={11} />
                        {fmtNum(item.forks, locale)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div
                    className={`${compact ? 'text-[15px]' : 'text-[16.5px]'} font-semibold tracking-tight tabular-nums ${metric === 'gained' ? 'text-good' : 'text-ink'}`}
                  >
                    {primaryUsesCountUp ? (
                      <CountUp value={primaryOf(item)} format={formatPrimary} />
                    ) : (
                      formatPrimary(primaryOf(item))
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast-in flex max-w-md items-center gap-3 rounded-2xl border-[0.5px] border-black/10 bg-white/95 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl"
            role="status"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-good/10 text-good">
              <StarIcon size={14} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-ink">{toast.title}</span>
              <span className="block text-[11.5px] text-sub">{toast.sub}</span>
            </span>
          </div>
        ))}
      </div>

      {drawerFull && (
        <RepoDrawer
          fullName={drawerFull}
          item={drawerIndex >= 0 ? items[drawerIndex] : (drawerItem ?? undefined)}
          rank={drawerRank}
          total={items.length}
          locale={locale}
          strings={strings}
          open={drawerOpen}
          neighbors={drawerNeighbors}
          onClose={closeDrawer}
          onPrev={() => {
            if (drawerIndex > 0) openDrawer(items[drawerIndex - 1].fullName, items[drawerIndex - 1])
          }}
          onNext={() => {
            if (drawerIndex >= 0 && drawerIndex < items.length - 1) openDrawer(items[drawerIndex + 1].fullName, items[drawerIndex + 1])
          }}
        />
      )}
    </div>
  )
}

function flagBadge(kind: RowFlag['kind'], delta: number, strings: LiveStrings): ReactNode {
  if (kind === 'up') {
    return (
      <span
        title={strings.upLabel}
        className="inline-flex items-center gap-0.5 rounded-full bg-good/10 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-good"
      >
        <ArrowUpIcon size={8} />
        {delta > 1 ? delta : ''}
      </span>
    )
  }
  return (
    <span
      title={strings.downLabel}
      className="inline-flex items-center gap-0.5 rounded-full bg-bad/10 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-bad"
    >
      <ArrowDownIcon size={8} />
      {delta > 1 ? Math.abs(delta) : ''}
    </span>
  )
}

function trimDesc(s: string, n: number): string {
  // 仓库描述可能自带 emoji（数据源），与 Apple 风格界面冲突 → 一律剥离（仅展示用）
  const text = s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > n ? `${text.slice(0, n - 1)}…` : text
}
