/**
 * 破坏性集成测试的目标库守卫(评审十二轮定稿)。
 *
 * 要求:连接串经 URL 字段级解析,host 必须精确等于 localhost/127.0.0.1,
 * pathname(库名)必须精确等于 /ghb_a1_verify 或 /ghb_test —— 两项同时满足
 * 才允许执行 DROP/DDL 类破坏性操作。任何一项不满足即返回 false(测试跳过),
 * 不使用子串匹配,不依赖环境变量名称。
 */
export function isIsolatedTestDatabase(url: string | undefined | null): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false // 不可解析的连接串一律拒绝
  }
  const host = parsed.hostname.toLowerCase()
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  const db = parsed.pathname.replace(/\.sqlite$|\/$/, '') // 仅去尾斜杠,库名整段比对
  const isTestDb = db === '/ghb_a1_verify' || db === '/ghb_test'
  return isLocalHost && isTestDb
}
