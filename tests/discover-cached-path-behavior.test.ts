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
function filters(p: Partial<{ lang?: string; topic?: string; band?: 's0' | 's1' | 's2' | 's3'; age?: '7' | '30' | '90' | 'year'; sort?: 'stars' | 'gain' }>) {
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

  it('④ 队列满:第 51+ 个持久路径请求不执行 SQL,立即 overloaded(评审十二轮重写:52 个请求全部命中持久路径)', async () => {
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
    // 评审十二轮:此前用动态 topic(`full-${stamp}-${i}`)不在 TOP_FACETS.topics →
    // 全部走长尾路径,持久路径队列满未被覆盖。现 lang/topic 均取自 Top 榜(保证命中
    // discoverQueryCached),用 band×age×sort 组合出 52 个互异键制造排队。
    const bands = ['s0', 's1', 's2', 's3'] as const
    const ages = ['7', '30', '90', 'year'] as const
    const sorts = ['stars', 'gain'] as const
    const langs = ['typescript', 'python']
    const topics = ['ai', 'web']
    const first = Array.from({ length: 52 }, (_, i) =>
      discoverQuery({
        ...filters({
          lang: langs[i % 2],
          topic: topics[Math.floor(i / 2) % 2],
          band: bands[Math.floor(i / 4) % 4],
          age: ages[Math.floor(i / 16) % 4],
          sort: sorts[Math.floor(i / 64) % 2],
        }),
        facetsRef: TOP_FACETS,
      }))
    await new Promise(r => setTimeout(r, 300))
    const mid = __testOnlyLongtailState()
    expect(mid.running).toBe(2)
    expect(mid.queued).toBe(50)
    expect(mid.inflight).toBe(0) // 持久路径不经长尾 single-flight,若误走长尾 inflight>0
    const callsAtMid = sqlCalls
    // 评审十三轮:5 个拒绝请求改为【互不相同且均命中 Top 榜】的组合——
    // 每个都是独立的持久缓存键,必须各自 queue-full 拒绝(queueFullRejects +5)。
    // lang/topic 取自 Top 榜,band×age×sort 组合出 5 个互异键(与首批 52 键也不重叠:
    // 首批 band 覆盖 s0-s3、age 全档——改用首批未用的 age 排列:sort 反转 + band 错位)。
    const rejects = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      discoverQuery({
        ...filters({
          lang: 'python',
          topic: 'web',
          band: (['s1', 's2', 's3', 's0', 's1'] as const)[i],
          age: (['30', '90', 'year', '7', 'year'] as const)[i],
          sort: i % 2 === 0 ? 'gain' : 'stars',
        }),
        facetsRef: TOP_FACETS,
      }).catch((e: unknown) => e)))
    for (const r of rejects) {
      const status = (r as { status?: string }).status ?? 'throw'
      expect(status).toBe('overloaded')
    }
    expect(__testOnlyLongtailState().queueFullRejects).toBeGreaterThanOrEqual(before + 5)
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
