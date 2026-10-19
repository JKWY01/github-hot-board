import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
