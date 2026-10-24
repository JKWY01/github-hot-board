/* eslint-disable @typescript-eslint/no-unused-vars -- 测试替身:参数仅为签名兼容 */
/** next/cache 的测试替身:单测里 cacheLife/cacheTag 是无操作。 */
export function cacheLife(_profile: unknown): void {}
export function cacheTag(..._tags: string[]): void {}
export function unstable_cacheLife(_profile: unknown): void {}
export function unstable_cacheTag(..._tags: string[]): void {}
export function revalidateTag(..._args: unknown[]): void {}
