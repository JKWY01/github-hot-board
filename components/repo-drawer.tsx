'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { BoardItem, Locale } from '@/lib/types'
import { fmtNum } from '@/lib/format'
import { LANG_LINK_TEXT } from '@/lib/locales'
import { ForkIcon, StarIcon } from './Icons'
import type { LiveStrings } from './LiveBoardList'

/** 行点击 → 站内抽屉:里面直接铺 GitHub 官方渲染好的 README,
 * 等于把仓库页面本体搬进来(数据中心零自采 —— 数字就用榜单行里已有的)。
 * 桌面右滑、移动底弹;抽屉开着时身后榜单照常 60 秒翻新。
 * 进出场 rAF 两段式,不依赖 animate 插件;respect prefers-reduced-motion。 */
export default function RepoDrawer({
  fullName,
  item,
  rank,
  total,
  locale,
  strings,
  open,
  neighbors,
  onClose,
  onPrev,
  onNext,
}: {
  fullName: string
  item: BoardItem | undefined
  rank: number
  total: number
  locale: Locale
  strings: LiveStrings
  open: boolean
  neighbors?: string[]
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const drawer = strings.drawer
  const [html, setHtml] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'empty' | 'fail'>('loading')
  const cacheRef = useRef(new Map<string, string>())
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const scrollBoxRef = useRef<HTMLDivElement>(null)
  const mdBoxRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  /** 首屏 README / 文档链就地翻页 / 显式语言切换,同一个内容缓存(键含文档路径或语言)。 */
  const loadDoc = useCallback(
    (docPath: string | null, forcedLg?: string) => {
      const key = docPath
        ? `${fullName}::${docPath}`
        : forcedLg
          ? `${fullName}::lg:${forcedLg}`
          : fullName
      const cached = cacheRef.current.get(key)
      if (cached) {
        setHtml(cached)
        setState('ok')
        requestAnimationFrame(() => scrollBoxRef.current?.scrollTo({ top: 0 }))
        return
      }
      setHtml(null)
      setState('loading')
      const controller = new AbortController()
      const url = docPath
        ? `/api/repo?full=${encodeURIComponent(fullName)}&path=${encodeURIComponent(docPath)}`
        : `/api/repo?full=${encodeURIComponent(fullName)}&lg=${forcedLg ?? locale}`
      fetch(url, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => {
          const readme = (j?.readme as string | undefined) ?? null
          if (readme) {
            cacheRef.current.set(key, readme)
            setHtml(readme)
            setState('ok')
            requestAnimationFrame(() => scrollBoxRef.current?.scrollTo({ top: 0 }))
          } else if (docPath) {
            // 文档链坏了(作者切换器指向不存在的文件之类):回落默认 README,不留在错误卡
            loadDoc(null)
          } else {
            setState('empty')
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            if (docPath) loadDoc(null)
            else setState('fail')
          }
        })
      return () => controller.abort()
    },
    [fullName, locale],
  )

  useEffect(() => {
    const cleanup = loadDoc(null)
    return cleanup
  }, [loadDoc])

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

  // 图片失链回退:README 作者常把图写成相对路径,而图在别的目录
  // (往往 Localization readme 目录下引用上级 assets)。单图只回退一次:
  // 路径里出现 readme 目录段先剔除,否则向根走一级;仍失败就保持破图(GitHub 也一样)。
  useEffect(() => {
    const box = mdBoxRef.current
    if (!box || state !== 'ok') return
    const onErr = (e: Event) => {
      const img = e.target as HTMLImageElement
      if (img.tagName !== 'IMG' || img.dataset.lookedUp) return
      const src = img.getAttribute('src') || ''
      const m = src.match(/^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+)\/(.+)$/)
      if (!m) return
      const segs = m[2].split('/')
      if (segs.length < 2) return
      img.dataset.lookedUp = '1'
      const ri = segs.findIndex((s) => s.toLowerCase() === 'readme')
      if (ri > 0) segs.splice(ri, 1)
      else if (segs.length > 2) segs.splice(segs.length - 2, 1)
      else return
      img.src = `${m[1]}/${segs.join('/')}`
    }
    box.addEventListener('error', onErr, true)
    return () => box.removeEventListener('error', onErr, true)
  }, [state, html])

  // 邻居预取:当前页稳定半秒后,顺手把上/下一名的 README 拉进缓存
  // (别人之后点上下名时近乎零等待;数据本身走服务端共享缓存,不额外压配额)
  useEffect(() => {
    if (!open || state !== 'ok' || !neighbors?.length) return
    const t = setTimeout(() => {
      for (const n of neighbors) {
        if (cacheRef.current.has(n)) continue
        fetch(`/api/repo?full=${encodeURIComponent(n)}&lg=${locale}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            const readme = j?.readme as string | undefined
            if (readme) cacheRef.current.set(n, readme)
          })
          .catch(() => {})
      }
    }, 700)
    return () => clearTimeout(t)
  }, [open, state, neighbors, locale])

  if (!item) return null

  const shown = open && entered

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
        className={`absolute inset-y-0 right-0 flex w-[min(620px,94vw)] flex-col bg-white shadow-[0_0_70px_rgba(0,0,0,0.2)] max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[92dvh] max-sm:w-full max-sm:rounded-t-[22px] ${
          shown ? 'translate-x-0 max-sm:translate-y-0' : 'translate-x-full max-sm:translate-y-full'
        } motion-safe:transition-transform motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]`}
      >
        <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-black/8 px-5 py-2.5">
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

        <div ref={scrollBoxRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 px-5 pt-4">
            <img
              src={item.avatarUrl}
              alt=""
              width={42}
              height={42}
              loading="lazy"
              decoding="async"
              className="h-[42px] w-[42px] shrink-0 rounded-full border-[0.5px] border-black/8 bg-surface object-cover"
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[16.5px] font-semibold tracking-tight text-ink">{fullName}</h2>
              <p className="mt-0.5 flex items-center gap-2.5 text-[12px] text-sub">
                <span className="inline-flex items-center gap-1">
                  <StarIcon size={11} />
                  {fmtNum(item.stars, locale)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ForkIcon size={11} />
                  {fmtNum(item.forks, locale)}
                </span>
                {item.language && <span>{item.language}</span>}
              </p>
            </div>
            <a
              href={item.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/[0.045] px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-black/[0.07] hover:text-accent-strong"
            >
              {drawer.open}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 8L8 2M8 2H3.5M8 2v4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          <div className="border-t-[0.5px] border-black/8" />

          {state === 'loading' && <p className="px-5 py-6 text-[12.5px] text-sub" role="status">{drawer.loading}</p>}
          {state === 'empty' && <p className="px-5 py-6 text-[12.5px] text-sub" role="status">{drawer.noReadme}</p>}
          {state === 'fail' && (
            <p className="mx-5 my-4 rounded-2xl border-[0.5px] border-black/10 bg-[#fff8e6] px-3.5 py-2 text-[12px] text-bad" role="status">
              {drawer.fail}
            </p>
          )}{state === 'ok' && html && (
            <div
              ref={mdBoxRef}
              className="md-body px-5 py-4"
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest('a')
                if (!a) return
                const href = a.getAttribute('href') ?? ''
                if (href.startsWith('#')) {
                  const anchor = (e.currentTarget as HTMLElement).querySelector(`#${CSS.escape(href.slice(1))}`)
                  if (anchor) {
                    e.preventDefault()
                    anchor.scrollIntoView({ block: 'start', behavior: 'smooth' })
                  }
                  return
                }
                // 语言切换器:锚文本按共用表映射站点语言,显式换内容(仓库切换链常坏,直接换语言内容最稳)
                const label = (a.textContent || '').trim()
                const langLg = LANG_LINK_TEXT.find(({ re }) => re.test(label))?.lg ?? null
                // 同仓库的 .md 文档链 → 抽屉内就地翻页,不出站
                const m = href.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/[^/]+\/(.+\.md)$/i)
                if (langLg && (!m || m[1].toLowerCase() === fullName.toLowerCase())) {
                  e.preventDefault()
                  loadDoc(null, langLg)
                  return
                }
                if (m && m[1].toLowerCase() === fullName.toLowerCase()) {
                  e.preventDefault()
                  loadDoc(decodeURIComponent(m[2]))
                }
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>

        <div className="border-t-[0.5px] border-black/6 px-5 py-2.5 text-[11.5px] text-ink/40">{drawer.from}</div>
      </aside>
    </div>
  )
}
