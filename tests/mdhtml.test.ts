import { describe, expect, it } from 'vitest'

import { absolutizeMdHtml, findLocalizedReadmePath, normRel, pickLeadLine, scriptOk } from '../lib/mdhtml'

describe('normRel', () => {
  it('归一化 ./ 与 ../ 段', () => {
    expect(normRel('docs/./readme/../a.md')).toBe('docs/a.md')
    expect(normRel('./a.md')).toBe('a.md')
    expect(normRel('a/../../b.md')).toBe('b.md') // .. 越过根:段被 pop 空,不报错
  })
})

describe('absolutizeMdHtml', () => {
  const full = 'vercel/next.js'
  const branch = 'canary'

  it('根相对链接补 GitHub 域', () => {
    const out = absolutizeMdHtml(`<a href="/vercel/next.js/blob/canary/x.md">x</a>`, full, branch, '')
    expect(out).toContain('href="https://github.com/vercel/next.js/blob/canary/x.md"')
  })

  it('文档目录下的裸相对链按目录落位并归一化 ../', () => {
    const out = absolutizeMdHtml(`<a href="../img/logo.svg">logo</a>`, full, branch, 'docs/readme')
    expect(out).toContain(`href="https://github.com/${full}/blob/${branch}/docs/img/logo.svg"`)
  })

  it('同目录裸相对图片指向 raw CDN', () => {
    const out = absolutizeMdHtml(`<img src="assets/a.png">`, full, branch, 'docs')
    expect(out).toContain(`src="https://raw.githubusercontent.com/${full}/${branch}/docs/assets/a.png"`)
  })

  it('外链补新标签;页内锚点保持原样', () => {
    const out = absolutizeMdHtml(`<a href="https://ex.com">e</a><a href="#sec">s</a>`, full, branch, '')
    expect(out).toContain('<a target="_blank" rel="noopener noreferrer" href="https://ex.com"')
    expect(out).toContain('<a href="#sec">s</a>')
  })

  it('http/mailto/javascript 链接不被改写为仓库路径', () => {
    const out = absolutizeMdHtml(`<a href="mailto:a@b.c">m</a><a href="javascript:x">j</a>`, full, branch, '')
    expect(out).toContain('href="mailto:a@b.c"')
    expect(out).toContain('href="javascript:x"')
  })
})

describe('scriptOk(语言文字系统判定)', () => {
  it('中文需 ≥6 个汉字', () => {
    expect(scriptOk('zh', '这是一个足够长的中文句子')).toBe(true)
    expect(scriptOk('zh', 'short')).toBe(false)
  })
  it('日文认假名或足量汉字', () => {
    expect(scriptOk('ja', 'これはテストです')).toBe(true)
    expect(scriptOk('ja', 'english only text')).toBe(false)
  })
  it('拉丁系要词数与字母量双下限', () => {
    expect(scriptOk('de', 'Ein sehr schnelles Werkzeug fuer alle')).toBe(true)
    expect(scriptOk('de', 'hi')).toBe(false)
  })
})

describe('pickLeadLine(首句提取)', () => {
  it('取第一段合法文本', () => {
    const html = '<p>🚀🚀</p><p>Next.js is the React framework for the web.</p>'
    expect(pickLeadLine(html, 'en')).toBe('Next.js is the React framework for the web.')
  })
  it('中文段落要过文字系统', () => {
    const html = '<p>Next.js 是一个用于生产环境的 React 框架</p>'
    expect(pickLeadLine(html, 'zh')).toContain('React 框架')
  })
  it('语言切换器段(· 分隔)被跳过', () => {
    const html = '<p>English · 简体中文 · 日本語</p><p>English description line here now</p>'
    expect(pickLeadLine(html, 'en')).toBe('English description line here now')
  })
})

describe('findLocalizedReadmePath(语言切换器解析)', () => {
  const branch = 'main'
  it('短锚文本命中并剥掉前缀', () => {
    const html = `<p><a href="https://github.com/a/b/blob/main/README.zh-CN.md">简体中文</a></p>`
    expect(findLocalizedReadmePath(html, 'a/b', branch, 'zh')).toBe('README.zh-CN.md')
  })
  it('长正文(>24 字符)里的"中文"字样不误触', () => {
    const html = `<p><a href="https://github.com/a/b/blob/main/docs/guide.md">这份指南详细教你如何撰写并维护中文文档,以及如何把它们发布到开源社区</a></p>`
    expect(findLocalizedReadmePath(html, 'a/b', branch, 'zh')).toBeNull()
  })
})
