'use client'

import { useState } from 'react'

/** README 展开全文(2026-10-27 档案页重设计):children 始终完整 SSR 输出(爬虫拿全文),
 *  默认限高 640px + 底部渐隐 + 展开按钮;点击撑开,再点收起并回滚到区块顶部。 */
export default function ReadmeExpand({ expand, collapse, children }: {
  expand: string
  collapse: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <div
        className={`${open ? 'max-h-none overflow-visible' : 'max-h-[640px] overflow-y-auto'} md-body ${open ? '' : 'rounded-[20px] px-5 py-4 sm:px-6'}`}
      >
        {children}
      </div>
      {!open && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-[20px] bg-gradient-to-t from-[#f5f5f7] to-transparent" />
      )}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            if (v) window.scrollTo({ behavior: 'smooth', top: window.scrollY - 400 })
            return !v
          })
        }}
        className="relative z-10 mx-auto mt-2 block rounded-full border-[0.5px] border-black/10 bg-white px-4 py-1.5 text-[12.5px] font-medium text-ink/70 transition-colors hover:border-accent/40 hover:text-accent-strong"
      >
        {open ? collapse : expand}
      </button>
    </div>
  )
}
