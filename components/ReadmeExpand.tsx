'use client'

import { useState } from 'react'

/** README 展开全文(2026-10-27 档案页重设计;2026-10-28 评审修:内部滚动→整体裁剪)。
 *  children 始终完整 SSR 输出(爬虫拿全文);默认 640px 裁剪 + 底部渐隐 + 展开按钮,
 *  不再使用容器内滚动 —— 页面滚动与内容框内滚动的双滚冲突(移动端尤其)由此消除。 */
export default function ReadmeExpand({ expand, collapse, children }: {
  expand: string
  collapse: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <div
        className={`md-body ${open ? 'max-h-none overflow-visible' : 'max-h-[640px] overflow-hidden'}`}
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
