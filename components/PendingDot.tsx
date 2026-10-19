'use client'

import { useLinkStatus } from 'next/link'

/** 链接点击进入 pending 时给出即时视觉反馈(转圈点),避免跨页导航期间被误以为卡住。
 * 不再用 useTransition 包路由切换(会拖慢并行预取标记为 pending 的时机),纯粒度放在每个链接上。 */
export default function PendingDot({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  if (!pending) return <>{children}</>
  return (
    <span className="inline-flex items-center gap-1.5" aria-busy="true">
      {children}
      <span
        className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-current opacity-70"
        aria-hidden
      />
    </span>
  )
}
