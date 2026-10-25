'use client'

import { copyText } from '@/lib/clipboard'

/** 档案页分享钮:优先系统分享(Web Share),被拒/不支持退复制链接。 */
export default function ArchiveShare({
  label,
  title,
  url,
}: {
  label: string
  title: string
  url: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> }
        if (nav.share) {
          void nav.share({ title, url }).catch(() => undefined)
        } else {
          void copyText(url)
        }
      }}
      className="inline-flex items-center gap-1 font-medium text-ink/50 transition-colors hover:text-accent-strong"
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 9V1.5M7 1.5L4.2 4.3M7 1.5l2.8 2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.5 6.5v4.7a1.3 1.3 0 0 0 1.3 1.3h6.4a1.3 1.3 0 0 0 1.3-1.3V6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  )
}
