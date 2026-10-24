'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/** 渲染兜底卡:任一客户端组件抛错时接管,单板故障不连坐全站白屏。
 * 双语静态文案,刻意不依赖字典/数据层 —— 兜底件自己不能有依赖故障面。 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[board-error]', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="kicker">RECOVERABLE</p>
      <h1 className="hero-title mt-3">这一页暂时没画完</h1>
      <p className="mt-1 hero-title-en">This view hit a snag.</p>
      <p className="mt-4 text-[15px] leading-relaxed text-sub">
        数据与榜单不受影响,重试或从顶部导航去别的榜。
        <br />
        Data is fine — retry, or hop to another board from the nav.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center rounded-full bg-ink px-6 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-80"
        >
          重试 · Retry
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-full border-[0.5px] border-black/15 bg-white px-6 py-2.5 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          回首页 · Home
        </Link>
      </div>
    </div>
  )
}
