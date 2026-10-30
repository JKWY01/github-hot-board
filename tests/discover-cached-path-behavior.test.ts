import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Top 榜常用组合冷 miss 并发验证(评审十轮新增验收项):
 * discoverQueryCached 路径无应用层信号量——验证①同键并发由 Next 'use cache' 合并的程度
 * ②不同键冷 miss 是否无界并发打库(若有风险,需给持久路径补并发保护)。
 * 方法:mock withDb 计数+延迟,真实调用 discoverQuery(Top 榜组合)。
 * 注:'use cache' 在裸 Node 测试环境由 next/cache stub 提供——stub 是直通(无缓存语义),
 * 因此本测试能测到的是【应用层+mock 层】的并发形状;Next 真实缓存合并行为需隔离 standalone 验证(另行完成)。
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

import { discoverQuery } from '../lib/discover'

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

describe('Top 榜持久缓存路径并发形状(评审十轮)', () => {
  it('同键并发 20:stub 直通下 withDb 被调次数=20(Next 真实缓存的合并能力由 standalone 验证补测)', async () => {
    let calls = 0
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      calls++
      await new Promise(r => setTimeout(r, 50))
      return fn(fakeSql()) as never
    })
    await Promise.all(Array.from({ length: 20 }, () =>
      discoverQuery({ ...filters({ lang: 'typescript', topic: 'ai' }), facetsRef: TOP_FACETS })))
    expect(calls).toBe(20)
  })

  it('不同键冷 miss 并发 8:评审十轮治理后 maxConcurrent ≤ 2(持久路径共享信号量)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 60))
      concurrent--
      return fn(fakeSql()) as never
    })
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      discoverQuery({ ...filters(i % 2 ? { lang: 'typescript', topic: i < 4 ? 'ai' : 'web' } : { lang: i < 4 ? 'typescript' : 'python' }), facetsRef: TOP_FACETS })))
    // Top 榜组合键空间有界(7150)+ 并发有帽(2)=持久路径 DB 预算闭环
    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })
})
