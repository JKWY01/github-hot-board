import { afterEach, describe, expect, it } from 'vitest'

import { isLocalRequest, requireCronAuth, secretMatches } from '../lib/apiguard'

const LOCAL = 'http://localhost:3000/api/sync'
const PUBLIC = 'https://git.vaiox.xyz/api/sync'

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('secretMatches(常数时间比较)', () => {
  it('相等通过,不等拒绝,大小写敏感', () => {
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abc', 'abd')).toBe(false)
    expect(secretMatches('ABC', 'abc')).toBe(false)
  })
  it('长度不等同样安全拒绝', () => {
    expect(secretMatches('', 'abc')).toBe(false)
    expect(secretMatches('abcdef', 'abc')).toBe(false)
  })
})

describe('requireCronAuth', () => {
  it('未配 CRON_SECRET:本地放行,公网拒绝(fail-closed)', () => {
    delete process.env.CRON_SECRET
    expect(requireCronAuth(new Request(LOCAL))).toBeNull()
    const denied = requireCronAuth(new Request(PUBLIC))
    expect(denied?.status).toBe(401)
  })

  it('配了 CRON_SECRET:Bearer 头匹配才放行', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireCronAuth(new Request(PUBLIC, { headers: { authorization: 'Bearer s3cret' } }))).toBeNull()
    expect(requireCronAuth(new Request(PUBLIC, { headers: { authorization: 'Bearer wrong' } }))?.status).toBe(401)
    expect(requireCronAuth(new Request(PUBLIC))?.status).toBe(401)
  })

  it('配了 CRON_SECRET:query 里的 secret 不再生效(防进日志)', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireCronAuth(new Request(`${PUBLIC}?secret=s3cret`))?.status).toBe(401)
  })

  it('配了 CRON_SECRET 时连本地也要带头(口径唯一)', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireCronAuth(new Request(LOCAL))?.status).toBe(401)
    expect(requireCronAuth(new Request(LOCAL, { headers: { authorization: 'Bearer s3cret' } }))).toBeNull()
  })
})

describe('isLocalRequest', () => {
  it('loopback 域名判定', () => {
    expect(isLocalRequest(new Request('http://localhost:3000/x'))).toBe(true)
    expect(isLocalRequest(new Request('http://127.0.0.1:3000/x'))).toBe(true)
    expect(isLocalRequest(new Request('https://git.vaiox.xyz/x'))).toBe(false)
  })
  it('XFF 首段私网地址判定(自托管反代场景)', () => {
    const h = (ip: string) => new Request('https://git.vaiox.xyz/x', { headers: { 'x-forwarded-for': ip } })
    expect(isLocalRequest(h('192.168.1.10'))).toBe(true)
    expect(isLocalRequest(h('10.0.0.3, 1.2.3.4'))).toBe(true)
    expect(isLocalRequest(h('172.16.0.9'))).toBe(true)
    expect(isLocalRequest(h('8.8.8.8'))).toBe(false)
  })
})
