'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { track } from '@vercel/analytics'

import type { BoardItem, Locale, LivePatch } from '@/lib/types'
import { fmtAgo, fmtDay, fmtNum, fmtSlope, fmtSigned } from '@/lib/format'
import CountUp from './CountUp'
import RepoDrawer from './repo-drawer'
import WatchBell from './watch-bell'
import { ArrowDownIcon, ArrowUpIcon, ArchiveIcon, BellIcon, ClockIcon, ForkIcon, GithubIcon, IssueIcon, StarIcon } from './Icons'
import { celebrateBurst } from './celebrate'

export type LiveStrings = Awaited<ReturnType<typeof import('@/app/[lang]/dictionaries').liveStrings>>

export interface LiveBoardListProps {
  slug: string
  locale: Locale
  currentLanguage?: string
  initialItems: BoardItem[]
  /** SSR 载荷被截断过(只带了首屏批):挂载后立即静默拉一次全集,不等首个 60s 轮询 */
  initialTruncated?: boolean
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

type BucketId = string
type SortId = 'board' | 'gained' | 'rate'

/** 每榜分档:排序用什么量,就按什么量切档 —— 控件跟着榜走,不再全站一刀切。
 *  overall 是全局量级榜(第 300 名门槛约 8.4 万星),细档毫无意义,用大档;
 *  rising/dark/overlooked 的收录带在几十到千级,用细档,forks 按 fork 数,
 *  milestone 天生按"冲刺目标"分(行里自带 milestoneTarget);
 *  controversial 的矛盾分没有自然档位,只留全量。 */
type Plan = { id: string; label: string; min: number; max: number; by: 'stars' | 'forks' | 'target'; target?: number }
const WIDE: Plan[] = [
  { id: '50k', label: '50k+', min: 50_000, max: Number.POSITIVE_INFINITY, by: 'stars' },
  { id: '20k', label: '20k–50k', min: 20_000, max: 50_000, by: 'stars' },
  { id: '10k', label: '10k–20k', min: 10_000, max: 20_000, by: 'stars' },
  { id: '1k', label: '1k–10k', min: 1_000, max: 10_000, by: 'stars' },
  { id: 'sub1k', label: '<1k', min: 0, max: 1_000, by: 'stars' },
]
const SMALL: Plan[] = [
  { id: '1k', label: '1k+', min: 1_000, max: Number.POSITIVE_INFINITY, by: 'stars' },
  { id: '300', label: '300–1k', min: 300, max: 1_000, by: 'stars' },
  { id: '100', label: '100–300', min: 100, max: 300, by: 'stars' },
  { id: 'sub100', label: '<100', min: 0, max: 100, by: 'stars' },
]
const TIERS_BY_SLUG: Record<string, Plan[]> = {
  overall: [
    { id: '1m', label: '1M+', min: 1_000_000, max: Number.POSITIVE_INFINITY, by: 'stars' },
    { id: '300k', label: '300k–1M', min: 300_000, max: 1_000_000, by: 'stars' },
    { id: '100k', label: '100k–300k', min: 100_000, max: 300_000, by: 'stars' },
    { id: 'sub100k', label: '<100k', min: 0, max: 100_000, by: 'stars' },
  ],
  weekly: WIDE,
  monthly: WIDE,
  annual: [
    { id: '100k', label: '100k+', min: 100_000, max: Number.POSITIVE_INFINITY, by: 'stars' },
    { id: '20k', label: '20k–100k', min: 20_000, max: 100_000, by: 'stars' },
    { id: '1k', label: '1k–20k', min: 1_000, max: 20_000, by: 'stars' },
    { id: 'sub1k', label: '<1k', min: 0, max: 1_000, by: 'stars' },
  ],
  rising: SMALL,
  dark: SMALL,
  overlooked: SMALL,
  forks: [
    { id: 'f10k', label: '10k+', min: 10_000, max: Number.POSITIVE_INFINITY, by: 'forks' },
    { id: 'f1k', label: '1k–10k', min: 1_000, max: 10_000, by: 'forks' },
    { id: 'fsub1k', label: '<1k', min: 0, max: 1_000, by: 'forks' },
  ],
  milestone: [
    { id: 't1k', label: '→1k', target: 1_000, min: 0, max: 0, by: 'target' },
    { id: 't10k', label: '→10k', target: 10_000, min: 0, max: 0, by: 'target' },
    { id: 't50k', label: '→50k', target: 50_000, min: 0, max: 0, by: 'target' },
    { id: 't100k', label: '→100k', target: 100_000, min: 0, max: 0, by: 'target' },
  ],
  controversial: [],
}

/** 搜索:榜内即时过滤 + owner/repo 榜外精查 + 库内关键词发现(A+B+C)。
 *  名次语义与 API 共用一条谱系:总榜外 500+,里程碑"差 N 到档"。 */
const MILE_LADDER = [1_000, 10_000, 50_000, 100_000]
interface SearchHit {
  fullName: string
  stars?: number
  forks?: number
  pushedAt?: string
  desc?: Record<string, string>
  rank?: number
  cutoff?: number
  /** 服务端标注:站内是否有档案;无档案时名字链回落 GitHub(站内档案页对未上榜仓库诚实 404) */
  onBoard?: boolean
}

export default function LiveBoardList({
  slug,
  locale,
  currentLanguage,
  initialItems,
  initialTruncated,
  initialGeneratedAt,
  initialDegraded,
  metric,
  metricLabel,
  metricHint,
  secondary = 'none',
  showSlope = false,
  showIssues = true,
  showPushed = false,
  limit,
  compact = false,
  variant = 'default',
  pollMs = 60_000,
  strings,
}: LiveBoardListProps) {
  const [items, setItems] = useState<BoardItem[]>(limit ? initialItems.slice(0, limit) : initialItems)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  // SSR 期的"当前时刻"锚:用快照时刻(稳定合法值),避免 unstable Date.now() 中毒构建;
  // 真实钟由挂水合后的 nowAnchor 接管,首帧差值已 suppressHydrationWarning 压制。
  const dataNowMs = useMemo(() => {
    const t = Date.parse(initialGeneratedAt)
    return Number.isFinite(t) ? t : 0
  }, [initialGeneratedAt])
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

  /* ----------------- 梯队筛选 + 增量/增速切换(纯客户端视图层) -----------------
   * 默认态恒等于原榜:bucket=all & sort=board 时视图逐行原样,SSR 标记不变 ——
   * 筛选/改序只是"人看的透镜",不带 URL 参数,爬虫看到的永远是榜单默认序。 */
  const [tier, setTier] = useState<BucketId>('all')
  const [sortId, setSortId] = useState<SortId>('board')
  const [search, setSearch] = useState('')
  const [searchDeb, setSearchDeb] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchKind, setSearchKind] = useState<'exact' | 'keyword' | 'web' | 'empty'>('exact')
  const [webConfirmed, setWebConfirmed] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  /* 搜索历史(纯本地,最多 5 条):聚焦空输入时下拉,点选即重搜 */
  const HIST_KEY = 'ghb.search.hist.v1'
  const [hist, setHist] = useState<string[]>([])
  const [histOpen, setHistOpen] = useState(false)
  const readHist = (): string[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]') as unknown
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 5) : []
    } catch {
      return []
    }
  }
  const pushHist = (q: string) => {
    if (q.length < 2) return
    const next = [q, ...readHist().filter((x) => x !== q)].slice(0, 5)
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(next))
    } catch {
      /* 隐私模式:仅本次会话 */
    }
    setHist(next)
  }
  /* 渐进渲染:总榜 500 行一次全渲染约 1.5 万 DOM 节点,移动端水合吃力。
   * SSR 首批 RENDER_CHUNK 行,滚动接近尾部自动续批;筛选/搜索照常作用于全集。
   * tradeoff(已拍板):HTML 里行数截到首批 —— JSON-LD 本就只标 150,档案页才是 SEO 主粮。 */
  const RENDER_CHUNK = 100
  const [visibleCount, setVisibleCount] = useState(limit ?? RENDER_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const searchLocal = () => {
    const q = searchDeb.trim().toLowerCase()
    return q.length > 0 && items.some((it) => it.fullName.toLowerCase().includes(q))
  }
  const searchMode = Boolean(searchDeb) && !searchLocal()
  const custom = tier !== 'all' || sortId !== 'board' || Boolean(searchDeb)
  const customRef = useRef(custom)
  // 自定义态不摸渲染期 ref(react-hooks/refs):落账放进 useLayoutEffect,
  // 且声明序在 FLIP 效果之前 —— 同一次 commit 里 FLIP 读到的必是本拍状态。
  useLayoutEffect(() => {
    customRef.current = custom
  }, [custom])

  // 搜索防抖 + 服务端(A+B):400ms 静默后发起;榜内已命中则不打扰。
  // 两段式:第一发只查自家库(deep=0),库空回"本站没有"等确认;
  // 用户点"搜全站"后记下确认词(refetch 带 deep=1 才打全站,改了词就要重新确认)。
  useEffect(() => {
    const t = setTimeout(() => setSearchDeb(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    const q = searchDeb.trim()
    if (q.length < 2) {
      setSearchHits([])
      // 短词提前退出也必须复位转圈(2026-10-26 实锤):上一拍长词正转圈时,
      // 请求被 cleanup 置 stale、回调里不再 setSearching(false) —— 不复位就永远转圈
      setSearching(false)
      setWebConfirmed('')
      return
    }
    if (items.some((it) => it.fullName.toLowerCase().includes(q.toLowerCase()))) return
    let stale = false
    setSearching(true)
    track('library_search')
    fetch(`/api/search?q=${encodeURIComponent(q)}&board=${encodeURIComponent(slug)}&language=${encodeURIComponent(currentLanguage ?? '')}&deep=${webConfirmed === q ? 1 : 0}`)
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((j: { ok: boolean; results?: SearchHit[]; kind?: 'exact' | 'keyword' | 'web' | 'empty' }) => {
        if (stale) return
        setSearching(false)
        setSearchHits(j.ok ? (j.results ?? []) : [])
        if (j.kind) setSearchKind(j.kind)
      })
      .catch(() => {
        if (!stale) setSearching(false)
      })
    return () => {
      stale = true
    }
  }, [searchDeb, items, slug, currentLanguage, webConfirmed])

  // 原榜名次表:筛选态下仍按"真实榜单名次"亮前三、显示名次,不因视图重排撒谎
  const rankOf = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((it, i) => m.set(it.fullName, i + 1))
    return m
  }, [items])

  // 本榜的档位方案(未知榜回落宽体量档);排序证据由当拍数据自证
  const tierPlan = TIERS_BY_SLUG[slug] ?? WIDE
  const showNet = metric !== 'gained' && items.some((it) => (it.gained ?? 0) > 0)
  const showRate = metric !== 'slope' && items.some((it) => (it.gained ?? 0) > 0 && it.stars - (it.gained ?? 0) > 0)

  const view = useMemo(() => {
    if (!custom) return items
    let list = items
    if (tier !== 'all') {
      const hit = tierPlan.find((b) => b.id === tier)
      if (hit)
        list = list.filter((it) =>
          hit.by === 'target'
            ? it.milestoneTarget === hit.target
            : hit.by === 'forks'
              ? (it.forks ?? 0) >= hit.min && (it.forks ?? 0) < hit.max
              : it.stars >= hit.min && it.stars < hit.max,
        )
    }
    const qlc = searchDeb.trim().toLowerCase()
    if (qlc) list = list.filter((it) => it.fullName.toLowerCase().includes(qlc))
    if (sortId !== 'board') {
      list = [...list].sort((a, b) => {
        if (sortId === 'gained') return (b.gained ?? 0) - (a.gained ?? 0)
        // 增速 = 本期净增 / 期初基数(期初 0 的新仓按 1 兜底,天然冲第一,诚实)
        const ra = (a.gained ?? 0) / Math.max(1, a.stars - (a.gained ?? 0))
        const rb = (b.gained ?? 0) / Math.max(1, b.stars - (b.gained ?? 0))
        return rb - ra
      })
    }
    return list
  }, [items, tier, sortId, custom, tierPlan, searchDeb])

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

  // 哨兵续批:滚动到距尾部 ~600px 时再挂下一批(依赖 visibleCount:新哨兵节点出现后重挂观察)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => c + RENDER_CHUNK)
        }
      },
      { rootMargin: '600px 0px 0px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visibleCount])

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
    // SSR 载荷被截断(首屏 100 行):挂载后立即补全全集,让筛选/搜索的范围尽快恢复;
    // 不等 60s 首轮。SSR 行数与补全后不一致不触发 FLIP(同一 generatedAt 分支只刷字段)。
    if (initialTruncated && document.visibilityState === 'visible') void poll()
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
    // 自定义视图(筛选/改序)期间丢弃播报账本:FLIP 位移与爬降徽章都描述"原榜",
    // 混在重排视图里只会表演错误坐标 —— 宁可安静,不可撒谎。
    if (customRef.current) {
      pendingRef.current = null
      return
    }
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
          // 换芯后 score=增速百分比(rising 绝对增量榜新行 score 也走这,black 兜底形态同)
          return `${n.toFixed(1)}%`
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
  // 筛选/排序四词随字典走(strings.filterXxx,原内嵌 CTRL 表已并入词典体系)
  const ctrl = { all: strings.filterAll, board: strings.filterOrder, net: strings.filterNet, rate: strings.filterRate }

  /* 点行抽屉:开着的抽屉不挡 60 秒轮询;切仓不重挂(内容原位切换)。 */
  const [drawerFull, setDrawerFull] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerItem, setDrawerItem] = useState<BoardItem | null>(null)
  const drawerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openDrawer = useCallback((full: string, item: BoardItem) => {
    track('drawer_open')
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
  // '/' 聚焦搜索(GitHub 本尊惯例):输入态与抽屉开着时让路(依赖 drawerOpen 重挂,免 ref)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (drawerOpen) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

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

      {/* 梯队筛选 + 增量/增速切换:纯视图层。默认"全部 + 榜序" = 原榜,
          SSR/爬虫所见的行序与历史发布完全一致;无 URL 参数,不产生可收录的重复视图。 */}
      {!compact && items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 px-1">
          {tierPlan.length > 1 &&
            (['all', ...tierPlan.map((p) => p.id)] as string[]).map((id) => {
              const on = tier === id
              const label = id === 'all' ? ctrl.all : tierPlan.find((b) => b.id === id)?.label ?? id
              return (
                <button
                  key={`t-${id}`}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { track('board_filter'); setTier(id) }}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium tabular-nums transition-colors ${
                    on ? 'bg-ink text-white' : 'text-ink/55 hover:bg-black/8 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          {(showNet || showRate) && (
            <>
              <span className="mx-1.5 h-3.5 w-px bg-black/10" aria-hidden="true" />
              {(['board'] as SortId[]).map((id) => (
                <button
                  key={`s-${id}`}
                  type="button"
                  aria-pressed={sortId === id}
                  onClick={() => setSortId(id)}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    sortId === id ? 'bg-ink text-white' : 'text-ink/55 hover:bg-black/8 hover:text-ink'
                  }`}
                >
                  {ctrl.board}
                </button>
              ))}
              {showNet &&
                (['gained'] as SortId[]).map((id) => (
                  <button
                    key={`s-${id}`}
                    type="button"
                    aria-pressed={sortId === id}
                    onClick={() => setSortId(id)}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      sortId === id ? 'bg-ink text-white' : 'text-ink/55 hover:bg-black/8 hover:text-ink'
                    }`}
                  >
                    {ctrl.net}
                  </button>
                ))}
              {showRate &&
                (['rate'] as SortId[]).map((id) => (
                  <button
                    key={`s-${id}`}
                    type="button"
                    aria-pressed={sortId === id}
                    onClick={() => setSortId(id)}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      sortId === id ? 'bg-ink text-white' : 'text-ink/55 hover:bg-black/8 hover:text-ink'
                    }`}
                  >
                    {ctrl.rate}
                  </button>
                ))}
            </>
          )}
          <span className="ml-auto" />
          <Link
            href={`/${locale}/watch`}
            aria-label={strings.watchTitle}
            title={strings.watchTitle}
            className="flex shrink-0 items-center rounded-full bg-black/6 px-2.5 py-1 text-ink/70 transition-colors hover:text-ink"
          >
            <BellIcon size={13} />
          </Link>
          <label className="relative flex shrink-0 items-center gap-1 pl-2">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-ink/40" aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" />
              <path d="M10.4 10.4 L13.6 13.6" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => {
                setHist(readHist())
                setHistOpen(true)
              }}
              onBlur={() => window.setTimeout(() => setHistOpen(false), 160)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') pushHist(search.trim())
              }}
              placeholder={strings.searchPlaceholder}
              className="w-[150px] rounded-full bg-black/6 px-3 py-1 text-[12px] text-ink outline-none placeholder:text-ink/35 focus:bg-black/10 sm:w-[220px]"
            />
            {histOpen && hist.length > 0 && !search && (
              <span className="absolute right-0 top-[calc(100%+6px)] z-40 block w-[220px] overflow-hidden rounded-2xl border-[0.5px] border-black/10 bg-white py-1 shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
                {hist.map((h) => (
                  <button
                    key={h}
                    type="button"
                    /* mousedown 抢在 input blur 之前,免下拉先消失 */
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setSearch(h)
                      setHistOpen(false)
                      searchRef.current?.focus()
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-ink/80 transition-colors hover:bg-black/5"
                  >
                    <span className="truncate">{h}</span>
                    <span className="shrink-0 text-ink/30" aria-hidden>↺</span>
                  </button>
                ))}
              </span>
            )}
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="rounded-full bg-black/6 px-1.5 py-0.5 text-[11px] leading-none text-ink/60 hover:text-ink"
                aria-label="clear search"
              >
                ×
              </button>
            )}
          </label>
          <span className="pl-2 text-right text-[11px] tabular-nums text-sub">
            {custom ? `${view.length} / ${items.length}` : ''}
          </span>
        </div>
      )}

      {(degraded || stale) && (
        <div className="mb-3 rounded-2xl border-[0.5px] border-black/10 bg-[#fff8e6] px-3.5 py-2 text-[12px] text-bad">
          {stale ? strings.rateLimited : strings.degraded}
        </div>
      )}

      {searchMode && (
        <div className="mb-3 rounded-[18px] border-[0.5px] border-black/10 bg-[#f8f8fa] px-3.5 py-3">
          <div className="mb-2 text-[12px] font-semibold text-ink">
            {searching
              ? `${strings.searchPlaceholder}…`
              : searchHits.length === 0
                ? searchKind === 'empty'
                  ? strings.searchMissing
                  : strings.searchEmpty
                : searchKind === 'web'
                  ? strings.searchAll
                  : searchKind === 'keyword'
                    ? strings.searchRelated
                    : strings.searchOutside}
          </div>
          {!searching &&
            (searchHits.length === 0 ? (
              searchKind === 'empty' ? (
                <button
                  type="button"
                  onClick={() => setWebConfirmed(searchDeb.trim())}
                  className="rounded-full bg-black/8 px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-black/12"
                >
                  {strings.searchAllBtn}
                </button>
              ) : (
                <div className="py-1 text-[12.5px] text-sub">{strings.searchEmpty}</div>
              )
            ) : (
              searchHits.slice(0, 6).map((hit, i) => (
                <SearchResultRow key={hit.fullName + i} hit={hit} locale={locale} slug={slug} first={searchKind === 'exact' && i === 0} />
              ))
            ))}
        </div>
      )}

      <ol className={`card list-none overflow-hidden ${compact ? '' : 'rounded-[22px]'}`}>
        {view.slice(0, visibleCount).map((item, index) => {
          // 名次语义:默认视图 = 视图序(≡原榜);筛选态保留原榜名次;改序态按视图序重编号,
          // 且爬/降徽章在自定义视图一律休眠 —— 它们描述的是原榜坐标,重排后不算数。
          const rankShown = !custom || sortId === 'board' ? (rankOf.get(item.fullName) ?? index + 1) : index + 1
          const live = custom ? undefined : flags[item.fullName]
          const prev = item.prevRank
          // 排序变化徽章:本地实时(换拍一刻 FLIP 同款)优先;否则回落到载荷里持久化的上一拍名次
          // —— 任何人任何时候打开页面都能直接看到上一轮同步的爬/掉,不必恰好守在换拍一刻。
          const flag =
            custom
              ? undefined
              : live ??
                (prev === undefined
                  ? undefined
                  : prev > rankShown
                    ? { kind: 'up' as const, delta: prev - rankShown }
                    : { kind: 'down' as const, delta: rankShown - prev })
          const crossed =
            variant === 'milestone' && item.milestoneTarget ? item.stars >= item.milestoneTarget : false
          // 里程碑"预计跨线":gap ÷ 当拍斜率,>90 天视为斜率失真不显示(诚实:估不出来就不估)
          const etaDays =
            variant === 'milestone' && item.milestoneTarget && item.stars < item.milestoneTarget && (item.slope ?? 0) > 0
              ? Math.ceil((item.milestoneTarget - item.stars) / (item.slope as number))
              : null
          // 行描述按站点语言挑:载荷里备好的对应语言描述(descLng),没有就回仓库原文
          const shown = item.descLng?.[locale] || item.desc || null
          const officialLabel = locale === 'zh' ? '官方同款' : 'official'
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
              className={`will-change-transform cursor-pointer ${crossed ? 'bg-good/6' : rankShown <= 3 ? 'bg-surface/70' : ''} ${
                drawerFull === item.fullName && drawerOpen ? 'ring-1 ring-inset ring-accent/40' : ''
              } border-b-[0.5px] border-black/6 last:border-b-0`}
            >
              <div className={`flex items-center gap-3 px-4 sm:gap-4 sm:px-5 ${compact ? 'py-3' : 'py-4'}`}>
                <div
                  className={`w-8 shrink-0 text-right font-semibold tabular-nums ${compact ? 'text-[14px]' : 'text-[17px]'} ${
                    rankShown <= 3 ? 'text-accent' : 'text-sub'
                  } ${flag?.kind === 'up' && rankShown <= 3 ? 'podium-flash' : ''}`}
                >
                  {rankShown}
                </div>

                <img
                  src={item.avatarUrl}
                  alt=""
                  onError={(e) => {
                    // 头像死链(仓库改名/CDN 抖动)回退 owner 默认头像,只退一次
                    const im = e.currentTarget
                    if (im.dataset.fb) return
                    im.dataset.fb = '1'
                    im.src = `https://github.com/${item.owner || 'github'}.png`
                  }}
                  width={compact ? 30 : 38}
                  height={compact ? 30 : 38}
                  loading="lazy"
                  className={`shrink-0 rounded-[10px] border-[0.5px] border-black/8 avatar-ph object-cover ${compact ? 'h-[30px] w-[30px]' : 'h-[38px] w-[38px]'}`}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {/* 仓库名不再是外链:浏览不放走流量;真正想去的走行尾小门(明确意图下才出站) */}
                    <span className={`truncate font-semibold tracking-tight text-ink ${compact ? 'text-[13.5px]' : 'text-[15px]'}`}>
                      {item.fullName}
                    </span>
                    {/* 站内档案/出站 GitHub 的门都收进行右缘(见行尾动作组);名字行保持干净 */}
                    {flag && flagBadge(flag.kind, flag.delta, strings)}
                    {/* 官方同款:官方 Trending 同期也收录了这家(自算增量榜的双源互证) */}
                    {item.officialTrending && (
                      <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-good/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-good sm:inline-flex">
                        {officialLabel}
                      </span>
                    )}
                    {/* 新入榜:上一拍没这家且无实时旗 —— 榜单的诚实增量信号 */}
                    {!flag && !custom && prev === undefined && (
                      <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent sm:inline-flex">
                        {strings.newLabel}
                      </span>
                    )}
                    {/* 关注铃铛贴着仓库名:点击先问"你的项目还是想关注",选完就地给列表入口 */}
                    {!compact && (
                      <WatchBell
                        fullName={item.fullName}
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
                    )}
                  </div>

                  {shown && (
                    <p className={`mt-0.5 text-sub ${compact ? 'line-clamp-1 text-[12px]' : 'line-clamp-2 text-[13px]'}`}>
                      {trimDesc(shown, compact ? 90 : 150)}
                    </p>
                  )}

                  {/* 统一底座:语言 · fork · issues(数据真的没有就不画格,不造假)。
                      本榜主值永远在行右侧大数(总榜=星/斜率榜=星/天/fork 榜=fork)。
                      本征格式之后是本榜特化格(斜率/更新时间/24h 增量等)。 */}
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-sub ${compact ? 'mt-0.5' : 'mt-1'}`}>
                    {item.language && <span>{item.language}</span>}
                    {metric !== 'forks' && (
                      <span className="inline-flex items-center gap-1">
                        <ForkIcon size={11} />
                        {fmtNum(item.forks, locale)}
                      </span>
                    )}
                    {showIssues && item.issues !== undefined && (
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
                      // SSR/爬虫锚 = 快照时刻(合法稳定值);水合后由真实钟接管,期间差值抑制警告
                      <span className="inline-flex items-center gap-1" suppressHydrationWarning>
                        <ClockIcon size={11} />
                        {fmtAgo(item.pushedAt, locale, nowAnchor || dataNowMs)}
                      </span>
                    )}
                    {etaDays !== null && etaDays <= 90 && (
                      <span className="font-medium text-accent/85">
                        {strings.etaDays.replace('{n}', String(etaDays))}
                      </span>
                    )}
                    {secondary === 'stars' && metric !== 'stars' && (
                      <span className="inline-flex items-center gap-1">
                        <StarIcon size={11} />
                        {fmtNum(item.stars, locale)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 行尾:主数值 + 动作组(经典列表"value + accessory"形制)。
                    档案 = 站内详情(悬停时顺带预热档案缓存);GitHub = 描边圆钮,hover 反色点亮。 */}
                <div className="flex shrink-0 items-center gap-2.5">
                  <div
                    className={`${compact ? 'text-[15px]' : 'text-[16.5px]'} text-right font-semibold tracking-tight tabular-nums ${metric === 'gained' ? 'text-good' : 'text-ink'}`}
                  >
                    {primaryUsesCountUp ? (
                      <CountUp value={primaryOf(item)} format={formatPrimary} />
                    ) : (
                      formatPrimary(primaryOf(item))
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/${locale}/repo/${item.fullName}`}
                      prefetch={false}
                      aria-label={`${item.fullName} · ${strings.drawer.archive}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink/35 transition-colors hover:bg-black/6 hover:text-accent"
                      // 悬停预热:普通 GET 在服务端把 'use cache' 档案缓存烧热,
                      // 真正点击大概率是热渲染(只省时,不碰 RSC 路由,与 #412 无关)
                      onMouseEnter={() => {
                        fetch(`/${locale}/repo/${item.fullName}`).catch(() => {})
                      }}
                    >
                      <ArchiveIcon size={15} />
                    </Link>
                    <a
                      href={item.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`GitHub · ${item.fullName}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-black/15 text-ink/65 transition-colors hover:border-ink hover:bg-ink hover:text-white"
                    >
                      <GithubIcon size={16} />
                    </a>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {/* 渐进渲染:还有未挂载的行 → 哨兵(IntersectionObserver 见尾自动续批) */}
      {view.length > visibleCount && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
      {/* 档位/搜索过滤后为空:一句人话,不晾一个空卡(真·空榜仍走错误卡路径) */}
      {custom && view.length === 0 && items.length > 0 && (
        <p className="px-1 py-10 text-center text-[13px] text-sub">{strings.filterEmpty}</p>
      )}

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
        className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-good/10 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-good"
      >
        <ArrowUpIcon size={8} />
        {delta > 1 ? delta : ''}
      </span>
    )
  }
  return (
    <span
      title={strings.downLabel}
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-bad/10 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-bad"
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

/** 搜索结果行:档位语义与原榜共用(name 上的徽章)。
 *  榜内 → #N;总榜外 → 500+(量级越门槛却缺席 → 500+?);里程碑 → 差 N 到下一档。 */
function SearchResultRow({
  hit,
  locale,
  slug,
  first,
}: {
  hit: SearchHit
  locale: Locale
  slug: string
  first?: boolean
}) {
  let badge: string | null = null
  if (hit.rank !== undefined) badge = `#${hit.rank}`
  else if (slug === 'milestone' && hit.stars !== undefined) {
    const t = MILE_LADDER.find((x) => x > hit.stars!)
    if (t) badge = `+${fmtNum(t - hit.stars!, locale)} →${fmtNum(t, locale)}`
  } else if (slug === 'overall' && hit.stars !== undefined && hit.cutoff !== undefined) {
    badge = hit.stars >= hit.cutoff ? '500+?' : '500+'
  }
  const desc =
    hit.desc?.[locale] ?? hit.desc?.en ?? hit.desc?.__gh ?? Object.values(hit.desc ?? {}).find(Boolean) ?? null
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-2xl px-3 py-2 ${first ? 'bg-white' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {hit.onBoard === false ? (
            <a
              href={`https://github.com/${hit.fullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`truncate text-ink hover:underline ${first ? 'text-[14px] font-semibold' : 'text-[13px] font-medium'}`}
            >
              {hit.fullName}
            </a>
          ) : (
            <Link
              href={`/${locale}/repo/${hit.fullName}`}
              className={`truncate text-ink hover:underline ${first ? 'text-[14px] font-semibold' : 'text-[13px] font-medium'}`}
            >
              {hit.fullName}
            </Link>
          )}
          {badge && (
            <span
              className="shrink-0 rounded-full bg-black/8 px-2 py-0.5 text-[10.5px] tabular-nums text-ink/70"
              title={badge}
            >
              {badge}
            </span>
          )}
        </div>
        {desc && <p className="mt-0.5 truncate text-[12px] text-sub">{desc}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-[11.5px] tabular-nums text-sub">
        {hit.stars !== undefined && (
          <span className="inline-flex items-center gap-1">
            <StarIcon size={11} />
            {fmtNum(hit.stars, locale)}
          </span>
        )}
        {hit.forks !== undefined && hit.forks > 0 && (
          <span className="inline-flex items-center gap-1">
            <ForkIcon size={11} />
            {fmtNum(hit.forks, locale)}
          </span>
        )}
        <a
          href={`https://github.com/${hit.fullName}`}
          target="_blank"
          rel="noreferrer"
          className="opacity-55 transition-opacity hover:opacity-100"
          aria-label={`GitHub ${hit.fullName}`}
        >
          <GithubIcon size={13} />
        </a>
      </div>
    </div>
  )
}
