# SEO 审计报告

- 站点:https://git.vaiox.xyz
- 时间:2026-10-27T15:40:31.645Z
- 审计器版本:unknown
- 生产部署版本:unknown(取不到不猜)
- 样本:43 页(问题条目数≠独立页面数)
- sitemap 计数:{"/sitemap/boards.xml":576,"/sitemap/history.xml":70,"/sitemap/0.xml":4000,"/sitemap/1.xml":1882}
- 问题:P0=1 P1=1 P2=41

## P0

| 类型 | URL | 详情 |
|---|---|---|
| fetch-failed | /zh/repo/vercel/next.js | TimeoutError: The operation was aborted due to timeout |

## P1

| 类型 | URL | 详情 |
|---|---|---|
| missing-h1 | /zh/watch |  |

## P2

| 类型 | URL | 详情 |
|---|---|---|
| title-too-long | /en | 125 chars |
| title-too-long | /es | 106 chars |
| title-too-long | /pl | 105 chars |
| slow-response | /zh/boards/overall | 9969ms |
| slow-response | /zh/boards/weekly | 11818ms |
| slow-response | /zh/boards/monthly | 10375ms |
| slow-response | /zh/boards/annual | 14579ms |
| slow-response | /zh/boards/rising | 17494ms |
| slow-response | /zh/boards/dark | 9858ms |
| slow-response | /zh/boards/overlooked | 11240ms |
| slow-response | /zh/boards/controversial | 11031ms |
| slow-response | /zh/boards/forks | 13106ms |
| slow-response | /zh/boards/milestone | 7846ms |
| slow-response | /en/boards/overall | 6046ms |
| slow-response | /zh/boards/overall/python | 8647ms |
| title-too-long | /en/boards/weekly/typescript | 72 chars |
| slow-response | /zh/boards/monthly/rust | 5620ms |
| title-too-long | /en/boards/overall/javascript | 76 chars |
| slow-response | /en/repo/vercel/next.js | 11598ms |
| multiple-h1 | /en/repo/vercel/next.js | 2 h1 |
| multiple-h1 | /en/repo/morluto/rea | 2 h1 |
| slow-response | /en/repo/google/guava | 9922ms |
| multiple-h1 | /en/repo/google/guava | 2 h1 |
| slow-response | /en/repo/peach-mitao/peach | 14279ms |
| multiple-h1 | /en/repo/peach-mitao/peach | 2 h1 |
| slow-response | /en/repo/freeCodeCamp/freeCodeCamp | 17338ms |
| slow-response | /es/repo/google/guava | 16812ms |
| multiple-h1 | /es/repo/google/guava | 2 h1 |
| page-too-heavy | /zh/history/overall | uncompressed HTML 1747KiB (utf8 bytes) |
| slow-response | /en/history/overall/2026-10-26 | 5461ms |
| page-too-heavy | /en/history/overall/2026-10-26 | uncompressed HTML 1753KiB (utf8 bytes) |
| page-too-heavy | /en/history/overall/2026-10-25 | uncompressed HTML 1753KiB (utf8 bytes) |
| slow-response | /en/history/overall/2026-10-24 | 5795ms |
| page-too-heavy | /en/history/overall/2026-10-24 | uncompressed HTML 1753KiB (utf8 bytes) |
| slow-response | /en/history/weekly/2026-10-26 | 5195ms |
| slow-response | /zh/discover | 8779ms |
| title-too-long | /en/guide | 71 chars |
| slow-response | /feed.xml | 7177ms |
| slow-response | /robots.txt | 5364ms |
| slow-response | /sitemap-index.xml | 5073ms |
| duplicate-title | /es/repo/google/guava | same as https://git.vaiox.xyz/en/repo/google/guava (repo) |
