# GitHub 项目热榜站 · 设计规格（2026-10-17）

## 目标
做一个公开、可被搜索引擎收录的 GitHub 项目榜单站（中英双语），数据全部来自 GitHub 官方（Search API + Trending 页面），Apple 官网风格，带排名重排/数字滚动/里程碑庆祝动画，无 emoji，部署到 Vercel。

非目标：不做用户系统、不做点赞/评论 UGC、不做付费、不做 GITHUB 数据之外的情感分析（黑红榜为公开口径的启发式指标）。

## 技术栈
- Next.js 16 App Router（`cacheComponents: true`，脚手架默认）+ React 19 + TypeScript + Tailwind v4
- i18n：`app/[lang]` 目录（zh / en）+ `proxy.ts` 根路径按 Accept-Language 重定向
- 动画零依赖：手写 FLIP 重排、数字补间、Canvas 彩带（手写），尊重 prefers-reduced-motion
- 数据缓存：所有 GitHub 请求走 `fetch` + `next: { revalidate: TTL }`（Vercel Data Cache 持久化，跨实例共享，保护 API 配额）；页面用 Suspense 动态洞流式出数据；导出 `revalidate`/`dynamic` 段配置在 cacheComponents 下已被移除，禁止使用

## 数据源与口径（每个榜页面公开展示口径说明）
| slug | 榜 | 数据源 | 口径 |
|---|---|---|---|
| overall | 总榜·史上最强 | Search: `stars:>1000 sort:stars` 翻页取前 700 | 历史累计 Star 数 |
| weekly | 周榜·本周点火 | github.com/trending?since=weekly 抓取 | 官方 Trending 顺序 + "stars this week" 真实周增量 |
| monthly | 月榜 | trending?since=monthly | 同上，月增量 |
| annual | 年度新星榜 | `created:>YYYY-01-01 sort:stars` | 今年创建且星数最高 |
| rising | 潜力榜 | `created:> {today-90d} sort:stars` 取前 300 | 星/天 斜率 |
| dark | 黑马榜 | rising + annual 池 | 高斜率 × 低绝对星数（<1500）× 近期活跃 |
| overlooked | 被忽视榜 | `pushed:> {30d内} stars:100..800 fork:false sort:stars` | 持续维护但冷清（附带最近 push 时间、issue 数） |
| controversial | 黑红争议榜 | overall 池 | 争议指数=(forks×2+open_issues)/stars 异常值；标注为启发式，非情感数据 |
| forks | Fork 之王 | `sort:forks` | 历史累计 Fork 数 |
| milestone | 实时里程碑 | `stars:{t-80}..{t+80} pushed:>30d` (t ∈ 1k/10k/50k/100k) + 浏览器轮询 | 逼近阈值 ° 跨越时前台庆祝（跨瞬间检测由客户端相邻两次轮询 diff 完成） |

语言 facet：overall/weekly/monthly 支持 `language` 路由段（一档语言 内置 8 种：JavaScript/TypeScript/Python/Go/Rust/Java/C/C++）。

## 路由
- `/` → proxy.ts 重定向到 `/zh|/en`
- `/[lang]` 首页（hero + 各榜速览卡片 + 内链）
- `/[lang]/boards/[slug]` 榜单页（默认全语言/All languages）
- `/[lang]/boards/[slug]/[language]` 语言份榜
- API GET `/api/boards/[slug]`（客户端轮询用，无运行时 API 差异不缓存，响应标 no-store）

## SEO
SSR 全量 HTML；`generateMetadata`（title/description/canonical/hreflang/robots）；每页 JSON-LD（WebSite/ItemList/BreadcrumbList）；opengraph-image（ImageResponse，按段自动）；sitemap.ts；robots.ts；每榜原创口径说明文案；页脚内链全榜；manifest + icon。
metadataBase 由 env NEXT_PUBLIC_SITE_URL 提供（README 写明）。

## 错误与降级
- Search 403/限流 → 页面显示「数据源暂时限流，展示缓存快照」横条（读取 fetch 缓存旧值仍可渲染）
- Trending 抓取失败 → 周榜/月榜降级为 Search 口径（created:>7d/30d sort:stars）并在 UI 显式标注口径切换
- 单源异常不阻塞整页（Promise.allSettled 分组）

## 环境变量
- GITHUB_TOKEN（可选，但线上强烈建议；无 token 时 TTL 自动放宽到 15 分钟）
- NEXT_PUBLIC_SITE_URL 生产域名

## 验收
- `npm run build` 通过（cacheComponents 模型下无 blocking-route 报错）
- production `next start` 下逐路由 curl 200 且 HTML 含榜单数据
- /api/boards/* 返回 JSON
- 首页与每个榜页 metadata/JSON-LD 可见
- README 含数据口径、部署、token 申请与扩展指南
