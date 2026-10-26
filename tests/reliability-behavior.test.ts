import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDarkData, getMilestoneData } from '../lib/boards'
import { RateLimitError } from '../lib/github'

/** 行为测试层(2026-10-26 外部审查二轮意见):静态契约测试只防"代码形态被删",
 *  这里用 vi.mock 顶替取数层,真验失败/降级行为——三条故障场景各一条:
 *  ①ghSearch 抛错 → 黑马榜拒绝生成新数据(向上抛,由同步层保留上一拍)
 *  ②里程碑四档中一档失败 → 照常出榜但 degraded=true
 *  ③(事务回滚在 DB 层,由 Postgres 保证;单进程测试环境无法 fake sql.begin,
 *     用源码契约测试钉住写法,行为正确性由 PG 事务语义背书。) */

vi.mock('../lib/github', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/github')>()
  return {
    ...mod,
    ghSearch: vi.fn(),
  }
})

const { ghSearch } = await import('../lib/github')
const ghSearchMock = vi.mocked(ghSearch)

afterEach(() => {
  ghSearchMock.mockReset()
})

const repo = (fullName: string, stars: number, daysOld = 10) => ({
  id: 1,
  fullName,
  owner: fullName.split('/')[0],
  name: fullName.split('/')[1] ?? fullName,
  htmlUrl: `https://github.com/${fullName}`,
  avatarUrl: `https://github.com/${fullName.split('/')[0]}.png`,
  desc: null,
  stars,
  forks: 0,
  issues: 0,
  createdAt: new Date(Date.now() - daysOld * 86_400_000).toISOString(),
  pushedAt: new Date().toISOString(),
  topics: [] as string[],
  language: null,
  license: null,
})

describe('黑马榜失败行为(上游抖动不得伪装成空榜)', () => {
  it('ghSearch 抛 RateLimitError 时,getDarkData 必须向上抛而不是返回空榜', async () => {
    ghSearchMock.mockRejectedValue(new RateLimitError('GitHub rate limited [403] test'))
    await expect(getDarkData()).rejects.toBeInstanceOf(RateLimitError)
    expect(ghSearchMock).toHaveBeenCalled()
  })

  it('ghSearch 抛普通错误同样向上抛', async () => {
    ghSearchMock.mockRejectedValue(new Error('network down'))
    await expect(getDarkData()).rejects.toThrow('network down')
  })

  it('取数成功但筛完为空 → 不抛,返回 degraded 空榜(诚实降级路径)', async () => {
    ghSearchMock.mockResolvedValue([])
    const data = await getDarkData()
    expect(data.items).toEqual([])
    expect(data.degraded).toBe(true)
  })

  it('正常取数 → 不 degraded,且斜率排序生效(新仓快者在前)', async () => {
    // 同为 1000 星:5 天的仓(200/天)> 20 天的仓(50/天)
    ghSearchMock.mockResolvedValue([repo('slow/steady', 1_000, 20), repo('fast/burst', 1_000, 5)])
    const data = await getDarkData()
    expect(data.degraded).toBeUndefined()
    expect(data.items[0].fullName).toBe('fast/burst')
  })
})

describe('里程碑部分失败行为(四档挂一档必须露出)', () => {
  it('一档失败、三档成功 → 返回榜 + degraded=true', async () => {
    ghSearchMock.mockImplementation(async (query: string) => {
      if (query.includes('stars:920..999')) throw new RateLimitError('partial failure') // 1k 档
      return [repo('ok/one', 9_500, 30), repo('ok/two', 49_500, 30), repo('ok/three', 95_000, 30)]
    })
    const data = await getMilestoneData()
    expect(data.items.length).toBeGreaterThan(0)
    expect(data.degraded).toBe(true)
  })

  it('四档全失败 → 抛错(同步层判失败,保留上一拍)', async () => {
    ghSearchMock.mockRejectedValue(new Error('all down'))
    await expect(getMilestoneData()).rejects.toThrow('all down')
  })

  it('四档全成功 → 不 degraded', async () => {
    ghSearchMock.mockResolvedValue([repo('ok/one', 9_500, 30)])
    const data = await getMilestoneData()
    expect(data.degraded).toBeUndefined()
  })
})
