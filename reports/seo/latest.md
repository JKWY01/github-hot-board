# SEO 审计报告

- 站点:https://git.vaiox.xyz
- 时间:2026-10-27T13:33:00.639Z
- 样本:43 页
- sitemap 计数:{"/sitemap/boards.xml":576,"/sitemap/history.xml":70,"/sitemap/0.xml":4000,"/sitemap/1.xml":1882}
- 问题:P0=0 P1=7 P2=17

## P1

| 类型 | URL | 详情 |
|---|---|---|
| hreflang-incomplete | /zh/history/overall | 0/17 (need 16 + x-default) |
| hreflang-missing-self | /zh/history/overall |  |
| hreflang-incomplete | /zh/history/weekly | 0/17 (need 16 + x-default) |
| hreflang-missing-self | /zh/history/weekly |  |
| missing-description | /zh/watch |  |
| missing-h1 | /zh/watch |  |
| missing-canonical | /zh/watch |  |

## P2

| 类型 | URL | 详情 |
|---|---|---|
| title-too-long | /en | 125 chars |
| title-too-long | /es | 106 chars |
| title-too-long | /pl | 105 chars |
| title-too-long | /en/boards/weekly/typescript | 72 chars |
| title-too-long | /en/boards/overall/javascript | 76 chars |
| multiple-h1 | /en/repo/vercel/next.js | 2 h1 |
| multiple-h1 | /en/repo/morluto/rea | 2 h1 |
| multiple-h1 | /en/repo/google/guava | 2 h1 |
| multiple-h1 | /en/repo/peach-mitao/peach | 2 h1 |
| multiple-h1 | /zh/repo/vercel/next.js | 2 h1 |
| multiple-h1 | /es/repo/google/guava | 2 h1 |
| page-too-heavy | /zh/history/overall | 1731KB |
| page-too-heavy | /en/history/overall/2026-10-26 | 1742KB |
| page-too-heavy | /en/history/overall/2026-10-25 | 1742KB |
| page-too-heavy | /en/history/overall/2026-10-24 | 1742KB |
| title-too-long | /en/guide | 71 chars |
| duplicate-title | /es/repo/google/guava | same as https://git.vaiox.xyz/en/repo/google/guava (repo) |
