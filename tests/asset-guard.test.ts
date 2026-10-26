import { describe, expect, it } from 'vitest'

/** 保护资产批(2026-10-26)静态契约:钉死四个"会伤真实用户/资产"的修复形态。
 *  行为层在客户端组件(依赖浏览器事件流),这里锁源码契约,改动必须先改测试。 */

describe('repo_seen 永久化(60 天炸弹拆除)', () => {
  it('pruneOld 不得再删 repo_seen(删了 = 老档案 404 = 收录面塌方)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../lib/snapshot.ts', import.meta.url), 'utf8')
    const pruneBody = src.slice(src.indexOf('export async function pruneOld'), src.indexOf('/** 同榜邻居'))
    expect(pruneBody).toMatch(/DELETE FROM board_snapshots/)
    expect(pruneBody).toMatch(/DELETE FROM repo_docs/)
    expect(pruneBody).not.toMatch(/DELETE FROM repo_seen/)
  })
})

describe('搜索转圈复位(用户今天就可能踩到)', () => {
  it('搜索 effect 的短词提前退出路径必须 setSearching(false)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../components/LiveBoardList.tsx', import.meta.url), 'utf8')
    // 锚定搜索 effect(带 setSearchDeb/setSearching 的那处,不是 pushHist 的长度检查)
    const i0 = src.indexOf('if (q.length < 2) {\n      setSearchHits([])')
    expect(i0).toBeGreaterThan(0)
    const body = src.slice(i0, i0 + 300)
    expect(body).toMatch(/setSearching\(false\)/)
  })
})

describe('watch 清空列表状态复位(推送鬼影)', () => {
  it('空列表必须重置 lastFetchKey 并清状态,不得提前 return', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../components/watch-client.tsx', import.meta.url), 'utf8')
    const i0 = src.indexOf('if (!ready) return')
    const body = src.slice(i0, i0 + 400)
    expect(body).toMatch(/entries\.length === 0/)
    expect(body).toMatch(/lastFetchKey\.current = ''/)
  })
  it('推送续订对空列表也要同步(服务端残留已删关注=跨线推送鬼影)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../components/watch-client.tsx', import.meta.url), 'utf8')
    const i0 = src.indexOf('已开启后关注列表变化')
    const body = src.slice(i0, src.indexOf('}, [pushOn, entries, locale])', i0))
    expect(body).toMatch(/if \(!pushOn\) return/)
    expect(body).not.toMatch(/entries\.length === 0\) return/)
  })
})

describe('GitHub 配额记账(403 预警)', () => {
  it('ghJson 成功路径必须带 [quota] 日志(每小时节流,不落 token 本身)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../lib/github.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('async function ghJson'), src.indexOf('function mapRepo'))
    expect(body).toMatch(/\[quota\]/)
    expect(body).toMatch(/lastQuotaLogAt/)
    expect(body).not.toMatch(/current\.token|TOKENS\[tokenIdx/)
  })
})
