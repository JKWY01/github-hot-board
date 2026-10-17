# 实施计划：GitHub 项目热榜站

对应 spec：`docs/superpowers/specs/2026-10-17-github-leaderboard-design.md`

约束回顾：Next 16.4.2 + cacheComponents（无 `export const revalidate`/`dynamic` 段配置）；i18n 走 `app/[lang]` + `proxy.ts`（仅匹配 `/`）；GitHub 数据全部经 `fetch`+`next.revalidate`（Data Cache）；动画零依赖手写。

## 步骤

1. **数据层 `lib/`**
   - `types.ts`：RepoLite（full_name/owner/desc/stars/forks/issues/language/created/pushed/topics/url/avatar）
   - `github.ts`：
     - `ghSearch(q, {sort, order, pages})` → Search API 翻页（fetch + next.revalidate；token header；403 抛可识别错误）
     - `fetchTrending({since, language})` → 抓取 github.com/trending HTML（自研选择器：`<article` 块 → `h2 a[href^="/"]`、`p.col-9`、`span[itemprop=programmingLanguage]`、`a[href$='/stargazers']`、`a[href$='/forks']`、`float-sm-right` span 中 `N,NNN stars this {day|week|month}`；`repo` 文本去炮灰 span），失败抛错
   - `boards.ts`：`BOARDS`（slug/中英名/口径说明/数据函数/是否语言facet）；各榜得分纯函数
   - 验证：node 脚本对 /tmp/tr.html fixture 断言解析出 11 条、含 stars this week；对真实 API 抽样

2. **i18n 骨架**
   - `proxy.ts`（根路径按 Accept-Language 重定向 zh/en；matcher 只 ` '/'`）
   - `app/[lang]/layout.tsx`（html lang、Nav、footer）、`dictionaries.ts`（zh/en JSON）、删除 scaffold 根 layout/page、globals.css 迁移
   - `notFoundOnBadLang` 检查

3. **页面**
   - `app/[lang]/page.tsx`：hero（无 emoji、渐变大标题）+ 本周点火速览 + 全榜卡片网格 + 里程碑直播模块
   - `app/[lang]/boards/[slug]/page.tsx` + `[language]` 子路由：BoardHeader、BoardList（SSR 直出）、口径说明 + FAQ 原创文、其它榜内链、JSON-LD
   - `app/[lang]/boards/[slug]/not-found`? 统一 not-found.tsx

4. **客户端动画组件（零依赖）**
   - `LiveBoardList`：初始 SSR 数据 + 60s 轮询 /api；FLIP 换位（ cubic-bezier(0.22,1,0.36,1)）+ 数字补间 + 上下 SVG 箭头 + reduced-motion 降级
   - `MilestoneCamera`：轮询 diff 跨阈值 → Canvas 彩带 + toast「X 突破 10,000 星」
   - `LangTabs`、`CountUp`

5. **API `app/api/boards/[slug]/route.ts`**：GET（headers() 触发请求时执行）→ 数据函数 → JSON no-store

6. **SEO 元数据**
   - `app/[lang]/opengraph-image.tsx`、`app/[lang]/boards/[slug]/opengraph-image.tsx`（ImageResponse 1200×630）
   - `app/sitemap.ts`、`app/robots.ts`、`app/manifest.ts`、icon
   - generateMetadata：canonical/hreflang/OG/Twitter

7. **验证**
   - `npm run build`（ts 全原创检查）
   - `npm run start` 起新进程：curl `/`（重定向）、`/zh`、`/en`、9 个榜页 × 2 语言抽样 + milestone、`/api/boards/overall`、`/sitemap.xml`、`/robots.txt`，grep HTML 关键数据
   - 修 bug 迭代

8. **交付物**
   - README（中文）：架构、口径表、缓存/限流设计、Vercel 上线与 token 配置步骤、扩展指南
   - `.env.example`
   - git 提交（含 spec/plan 文档）

## 测试边界
解析器与打分函数（纯逻辑）以 fixture/真实样本断言方式验证；UI/SEO 以构建 + 路由 curl 验证。
