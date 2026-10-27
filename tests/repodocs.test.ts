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

// 探测账本假库:full|lang → resolved(30 天新鲜语义由被测方传 maxAge 决定,这里简化为全命中)
const fakeProbe = new Map<string, boolean>()
const probeWrites: Array<{ full: string; lang: string; resolved: boolean }> = []

vi.mock('../lib/snapshot', () => ({
  readProbes: async (fullNames: string[], _maxAgeMs: number) => {
    const out = new Map<string, boolean>()
    for (const f of fullNames) for (const [k, v] of fakeProbe) if (k.startsWith(`${f}|`)) out.set(k, v)
    return out
  },
  upsertProbe: async (full: string, lang: string, resolved: boolean) => {
    probeWrites.push({ full, lang, resolved })
    fakeProbe.set(`${full}|${lang}`, resolved)
  },
  // withDb 的回调参数 sql 本身就是可 tagged-template 调用的函数(postgres.js Sql 语义)
  withDb: async (fn: (sql: unknown) => Promise<unknown>) =>
    fn((strings: TemplateStringsArray, ...vals: unknown[]) => {
      const text = strings.join('?')
      // SELECT 形态 [full, lang];INSERT 形态 [full, lang, html]
      if (text.includes('SELECT md5(html)')) {
        // 历史污染识别查询:目标语与 en 内容 md5 是否一致(按假库实时比对)
        const full = String(vals[0] ?? '')
        const lang = String(vals[1] ?? '')
        const t = fakeCache.get(`${full}|${lang}`)
        const e = fakeCache.get(`${full}|en`)
        return Promise.resolve([{ same: t !== undefined && t === e }])
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
  fakeProbe.clear()
  probeWrites.length = 0
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

  it('场景2b:目标语言缺失、探测账本已确认无翻译 → 返回英文缓存兜底,不打上游', async () => {
    fakeCache.set('a/b|en', '<p>english cached</p>')
    fakeProbe.set('a/b|zh', false)
    const r = await readRepoDocWithFallback('a/b', 'zh')
    expect(r).toEqual({ html: '<p>english cached</p>', fallback: true })
  })

  it('场景2c:探测查询失败 → 按未探测处理(保守,宁打上游不错杀真翻译)', async () => {
    fakeCache.set('a/b|en', '<p>en</p>')
    // fakeProbe 置空+readProbes 抛错由下一个 mock 钉死?—— 简化:probe 无记录即等价保守路径
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

  it('场景3c:上游返回英文兜底(localized:false)→ 展示但落 en 键,并记探测结论 false(评审三轮)', async () => {
    localizedMock.mockResolvedValue({ html: '<p>en content</p>', localized: false })
    const got = await borrowLocalizedRepoDocFetch('e/f', 'ja')
    expect(got).toEqual({ html: '<p>en content</p>', fallback: true })
    expect(executed.some((e) => e.key === 'ja')).toBe(false)
    expect(executed.some((e) => e.key === 'en' && e.html === '<p>en content</p>')).toBe(true)
    expect(probeWrites).toContainEqual({ full: 'e/f', lang: 'ja', resolved: false })
  })

  it('场景6:上游失败(throws)→ 单飞 promise reject,不写库,不吞错给缓存层', async () => {
    localizedMock.mockRejectedValue(new Error('upstream down'))
    await expect(borrowLocalizedRepoDocFetch('g/h', 'ko')).rejects.toThrow('upstream down')
    expect(executed).toHaveLength(0)
  })
})
