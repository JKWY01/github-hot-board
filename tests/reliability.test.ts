import { afterEach, describe, expect, it } from 'vitest'

/** 外部审查(2026-10-26)揪出的可靠性红线,回归钉死。
 *  真网络调用太慢(配额节流 6.2s/发),这里不打真 GitHub —— 用"注入非法 process.env
 *  后行为契约"与纯函数语义锚定:回归只验"语义没被改回去",不测网络。 */

const ORIG_TOKENS = process.env.GITHUB_TOKENS
const ORIG_TOKEN = process.env.GITHUB_TOKEN

afterEach(() => {
  if (ORIG_TOKENS === undefined) delete process.env.GITHUB_TOKENS
  else process.env.GITHUB_TOKENS = ORIG_TOKENS
  if (ORIG_TOKEN === undefined) delete process.env.GITHUB_TOKEN
  else process.env.GITHUB_TOKEN = ORIG_TOKEN
})

describe('外部审查红线:取数失败语义(源码契约)', () => {
  it('getDarkData 源码不得吞 ghSearch 异常(catch 归零 = 空榜覆盖好榜)', async () => {
    // 直接读源码做静态断言:这段代码的失败模式曾是"上游抖一下→空榜进库",
    // 任何把 try/catch 加回来的改动都必须先改这条测试,属于故意设卡。
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../lib/boards.ts', import.meta.url), 'utf8')
    const darkBody = src.slice(src.indexOf('export async function getDarkData'), src.indexOf('export async function getOverlookedData'))
    expect(darkBody).not.toMatch(/catch\s*(\(\w*\))?\s*\{\s*\n?\s*repos\s*=\s*\[\]/)
    expect(darkBody).toMatch(/await ghSearch/)
  })

  it('getMilestoneData 部分失败必须标 degraded(返回值带 degraded 字段)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../lib/boards.ts', import.meta.url), 'utf8')
    const msBody = src.slice(src.indexOf('export async function getMilestoneData'), src.indexOf('/** 冲线语义'))
    expect(msBody).toMatch(/failedThresholds/)
    expect(msBody).toMatch(/degraded:\s*failedThresholds\.length > 0/)
  })

  it('writeHeadAndRows 必须在 sql.begin 事务内写三张表', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../lib/snapshot.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export async function writeHeadAndRows'))
    expect(body).toMatch(/sql\.begin/)
    expect(body).toMatch(/INSERT INTO board_head/)
    expect(body).toMatch(/INSERT INTO board_snapshots/)
    expect(body).toMatch(/INSERT INTO repo_seen/)
  })
})

describe('冲线语义回归锚(不变量)', () => {
  it('档位与 nextThreshold 语义不变', async () => {
    const { MILESTONE_THRESHOLDS, nextThreshold } = await import('../lib/boards')
    expect(MILESTONE_THRESHOLDS).toEqual([1_000, 10_000, 50_000, 100_000])
    expect(nextThreshold(999)).toBe(1_000)
    expect(nextThreshold(100_000)).toBeNull()
  })
})
