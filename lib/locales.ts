/** 站点语言注册表 —— 全站语种的单一事实源。
 * URL 段即本文件 locale;README 探测表、行描述映射、导航菜单、SEO alternate 都从这里取值。
 * 加语种的姿势:这里加一行,词典加一个模块,其余全部自动生效。 */

export type Locale =
  | 'en'
  | 'zh'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'es'
  | 'pt'
  | 'it'
  | 'ru'
  | 'uk'
  | 'pl'
  | 'tr'
  | 'vi'
  | 'id'

/** URL 段与 LOCALE_LABEL 顺序即展示顺序;en 排首位是默认语言(根路径无匹配时回这里)。 */
export const LOCALES = [
  'en',
  'zh',
  'zh-TW',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt',
  'it',
  'ru',
  'uk',
  'pl',
  'tr',
  'vi',
  'id',
] as const

/** 菜单/页脚展示用的语言原生名(不译,语言名永远用它自己的字)。 */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  ru: 'Русский',
  uk: 'Українська',
  pl: 'Polski',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
}

/** <html lang> 值:URL 段不一定等于 BCP47(繁中用 zh-Hant、葡语页面指 pt-BR)。 */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: 'en',
  zh: 'zh-CN',
  'zh-TW': 'zh-Hant',
  ja: 'ja',
  ko: 'ko',
  de: 'de',
  fr: 'fr',
  es: 'es',
  pt: 'pt-BR',
  it: 'it',
  ru: 'ru',
  uk: 'uk',
  pl: 'pl',
  tr: 'tr',
  vi: 'vi',
  id: 'id',
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/** 页面级 hreflang 套件:16 语 + x-default(默认英文),路径不带语段。 */
export function altLangs(pathNoLang: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const locale of LOCALES) {
    map[locale] = `/${locale}${pathNoLang}`
  }
  map['x-default'] = `/en${pathNoLang}`
  return map
}

/** Accept-Language 的最佳匹配:精确段 > 基础子族(zh-Hant 归 zh-TW) > 默认英文。 */
export function matchLocaleFromTag(tag: string): Locale | null {
  const t = tag.trim().toLowerCase()
  if (!t) return null
  if (t === 'zh-tw' || t === 'zh-hant' || t === 'zh-hant-tw') return 'zh-TW'
  if (t.startsWith('zh-hans') || t === 'zh-cn' || t.startsWith('zh-cn') || t.startsWith('zh-sg') || t.startsWith('zh-my')) return 'zh'
  if (t.startsWith('zh')) return 'zh'
  const base = t.split('-')[0]
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : null
}

/** README 语言切换器的锚文本 → 站点语言。顺序即优先级(繁体必须先于“中文”泛指)。
 * 客户端抽屉与同步端提取共用这一张表;匹配只对短标签(≤24 字符)生效,避免正文中误触。 */
export const LANG_LINK_TEXT: ReadonlyArray<{ re: RegExp; lg: Locale }> = [
  { re: /繁(?:體|体)中文|Traditional Chinese/i, lg: 'zh-TW' },
  { re: /简(?:体|體)中文|簡(?:體|体)中文|Simplified Chinese|中文|漢語|汉语|Chinese/i, lg: 'zh' },
  { re: /English|英文|英語/i, lg: 'en' },
  { re: /日本語|日语|日文|Japanese/i, lg: 'ja' },
  { re: /한국어|韓國語|韩语|韩文|Korean/i, lg: 'ko' },
  { re: /Deutsch|German|德语|德文/i, lg: 'de' },
  { re: /Français|French|法语|法文/i, lg: 'fr' },
  { re: /Español|Spanish|西班牙语|西语/i, lg: 'es' },
  { re: /Português|Portuguese|葡萄牙语|葡萄牙文/i, lg: 'pt' },
  { re: /Italiano|Italian|意大利语|義大利語|意语/i, lg: 'it' },
  { re: /Русский|Russian|俄语|俄文/i, lg: 'ru' },
  { re: /Українська|Ukrainian|乌克兰语|烏克蘭語/i, lg: 'uk' },
  { re: /Polski|Polish|波兰语|波蘭語/i, lg: 'pl' },
  { re: /Türkçe|Turkish|土耳其语|土耳其文/i, lg: 'tr' },
  { re: /Tiếng Việt|Vietnamese|越南语|越南文/i, lg: 'vi' },
  { re: /Bahasa Indonesia|Indonesian|印尼语|印尼文/i, lg: 'id' },
]
