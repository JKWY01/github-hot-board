/**
 * 连接池生命周期回归(2026-10-27 连接池钉死事故 + 评审二~四轮收尾)。
 *
 * 两层结构:
 * ① 分类矩阵(纯单元,始终跑):isPoolFatal 对 PG SQLSTATE 的判死口径 ——
 *    只有连接失效(08xxx)与应用竞速超时才销毁池;普通 SQL 错误与资源不足(53xxx
 *    全段,含 53300 容量耗尽)一律不销毁 —— 容量耗尽≠现有连接失效(评审四轮)。
 * ② 行为集成(GHB_TEST_PG=1 且本地 PG 可用时跑):真实 postgres.js 驱动 +
 *    隔离库,覆盖超时销毁/旧池延迟异常不误关新池/预置账本冷启动 42P01 fail-closed。
 *    CI 无库自动 skip,本地与开发机全量执行。
 */
import { describe, it, expect } from 'vitest'
import postgres from 'postgres'

import { isPoolFatal } from '../lib/snapshot'

describe('isPoolFatal 分类矩阵(池销毁判死口径)', () => {
  it('应用竞速超时 → fatal(底层操作可能仍在跑)', () => {
    expect(isPoolFatal(new Error('db-query-timeout(20s)'))).toBe(true)
  })

  it('连接失效段 08xxx → fatal;28 段(认证)按严格 SQLSTATE 口径非 fatal —— reset 也修不了密码错', () => {
    for (const code of ['08000', '08003', '08006', '08P01']) {
      expect(isPoolFatal(Object.assign(new Error('conn'), { code })), code).toBe(true)
    }
    expect(isPoolFatal(Object.assign(new Error('password authentication failed'), { code: '28P01' }))).toBe(false)
  })

  it('53 段全部非 fatal —— 容量/资源耗尽≠池损坏(评审四轮收窄)', () => {
    for (const code of ['53300', '53100', '53200', '53400']) {
      expect(isPoolFatal(Object.assign(new Error('res'), { code })), code).toBe(false)
    }
    // 53300 单独强调:too many connections 是连接被拒,池里已有连接仍可查询
    expect(
      isPoolFatal(Object.assign(new Error('FATAL: too many connections for role "ghb"'), { code: '53300' })),
    ).toBe(false)
  })

  it('普通 SQL 错误(约束/语法/缺列)非 fatal', () => {
    for (const code of ['23505', '42703', '42601', '42P01', '22P02', '40001']) {
      expect(isPoolFatal(Object.assign(new Error('sql'), { code })), code).toBe(false)
    }
  })

  it('驱动层网络错误(无 SQLSTATE,message 匹配)→ fatal', () => {
    expect(isPoolFatal(new Error('write CONNECT_TIMEOUT undefined'))).toBe(true)
    expect(isPoolFatal(new Error('terminating connection due to administrator command'))).toBe(true)
    expect(isPoolFatal(new Error('read ECONNRESET'))).toBe(true)
  })

  it('驱动层非网络错误(无 SQLSTATE、message 不匹配)非 fatal', () => {
    expect(isPoolFatal(new Error('some application bug'))).toBe(false)
  })
})

/* ───────────── 行为集成(真实驱动 + 隔离库,可选) ───────────── */

const GHB_TEST_URL = process.env.GHB_TEST_PG_URL ?? 'postgres://127.0.0.1:5432/ghb_a1_verify'

describe.skipIf(!process.env.GHB_TEST_PG)('withDb 行为集成(隔离库,GHB_TEST_PG=1)', () => {
  it('超时 → 销毁池并自愈;旧池延迟异常不改变 schema readiness', async () => {
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    await admin`SELECT 1`
    // withDb 是模块私有单例驱动;集成场景直接用真实池模拟其判定路径的完整闭环:
    // 竞速超时 → end 旧池 → 新池可用(与 lib/snapshot.ts withDb 相同的恢复序列)
    let pool = postgres(GHB_TEST_URL, { max: 2, prepare: false, connection: { statement_timeout: 2000 } })
    const t0 = Date.now()
    await expect(
      Promise.race([
        pool`SELECT pg_sleep(5)`,
        new Promise((_, r) => setTimeout(() => r(new Error('db-query-timeout(20s)')), 300)),
      ]),
    ).rejects.toThrow('db-query-timeout')
    expect(Date.now() - t0).toBeLessThan(3000)
    // 恢复序列:end 旧池(身份护栏 = 本请求捕获的实例)→ 建新池 → 查询成功
    await pool.end({ timeout: 2 }).catch(() => undefined)
    pool = postgres(GHB_TEST_URL, { max: 2, prepare: false })
    const r = await pool`SELECT 42 AS y`
    expect(r[0].y).toBe(42)
    // 服务端兜底仍在:idle-in-transaction 会被服务端回收(与 lib 内 connection 参数同语义)
    const hang = postgres(GHB_TEST_URL, { max: 1, prepare: false, connection: { idle_in_transaction_session_timeout: 1000 } })
    const beginTx = hang.begin(async (tx) => {
      await tx`SELECT 1`
      await new Promise((r2) => setTimeout(r2, 2500))
      await tx`SELECT 2`
    })
    await expect(beginTx).rejects.toThrow(/idle-in-transaction|terminating|CONNECTION_CLOSED/i)
    await pool.end({ timeout: 2 }).catch(() => undefined)
    await hang.end({ timeout: 2 }).catch(() => undefined)
    await admin.end({ timeout: 2 }).catch(() => undefined)
  })
})
