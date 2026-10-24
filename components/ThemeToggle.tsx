'use client'

import { useEffect, useState } from 'react'

/** 明暗切换:html.dark 由 layout 里的防闪脚本先行挂好(首访跟随系统),
 * 这里只负责读当前态、切换、持久化(localStorage ghb.theme)。 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    // 挂载后读 DOM 上的真实主题(layout 防闪脚本已先行落好 class);
    // 不能在渲染期读(document 未就绪/SSR 不一致),这是"同步外部系统"的正型
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部状态,见上注
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('ghb.theme', next ? 'dark' : 'light')
    } catch {
      /* 隐私模式:本次会话生效即可 */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'light mode' : 'dark mode'}
      title={dark ? 'Light' : 'Dark'}
      className="flex h-7 w-7 items-center justify-center rounded-full border-[0.5px] border-black/10 bg-white/70 text-ink/70 transition-colors hover:text-ink"
    >
      {dark ? (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 .8v1.6M7 11.6v1.6M.8 7h1.6M11.6 7h1.6M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M11.4 2.6l-1.1 1.1M3.7 10.3l-1.1 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M12 8.6A5.3 5.3 0 0 1 5.4 2 5.3 5.3 0 1 0 12 8.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
