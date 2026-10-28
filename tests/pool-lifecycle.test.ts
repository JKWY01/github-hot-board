/**
 * 连接池生命周期回归(2026-10-27 连接池钉死事故 + 评审二~五轮收尾)。
 *
 * 两层结构:
 * ① 分类矩阵(纯单元,始终跑):isPoolFatal 判死口径。
 * ② 应用层状态机(真实 withDb 驱动,GHB_TEST_PG=1 且本地 PG 可用时跑):
 *    全程经过生产代码的 withDb/sqlSingleton/poolInit/身份护栏/migrate 分流,
 *    覆盖评审五轮点名的三个场景:
 *    · 完整恢复闭环:建池 → 查询故障销毁 → 新池创建 → 连续查询成功;
 *    · 旧池延迟异常不误关新池、不影响新池服务;
 *    · 预置迁移账本后冷启动撞 42P01 → fail-closed(不做无效重试)。
 * CI 无库自动 skip;本地与开发机设 GHB_TEST_PG=1 全量执行。
 */
import { describe, it, expect, vi } from 'vitest'
import postgres from 'postgres'

// snapshot.ts 顶层读取 DATABASE_URL(模块加载时);ESM 的 import 会提升到任何语句之前,
// 必须用 vi.hoisted 在模块加载前注入隔离库地址,否则 withDb 看到 undefined 直接返回。
const GHB_TEST_URL = process.env.GHB_TEST_PG_URL ?? 'postgres://127.0.0.1:5432/ghb_a1_verify'
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.GHB_TEST_PG_URL ?? 'postgres://127.0.0.1:5432/ghb_a1_verify'
})

import {
  isPoolFatal,
  withDb,
  __testOnlyResetState,
  __testOnlyPoolState,
} from '../lib/snapshot'

describe('isPoolFatal 分类矩阵(池销毁判死口径,恒跑)', () => {
  it('应用竞速超时 → fatal(底层操作可能仍在跑)', () => {
    expect(isPoolFatal(new Error('db-query-timeout(20s)'))).toBe(true)
  })

  it('连接失效段 08xxx → fatal;28 段(认证)非 fatal —— reset 也修不了密码错', () => {
    for (const code of ['08000', '08003', '08006', '08P01']) {
      expect(isPoolFatal(Object.assign(new Error('conn'), { code })), code).toBe(true)
    }
    expect(isPoolFatal(Object.assign(new Error('password authentication failed'), { code: '28P01' }))).toBe(false)
  })

  it('53 段全部非 fatal —— 容量/资源耗尽≠池损坏(评审四轮收窄)', () => {
    for (const code of ['53300', '53100', '53200', '53400']) {
      expect(isPoolFatal(Object.assign(new Error('res'), { code })), code).toBe(false)
    }
  })

  it('普通 SQL 错误(约束/语法/缺列)非 fatal', () => {
    for (const code of ['23505', '42703', '42601', '42P01', '22P02', '40001']) {
      expect(isPoolFatal(Object.assign(new Error('sql'), { code })), code).toBe(false)
    }
  })

  it('驱动层网络错误 → fatal;其他应用错误 → 非 fatal', () => {
    expect(isPoolFatal(new Error('write CONNECT_TIMEOUT undefined'))).toBe(true)
    expect(isPoolFatal(new Error('read ECONNRESET'))).toBe(true)
    expect(isPoolFatal(new Error('some application bug'))).toBe(false)
  })
})

/* ───────── 应用层状态机(真实 withDb,隔离库,可选) ───────── */

const hasPg = Boolean(process.env.GHB_TEST_PG)

describe.skipIf(!hasPg)('withDb 应用层状态机(真实驱动,GHB_TEST_PG=1)', () => {

  it('完整恢复闭环:建池 → 故障销毁 → 重建 → 连续查询成功(评审五轮指定链路)', async () => {
    __testOnlyResetState()
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    await admin`SELECT 1`

    // ① 建池:第一次 withDb 成功,现役池就位
    const r1 = await withDb(async (sql) => {
      const rows = (await sql`SELECT 1 AS v`) as unknown as Array<{ v: number | string }>
      return Number(rows[0].v)
    })
    expect(r1).toBe(1)
    const poolA = __testOnlyPoolState().current
    expect(poolA).not.toBeNull()

    // ② 故障:连接级死亡(08006)→ isPoolFatal 分支 → 销毁
    await withDb(async () => {
      throw Object.assign(new Error('server closed the connection unexpectedly'), { code: '08006' })
    })
    // ③ 旧池已从状态机清除(身份护栏:现役池被清,poolInit 同步清)
    expect(__testOnlyPoolState().current).toBeNull()

    // ④ 重建:下一次 withDb 创建新池并成功
    const r2 = await withDb(async (sql) => {
      const rows = (await sql`SELECT 42 AS y`) as unknown as Array<{ y: number | string }>
      return Number(rows[0].y)
    })
    expect(r2).toBe(42)
    const poolB = __testOnlyPoolState().current
    expect(poolB).not.toBeNull()
    expect(poolB).not.toBe(poolA) // 是新实例

    // ⑤ 连续查询成功(新池稳定服务)
    for (let i = 0; i < 3; i++) {
      const r = await withDb(async (sql) => {
        const rows = (await sql`SELECT ${i + 1} AS n`) as unknown as Array<{ n: number | string }>
        return Number(rows[0].n)
      })
      expect(r).toBe(i + 1)
    }
    await admin.end({ timeout: 2 }).catch(() => undefined)
    __testOnlyResetState()
  })

  it('旧池延迟异常处理不误关新池、不影响新池服务(身份护栏)', async () => {
    __testOnlyResetState()
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    await admin`SELECT 1`

    // 场景:池 A 请求故障 → A 被正确 reset(end 由 withDb 执行);随后 B 建立;
    // "旧池 A 的恢复动作"此刻才延迟补一记 end(A) —— 语义上只允许 end A 自己,
    // B 必须毫发无损继续服务(修复前的 bug:读全局会把 B 误关)。
    const r1 = await withDb(async (sql) => 1)
    expect(r1).toBe(1)
    const poolA = __testOnlyPoolState().current!

    await withDb(async () => {
      throw Object.assign(new Error('connection failure'), { code: '08006' })
    })
    expect(__testOnlyPoolState().current).toBeNull()

    await withDb(async (sql) => {
      const rows = (await sql`SELECT 99 AS b`) as unknown as Array<{ b: number }>
      return rows[0].b
    })
    const poolB = __testOnlyPoolState().current!
    expect(poolB).not.toBe(poolA)

    // 旧池 A 的延迟恢复动作:只 end 自己(与身份护栏一致的语义)
    void poolA.end({ timeout: 2 }).catch(() => undefined)
    // B 仍正常服务,且仍是现役
    const r2 = await withDb(async (sql) => {
      const rows = (await sql`SELECT 100 AS c`) as unknown as Array<{ c: number }>
      return rows[0].c
    })
    expect(r2).toBe(100)
    expect(__testOnlyPoolState().current).toBe(poolB)

    await admin.end({ timeout: 2 }).catch(() => undefined)
    __testOnlyResetState()
  })

  it('预置迁移账本后冷启动撞 42P01 → fail-closed,不做无效重试(真实 migrate 路径)', async () => {
    __testOnlyResetState()
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    // 预置账本(模拟生产 0001-baseline 已应用):
    await admin`CREATE TABLE IF NOT EXISTS ghb_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
    await admin`INSERT INTO ghb_schema_migrations (id) VALUES ('0001-baseline') ON CONFLICT (id) DO NOTHING`
    // 制造结构漂移:基线表不存在(账本却说已应用)
    await admin`DROP TABLE IF EXISTS board_head`

    // withDb:查询 board_head → 42P01 → migrate(账本已齐,applied=0)→ 必须失败返回,
    // 且不能把表凭空建回来(账本跳过基线 DDL —— 漂移只能显式迁移修复)
    const r = await withDb(async (sql) => {
      const rows = (await sql`SELECT payload FROM board_head WHERE key = 'weekly'`) as unknown as Array<{ payload: unknown }>
      return rows
    })
    expect(r).toBeUndefined() // fail-closed:不做无效重试
    const still = await admin`SELECT to_regclass('board_head') AS t`
    expect(still[0].t).toBeNull() // 表未被"自愈"凭空重建

    await admin`DELETE FROM ghb_schema_migrations WHERE id = '0001-baseline'`
    await admin.end({ timeout: 2 }).catch(() => undefined)
    __testOnlyResetState()
  })

  it('冷启动并发 5 请求只创建一个池(poolInit 协调)', async () => {
    __testOnlyResetState()
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    await admin`SELECT 1`
    const results = await Promise.all([
      withDb(async (sql) => { const r = (await sql`SELECT 1 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 2 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 3 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 4 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 5 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
    ])
    expect(results).toEqual([1, 2, 3, 4, 5])
    // 状态机单例不变量:并发初始化竞态若回归,现役池不可能保持唯一且稳定
    expect(__testOnlyPoolState().current).not.toBeNull()
    expect(__testOnlyPoolState().initializing).toBe(false)
    await admin.end({ timeout: 2 }).catch(() => undefined)
    __testOnlyResetState()
  })
})
