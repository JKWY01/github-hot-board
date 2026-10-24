/** 每 IP 滑窗限流的共享实现。
 * 此前 search / watch 各自复制了一份,且 Map 条目只覆盖写、从不清理 ——
 * 伪造 IP 轮换可以无限撑大实例内存。这里统一实现并带上修剪:
 * 每次判定顺手清一次过期项,超过上限整体重置(极端风暴下宁可短暂放行,不可 OOM)。 */

const MAX_TRACKED_IPS = 8_000

export interface SlidingWindow {
  allow(ip: string, perWindow: number, windowMs: number): boolean
}

/** now 参数为可注入时钟(单测用),默认墙钟。 */
export function slidingWindow(now: () => number = Date.now): SlidingWindow {
  const hits = new Map<string, { n: number; t: number }>()
  return {
    allow(ip, perWindow, windowMs) {
      const at = now()
      // 顺手修剪:窗口外的条目已无意义
      if (hits.size > 512) {
        for (const [k, v] of hits) {
          if (at - v.t > windowMs) hits.delete(k)
        }
      }
      // 上限保险丝:条目数仍超限就整体重置(风暴兜底,放弃这一轮的记忆好过撑爆内存)
      if (hits.size > MAX_TRACKED_IPS) hits.clear()

      const e = hits.get(ip)
      if (!e || at - e.t > windowMs) {
        hits.set(ip, { n: 1, t: at })
        return true
      }
      if (e.n >= perWindow) return false
      e.n += 1
      return true
    },
  }
}

/** 从请求头取客户端 IP(Vercel/反代会写 x-forwarded-for;直连时归为 local)。 */
export function clientIpOf(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}
