import HomeButton from '@/components/HomeButton'

/** 静态 404(双语标题 + 按路径定位语言的单按钮);不读 params,避免动态参数缺失问题。 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="kicker">404</p>
      <h1 className="hero-title mt-3">页面不存在</h1>
      <p className="mt-1 hero-title-en">Page not found</p>
      <p className="mt-4 text-[15px] text-sub">
        这个仓库大概已经被宇宙移走，或者从未存在过。
        <br />
        This repository seems to have left the universe — or never existed.
      </p>
      <div className="mt-8">
        <HomeButton />
      </div>
    </div>
  )
}
