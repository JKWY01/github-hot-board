import { describe, it, expect } from 'vitest'

import { sanitizeDiscoverLang, sanitizeDiscoverTopic } from '@/lib/discover'

/**
 * Discover 参数边界校验(2026-10-29 OOM 事故批)。
 * 三类拆分纪律(外部评审):非法拒绝 / 合法长尾放行 / 既有枚举不动。
 * 拒绝类不进 'use cache'(page 层短路)→ 缓存键空间有界。
 */

describe('sanitizeDiscoverLang', () => {
  it('undefined/空 → undefined(无参,不拒绝)', () => {
    expect(sanitizeDiscoverLang(undefined)).toBeUndefined()
    expect(sanitizeDiscoverLang('')).toBeUndefined()
  })

  it('合法主流语言 → 原样放行', () => {
    expect(sanitizeDiscoverLang('TypeScript')).toBe('TypeScript')
    expect(sanitizeDiscoverLang('python')).toBe('python')
    expect(sanitizeDiscoverLang('C++')).toBe('C++')
    expect(sanitizeDiscoverLang('C#')).toBe('C#')
    expect(sanitizeDiscoverLang('Objective-C')).toBe('Objective-C')
    expect(sanitizeDiscoverLang('Emacs Lisp')).toBe('Emacs Lisp')
  })

  it('合法长尾语言 → 放行(不拿 Top 榜当白名单,SEO 长尾保全)', () => {
    expect(sanitizeDiscoverLang('Zig')).toBe('Zig')
    expect(sanitizeDiscoverLang('Nushell')).toBe('Nushell')
    expect(sanitizeDiscoverLang('VBA')).toBe('VBA')
  })

  it('注入/非法字符形态 → null(拒绝)', () => {
    expect(sanitizeDiscoverLang("x'; DROP TABLE board_head;--")).toBeNull()
    expect(sanitizeDiscoverLang('a"b')).toBeNull()
    expect(sanitizeDiscoverLang('a%20b')).toBeNull()
    expect(sanitizeDiscoverLang('a<b>')).toBeNull()
    expect(sanitizeDiscoverLang('lang=(select)')).toBeNull()
    expect(sanitizeDiscoverLang('../etc/passwd')).toBeNull()
  })

  it('超长(>24)→ null(拒绝;合法语言名远短于此)', () => {
    expect(sanitizeDiscoverLang('a'.repeat(25))).toBeNull()
    expect(sanitizeDiscoverLang('a'.repeat(24))).toBe('a'.repeat(24))
  })
})

describe('sanitizeDiscoverTopic', () => {
  it('undefined/空 → undefined', () => {
    expect(sanitizeDiscoverTopic(undefined)).toBeUndefined()
    expect(sanitizeDiscoverTopic('')).toBeUndefined()
  })

  it('合法 topic(官方命名空间 [a-z0-9-])→ 放行', () => {
    expect(sanitizeDiscoverTopic('ai')).toBe('ai')
    expect(sanitizeDiscoverTopic('machine-learning')).toBe('machine-learning')
    expect(sanitizeDiscoverTopic('c-plus-plus')).toBe('c-plus-plus')
    expect(sanitizeDiscoverTopic('web3')).toBe('web3')
  })

  it('合法长尾 topic → 放行(正常查询,空结果可缓存且键有界)', () => {
    expect(sanitizeDiscoverTopic('reverse-tunnel')).toBe('reverse-tunnel')
    expect(sanitizeDiscoverTopic('i3status')).toBe('i3status')
    expect(sanitizeDiscoverTopic('a')).toBe('a')
  })

  it('大小写混合/下划线/注入/超长 → null(拒绝;笛卡尔积变体靠这些绕缓存键)', () => {
    expect(sanitizeDiscoverTopic('AI')).toBeNull()
    expect(sanitizeDiscoverTopic('Machine_Learning')).toBeNull()
    expect(sanitizeDiscoverTopic('topic spaces')).toBeNull()
    expect(sanitizeDiscoverTopic("topic'--")).toBeNull()
    expect(sanitizeDiscoverTopic('a'.repeat(36))).toBeNull()
    expect(sanitizeDiscoverTopic('a'.repeat(35))).toBe('a'.repeat(35))
  })
})
