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
  __testOnlyObserve,
  __testOnlyEndBarrier,
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

  it('真实并发竞态:A 故障处理未完成时 B 建立 —— B 现役不被误关,A 被正确 end(身份护栏)', async () => {
    __testOnlyResetState()
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    await admin`SELECT 1`

    // 场景时序(评审七轮:确定性 barrier,不用固定 sleep):
    // A 请求已失败 → withDb catch 同步清现役 → 【屏障:暂停在 end 之前】→
    // 测试确认"已进入暂停态"后让 B 建池并查询成功 → 释放屏障 → A 的 end 完整结束。
    let createCount = 0
    let endCount = 0
    __testOnlyObserve({
      onPoolCreate: () => { createCount += 1 },
      onPoolEnd: () => { endCount += 1 },
    })

    // ① 建池 A
    const r1 = await withDb(async (sql) => 1)
    expect(r1).toBe(1)
    const poolA = __testOnlyPoolState().current!
    expect(createCount).toBe(1)

    // ② 屏障:拦住 A 的 end(挂在真实 end 调用点之前)。"已到达暂停点"的确定性信号
    //    = onPoolEnd 计数(它在清现役之后、屏障之前被调用):endCount===1 即 A 已完成
    //    同步清理并停在屏障前,不是固定 sleep。
    let releaseEnd!: () => void
    const endGate = new Promise<void>((resolve) => { releaseEnd = resolve })
    __testOnlyEndBarrier(endGate)

    // ③ 路1:A 上致命故障 → withDb catch → 同步清现役 → 卡在屏障(await endGate)
    const failA = withDb(async () => {
      throw Object.assign(new Error('connection failure'), { code: '08006' })
    })
    await vi.waitFor(() => expect(endCount).toBe(1))   // 确定性:A 已到达屏障
    expect(__testOnlyPoolState().current).toBeNull()   // A 的同步清理已完成

    // ④ 路2:B 建池并查询成功 —— 发生在 A 的故障处理尚未结束之时(屏障仍挂着)
    const buildB = withDb(async (sql) => {
      const rows = (await sql`SELECT 99 AS b`) as unknown as Array<{ b: number | string }>
      return Number(rows[0].b)
    })
    const rB = await buildB
    expect(rB).toBe(99)
    const poolB = __testOnlyPoolState().current!
    expect(poolB).not.toBeNull()
    expect(poolB).not.toBe(poolA)             // B 是新现役池
    expect(createCount).toBe(2)               // 恰好两次建池(A、B)
    expect(__testOnlyPoolState().current).toBe(poolB)  // A 的故障处理仍停在屏障(未结束)

    // ⑤ 释放屏障:A 的 end 完整结束
    releaseEnd()
    await failA
    expect(endCount).toBe(1)                  // A 被 end(且仅一次)

    // ③ 四断言(评审指定):B 仍是现役;B 连续查询成功;poolInit 指向 B 的现役状态;
    //    A 已被正确关闭(endCount 已证)且不再回来
    expect(__testOnlyPoolState().current).toBe(poolB)
    expect(__testOnlyPoolState().initializing).toBe(false)
    for (let i = 0; i < 3; i++) {
      const r = await withDb(async (sql) => {
        const rows = (await sql`SELECT ${100 + i} AS c`) as unknown as Array<{ c: number | string }>
        return Number(rows[0].c)
      })
      expect(r).toBe(100 + i)
    }
    expect(__testOnlyPoolState().current).toBe(poolB)
    // 判别力断言:B 现役后连续查询阶段不得再触发建池(若旧故障处理误清了 B,
    // 这里会出现第 3 次建池 —— 回归即红)
    expect(createCount).toBe(2)
    expect(endCount).toBe(1)

    __testOnlyObserve({}) // 清观测钩子
    __testOnlyEndBarrier(null) // 清屏障
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

  it('冷启动并发 5 请求只创建一次池、无游离池(创建/销毁计数观测)', async () => {
    __testOnlyResetState()
    const admin = postgres(GHB_TEST_URL, { max: 1, prepare: false })
    await admin`SELECT 1`
    let createCount = 0
    let endCount = 0
    __testOnlyObserve({
      onPoolCreate: () => { createCount += 1 },
      onPoolEnd: () => { endCount += 1 },
    })
    const results = await Promise.all([
      withDb(async (sql) => { const r = (await sql`SELECT 1 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 2 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 3 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 4 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
      withDb(async (sql) => { const r = (await sql`SELECT 5 AS n`) as unknown as Array<{ n: number | string }>; return Number(r[0].n) }),
    ])
    expect(results).toEqual([1, 2, 3, 4, 5])
    // 评审六轮指定断言:5 个并发请求只触发一次池创建;0 次销毁 = 没有游离池被丢弃
    expect(createCount).toBe(1)
    expect(endCount).toBe(0)
    // 状态机单例不变量
    expect(__testOnlyPoolState().current).not.toBeNull()
    expect(__testOnlyPoolState().initializing).toBe(false)
    __testOnlyObserve({}) // 清观测钩子
    await admin.end({ timeout: 2 }).catch(() => undefined)
    __testOnlyResetState()
  })
})
