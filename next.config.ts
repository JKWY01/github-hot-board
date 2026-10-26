import type { NextConfig } from "next";

// 安全响应头。CSP 是缓和版(script/style 仍需 'unsafe-inline':Next 引导脚本内联、
// GitHub 渲染的 README HTML 自带 inline style),真正拦住 JSON-LD 注入的是
// lib/jsonld.ts 的出口转义 —— 这里是纵深防御:限制外联脚本/对象/嵌框/嗅探。
// 资源口径:
//   script: 'self' + va.vercel-scripts.com(@vercel/analytics 调试态)+ 'unsafe-inline'(Next 引导)
//           开发态额外 'unsafe-eval'(React dev 的调试栈重建需要;生产不带)
//   img:    https: data:(README 里的图片可来自任意图床/CDN,不能收窄)
//   style:  'self' + 'unsafe-inline'(GitHub README 的对齐样式)
//   connect:'self' + va.vercel-scripts.com(analytics beacon)
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "connect-src 'self' https://va.vercel-scripts.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // 自托管(HK 容器)与 Vercel 两用:standalone 产物 = server.js + 精选依赖,
  // Vercel 构建器会忽略此选项,行为不变(HK 搬家 2026-10-25)。
  output: 'standalone',
  // Postgres 驱动不打进 bundle:动态引入的驱动被打包器改写后 tagged-template 会损坏
  // (实测 prod 发出空 SQL 报 "syntax error at or near :"),外部化后裸 Node 加载一切正常。
  serverExternalPackages: ['postgres'],
  // 16.x 里这是顶层配置（不再支持段级导出）。fill 死线 = min(useCacheTimeout, static×0.9)
  // = min(180, 216) = 180s：配额节流后最长队列 ~40 个 URL × 2.1s ≈ 84s，留足余量。
  staticPageGenerationTimeout: 240,
  // 用 cache fill 的构建死线放宽：默认 50s 会在长队列下误伤。
  experimental: {
    useCacheTimeout: 180,
  },
  // 老牌爬虫的惯例入口:/sitemap.xml → /sitemap-index.xml(308,永久)。
  // 走 config redirects 而非 app/sitemap.xml/route.ts:Next 里 sitemap.xml
  // 与元数据路由冲突(dev 实测 "Conflicting route and metadata at /sitemap.xml")。
  async redirects() {
    return [
      { source: '/sitemap.xml', destination: '/sitemap-index.xml', permanent: true },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
    ]
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
