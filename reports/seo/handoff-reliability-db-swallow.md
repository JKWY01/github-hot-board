# 可靠性专项移交件:数据库失败被误判为"仓库不存在"的吞错链

来源:SEO 审计第一阶段追查生产 noindex 壳事故时定位(代码级实锤见
`noindex-shell-verification-2026-10-28.md` 追加节)。本件只移交、不在 SEO 分支修。

## 事故链(每层单独看都有兜底,组合起来把基础设施故障伪装成业务结论)

```
withDb() 失败(连接池拥塞/20s 竞速超时/非致命 SQL 错)
  → 返回 undefined
  → readRepoArchiveRows(): `... ?? base`  ← 失败被吞成空 appearances
  → getRepoArchiveCached(): appearances.length === 0 → return null
  → 页面: if (!archive) notFound() → noindex 404 壳烤进 ISR(可跨部署存留)
```

页面顶层的 TIMEOUT 哨兵(9s → 5xx)拦不住这条链:undefined 在哨兵之前就变成了"确认查无此仓"。

## 验收标准(外部评审建议的四情形,全部必须有测试)

| 场景 | 正确行为 |
|---|---|
| 查询成功,存在记录 | 正常返回档案 |
| 查询成功,无记录 | 真正的 404(notFound) |
| 查询失败或超时 | 错误处理路径(5xx/降级),**绝不**伪装成 404 |
| 数据库恢复后再查 | 恢复正常,不沿用错误结果 |

关键断言:**查询失败不得把错误的空结果写入缓存**('use cache' 会把空结果固化,
同类事故:discover 页空 Map 曾被固化 2 小时)。实现形态(异常传播 vs 显式
Result 类型)由可靠性负责同事按架构定;同类 `?? base`/`?? []` 吞错模式建议
顺带全库扫描(不止 readRepoArchiveRows 一处)。

## 关联证据

- 事故采样(已持久化):`noindex-shell-evidence-2026-10-28.json`(18 条脱敏记录,age=33149s 永续 HIT)
- 缓存行为验收补充(评审第五轮):模拟查询失败→恢复库→下一次查询须得真实数据,不得复用失败期空结果;仅证明函数抛异常不够
- 受影响页面清单:见 seo-audit-2026-10-28-01-42-.json 的 unexpected-noindex 条目
- 部署时间线:v1.2.2 vercel-deploy 10-27 14:35 UTC(api-upload-free failure)
