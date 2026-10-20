'use client'

import Link from 'next/link'
import { useLinkStatus } from 'next/link'

/** useLinkStatus 必须在 <Link> 的**子组件**里调用(Next 16 规范),因此拆两层。 */
function ChipFace({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return (
    <>
      {pending && (
        <span
          className="mr-1.5 inline-block size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-80"
          aria-hidden
        />
      )}
      <span className={pending ? 'opacity-80' : ''}>{children}</span>
    </>
  )
}

/** 语言 chip:点击后 pending 时出现转圈点,给出「已出发」反馈,避免「像卡了」。 */
export default function PendingChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={`language-chip ${active ? 'language-chip-active' : ''}`}
    >
      <ChipFace>{children}</ChipFace>
    </Link>
  )
}
