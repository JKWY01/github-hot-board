import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/* 单测只测 lib 纯函数层。lib 里多个模块顶层 import 'next/cache'(cacheLife/cacheTag),
 * 裸 Node 环境没有 Next 运行时 —— 用无操作 stub 顶替,不碰真实行为。 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      'next/cache': resolve(__dirname, 'tests/stubs/next-cache.ts'),
    },
  },
})
