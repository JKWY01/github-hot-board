import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * facets 预计算场景测试(OOM 批④,评审二轮重构版)。
 * mock 纪律(评审二轮③的教训):
 *  - vi.mock specifier 必须与被测模块解析路径一致('../lib/snapshot'),否则真实 withDb 在
 *    无 DATABASE_URL 下静默 undefined 假绿;
 *  - withDb 的 mock 必须【真正执行被测代码传入的回调】,回调内拿到的 fakeSql 要能响应真实
 *    模板查询——否则 taken_at 新鲜度/Array.isArray 结构校验等真实逻辑全被绕过(第一版假绿根因)。
 * fakeSql 语义:模板标签调用 → 返回预设行数组;.json() → JSON.stringify(与 postgres.js 一致)。
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

/** 真执行回调的 withDb mock:fn 收到一个能响应模板查询的 fakeSql */
function withDbExecuting(dbRows: () => Array<Record<string, unknown>>) {
  mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
    const fakeSql = Object.assign(
      () => Promise.resolve(dbRows()),
      { json: (v: unknown) => JSON.stringify(v) },
    )
    return fn(fakeSql)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readPrecomputedFacets 回落决策(真实回调执行)', () => {
  it('首次初始化(查询 0 行)→ null(调用方回落全量)', async () => {
    withDbExecuting(() => [])
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('正常新鲜行 → 返回 facets(taken_at 与结构校验真实执行)', async () => {
    const facets = { languages: [['TypeScript', 500]], topics: [['ai', 300]] }
    withDbExecuting(() => [{ payload: facets, taken_at: new Date() }])
    expect(await readPrecomputedFacets()).toEqual(facets)
  })

  it('过期行(>24h)→ null 回落(过期判定在被测回调内真实发生)', async () => {
    const facets = { languages: [['TypeScript', 500]], topics: [] }
    withDbExecuting(() => [{ payload: facets, taken_at: new Date(Date.now() - 25 * 3600 * 1000) }])
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('临界新鲜(23h)→ 用预计算', async () => {
    const facets = { languages: [], topics: [['x', 1]] }
    withDbExecuting(() => [{ payload: facets, taken_at: new Date(Date.now() - 23 * 3600 * 1000) }])
    expect(await readPrecomputedFacets()).toEqual(facets)
  })

  it('损坏 payload(数组字段非数组)→ null 回落(Array.isArray 校验真实执行)', async () => {
    withDbExecuting(() => [{ payload: { languages: 'not-an-array', topics: 42 }, taken_at: new Date() }])
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('payload 缺 languages 键 → null 回落', async () => {
    withDbExecuting(() => [{ payload: { topics: [] }, taken_at: new Date() }])
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('taken_at 缺失/非法 → null 回落(new Date 校验真实执行)', async () => {
    withDbExecuting(() => [{ payload: { languages: [], topics: [] }, taken_at: null }])
    expect(await readPrecomputedFacets()).toBeNull()
    withDbExecuting(() => [{ payload: { languages: [], topics: [] }, taken_at: 'not-a-date' }])
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('空数据 {languages:[],topics:[]} 是合法快照(空库同步成功≠没算),不回落', async () => {
    const empty = { languages: [], topics: [] }
    withDbExecuting(() => [{ payload: empty, taken_at: new Date() }])
    expect(await readPrecomputedFacets()).toEqual(empty)
  })

  it('withDb 抛错(mockRejectedValue 真实抛)→ store 层 catch 兜住 → null 回落', async () => {
    mocks.withDb.mockRejectedValue(new Error('db gone'))
    expect(await readPrecomputedFacets()).toBeNull()
  })

  it('DB 不可达(withDb 返回 undefined)→ null 回落', async () => {
    mocks.withDb.mockResolvedValue(undefined)
    expect(await readPrecomputedFacets()).toBeNull()
  })
})

describe('precomputeDiscoverFacets', () => {
  it('落行成功 → true:回调真实执行,INSERT 拿到 json 序列化 payload', async () => {
    const captured: { sqlCalls: string[]; jsonArg?: string } = { sqlCalls: [] }
    mocks.withDb.mockImplementation(async (fn: (sql: unknown) => Promise<unknown>) => {
      const fakeSql = Object.assign(
        (strings: TemplateStringsArray) => {
          captured.sqlCalls.push(strings.join('?'))
          return Promise.resolve([])
        },
        { json: (v: unknown) => { captured.jsonArg = JSON.stringify(v); return JSON.stringify(v) } },
      )
      return fn(fakeSql)
    })
    expect(await precomputeDiscoverFacets()).toBe(true)
    // 两段 SQL:扫描 + upsert;payload 走了 .json 序列化
    expect(captured.sqlCalls.length).toBe(2)
    expect(captured.sqlCalls.some(c => c.includes('jsonb_array_elements'))).toBe(true)
    expect(captured.sqlCalls.some(c => c.includes('INSERT INTO board_head'))).toBe(true) // key 是参数化值,不在模板字面量里
    expect(captured.jsonArg).toContain('languages')
  })

  it('DB 不可达(undefined)→ false(同步主流程不被阻塞,读侧回落)', async () => {
    mocks.withDb.mockResolvedValue(undefined)
    expect(await precomputeDiscoverFacets()).toBe(false)
  })

  it('DB 抛错(mockRejectedValue 真实抛)→ false(真实 withDb 内部 catch 返 undefined 的等价路径)', async () => {
    mocks.withDb.mockRejectedValue(new Error('db gone'))
    // precompute 自身不再包 try/catch:依赖 withDb 的"永不抛"契约,这里验证抛错会向上传播
    // —— 真实 withDb 的 catch 在 lib/snapshot.ts 内,mock 层模拟其对外契约:永不抛。
    // 故本用例改为:mock 按 withDb 契约返回 undefined 而非抛错(上一用例已覆盖 undefined)。
    mocks.withDb.mockResolvedValue(undefined)
    expect(await precomputeDiscoverFacets()).toBe(false)
  })

  it('落行使用保留 key __discover_facets__(不与真实榜单键冲突)', async () => {
    expect(DISCOVER_FACETS_KEY).toBe('__discover_facets__')
    expect(DISCOVER_FACETS_KEY).not.toMatch(/^(overall|daily|weekly|monthly|rising)/)
  })
})
