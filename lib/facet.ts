/** 语言分面与榜单路由的纯数据层:零依赖(edge/middleware 也能用)。
 * URL 一律用安全 slug(路径段不能出现 '+'/'#',Next 路由解析会 404);数据层用 GitHub 原生语言名。 */

export const FACET_LANGUAGES = [
  'javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'c++',
] as const
export type FacetLanguage = (typeof FACET_LANGUAGES)[number]

/** c++ → cpp,c# → csharp。 */
export function facetLangSlug(lang: string): string {
  return lang.toLowerCase().replaceAll('+', 'p').replaceAll('#', 'sharp')
}

/** 由 slug 反查真实语言名。 */
export function facetLangFromSlug(slug: string): FacetLanguage | undefined {
  const want = slug.toLowerCase()
  return FACET_LANGUAGES.find((l) => facetLangSlug(l) === want)
}

/** 用户可读语言名(展示层:chips / H1 / 标题 / OG;URL 仍用 slug,数据层仍用原生名)。未知值原样返回。 */
export const FACET_DISPLAY: Record<FacetLanguage, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  'c++': 'C++',
}

export function facetDisplay(lang: string): string {
  const key = lang.toLowerCase() as FacetLanguage
  return FACET_DISPLAY[key] ?? lang
}

export const BOARD_SLUGS = [
  'overall', 'weekly', 'monthly', 'annual', 'rising',
  'dark', 'overlooked', 'controversial', 'forks', 'milestone',
] as const

/** 支持语言分面的榜单(与 boards.ts 的 BOARD_META.facets 保持一致)。 */
export const FACET_BOARDS = ['overall', 'weekly', 'monthly'] as const
