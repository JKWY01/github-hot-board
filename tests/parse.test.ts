import { describe, expect, it } from 'vitest'

import { cleanDesc, parseTrendingHtml } from '../lib/parse'

/** 结构对齐 2026-10 官方 trending 页的解析目标(article/h2.lh-condensed/col-9/float-sm-right)。 */
function article(opts: {
  fullName: string
  desc?: string
  lang?: string
  stars?: number
  forks?: number
  growth?: number
  period?: 'day' | 'week' | 'month'
}): string {
  const [owner, repo] = opts.fullName.split('/')
  const stars = opts.stars ?? 1000
  const forks = opts.forks ?? 100
  const fmt = (n: number) => n.toLocaleString('en-US')
  return `<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/${opts.fullName}" data-view-component="true" class="Link">${opts.fullName}</a>
  </h2>
  <p class="col-9 color-fg-muted my-1 pr-4">
    ${opts.desc ?? ''}
  </p>
  <span itemprop="programmingLanguage">${opts.lang ?? 'Python'}</span>
  <a href="/${owner}/${repo}/stargazers" class="Link--muted d-inline-block mr-3">
    <svg aria-label="star" class="octicon"></svg> ${fmt(stars)}
  </a>
  <a href="/${owner}/${repo}/forks" class="Link--muted d-inline-block mr-3">
    <svg aria-label="fork" class="octicon"></svg> ${fmt(forks)}
  </a>
  <span class="d-inline-block float-sm-right">
    <svg class="octicon octicon-star"></svg> ${fmt(opts.growth ?? 0)} stars this ${opts.period ?? 'week'}
  </span>
</article>`
}

const pad = '<!-- ' + 'x'.repeat(600) + ' -->'

describe('parseTrendingHtml', () => {
  it('解析常规条目:名字/描述/语言/星/fork/增量', () => {
    const html = pad + article({
      fullName: 'vercel/next.js', desc: 'The React Framework', lang: 'TypeScript',
      stars: 128000, forks: 27000, growth: 3456, period: 'week',
    })
    const out = parseTrendingHtml(html, 'weekly')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      fullName: 'vercel/next.js',
      desc: 'The React Framework',
      language: 'TypeScript',
      stars: 128000,
      forks: 27000,
      growth: 3456,
      period: 'weekly',
    })
  })

  it('day/week/month 增量词映射到 period', () => {
    for (const [word, period] of [['day', 'daily'], ['week', 'weekly'], ['month', 'monthly']] as const) {
      const out = parseTrendingHtml(pad + article({ fullName: 'a/b', period: word }), 'daily')
      expect(out[0]?.period).toBe(period)
    }
  })

  it('HTML 实体在描述里被解码', () => {
    const out = parseTrendingHtml(pad + article({ fullName: 'a/b', desc: 'A &amp; B &lt;fast&gt; tool' }))
    expect(out[0]?.desc).toBe('A & B <fast> tool')
  })

  it('多页拼接时同名仓库去重(留首个)', () => {
    const html = pad + article({ fullName: 'a/b', stars: 10 }) + article({ fullName: 'a/b', stars: 99 })
    const out = parseTrendingHtml(html)
    expect(out).toHaveLength(1)
    expect(out[0]?.stars).toBe(10)
  })

  it('保留词路径(features/sponsors 等)不进榜', () => {
    const html = pad + article({ fullName: 'sponsors/whatever' })
    expect(parseTrendingHtml(html)).toHaveLength(0)
  })

  it('空串/太短的输入返回空数组而非抛错', () => {
    expect(parseTrendingHtml('')).toEqual([])
    expect(parseTrendingHtml('<article></article>')).toEqual([])
  })
})

describe('cleanDesc', () => {
  it('剥 emoji 与变体选择符、压缩空白', () => {
    expect(cleanDesc('🚀 blazing fast\uFE0F  tool  🔥')).toBe('blazing fast tool')
  })
  it('不动普通文本', () => {
    expect(cleanDesc('A calm description')).toBe('A calm description')
  })
})
