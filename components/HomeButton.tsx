import Link from 'next/link'

import PendingDot from './PendingDot'

/** 404 页唯一 CTA。not-found 是静态产物拿不到动态 locale,所以直链根路径,
 * 由 proxy.ts 的根路径重定向(Accept-Language)去到对应语言首页;链接本身服务端可渲染。 */
export default function HomeButton({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-85 ${className}`}
    >
      <PendingDot>回到首页 · Back home</PendingDot>
    </Link>
  )
}
