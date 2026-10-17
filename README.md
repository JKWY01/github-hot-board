# GitHub 火线榜 · GitHub Hot Board

**实时 GitHub 项目热榜站**：以 GitHub 官方公开数据为唯一数据源，为中英文读者提供十个不同视角的开源项目排行榜。Apple 官网风格、无 emoji、全程真数据（无任何人工干预）。

> 数据源：GitHub Search API + github.com/trending 官方页面。本站不伪造数据；每个榜单页面都公开口径说明与 FAQ。

## 榜单与口径

| # | 榜单 | 数据源 | 口径 |
|---|---|---|---|
| 1 | 总榜 · 史上最强 | Search API | 历史累计 Star 降序（stars:>1000、排除 fork） |
| 2 | 周榜 · 本周点火 | 官方 Trending 周页 | 官方顺序 + 官方标注的“本周新增 Star”真实增量 |
| 3 | 月榜 · 本月风潮 | 官方 Trending 月页 | 同上（月窗口） |
| 4 | 年度新星榜 | Search API | 今年创建且累计 Star 最高 |
| 5 | 潜力榜 · 90 天斜率 | Search API | 近 90 天创建，按 星/天 均速排序 |
| 6 | 黑马榜 · 被雪藏候选 | Search API | 潜力池中累计 Star < 1500 的切片 |
| 7 | 被忽视榜 · 活跃冷清 | Search API | 近 30 天持续 push、Star 100–800，升序 |
| 8 | 黑红榜 · 争议指数 | Search API 衍生 | (Fork×2 + Issue) ÷ Star 极值（启发式，非情感数据） |
| 9 | Fork 之王 | Search API | 历史累计 Fork 降序 |
| 10 | 实时里程碑 · 破星直播 | Search API × 4 | 1k/10k/50k/100k 阈值 ±80 星的冲刺者；前台 60 秒轮询，跨线触发五彩纸屑庆祝 |

总榜 / 周榜 / 月榜支持语言分榜（javascript / typescript / python / go / rust / java / c / c++），对应 URL 形如 `/zh/boards/weekly/python`（每条 URL 独立收录）。

## 技术要点

- **Next.js 16 App Router + React 19 + TypeScript + Tailwind v4**，`cacheComponents` 新缓存模型（页面静态壳 + Suspense 动态洞，无 `export const revalidate` 旧段配置）。
- **数据缓存**：所有 GitHub 请求带 `fetch(url, { next: { revalidate } })` —— 在 Vercel 上由 Data Cache 持久化（跨实例共享），这是限流保护的核心。有 token 时 5 分钟，无 token 15 分钟。
- **i18n**：`app/[lang]` 路由 + 根路径 `proxy.ts` 按 `Accept-Language` 重定向；`alternates.languages` 输出 hreflang。
- **动画（零依赖手写）**：
  - 排名变更 FLIP 换位（`cubic-bezier(0.22,1,0.36,1)`）
  - 星数 rAF 数字补间（`CountUp`）
  - 里程碑跨线：Canvas 五彩纸屑 + 恭喜 toast（纯图形，无 emoji 文案）
  - 冲进前三的一束小火花；上升/下降用 SVG 三角箭头
  - 全部尊重 `prefers-reduced-motion`
- **SEO**:SSR 全量 HTML、动态 metadata、Open Graph 动态图（ImageResponse）、sitemap/robots/manifest、每个榜单页含 ItemList/FAQPage/JSON-LD 结构化数据、FAQ 原创文案。

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填 GITHUB_TOKEN（可选但强烈建议）与 NEXT_PUBLIC_SITE_URL
npm run dev                  # http://localhost:3000 → 自动跳转 /zh 或 /en
```

测试数据层（不启动服务器，使用本地 fixture 解析校验）：

```bash
node --experimental-strip-types --input-type=module -e "import {parseTrendingHtml} from './lib/parse.ts'; import fs from 'node:fs'; const html = fs.readFileSync('/tmp/tr.html','utf8'); console.log(parseTrendingHtml(html, 'weekly').length)"
```

## 上线（Vercel）

1. `git init && git add -A && git commit -m init && git push` 到你的仓库。
2. Vercel → New Project → 导入仓库（框架自动识别 Next.js）。
3. 环境变量设置：
   - `GITHUB_TOKEN`：github.com/settings/tokens 生成的 classic token，**不勾选任何权限**即可（public 数据只读）。没有 token 站点也能跑，但匿名限流更严。
   - `NEXT_PUBLIC_SITE_URL`：你的最终域名（如 `https://your-domain.com`），供 canonical/sitemap/OG 使用。
4. 部署完成后去搜索引擎提交 sitemap（Google Search Console / Bing Webmaster）。

自托管：`npm run build && npm run start`（Node 22+），或 Docker 包裹 `npm start`。快照层不存在，无需数据库。

### 可选：定时/手动兜底刷新

`/api/refresh`（GET）会对全部榜单执行 `revalidateTag('github')`，强制下一次访问重新拉数据（适合非正常限流后的恢复）。设置环境变量 `CRON_SECRET` 后，调用需携带 `Authorization: Bearer $CRON_SECRET` 或 `?secret=$CRON_SECRET`：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/refresh
```

如需 Vercel Cron 自动兜底，可在项目根目录放 `vercel.json`：

```json
{ "crons": [{ "path": "/api/refresh", "schedule": "0 */6 * * *" }] }
```

## 关键源码

```
lib/github.ts       Search API / Trending 抓取（fetch + next.revalidate）
lib/parse.ts        Trending 页 HTML 解析（纯函数，可单测）
lib/boards.ts       十个榜单的口径实现与调度
components/LiveBoardList.tsx  实时榜单：轮询 + FLIP 爬榜 + 数字补间 + 庆祝
components/celebrate.ts       Canvas 彩屑（无 emoji）
app/[lang]/*        双语页面与 dictionaries（站点全部文案）
app/api/boards/[slug]  客户端轮询端点
```

## 如何新增一个榜

1. `lib/boards.ts`：写一个 `getXxxData()`（Search API 口口相接），并在 `getBoardData` 分发。
2. `app/[lang]/dictionaries.ts`：补 `BoardCopy`（名称/口径/FAQ，中英双语）。
3. 需要语言分面就在 `BOARD_META` 开 `facets`。
4. 路由、导航、footer、sitemap 全部随 `BOARD_ORDER` 自动生效。

## 已知限制（如实说明）

- Trending 数字在缓存期内（≤15 分钟）可能与官方页面实时值有偏差。
- GitHub Search 对"总量"有 1000 条/查询的上限；总榜展示 Top 300 池，足够覆盖头部的所有故事。
- 黑红榜是结构化启发式（Fork/Issue 比例），不是情感分析；页面已明确标注。
- 里程碑跨线检测发生在浏览器端（页面停留期间），服务器端不保存历史状态。
