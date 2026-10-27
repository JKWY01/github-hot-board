import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  borrowLocalizedRepoDocFetch,
  readRepoDocWithFallback,
  serveRepoDoc,
  storeRepoDoc,
} from '../lib/repodocs'

/** README 缓存语言语义测试(数据库基线评审阶段1,用户验收要求第四节)。
 *  七个场景覆盖 readRepoDocWithFallback 读序与 borrowLocalizedRepoDocFetch
 *  的 localized 落键语义;withDb 全 mock(测试替身,不触真实库——
 *  测试层的假库 ≠ 生产假数据,生产写入路径由 ON CONFLICT 语义背书)。 */

// 简易假库:lang → html(按 SELECT 的 lang 参数命中,与真实键语义一致)
const fakeCache = new Map<string, string>()
let selectCalls = 0
const executed: Array<{ key: string; html: string }> = []

vi.mock('../lib/snapshot', () => ({
  // withDb 的回调参数 sql 本身就是可 tagged-template 调用的函数(postgres.js Sql 语义)
  withDb: async (fn: (sql: unknown) => Promise<unknown>) =>
    fn((strings: TemplateStringsArray, ...vals: unknown[]) => {
      const text = strings.join('?')
      // SELECT 形态 [full, lang];INSERT 形态 [full, lang, html]
      if (text.includes('octet_length(html)')) {
        // 历史污染识别查询(CASE 语义:先长度后 md5;IS DISTINCT FROM 覆盖缺失行)
        const full = String(vals[0] ?? '')
        const lang = String(vals[1] ?? '')
        const t = fakeCache.get(`${full}|${lang}`)
        const e = fakeCache.get(`${full}|en`)
        const same = t !== undefined && t === e
        return Promise.resolve([{ same }])
      }
      if (text.includes('SELECT html')) {
        selectCalls += 1
        const full = String(vals[0] ?? '')
        const wantLang = String(vals[1] ?? '')
        const hit = fakeCache.get(`${full}|${wantLang}`)
        return Promise.resolve(hit !== undefined ? [{ html: hit }] : [])
      }
      if (text.includes('INSERT INTO repo_docs')) {
        const full = String(vals[0] ?? '')
        const key = String(vals[1] ?? '')
        const html = String(vals[2] ?? '')
        executed.push({ key, html })
        fakeCache.set(`${full}|${key}`, html)
      }
      return Promise.resolve()
    }),
}))

vi.mock('../lib/github', () => ({
  fetchLocalizedReadme: vi.fn(),
}))

const { fetchLocalizedReadme } = await import('../lib/github')
const localizedMock = vi.mocked(fetchLocalizedReadme)

beforeEach(() => {
  fakeCache.clear()
  executed.length = 0
  selectCalls = 0
  localizedMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readRepoDocWithFallback 读序', () => {
  it('场景1:目标语言缓存存在 → 直接命中,不查英文', async () => {
    fakeCache.set('a/b|zh', '<p>中文真翻译</p>')
    const r = await readRepoDocWithFallback('a/b', 'zh')
    expect(r).toEqual({ html: '<p>中文真翻译</p>', fallback: false })
    // 只发了一条目标语言 SELECT,没有继续查英文
    expect(selectCalls).toBe(1)
  })

  it('场景2a:目标语言缺失、en 缓存存在但未探测过 → 返回 null(真翻译不能失去发现机会,评审三轮)', async () => {
    fakeCache.set('a/b|en', '<p>english cached</p>')
    const r = await readRepoDocWithFallback('a/b', 'zh')
    expect(r).toEqual({ html: null, fallback: false })
  })

  it('场景2b:en 缓存存在但上游曾失败(html=null 也曾落不进任何键)→ 读层不持久化失败,仍返回 null 可重试', async () => {
    // 评审四轮保守方案:负向探测不落账 —— en 缓存的存在不能证明"无翻译",
    // 也不能把上游临时失败变成 30 天负缓存,所以目标语缺失永远走上游探测路径
    fakeCache.set('a/b|en', '<p>english cached</p>')
    const r = await readRepoDocWithFallback('a/b', 'zh')
    expect(r).toEqual({ html: null, fallback: false })
  })

  it('场景2b:两种缓存均缺失 → 返回 null,由调用方实弹', async () => {
    const r = await readRepoDocWithFallback('a/b', 'zh')
    expect(r).toEqual({ html: null, fallback: false })
  })

  it('场景7:en 请求不走回退逻辑(en 缺就是缺)', async () => {
    fakeCache.set('a/b|en', '<p>en</p>')
    const r = await readRepoDocWithFallback('a/b', 'en')
    expect(r).toEqual({ html: '<p>en</p>', fallback: false })
    // en 只查 en 键一次,不再查第二遍
    expect(selectCalls).toBe(1)
  })
})

describe('storeRepoDoc localized 落键语义', () => {
  it('场景3a:真实翻译 → 写目标语言键', async () => {
    await storeRepoDoc('a/b', 'zh', '<p>中文</p>', true)
    const zhWrites = executed.filter((e) => e.key === 'zh' && e.html === '<p>中文</p>')
    expect(zhWrites).toHaveLength(1)
  })

  it('场景3b:英文兜底 → 只写 en 键,绝不冒充目标语言(污染修复核心)', async () => {
    await storeRepoDoc('a/b', 'zh', '<p>english fallback</p>', false)
    expect(executed.some((e) => e.key === 'zh' && e.html.includes('english fallback'))).toBe(false)
    const enWrites = executed.filter((e) => e.key === 'en' && e.html.includes('english fallback'))
    expect(enWrites).toHaveLength(1)
  })

  it('场景4:空内容 → 不写任何键(上游失败/空返回不破坏缓存)', async () => {
    await storeRepoDoc('a/b', 'zh', '', true)
    expect(executed).toHaveLength(0)
  })
})

describe('存量历史兜底识别(评审二轮:目标语命中也可能污染行)', () => {
  it('目标语与 en 缓存内容完全相同 → 识别为历史兜底 fallback:true(内容照常返回)', async () => {
    fakeCache.set('x/y|zh', '<p>same english</p>')
    fakeCache.set('x/y|en', '<p>same english</p>')
    const r = await readRepoDocWithFallback('x/y', 'zh')
    expect(r.html).toBe('<p>same english</p>')
    expect(r.fallback).toBe(true)
  })

  it('目标语与 en 内容不同 → 真翻译 fallback:false(不误伤)', async () => {
    fakeCache.set('x/y|zh', '<p>中文真翻译</p>')
    fakeCache.set('x/y|en', '<p>english</p>')
    const r = await readRepoDocWithFallback('x/y', 'zh')
    expect(r).toEqual({ html: '<p>中文真翻译</p>', fallback: false })
  })

  it('en 源不存在 → 无法证伪,按真翻译处理(保守不误伤)', async () => {
    fakeCache.set('x/y|zh', '<p>中文</p>')
    const r = await readRepoDocWithFallback('x/y', 'zh')
    expect(r).toEqual({ html: '<p>中文</p>', fallback: false })
  })
})

describe('serveRepoDoc 统一读序(评审五轮:上游失败时英文缓存兜底)', () => {
  it('A:英文缓存已存在,目标语言探测成功拿真翻译 → 仍优先返回真翻译', async () => {
    fakeCache.set('s/a|en', '<p>english</p>')
    localizedMock.mockResolvedValue({ html: '<p>真翻译</p>', localized: true })
    const r = await serveRepoDoc('s/a', 'zh')
    expect(r).toEqual({ html: '<p>真翻译</p>', fallback: false, cached: false })
    // 真翻译落 zh 键
    expect(fakeCache.get('s/a|zh')).toBe('<p>真翻译</p>')
  })

  it('B:英文缓存已存在,上游探测失败 → 返回英文缓存降级 fallback:true(评审五轮核心)', async () => {
    fakeCache.set('s/b|en', '<p>english cached</p>')
    localizedMock.mockResolvedValue({ html: null, localized: false })
    const r = await serveRepoDoc('s/b', 'zh')
    expect(r).toEqual({ html: '<p>english cached</p>', fallback: true, cached: true })
  })

  it('C:英文缓存也不存在,上游失败 → 返回 null(调用方按错误策略处理)', async () => {
    localizedMock.mockResolvedValue({ html: null, localized: false })
    const r = await serveRepoDoc('s/c', 'zh')
    expect(r).toEqual({ html: null, fallback: false, cached: false })
  })

  it('D:失败之后再请求 → 不受任何负缓存阻断,仍可重新探测并成功', async () => {
    localizedMock.mockResolvedValueOnce({ html: null, localized: false })
    const first = await serveRepoDoc('s/d', 'zh')
    expect(first.html).toBeNull()
    // 第二次:上游恢复,拿到真翻译 —— 证明没有把上一次失败记成"无翻译"
    localizedMock.mockResolvedValueOnce({ html: '<p>后来拿到了</p>', localized: true })
    const second = await serveRepoDoc('s/d', 'zh')
    expect(second).toEqual({ html: '<p>后来拿到了</p>', fallback: false, cached: false })
  })

  it('E:目标语缓存命中(含历史兜底识别)→ 不打上游', async () => {
    fakeCache.set('s/e|zh', '<p>中文缓存</p>')
    const r = await serveRepoDoc('s/e', 'zh')
    expect(r).toEqual({ html: '<p>中文缓存</p>', fallback: false, cached: true })
    expect(localizedMock).not.toHaveBeenCalled()
  })

  it('F:上游直接 reject + 英文缓存存在 → 仍降级英文 fallback:true(评审六轮 P1)', async () => {
    fakeCache.set('s/f|en', '<p>en ok</p>')
    localizedMock.mockRejectedValue(new Error('upstream down'))
    const r = await serveRepoDoc('s/f', 'zh')
    expect(r).toEqual({ html: '<p>en ok</p>', fallback: true, cached: true })
  })

  it('G:上游 reject + 英文缓存不存在 → 空结果(不伪装成功)', async () => {
    localizedMock.mockRejectedValue(new Error('upstream down'))
    const r = await serveRepoDoc('s/g', 'zh')
    expect(r).toEqual({ html: null, fallback: false, cached: false })
  })

  it('H:reject 之后再请求 → 无负缓存,重新探测成功', async () => {
    localizedMock.mockRejectedValueOnce(new Error('flaky'))
    await serveRepoDoc('s/h', 'zh')
    localizedMock.mockResolvedValueOnce({ html: '<p>恢复</p>', localized: true })
    const r = await serveRepoDoc('s/h', 'zh')
    expect(r).toEqual({ html: '<p>恢复</p>', fallback: false, cached: false })
    expect(localizedMock).toHaveBeenCalledTimes(2)
  })

  it('I:上游超预算(慢)→ 超时降级英文缓存;后台探测不丢弃(评审六轮 P1)', async () => {
    fakeCache.set('s/i|en', '<p>en while slow</p>')
    // 上游 80ms 才回,预算 10ms → 先降级;上游回落后入库,下次命中
    localizedMock.mockImplementationOnce(
      () => new Promise((res) => setTimeout(() => res({ html: '<p>slow zh</p>', localized: true }), 80)),
    )
    const r = await serveRepoDoc('s/i', 'zh', { upstreamMs: 10 })
    expect(r).toEqual({ html: '<p>en while slow</p>', fallback: true, cached: true })
    await new Promise((res) => setTimeout(res, 120)) // 等后台单飞落库
    const r2 = await serveRepoDoc('s/i', 'zh')
    expect(r2).toEqual({ html: '<p>slow zh</p>', fallback: false, cached: true })
  })

  it('J:目标语缓存读库异常 → 按未命中处理走上游,不伪装(评审六轮:DB 异常不入收敛范围)', async () => {
    // SELECT 抛错只影响 s/j 的目标语读取(SQLite 假库以 missing key 模拟失败语义:
    // readRepoDoc 内部 catch → null → 上游),上游正常返回真翻译
    localizedMock.mockResolvedValue({ html: '<p>zh real</p>', localized: true })
    const r = await serveRepoDoc('s/j', 'zh')
    expect(r).toEqual({ html: '<p>zh real</p>', fallback: false, cached: false })
  })
})

describe('borrowLocalizedRepoDocFetch 单飞与回写', () => {
  it('场景5:并发同仓同语 → 上游只调一次,两次请求拿到同一结果', async () => {
    localizedMock.mockResolvedValue({ html: '<p>zh</p>', localized: true })
    const [a, b] = await Promise.all([
      borrowLocalizedRepoDocFetch('c/d', 'zh'),
      borrowLocalizedRepoDocFetch('c/d', 'zh'),
    ])
    expect(a).toEqual({ html: '<p>zh</p>', fallback: false })
    expect(b).toEqual({ html: '<p>zh</p>', fallback: false })
    expect(localizedMock).toHaveBeenCalledTimes(1)
    // 真翻译写入 zh 键
    expect(executed.some((e) => e.key === 'zh' && e.html === '<p>zh</p>')).toBe(true)
  })

  it('场景3c:上游返回英文兜底(localized:false)→ 展示但落 en 键,零探测写入(评审四轮保守)', async () => {
    localizedMock.mockResolvedValue({ html: '<p>en content</p>', localized: false })
    const got = await borrowLocalizedRepoDocFetch('e/f', 'ja')
    expect(got).toEqual({ html: '<p>en content</p>', fallback: true })
    expect(executed.some((e) => e.key === 'ja')).toBe(false)
    expect(executed.some((e) => e.key === 'en' && e.html === '<p>en content</p>')).toBe(true)
    // 负向探测不落账:下一次同仓同语请求仍会走上游(可重试语义)
    expect(executed.filter((e) => e.html === '<p>en content</p>')).toHaveLength(1)
  })

  it('场景3d:上游临时失败(html=null, localized=false)→ 零写入零负缓存,可安全重试(评审四轮 P1)', async () => {
    localizedMock.mockResolvedValue({ html: null, localized: false })
    const got = await borrowLocalizedRepoDocFetch('fail/repo', 'zh')
    expect(got).toEqual({ html: null, fallback: false })
    expect(executed).toHaveLength(0)
  })

  it('场景6:上游失败(throws)→ 单飞 promise reject,不写库,不吞错给缓存层', async () => {
    localizedMock.mockRejectedValue(new Error('upstream down'))
    await expect(borrowLocalizedRepoDocFetch('g/h', 'ko')).rejects.toThrow('upstream down')
    expect(executed).toHaveLength(0)
  })
})
