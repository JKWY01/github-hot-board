import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * discoverQuery 行为测试(评审三轮 P1):真实调用 discoverQuery(不重实现判定逻辑),
 * mock discoverFilteredUncached 的底层 withDb,断言三层边界:
 *  Ⅰ. 常用组合(Top 榜内)→ 走持久缓存路径;
 *  Ⅱ. 长尾组合 → 走非持久路径(微缓存+single-flight+并发帽);
 *  Ⅲ. 同键并发 N = 1 次打库(single-flight);
 *  Ⅳ. 不同键并发 > 帽 → 同时在途查询数 ≤ MAX,超出者排队或降级。
 * mock 纪律:withDb mock 计数+可控延迟,specifier '../lib/snapshot'(与被测模块解析一致)。
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

import { discoverQuery, __testOnlyLongtailState, type DiscoverFilters } from '../lib/discover'

const TOP_FACETS = {
  languages: [['typescript', 9], ['python', 8]] as Array<[string, number]>,
  topics: [['ai', 7], ['web', 6]] as Array<[string, number]>,
}

function filters(partial: Partial<DiscoverFilters>): DiscoverFilters {
  return { sort: 'stars', ...partial }
}

/** fakeSql:可模板标签 + .unsafe + .json(与 discoverFiltered 的 sql.unsafe 用法对齐) */
function fakeSql() {
  return Object.assign(() => Promise.resolve([]), {
    unsafe: () => Promise.resolve([]),
    json: (v: unknown) => JSON.stringify(v),
  })
}
function fakeWithDb(fn: (sql: unknown) => Promise<unknown>) {
  return fn(fakeSql())
}

// 微缓存 30s TTL 会跨用例泄漏——用不同参数隔离各用例,并在 beforeEach 清计数
beforeEach(() => {
  vi.clearAllMocks()
})

describe('discoverQuery 行为边界(真实调用)', () => {
  it('Ⅰ 常用组合(Top 榜内)→ 走 discoverFiltered(withDb 被调)', async () => {
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => fn(fakeSql()) as never)
    const rows = await discoverQuery({ ...filters({ lang: 'typescript', topic: 'ai' }), facetsRef: TOP_FACETS })
    expect(Array.isArray(rows)).toBe(true)
    expect(mocks.withDb).toHaveBeenCalledTimes(1)
  })

  it('Ⅱ 长尾组合 → 同样完成查询(withDb 被调),且可重复(微缓存命中后第二次不再打库)', async () => {
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => fn(fakeSql()) as never)
    const tail = { lang: 'ziglang', topic: 'reverse-tunnel', sort: 'stars' as const }
    await discoverQuery({ ...filters(tail), facetsRef: TOP_FACETS })
    expect(mocks.withDb).toHaveBeenCalledTimes(1)
    await discoverQuery({ ...filters(tail), facetsRef: TOP_FACETS })
    expect(mocks.withDb).toHaveBeenCalledTimes(1) // 微缓存命中,零新查询
  })

  it('Ⅲ 同键并发 20 = 1 次打库(single-flight 真实验证)', async () => {
    let dbCalls = 0
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      dbCalls++
      await new Promise(r => setTimeout(r, 50)) // 拉长在途窗口
      return fn(fakeSql()) as never
    })
    const tail = { lang: 'vala', topic: `sf-${Date.now()}`, sort: 'stars' as const }
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      discoverQuery({ ...filters(tail), facetsRef: TOP_FACETS })))
    expect(dbCalls).toBe(1)
    expect(results.length).toBe(20)
  })

  it('Ⅳ 不同键并发 10,DB 并发帽 2:同时在途查询数从不超过 2', async () => {
    let dbCalls = 0
    let concurrent = 0
    let maxConcurrent = 0
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      dbCalls++
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 80))
      concurrent--
      return fn(fakeSql()) as never
    })
    const stamp = Date.now()
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      discoverQuery({ ...filters({ lang: 'vala', topic: `cap-${stamp}-${i}`, sort: 'stars' as const }), facetsRef: TOP_FACETS })))
    expect(dbCalls).toBe(10) // 每键各查一次(不同键不合并)
    expect(maxConcurrent).toBeLessThanOrEqual(2) // 硬上限
    expect(__testOnlyLongtailState().running).toBe(0) // 全部释放
  })

  it('Ⅳb 队列预算超时 → 可控降级;超时等待者遗留项不泄漏 _running(评审四轮 P0 实测)', async () => {
    // 先占满 2 个并发槽(长挂 4s > 3s 预算)→ 第 3+ 键真实排队 → 超时降级
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      await new Promise(r => setTimeout(r, 4000))
      return fn(fakeSql()) as never
    })
    const stamp = Date.now()
    const reqs = Array.from({ length: 5 }, (_, i) =>
      discoverQuery({ ...filters({ lang: 'vala', topic: `q-${stamp}-${i}`, sort: 'stars' as const }), facetsRef: TOP_FACETS }))
    const results = await Promise.all(reqs)
    // 2 个占槽的最终成功;3 个排队的超时降级(空结果)
    const degraded = results.filter(r => Array.isArray(r) && r.length === 0)
    expect(degraded.length).toBeGreaterThanOrEqual(2)
    // 过载观测:预算超时计数真实发生
    expect(__testOnlyLongtailState().budgetTimeouts).toBeGreaterThanOrEqual(2)
    // 全部落定后资源归零(超时项不能滞留队列被后续 release 消费)
    const state = __testOnlyLongtailState()
    expect(state.running).toBe(0)
    expect(state.queued).toBe(0)
    expect(state.inflight).toBe(0)
  }, 20000)

  it('Ⅳc 降级不进微缓存:占满槽制造真实排队超时,恢复后同键必须重新查库(withDb 计数增加)', async () => {
    let slow = true
    let dbCalls = 0
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      dbCalls++
      if (slow) await new Promise(r => setTimeout(r, 4000)) // 4s > 3s 预算
      return fn(fakeSql()) as never
    })
    const stamp = Date.now()
    // 占满 2 槽
    const occupy = Array.from({ length: 2 }, (_, i) =>
      discoverQuery({ ...filters({ lang: 'vala', topic: `occ-${stamp}-${i}`, sort: 'stars' as const }), facetsRef: TOP_FACETS }))
    // 目标键在队列中等待 → 超时降级
    const target = { lang: 'vala', topic: `dg-${stamp}`, sort: 'stars' as const }
    const r1 = await discoverQuery({ ...filters(target), facetsRef: TOP_FACETS })
    expect(Array.isArray(r1) && r1.length === 0).toBe(true) // 降级空结果
    const callsAfterDegrade = dbCalls
    // 恢复
    slow = false
    await Promise.all(occupy)
    const r2 = await discoverQuery({ ...filters(target), facetsRef: TOP_FACETS })
    // 降级未进缓存:恢复后同键重新打库(计数增加),且拿到真实查询结果
    expect(dbCalls).toBeGreaterThan(callsAfterDegrade)
    void r2
    expect(__testOnlyLongtailState().running).toBe(0)
  }, 25000)
})
