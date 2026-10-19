# 市场分析手册 · BigQuery 全量查询(免费 1TB/月)

> 背景:GitHub 在 2026 年撤下了 REST/GraphQL 的星标明细接口,逐星时间线只存在于事件归档。
> `githubarchive` 是 GH Archive 在 BigQuery 上的官方公共数据集,**免费查询额度 1TB/月**,
> 无需建库、无需存储——你等于拥有全 GitHub 事件的分析权。
>
> 用法:https://console.cloud.google.com/ 用 GitHub 账号登录 → 启用 BigQuery(免费沙盒,不用绑卡)
> → 粘贴下方任一查询。表名格式 `githubarchive.day.YYYYMMDD`,月份用通配 `githubarchive.day.2026*`。

所有查询默认把 1TB 额度控制在 20GB 以内,放心跑。

---

## 1. 单仓库逐日星标(绝对精确,任何时间段)

```sql
SELECT DATE(created_at) AS day, COUNT(*) AS stars_gained
FROM `githubarchive.day.2026*`
WHERE _TABLE_SUFFIX BETWEEN '0901' AND '0930'      -- 2026-09-01 ~ 09-30
  AND repo.name = 'vercel/next.js'
  AND type = 'WatchEvent'
GROUP BY day ORDER BY day;
```

换仓库:改 `repo.name`;跨年改表通配与 `_TABLE_SUFFIX`(如 `'250101' AND '251231'`)。

## 2. 赛道时代趋势(月度新星数 + 活跃仓库数)

```sql
SELECT FORMAT_TIMESTAMP('%Y-%m', created_at) AS month,
       COUNT(*) AS stars_gained,
       COUNT(DISTINCT repo.name) AS active_repos
FROM `githubarchive.day.2025*` CROSS JOIN `githubarchive.day.2026*`
WHERE type = 'WatchEvent'
  AND (repo.name LIKE '%agent%' OR org.name = 'agent-ecosystem')  -- 改关键词
GROUP BY month ORDER BY month;
```

> 全表 CROSS JOIN 较大;限定月份范围时直接用单表 + `_TABLE_SUFFIX` 过滤更省。

## 3. 全站火箭榜(任意 30 天窗口的涨星 Top N)

```sql
SELECT repo.name AS repo, COUNT(*) AS stars_gained
FROM `githubarchive.day.2026*`
WHERE _TABLE_SUFFIX BETWEEN '0910' AND '0919'
  AND type = 'WatchEvent'
GROUP BY repo ORDER BY stars_gained DESC LIMIT 30;
```

## 4. 时段对比(本月 vs 上月,赛道内项目结构变化)

```sql
WITH cur AS (
  SELECT repo.name AS repo, COUNT(*) c FROM `githubarchive.day.202609*`
  WHERE type='WatchEvent' GROUP BY 1),
prev AS (
  SELECT repo.name AS repo, COUNT(*) c FROM `githubarchive.day.202608*`
  WHERE type='WatchEvent' GROUP BY 1)
SELECT cur.repo, cur.c AS this_month, IFNULL(prev.c, 0) AS prev_month
FROM cur LEFT JOIN prev USING (repo)
ORDER BY this_month - IFNULL(prev.c,0) DESC LIMIT 50;
```

## 5. 仓库改名历史(RENAME 影响,查告示)

```sql
SELECT repo.name, COUNT(*) FROM `githubarchive.day.2015*`
WHERE type='WatchEvent' AND repo.name LIKE 'facebook/react%' GROUP BY 1 ORDER BY 2 DESC;
```

---

## 注意

- `WatchEvent` 即"加星"事件;`ForkEvent` 为分叉;`PushEvent` 为提交。
- 老事件表(2015 前)有 `actor` 等字段差异,跨大范围时先小窗口验证。
- 本仓库 CLI(`node scripts/market.mjs`)走的是同一批数据的公共 ClickHouse 镜像(~10% 抽样),
  适合随手看形状;要绝对精确值用本页 BigQuery 查询。
