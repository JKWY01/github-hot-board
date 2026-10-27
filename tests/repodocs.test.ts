import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { borrowLocalizedRepoDocFetch, readRepoDocWithFallback, storeRepoDoc } from '../lib/repodocs'

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
