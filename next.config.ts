import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // 用 cache fill 的构建死线放宽到 3 分钟：配额节流后 fill 需要在队列里等自己的时间片
  // （91 页 × 每页 1-4 个 GitHub 请求，全局间隔 2.1s）。默认 50s 会在长队列下误伤。
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
