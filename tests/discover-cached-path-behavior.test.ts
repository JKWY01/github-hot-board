import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Top 榜持久路径信号量契约测试(评审十一轮 P0):
 * 修复前缺陷:discoverQueryCached 无条件 release(未获得槽位也 release→_running 错误递减)+
 * 过载仍执行 SQL(击穿并发帽)。
 * 六断言:①两请求占满槽 ②第三请求(排队超时)不执行 SQL ③running 不被错误递减
 * ④队列满不执行 SQL ⑤占槽完成后三计数归零 ⑥过载结果 status='overloaded'。
 * 注:next/cache 为直通 stub,'use cache' 真实填充合并由 standalone 验证(另一层证据,不在此声称)。
 */

const mocks = vi.hoisted(() => ({ withDb: vi.fn() }))
vi.mock('../lib/snapshot', () => ({
  withDb: mocks.withDb,
  readDiscoverMeta: vi.fn(),
}))
vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
}))

import { discoverQuery, __testOnlyLongtailState } from '../lib/discover'

const TOP_FACETS = {
  languages: [['typescript', 9], ['python', 8]] as Array<[string, number]>,
  topics: [['ai', 7], ['web', 6]] as Array<[string, number]>,
}
function filters(p: Partial<{ lang?: string; topic?: string }>) {
  return { sort: 'stars' as const, ...p }
}
function fakeSql() {
  return Object.assign(() => Promise.resolve([]), {
    unsafe: () => Promise.resolve([]),
    json: (v: unknown) => JSON.stringify(v),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('持久路径信号量契约(评审十一轮 P0)', () => {
  it('①②③ 队列等待超时:第三请求不执行 SQL,running 不被错误递减,状态=overloaded', async () => {
    let sqlCalls = 0
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      sqlCalls++
      await new Promise(r => setTimeout(r, 4000)) // 4s > 3s 预算
      return fn(fakeSql()) as never
    })
    const stamp = Date.now()
    // 两个请求占满 2 槽
    const occupy = [
      discoverQuery({ ...filters({ lang: 'typescript', topic: 'ai' }), facetsRef: TOP_FACETS }),
      discoverQuery({ ...filters({ lang: 'typescript', topic: 'web' }), facetsRef: TOP_FACETS }),
    ]
    await new Promise(r => setTimeout(r, 200))
    // 第三个:队列等待 → 3s 预算超时 → 必须 throw DiscoverOverloadedError(不执行 SQL)
    const third = await discoverQuery({ ...filters({ lang: 'python', topic: 'ai' }), facetsRef: TOP_FACETS })
    expect(third.status).toBe('overloaded')
    expect(third.rows).toEqual([])
    expect(sqlCalls).toBe(2) // 只有两个占槽请求执行了 SQL
    await Promise.all(occupy)
    // running 不被错误递减:全部落定后恰好归零(若错误 release 会变负或提前转交)
    const st = __testOnlyLongtailState()
    expect(st.running).toBe(0)
    expect(st.queued).toBe(0)
  }, 20000)

  it('④ 队列满:第 51+ 个请求不执行 SQL,立即 overloaded', async () => {
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      await new Promise(r => setTimeout(r, 8000)) // 长挂占满
      return fn(fakeSql()) as never
    })
    const stamp = Date.now()
    const before = __testOnlyLongtailState().queueFullRejects
    let sqlCalls = 0
    const countWrap = mocks.withDb.getMockImplementation()!
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      sqlCalls++
      return countWrap(fn)
    })
    const first = Array.from({ length: 52 }, (_, i) =>
      discoverQuery({ ...filters({ lang: 'typescript', topic: `full-${stamp}-${i}` }), facetsRef: TOP_FACETS }))
    await new Promise(r => setTimeout(r, 300))
    const mid = __testOnlyLongtailState()
    expect(mid.running).toBe(2)
    expect(mid.queued).toBe(50)
    const callsAtMid = sqlCalls
    const rejects = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      discoverQuery({ ...filters({ lang: 'typescript', topic: `rej-${stamp}-${i}` }), facetsRef: TOP_FACETS })))
    for (const r of rejects) expect(r.status).toBe('overloaded')
    expect(__testOnlyLongtailState().queueFullRejects).toBeGreaterThan(before)
    expect(sqlCalls).toBe(callsAtMid) // 队列满的请求零 SQL
    await Promise.all(first).catch(() => {})
  }, 30000)

  it('⑤ 正常路径契约:获得槽位→执行 SQL→release,完成后三计数归零', async () => {
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => fn(fakeSql()) as never)
    const r1 = await discoverQuery({ ...filters({ lang: 'typescript', topic: 'ai' }), facetsRef: TOP_FACETS })
    expect(r1.status).toBe('ok')
    expect(mocks.withDb).toHaveBeenCalledTimes(1)
    const st = __testOnlyLongtailState()
    expect(st.running).toBe(0)
    expect(st.queued).toBe(0)
    expect(st.inflight).toBe(0)
  })
})
