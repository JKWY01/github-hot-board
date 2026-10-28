import { it, expect } from 'vitest'
import { isIsolatedTestDatabase } from './helpers/isolated-pg'

it('守卫矩阵:双条件同时满足才放行', () => {
  // 允许
  expect(isIsolatedTestDatabase('postgres://127.0.0.1:5432/ghb_a1_verify')).toBe(true)
  expect(isIsolatedTestDatabase('postgres://localhost:5432/ghb_test')).toBe(true)
  expect(isIsolatedTestDatabase('postgres://user:pw@localhost/ghb_a1_verify?sslmode=require')).toBe(true)
  // 拒绝:远程主机 + 测试库名
  expect(isIsolatedTestDatabase('postgres://u:p@45.197.146.227:5432/ghb_test')).toBe(false)
  expect(isIsolatedTestDatabase('postgres://u:p@prod.example.com/ghb_a1_verify')).toBe(false)
  // 拒绝:本地主机 + 非测试库名(生产库)
  expect(isIsolatedTestDatabase('postgres://127.0.0.1:5432/ghb')).toBe(false)
  expect(isIsolatedTestDatabase('postgres://localhost:5432/production')).toBe(false)
  // 拒绝:子串伪装(库名含测试名但不是完整匹配)
  expect(isIsolatedTestDatabase('postgres://127.0.0.1:5432/ghb_a1_verify_prod')).toBe(false)
  expect(isIsolatedTestDatabase('postgres://127.0.0.1:5432/xghb_test')).toBe(false)
  // 拒绝:不可解析/空
  expect(isIsolatedTestDatabase(undefined)).toBe(false)
  expect(isIsolatedTestDatabase('')).toBe(false)
  expect(isIsolatedTestDatabase('not a url')).toBe(false)
})
