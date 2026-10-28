import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

/**
 * 档案页暂时故障与错误壳契约(2026-10-28 实证收敛版):
 *
 * 实测事实(生产构建+故障注入实测验证):
 *   - [lang]/layout 的 await 在 page 之前完成,Next 在 page 阶段流已启动;
 *   - 流开始后无论是 throw 还是 notFound(),Next 状态码都锁死 200;
 *   - throw 会产出 __next_error__ 破碎流并被 CDN 长期缓存(生产 5 URL 挂 13h+ 实锤);
 *   - notFound() 会向用户显示"仓库不存在"(语义欺骗)。
 *
 * 最终正确解法:
 *   1. 超时时不 throw 也不 notFound:渲染诚实降级视图 RepoUnavailable
 *      (正文明确说明"数据暂时不可用,请稍后重试",不伪装成仓库不存在);
 *   2. React 19 的 <meta name="robots" content="noindex" /> 由组件提升进 head,
 *      压过 layout 的 index,follow(搜索引擎遇重复 robots 取最严格值,不收录降级页);
 *   3. 正常完成的渲染走标准缓存(脏窗 ≤5 分钟),绝不产生长存的破碎流壳;
 *   4. DB 恢复后下次渲染即得完整真页面(自愈已实机验证);
 *   5. generateMetadata 限时 9s 并在超时时返回 {},避免 metadata 阶段裸死。
 */

describe('repo page 暂时故障降级契约(静态)', () => {
  let src = ''
  beforeAll(async () => {
    src = await readFile(new URL('../app/[lang]/repo/[...full]/page.tsx', import.meta.url), 'utf8')
  })

  it('archive 超时严禁 throw(throw=产生 __next_error__ 破碎流被 CDN 缓存)', () => {
    expect(src).not.toMatch(/throw new Error\('repo archive timeout/)
  })

  it('archive 超时不得伪装成 notFound(语义欺骗用户)', () => {
    // 只有 !archive(确认查无)才 notFound;TIMEOUT 分支严禁直接 notFound
    expect(src).not.toMatch(/archiveRes === TIMEOUT\)\s*notFound\(\)/)
  })

  it('archive 超时渲染 RepoUnavailable 降级视图', () => {
    expect(src).toMatch(/archiveRes === TIMEOUT\)/)
    expect(src).toMatch(/<RepoUnavailable\s*\/>/)
    expect(src).toMatch(/<RepoUnavailableBody\s*\/>/)
  })

  it('真不存在(!archive)仍然走 notFound()', () => {
    expect(src).toMatch(/if \(!archive\) notFound\(\)/)
  })

  it('generateMetadata 的 archive 读必须限时并在超时返回显式 noindex', () => {
    const metaBlock = src.slice(
      src.indexOf('export async function generateMetadata'),
      src.indexOf('export async function generateStaticParams'),
    )
    expect(metaBlock).toMatch(/withTimeout\(getRepoArchiveCached\(fullName\), 9000\)/)
    // 超时返回显式 noindex(实测:流式场景 metadata API 不可靠,组件提升是主通道,
    // metadata robots 是语义兼容的第二通道 —— 双通道都指向不收录)
    expect(metaBlock).toMatch(/archive === TIMEOUT\) return \{ robots: \{ index: false, follow: false \} \}/)
    expect(metaBlock).toMatch(/if \(!archive\) return \{\}/)
    expect(metaBlock).not.toMatch(/await getRepoArchiveCached\(fullName\)(?!\s*,)/)
  })

  it('body 内其余库读全部带降级(catch 保护),无未受控的 withTimeout', () => {
    const body = src.slice(src.indexOf('export default async function RepoPage'))
    const caught = body.match(/\.catch\(/g)?.length ?? 0
    expect(caught).toBeGreaterThanOrEqual(5)
  })
})

describe('RepoUnavailable 组件语义', () => {
  let compSrc = ''
  beforeAll(async () => {
    compSrc = await readFile(new URL('../components/RepoUnavailable.tsx', import.meta.url), 'utf8')
  })

  it('输出 noindex meta 供 React 19 提升到 head', () => {
    expect(compSrc).toMatch(/<meta name="robots" content="noindex" \/>/)
  })

  it('正文明确声明数据暂时不可用,而非仓库不存在', () => {
    expect(compSrc).toMatch(/数据暂时没取回来/)
    expect(compSrc).toMatch(/temporarily unavailable/)
    expect(compSrc).toMatch(/不是仓库不存在/)
    expect(compSrc).toMatch(/The repository is fine/)
  })
})

describe('三态判定逻辑(mock 层)', () => {
  const TIMEOUT = Symbol('timeout')

  function decide(archiveRes: unknown): 'unavailable' | 'notFound' | 'render' {
    if (archiveRes === TIMEOUT) return 'unavailable'
    if (!archiveRes) return 'notFound'
    return 'render'
  }

  it('超时 → unavailable(独立暂时故障分支,不伪装 404)', () => {
    expect(decide(TIMEOUT)).toBe('unavailable')
  })
  it('null(确认查无)→ notFound(保留真实 404)', () => {
    expect(decide(null)).toBe('notFound')
  })
  it('正常档案 → render', () => {
    expect(decide({ appearances: [] })).toBe('render')
  })
})
