# 生产 noindex 壳 · 独立只读验证报告(2026-10-28)

按外部评审要求执行:重复请求 + 双 noindex 信号(robots meta + X-Robots-Tag)+ 部署/缓存标识对比。全程只读,未合并分支、未部署、未打标签。

## 验证结果

**异常确认存在,且当前是稳定状态而非间歇:**

- 样本:`/en/repo/morluto/rea`(受影响页之一),6 轮 × 3 URL = 18 请求
- 受影响页连续 6 轮全部返回 noindex 壳;榜单页(`/zh/boards/overall`)始终正常(`index, follow` + PRERENDER)
- 壳特征:Next 的 notFound 共享壳(`<meta name="robots" content="noindex"/>`,无 H1、无主内容、无 JSON-LD)
- **两种 noindex 信号都查过**:HTML robots meta = noindex;响应头无 X-Robots-Tag(异常只在 meta 层)

## 根因链(证据齐全)

1. `v1.2.2` vercel-deploy 于 10-27 14:35 UTC 跑构建,**构建期 DB 抖动 → 档案页 `getRepoArchiveCached` 超时 → notFound() → noindex 壳被烤进 ISR**
2. 构建完成后上传阶段撞 `api-upload-free` 日限 → 部署标记 failure,但**部分 Vercel 副本已切流**
3. 坏壳缓存条目 `age=33149s`(9.2 小时)永续 HIT —— ISR 重验证未发生(notFound 页不被视为可过期内容)
4. 正常页与坏壳按请求落到不同缓存副本交替出现;现在坏壳占比升高(多数请求命中)

## 影响面

- **只影响 Vercel 真人线**;HK 爬虫线(爬虫实际抓取的主线)实测 0 例 noindex
- 受影响 = 部分档案页在 Vercel 线间歇/持续返回 noindex 壳;榜单页、首页、往日榜均正常

## 处置

- **唯一清除路径 = 一次成功的 Vercel 部署**(重置全部 ISR 条目)
- `api-upload-free` 限额按首次上传后 24h 滚动重置(上次 14:35 UTC)→ 今日 14:35 UTC 后重跑 vercel-deploy 即可
- 不重写架构、不动业务代码:构建期 notFound 壳的正确性另有"构建期 DB 依赖"专项(与同事可靠性四条合并处理)

## 验证证据

- 原始采样:`/tmp/noindex-evidence.json`(18 条,含时间/状态/双信号/vid/缓存态/age)
- 审计轮次:14:54(P0=0)→ 01:42(P0=15,其中 unexpected-noindex 12)→ 本报告复测确认

## 追加:根因代码链定位(2026-10-28 补)

评审意见"数据库暂时超时不应被等同于仓库不存在"经代码核对**属实**,完整链路:

```
withDb() 失败 → 返回 undefined
  → readRepoArchiveRows(): `... ?? base`(空 appearances,失败被吞)
  → getRepoArchiveCached(): appearances.length === 0 → return null
  → 页面:if (!archive) notFound() → noindex 404 壳烤进 ISR
```

页面顶层虽有 `TIMEOUT` 哨兵拦 9 秒级超时,但 `withDb` 内部的失败(连接池挤爆/20s 竞速超时/非致命
SQL 错)返回 `undefined` 后被 `?? base` 吞掉——**在哨兵起作用之前就已经变成了"确认查无此仓"**。

**修复归属:可靠性专项(不进 SEO 分支)**。建议形态:`readRepoArchiveRows` 区分"查询失败"与
"空结果"(失败抛错 → 页面顶层 5xx;只有真正无记录才返回空),与可靠性四条同批验收。
本报告的根因链由"推断"升级为"代码级实锤"。
