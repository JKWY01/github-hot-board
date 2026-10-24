'use client'

import { useState } from 'react'

/** 通用复制小钮:点击写入剪贴板,1.6s 内显示 ✓ 回执;失败静默(用户手动选择兜底)。 */
export default function CopyCode({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true)
            window.setTimeout(() => setDone(false), 1600)
          })
          .catch(() => undefined)
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink/45 transition-colors hover:bg-black/6 hover:text-ink"
    >
      {done ? (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="4.5" y="4.5" width="8" height="8" rx="1.8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9.5 4.5V3.3A1.8 1.8 0 0 0 7.7 1.5H3.3A1.8 1.8 0 0 0 1.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}
