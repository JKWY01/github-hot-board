# SEO 审计报告

- 站点:https://git.vaiox.xyz
- 时间:2026-10-28T01:42:20.717Z
- 审计器版本:cad0f15
- 生产部署版本:unknown(取不到不猜)
- 样本:43 页(问题条目数≠独立页面数)
- sitemap 计数:{}
- 问题:P0=15 P1=59 P2=18

## P0

| 类型 | URL | 详情 |
|---|---|---|
| fetch-failed | /en/repo/vercel/next.js | TimeoutError: The operation was aborted due to timeout |
| unexpected-noindex | /en/repo/morluto/rea | noindex |
| unexpected-noindex | /en/repo/google/guava | noindex |
| unexpected-noindex | /en/repo/peach-mitao/peach | noindex |
| unexpected-noindex | /en/repo/freeCodeCamp/freeCodeCamp | noindex |
| unexpected-noindex | /zh/repo/vercel/next.js | noindex |
| unexpected-noindex | /es/repo/google/guava | noindex |
| unexpected-noindex | /en/history/overall/2026-10-27 | noindex |
| unexpected-noindex | /en/history/overall/2026-10-26 | noindex |
| unexpected-noindex | /en/history/overall/2026-10-25 | noindex |
| unexpected-noindex | /en/history/weekly/2026-10-27 | noindex |
| unexpected-noindex | /en/history/weekly/2026-10-26 | noindex |
| unexpected-noindex | /en/history/weekly/2026-10-25 | noindex |
| fetch-failed | /feed.xml | TimeoutError: The operation was aborted due to timeout |
| fetch-failed | /robots.txt | TimeoutError: The operation was aborted due to timeout |

## P1

| 类型 | URL | 详情 |
|---|---|---|
| missing-h1 | /en/repo/morluto/rea |  |
| missing-canonical | /en/repo/morluto/rea |  |
| hreflang-incomplete | /en/repo/morluto/rea | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /en/repo/morluto/rea |  |
| hreflang-missing-self | /en/repo/morluto/rea |  |
| missing-h1 | /en/repo/google/guava |  |
| missing-canonical | /en/repo/google/guava |  |
| hreflang-incomplete | /en/repo/google/guava | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /en/repo/google/guava |  |
| hreflang-missing-self | /en/repo/google/guava |  |
| missing-h1 | /en/repo/peach-mitao/peach |  |
| missing-canonical | /en/repo/peach-mitao/peach |  |
| hreflang-incomplete | /en/repo/peach-mitao/peach | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /en/repo/peach-mitao/peach |  |
| hreflang-missing-self | /en/repo/peach-mitao/peach |  |
| missing-h1 | /en/repo/freeCodeCamp/freeCodeCamp |  |
| missing-canonical | /en/repo/freeCodeCamp/freeCodeCamp |  |
| hreflang-incomplete | /en/repo/freeCodeCamp/freeCodeCamp | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /en/repo/freeCodeCamp/freeCodeCamp |  |
| hreflang-missing-self | /en/repo/freeCodeCamp/freeCodeCamp |  |
| missing-h1 | /zh/repo/vercel/next.js |  |
| missing-canonical | /zh/repo/vercel/next.js |  |
| hreflang-incomplete | /zh/repo/vercel/next.js | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /zh/repo/vercel/next.js |  |
| hreflang-missing-self | /zh/repo/vercel/next.js |  |
| missing-h1 | /es/repo/google/guava |  |
| missing-canonical | /es/repo/google/guava |  |
| hreflang-incomplete | /es/repo/google/guava | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /es/repo/google/guava |  |
| hreflang-missing-self | /es/repo/google/guava |  |
| hreflang-incomplete | /zh/history/overall | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /zh/history/overall |  |
| hreflang-missing-self | /zh/history/overall |  |
| missing-h1 | /en/history/overall/2026-10-27 |  |
| missing-canonical | /en/history/overall/2026-10-27 |  |
| missing-h1 | /en/history/overall/2026-10-26 |  |
| missing-canonical | /en/history/overall/2026-10-26 |  |
| missing-h1 | /en/history/overall/2026-10-25 |  |
| missing-canonical | /en/history/overall/2026-10-25 |  |
| hreflang-incomplete | /zh/history/weekly | missing: en,zh,zh-TW,ja,ko,de,fr,es,pt,it,ru,uk,pl,tr,vi,id |
| hreflang-missing-x-default | /zh/history/weekly |  |
| hreflang-missing-self | /zh/history/weekly |  |
| missing-h1 | /en/history/weekly/2026-10-27 |  |
| missing-canonical | /en/history/weekly/2026-10-27 |  |
| missing-h1 | /en/history/weekly/2026-10-26 |  |
| missing-canonical | /en/history/weekly/2026-10-26 |  |
| missing-h1 | /en/history/weekly/2026-10-25 |  |
| missing-canonical | /en/history/weekly/2026-10-25 |  |
| missing-description | /zh/watch |  |
| missing-h1 | /zh/watch |  |
| missing-canonical | /zh/watch |  |
| duplicate-title | /en/repo/google/guava | same as https://git.vaiox.xyz/en/repo/morluto/rea (repo) |
| duplicate-title | /en/repo/peach-mitao/peach | same as https://git.vaiox.xyz/en/repo/morluto/rea (repo) |
| duplicate-title | /en/repo/freeCodeCamp/freeCodeCamp | same as https://git.vaiox.xyz/en/repo/morluto/rea (repo) |
| duplicate-title | /en/history/overall/2026-10-26 | same as https://git.vaiox.xyz/en/history/overall/2026-10-27 (history-day) |
| duplicate-title | /en/history/overall/2026-10-25 | same as https://git.vaiox.xyz/en/history/overall/2026-10-27 (history-day) |
| duplicate-title | /en/history/weekly/2026-10-27 | same as https://git.vaiox.xyz/en/history/overall/2026-10-27 (history-day) |
| duplicate-title | /en/history/weekly/2026-10-26 | same as https://git.vaiox.xyz/en/history/overall/2026-10-27 (history-day) |
| duplicate-title | /en/history/weekly/2026-10-25 | same as https://git.vaiox.xyz/en/history/overall/2026-10-27 (history-day) |

## P2

| 类型 | URL | 详情 |
|---|---|---|
| title-too-long | /en | 125 chars |
| title-too-long | /es | 106 chars |
| title-too-long | /pl | 105 chars |
| title-too-long | /en/boards/weekly/typescript | 72 chars |
| title-too-long | /en/boards/overall/javascript | 76 chars |
| title-too-long | /en/repo/morluto/rea | 125 chars |
| title-too-long | /en/repo/google/guava | 125 chars |
| title-too-long | /en/repo/peach-mitao/peach | 125 chars |
| title-too-long | /en/repo/freeCodeCamp/freeCodeCamp | 125 chars |
| title-too-long | /es/repo/google/guava | 106 chars |
| title-too-long | /en/history/overall/2026-10-27 | 125 chars |
| title-too-long | /en/history/overall/2026-10-26 | 125 chars |
| title-too-long | /en/history/overall/2026-10-25 | 125 chars |
| title-too-long | /en/history/weekly/2026-10-27 | 125 chars |
| title-too-long | /en/history/weekly/2026-10-26 | 125 chars |
| slow-response | /en/history/weekly/2026-10-25 | 19631ms |
| title-too-long | /en/history/weekly/2026-10-25 | 125 chars |
| title-too-long | /en/guide | 71 chars |
