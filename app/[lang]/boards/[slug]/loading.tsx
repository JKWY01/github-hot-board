import { BoardSkeleton } from '@/components/board-view'

/** 跨页导航的即时骨架:点击 nav/chips 后立刻切到本骨架,数据载入后填充。
 * 未知参数早被根目录 proxy.ts 以真 404 拦截,本边界内不会出现 404 digest。 */
export default function BoardLoading() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 pb-10 pt-14 sm:px-6 sm:pt-20">
        <div className="h-3 w-28 animate-pulse rounded-full bg-surface" />
        <div className="mt-4 h-14 w-64 animate-pulse rounded-2xl bg-surface sm:h-16" />
        <div className="mt-5 h-5 w-80 max-w-full animate-pulse rounded-lg bg-surface" />
        <div className="mt-7 flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-surface" />
          ))}
        </div>
      </section>
      <section className="bg-surface py-10">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <BoardSkeleton compact={false} />
        </div>
      </section>
    </div>
  )
}
