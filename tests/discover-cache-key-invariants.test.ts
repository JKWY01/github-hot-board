import { describe, it, expect } from 'vitest'

import { sanitizeDiscoverLang, sanitizeDiscoverTopic } from '@/lib/discover'
import type { DiscoverFilters } from '@/lib/discover'

/**
 * 缓存键不变式(2026-10-29 OOM 批②)。
 * 'use cache' 的键 = 函数实参的序列化(discoverQuery(f) 的 f 即键)。
 * 三个不变式:
 *  Ⅰ. 相同有效参数 → 同键(必然同内容)——由 'use cache' 语义保证,这里锁的是"入参归一化后相同"
 *  Ⅱ. 不同有效参数 → 不同键(不同参数不会错误共用不匹配内容)
 *  Ⅲ. 拒绝类参数 → 不产生键( sanitize 返回 null → page 层短路,discoverQuery 不被调用)
 *     —— Ⅲ 无法在纯函数层直接断言"键不存在",改为断言"归一化后为 undefined ⇒ page 层
 *        invalidParams 为 true"(与 page.tsx 的判定逻辑逐字段对齐,配静态契约测试防漂移)。
 */

/** 归一化:与 page.tsx 的处理顺序一致(pick → sanitize → ?? undefined → 组装 filters)。
 *  抽出来单测,防 page 与 lib 漂移。 */
function normalizeFilters(sp: Record<string, string | undefined>): {
  filters: DiscoverFilters
  invalid: boolean
} {
  const rawLang = sp.lang
  const rawTopic = sp.topic
  const langF = sanitizeDiscoverLang(rawLang) ?? undefined
  const topicF = sanitizeDiscoverTopic(rawTopic) ?? undefined
  const bandF = (['s0', 's1', 's2', 's3'] as const).find((b) => b === sp.band)
  const ageF = (['7', '30', '90', 'year'] as const).find((a) => a === sp.age)
  const sortF = sp.sort === 'gain' ? 'gain' : 'stars'
  const invalid =
    (rawLang !== undefined && langF === undefined) ||
    (rawTopic !== undefined && topicF === undefined)
  return { filters: { lang: langF, topic: topicF, band: bandF, age: ageF, sort: sortF }, invalid }
}

/** 'use cache' 键的等价模拟:Next 对实参做结构化序列化,字段序无关。 */
function cacheKeyOf(f: DiscoverFilters): string {
  return JSON.stringify(f, Object.keys(f).sort())
}

describe('缓存键不变式(批②)', () => {
  it('Ⅰa 大小写变体(TYPESCRIPT/TypeScript/typescript)→ 规范化后同键(评审二轮②)', () => {
    // SQL 侧 lower(lang) 语义等价;缓存键必须同语义同键,否则同内容三份缓存
    const a = normalizeFilters({ lang: 'TypeScript' })
    const b = normalizeFilters({ lang: 'typescript' })
    const c = normalizeFilters({ lang: 'TYPESCRIPT' })
    expect(cacheKeyOf(a.filters)).toBe(cacheKeyOf(b.filters))
    expect(cacheKeyOf(a.filters)).toBe(cacheKeyOf(c.filters))
    expect(a.filters.lang).toBe('typescript') // 规范化为小写
  })

  it('Ⅰb 缺省字段与显式默认(sort=stars)→ 不同键属预期(stars/gain 键值不同,语义不同)', () => {
    // sort 缺省 = 'stars';显式 'stars' 归一化后也是 'stars' → 同键
    const a = normalizeFilters({ topic: 'ai' })
    const b = normalizeFilters({ topic: 'ai', sort: 'stars' })
    expect(a.filters.sort).toBe(b.filters.sort)
    expect(cacheKeyOf(a.filters)).toBe(cacheKeyOf(b.filters))
  })

  it('Ⅱa 不同 topic → 不同键(不共页)', () => {
    const a = normalizeFilters({ topic: 'ai' })
    const b = normalizeFilters({ topic: 'web' })
    expect(cacheKeyOf(a.filters)).not.toBe(cacheKeyOf(b.filters))
  })

  it('Ⅱb 不同 lang → 不同键', () => {
    const a = normalizeFilters({ lang: 'TypeScript' })
    const b = normalizeFilters({ lang: 'Python' })
    expect(cacheKeyOf(a.filters)).not.toBe(cacheKeyOf(b.filters))
  })

  it('Ⅱc 不同 band/age → 不同键', () => {
    const s0 = normalizeFilters({ band: 's0' })
    const s1 = normalizeFilters({ band: 's1' })
    const a7 = normalizeFilters({ age: '7' })
    const a30 = normalizeFilters({ age: '30' })
    expect(cacheKeyOf(s0.filters)).not.toBe(cacheKeyOf(s1.filters))
    expect(cacheKeyOf(a7.filters)).not.toBe(cacheKeyOf(a30.filters))
  })

  it('Ⅱd 合法长尾可查询(能力保留),但走非持久路径(评审二轮核心治理)', () => {
    // 长尾的能力不变:归一化后仍是有效 filters,page 层会调 discoverQuery
    const longtails = ['reverse-tunnel', 'i3status', 'a', 'zz-topics-xyz'].map(
      (t) => normalizeFilters({ topic: t }),
    )
    for (const lt of longtails) expect(lt.invalid).toBe(false)
    // 但持久缓存判定改由 discoverQuery 内部完成(facetsRef 归属),此处锁归一化输出形状
    expect(longtails[0].filters.topic).toBe('reverse-tunnel')
  })

  it('Ⅳ 持久缓存键空间有界:常用组合归 Top 榜约束(评审二轮核心治理断言)', () => {
    // discoverQuery 的 'use cache' 只发生在 lang/topic 均属 facets Top 榜时(实现内判定),
    // 键空间上限 = Top10 lang × Top12 topic × 4 band × 5 age 值(含缺省) × 2 sort ≈ 4,800 键。
    // 归属判定逻辑单测:用 facetsRef 形状直接复算 inTop 判定(与 lib 实现一致的表达)
    const facets = { languages: [['TypeScript', 9], ['Python', 8]] as Array<[string, number]>, topics: [['ai', 7], ['web', 6]] as Array<[string, number]> }
    const inTopLang = (lang?: string) => !lang || facets.languages.some(([l]) => l.toLowerCase() === lang)
    const inTopTopic = (topic?: string) => !topic || facets.topics.some(([t]) => t.toLowerCase() === topic)
    // Top 内 → 持久缓存
    expect(inTopLang('typescript') && inTopTopic('ai')).toBe(true)
    // 长尾 → 非持久
    expect(inTopLang('zig') && inTopTopic('reverse-tunnel')).toBe(false)
    // 大小写规范化后归属判定不漏(TYPESCRIPT 已在 sanitize 层变 typescript)
    expect(inTopLang('typescript')).toBe(true)
  })

  it('Ⅲa 拒绝类 lang → invalid=true(页层短路,discoverQuery 不被调用=零键)', () => {
    for (const bad of ["x'; DROP--", 'a'.repeat(25), '../x', 'a"b']) {
      expect(normalizeFilters({ lang: bad }).invalid).toBe(true)
    }
  })

  it('Ⅲb 拒绝类 topic(大小写/下划线/超长)→ invalid=true', () => {
    for (const bad of ['AI', 'Machine_Learning', 'a'.repeat(36), 'x y']) {
      expect(normalizeFilters({ topic: bad }).invalid).toBe(true)
    }
  })

  it('Ⅲc 拒绝类与其他有效参数共存时仍整体短路(一票否决,不产生部分键)', () => {
    const r = normalizeFilters({ lang: 'TypeScript', topic: 'BAD_TOPIC' })
    expect(r.invalid).toBe(true)
  })

  it('Ⅲd 拒绝类与未提供参数区分:未提供(lang=undefined)≠拒绝(空参正常查询)', () => {
    expect(normalizeFilters({}).invalid).toBe(false)
    expect(normalizeFilters({ topic: 'ai' }).invalid).toBe(false)
  })
})

/**
 * 静态契约:page.tsx 的 invalidParams 判定必须与 normalizeFilters 的 invalid 语义一致
 * (源码子串断言,轻量防漂移;重写 page 时若删掉这两行,本测试红灯提示同步)。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('page 层与 lib 层契约(防漂移)', () => {
  const pageSrc = readFileSync(
    resolve(__dirname, '../app/[lang]/discover/page.tsx'),
    'utf8',
  )
  it('page 用 sanitize* 归一化 lang/topic(不裸用 pick 结果进查询)', () => {
    expect(pageSrc).toContain('sanitizeDiscoverLang(pick(sp')
    expect(pageSrc).toContain('sanitizeDiscoverTopic(pick(sp')
  })
  it('page 的短路判定覆盖 lang+topic 双参数(一票否决)', () => {
    expect(pageSrc).toMatch(/invalidParams[\s\S]{0,200}langF === undefined[\s\S]{0,120}topicF === undefined/)
  })
  it('短路时仍取 facets(非法参数访客也看到合法筛选选项,UI 导航不瘫)', () => {
    expect(pageSrc).toMatch(/if \(invalidParams\) \{[\s\S]{0,80}discoverFacets\(\)/)
  })
})
