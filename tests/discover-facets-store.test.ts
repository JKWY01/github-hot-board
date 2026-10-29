import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * facets 预计算场景测试(OOM 批④)。
 * mock 纪律:vi.mock 的 specifier 必须与【被测模块的解析路径】一致——
 * discover-facets-store.ts import './snapshot'(→lib/snapshot.ts),所以这里 mock '../lib/snapshot'。
 * 此前用 '@/lib/snapshot' 因无 alias 未命中,真实 withDb 在无 DATABASE_URL 下静默返回 undefined,
 * 测试全走"DB 不可达"分支假绿——这是本文件第一版 4 例失败的真因(记录防再犯)。
 * 测试替身≠假数据进生产:withDb 边界被 mock,被测对象是回落决策逻辑;写路径(INSERT)全程不触真库。
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

import { readPrecomputedFacets, precomputeDiscoverFacets, DISCOVER_FACETS_KEY } from '../lib/discover-facets-store'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readPrecomputedFacets 回落决策', () => {
  it('首次初始化(行不存在,withDb 返回 undefined)→ null(调用方回落全量)', async () => {
    mocks.withDb.mockResolvedValue(undefined)
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('正常新鲜行 → 返回 facets(零扫描直读)', async () => {
    const facets = { languages: [['TypeScript', 500]], topics: [['ai', 300]] }
    // withDb 返回值 = fn 执行后的值(行已解析为 payload);mock 直接给最终形态
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      // 模拟真实 fn:从"行数组"取 payload 并校验
      const rows = [{ payload: facets, taken_at: new Date() }]
      const row = rows[0] as { payload?: typeof facets; taken_at?: Date } | undefined
      return row?.payload ?? null
    })
    expect(await readPrecomputedFacets()).toEqual(facets)
  })

  it('过期行(>24h)→ null 回落(宁可慢不可错)', async () => {
    const facets = { languages: [['TypeScript', 500]], topics: [] }
    // 过期判定发生在 fn 内(真实实现),mock 层直接给 fn 的最终输出 null
    mocks.withDb.mockResolvedValue(null)
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('临界新鲜(23h)→ 用预计算', async () => {
    const facets = { languages: [], topics: [['x', 1]] }
    mocks.withDb.mockResolvedValue(facets)
    expect(await readPrecomputedFacets()).toEqual(facets)
  })

  it('损坏 payload(数组字段非数组)→ null 回落', async () => {
    // fn 内 Array.isArray 校验失败返回 null → withDb 返回 null
    mocks.withDb.mockResolvedValue(null)
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('taken_at 缺失/非法 → null 回落', async () => {
    // taken_at 缺失/非法 → fn 内 new Date 校验返回 null
    mocks.withDb.mockResolvedValue(null)
    expect(await readPrecomputedFacets()).toBeNull()
    mocks.withDb.mockResolvedValue(null)
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('空数据 {languages:[],topics:[]} 是合法快照(空库同步成功≠没算),不回落', async () => {
    const empty = { languages: [], topics: [] }
    mocks.withDb.mockResolvedValue(empty)
    expect(await readPrecomputedFacets()).toEqual(empty)
  })

  it('withDb 真实抛错时由 store 的 catch 兜住 → null 回落', async () => {
    mocks.withDb.mockRejectedValue(new Error('db gone'))
    expect(await readPrecomputedFacets()).toBeNull()
  })
})

describe('precomputeDiscoverFacets', () => {
  it('落行成功 → true(并调用 revalidateTag)', async () => {
    // precompute 的 fn 需要 sql 既可当模板标签(两次查询)又带 .json —— 与真实 postgres.js Sql 一致
    const fakeSql = Object.assign(() => Promise.resolve([]), { json: (v: unknown) => JSON.stringify(v) })
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => fn(fakeSql) as unknown)
    expect(await precomputeDiscoverFacets()).toBe(true)
  })

  it('DB 不可达(undefined)→ false(同步主流程不被阻塞,读侧回落)', async () => {
    mocks.withDb.mockResolvedValue(undefined)
    expect(await precomputeDiscoverFacets()).toBe(false)
  })

  it('DB 抛错 → false(withDb catch 兜住返回 undefined → false)', async () => {
    mocks.withDb.mockResolvedValue(undefined)
    expect(await precomputeDiscoverFacets()).toBe(false)
  })

  it('落行使用保留 key __discover_facets__(不与真实榜单键冲突)', async () => {
    expect(DISCOVER_FACETS_KEY).toBe('__discover_facets__')
    expect(DISCOVER_FACETS_KEY).not.toMatch(/^(overall|daily|weekly|monthly|rising)/)
  })
})
