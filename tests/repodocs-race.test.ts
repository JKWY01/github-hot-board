/**
 * repo_docs 建表竞态回归(评审十轮)。
 *
 * 背景:生产日志出现 `relation "repo_docs" already exists`(42P07 NOTICE)与
 * 连接池风暴伴生。隔离库多进程实测(10 进程同时 CREATE TABLE IF NOT EXISTS):
 * 1 OK / 9 ERR 23505 duplicate key on pg_type_typname —— IF NOT EXISTS 有检查
 * 窗口,输家报的不是 42P07 而是 23505。修复:ensure 捕获 23505/42P07 按成功处理。
 *
 * 本测试用同进程高并发 Promise 模拟并发建表(真实多进程形态见提交信息实验记录);
 * 断言:全部并发 ensure 成功、表恰好一个。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= process.env.GHB_TEST_PG_URL ?? 'postgres://127.0.0.1:5432/ghb_a1_verify'
})

import { readRepoDoc } from '../lib/repodocs'

const URL_ = process.env.DATABASE_URL!
const hasPg = Boolean(process.env.GHB_TEST_PG)

describe.skipIf(!hasPg)('repo_docs 建表竞态(ensure 23505/42P07 容忍)', () => {
  const admin = postgres(URL_, { max: 1, prepare: false })

  beforeAll(async () => {
    await admin`DROP TABLE IF EXISTS repo_docs`
  })
  afterAll(async () => {
    await admin.end({ timeout: 2 }).catch(() => undefined)
  })

  it('并发 20 路 readRepoDoc(冷启动 ensure 竞态)全部成功,表恰好一个', async () => {
    // readRepoDoc 对空表返回 null(静默),关键是不抛错、表恰好建一次
    const results = await Promise.all(
      Array.from({ length: 20 }, () => readRepoDoc('vercel/next.js', 'en')),
    )
    expect(results.every((r) => r === null)).toBe(true) // 空表 → null(不抛)
    const tables = await admin`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_name = 'repo_docs' AND table_schema = 'public'`
    expect(Number(tables[0].n)).toBe(1)
  })
})
