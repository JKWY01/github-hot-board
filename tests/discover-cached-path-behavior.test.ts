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
    // 评审十四轮:键生成器与首批【键集合】显式建表——后续拒绝键必须不在 firstKeySet 内,
    // 杜绝十四轮指出的"第 2/4 组与首批第 44/4 个重复"。
    const bands = ['s0', 's1', 's2', 's3'] as const
    const ages = ['7', '30', '90', 'year'] as const
    const sorts = ['stars', 'gain'] as const
    const langs = ['typescript', 'python']
    const topics = ['ai', 'web']
    const firstKeys = new Set<string>()
    const first = Array.from({ length: 52 }, (_, i) => {
      const flt = filters({
        lang: langs[i % 2],
        topic: topics[Math.floor(i / 2) % 2],
        band: bands[Math.floor(i / 4) % 4],
        age: ages[Math.floor(i / 16) % 4],
        sort: sorts[Math.floor(i / 64) % 2],
      })
      firstKeys.add(JSON.stringify([flt.lang ?? null, flt.topic ?? null, flt.band ?? null, flt.age ?? null, flt.sort]))
      return discoverQuery({ ...flt, facetsRef: TOP_FACETS })
    })
    // 防御性自检:首批键集合必须恰为 52(若生成器退化出现重复键,测试立即暴露)
    expect(firstKeys.size).toBe(52)
    await new Promise(r => setTimeout(r, 300))
    const mid = __testOnlyLongtailState()
    expect(mid.running).toBe(2)
    expect(mid.queued).toBe(50)
    expect(mid.inflight).toBe(0) // 持久路径不经长尾 single-flight,若误走长尾 inflight>0
    const callsAtMid = sqlCalls
    // 评审十三/十四轮:5 个拒绝请求 = 互不相同 + 均命中 Top 榜 + 与首批 52 键零交集。
    // 生成方式:python/web 固定(均在 Top 榜),枚举 band×age×sort 全 32 组合,
    // 剔除已被首批占用的 python/web 键(13 个),从剩余 19 组中取 5(独立脚本核验
    // 生成器正确性,见评审文档十四轮章节)。
    const rejectFlts = (['s1', 's2', 's3', 's0', 's1'] as const).map((b, i) => {
      void b
      return ([
        { band: 's1', age: 'year', sort: 'stars' },
        { band: 's2', age: 'year', sort: 'stars' },
        { band: 's3', age: 'year', sort: 'stars' },
        { band: 's0', age: '7', sort: 'gain' },
        { band: 's0', age: '30', sort: 'gain' },
      ] as const)[i]
    })
    for (const rf of rejectFlts) {
      const k = JSON.stringify(['python', 'web', rf.band, rf.age, rf.sort])
      expect(firstKeys.has(k)).toBe(false) // 与首批零交集(评审十四轮要求的显式断言)
    }
    const rejectKeys = new Set(rejectFlts.map(rf => JSON.stringify(['python', 'web', rf.band, rf.age, rf.sort])))
    expect(rejectKeys.size).toBe(5) // 互不重复
    const rejects = await Promise.all(rejectFlts.map(rf =>
      discoverQuery({ ...filters({ lang: 'python', topic: 'web', ...rf }), facetsRef: TOP_FACETS })
        .catch((e: unknown) => e)))
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
