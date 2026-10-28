/** 档案数据暂时不可用降级页(2026-10-28 错误壳事故的最小修复)。
 *
 * 背景(生产实锤):[lang]/layout 的 await 在 page 之前,Next 在 page 的第一个
 * await 完成前就已发出响应头与 200 —— 页面层 throw/notFound 都只能流中处理,
 * 产出"200 + noindex + 空壳"并被 CDN 当正常页缓存 13h+。
 *
 * 因此超时分支不再抛错:渲染本降级视图,空壳变诚实页。
 * - 可见正文明确说"数据暂时不可用"(不伪装成仓库不存在);
 * - noindex 双通道(实测定稿,2026-10-28):组件内 <meta robots noindex> 由 React 19
 *   提升进 head —— 这是流式场景下唯一可靠的通道(降级页的 metadata API 输出会因
 *   head 早于 generateMetadata 完成而整段不渲染,实测 title/robots 全缺);
 *   page.tsx 的 metadata.robots {index:false} 是第二通道,渲染出来时与之语义一致。
 *   最终 head 可能同时存在 'noindex'(组件)与 'noindex, nofollow'(metadata),
 *   指令语义相同、无冲突,搜索引擎合并后同为不收录;
 * - 正常完成的渲染走正常缓存(≤5 分钟脏窗,与普通页一致),绝不产生长存错误壳;
 * - DB 恢复后下次渲染即得真页面(自愈)。
 * 双语硬标签,刻意不依赖字典 —— 降级件自己不能有依赖故障面(与 error.tsx 同纪律)。 */
export default function RepoUnavailable() {
  return (
    <meta name="robots" content="noindex" />
  )
}

/** 降级正文(与 noindex meta 分离导出,便于单独断言)。 */
export function RepoUnavailableBody() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="kicker">RETRY SOON</p>
      <h1 className="hero-title mt-3">数据暂时没取回来</h1>
      <p className="mt-1 hero-title-en">This data is temporarily unavailable.</p>
      <p className="mt-4 text-[15px] leading-relaxed text-sub">
        不是仓库不存在 —— 是我们的数据源此刻没响应。稍等片刻刷新即可。
        <br />
        The repository is fine — our data source is not responding right now. Please retry shortly.
      </p>
    </div>
  )
}
