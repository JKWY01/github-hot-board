import { LANG_LINK_TEXT, LOCALES, type Locale } from './locales'

/** GitHub 渲染后 README HTML 的纯文本处理层(自 lib/github.ts 拆出,零 IO、可单测)。
 * 职责:相对链接改写(absolutize)、语言 README 命名候选与切换器解析、
 * "像人话的首句"提取与文字系统判定(pickLeadLine / scriptOk)。 */

/** 各语言的 README 常见命名候选:切换器没给路径时按惯例兜底。
 * 只登记站点语言;组合覆盖 _/-/. 分隔与语言子标签,目录只收 docs/、docs/readme/、doc/ 三个高发位。 */
export const LANG_README_PATHS: Partial<Record<Locale, string[]>> = {
  zh: [
    'README_zh-CN.md', 'README.zh-CN.md', 'README_zh.md', 'README.zh.md',
    'README_zh-Hans.md', 'README_CN.md', 'README-zh.md',
    'docs/README_zh-CN.md', 'docs/README_zh.md',
  ],
  'zh-TW': [
    'README_zh-TW.md', 'README.zh-TW.md', 'README_zh-Hant.md', 'README.zh-Hant.md',
    'README_TW.md', 'README-zh-tw.md', 'README-zh-TW.md',
    'docs/README_zh-TW.md', 'docs/readme/README_zh-TW.md', 'doc/README_zh-TW.md',
  ],
  ja: ['README_ja.md', 'README.ja.md', 'README_ja-JP.md', 'README.ja-JP.md', 'README_JA.md', 'README-ja.md', 'docs/README_ja.md', 'docs/readme/README_ja.md', 'doc/README_ja.md'],
  ko: ['README_ko.md', 'README.ko.md', 'README_ko-KR.md', 'README.ko-KR.md', 'README_KR.md', 'README-ko.md', 'docs/README_ko.md', 'docs/readme/README_ko.md'],
  de: ['README_de.md', 'README.de.md', 'README_de-DE.md', 'README.de-DE.md', 'README.German.md', 'README-DE.md', 'docs/README_de.md', 'docs/readme/README_de.md'],
  fr: ['README_fr.md', 'README.fr.md', 'README_fr-FR.md', 'README.fr-FR.md', 'README.French.md', 'docs/README_fr.md', 'docs/readme/README_fr.md'],
  es: ['README_es.md', 'README.es.md', 'README_es-ES.md', 'README.es-ES.md', 'README.Spanish.md', 'docs/README_es.md', 'docs/readme/README_es.md'],
  pt: ['README_pt-BR.md', 'README.pt-BR.md', 'README_pt.md', 'README.pt.md', 'README_pt-PT.md', 'README-PT.md', 'docs/README_pt-BR.md', 'docs/readme/README_pt-BR.md'],
  it: ['README_it.md', 'README.it.md', 'README_it-IT.md', 'README.Italian.md', 'docs/README_it.md', 'docs/readme/README_it.md'],
  ru: ['README_ru.md', 'README.ru.md', 'README_ru-RU.md', 'README-Russian.md', 'docs/README_ru.md', 'docs/readme/README_ru.md'],
  uk: ['README_uk.md', 'README.uk.md', 'README_ua.md', 'README_UA.md', 'README-ua.md', 'docs/README_uk.md', 'docs/readme/README_uk.md'],
  pl: ['README_pl.md', 'README.pl.md', 'README_pl-PL.md', 'README.Polish.md', 'docs/README_pl.md', 'docs/readme/README_pl.md'],
  tr: ['README_tr.md', 'README.tr.md', 'README_tr-TR.md', 'README.Turkish.md', 'docs/README_tr.md', 'docs/readme/README_tr.md'],
  vi: ['README_vi.md', 'README.vi.md', 'README_vn.md', 'README_VN.md', 'README-vi.md', 'docs/README_vi.md', 'docs/readme/README_vi.md'],
  id: ['README_id.md', 'README.id.md', 'README_id-ID.md', 'README_in.md', 'README-id.md', 'docs/README_id.md', 'docs/readme/README_id.md'],
}

/** 把 a/./b/../c 这类路径段归一化成干净的仓库根路径。 */
export function normRel(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** 统一改写:剥壳 → 根相对补域 → 裸相对按文档目录落位 → 外链新标签。 */
export function absolutizeMdHtml(html: string, full: string, branch: string, dir: string): string {
  let out = html.replace(/<!doctype[\s\S]*?>|<\/?(html|body)[^>]*>/gi, '').trim()
  const blobBase = `https://github.com/${full}/blob/${branch}`
  const rawBase = `https://raw.githubusercontent.com/${full}/${branch}`
  // 根相对(/owner/repo/raw/...)补 GitHub 域
  out = out.replace(/(src|href)="\/([^/])/g, '$1="https://github.com/$2')
  // 裸相对(含 ./ 与 ../)一律先并入文档目录、再做段归一化,.. 才有正确落点
  out = out.replace(/href="(?!(?:https?:|#|mailto:|javascript:))([^"]+)"/gi, (m, p1) => {
    const rel = dir ? `${dir}/${p1}` : p1
    return `href="${blobBase}/${normRel(rel)}"`
  })
  // 同目录裸相对的图片
  out = out.replace(/src="(?!(?:https?:|data:|#))([^"]+)"/gi, (m, p1) => {
    const rel = dir ? `${dir}/${p1}` : p1
    return `src="${rawBase}/${normRel(rel)}"`
  })
  // 外链新标签(页内锚点除外,交给客户端就地滚动)
  out = out.replace(/<a\b(?![^>]*\btarget=)(?![^>]*\bhref="#)/g, '<a target="_blank" rel="noopener noreferrer"')
  // 图片懒加载:长 README 几十张图不该一次全请求;已有 loading 属性的不动
  out = out.replace(/<img(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"')
  return out
}

/** 从语言切换器找同仓库的目标语言 README 路径。锚文本走 locales 的共用表,长正文不算。 */
export function findLocalizedReadmePath(html: string, full: string, branch: string, locale: Locale): string | null {
  const rule = LANG_LINK_TEXT.find((r) => r.lg === locale)
  if (!rule) return null
  const malink = `https://github.com/${full}/blob/${branch}/`
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/g
  for (const m of html.matchAll(re)) {
    const href = m[1]
    const text = m[2].replace(/<[^>]+>/g, '').trim()
    if (!text || text.length > 24) continue
    if (!rule.re.test(text)) continue
    if (!/\.md$/i.test(href)) continue
    if (href.startsWith(malink)) return href.slice(malink.length)
  }
  return null
}

/** 判定一句摘文属于目标语言:按文字系统给下限,徽章汤/英文正文混不进来。 */
export function scriptOk(locale: string, t: string): boolean {
  const count = (re: RegExp) => (t.match(re)?.length ?? 0)
  switch (locale) {
    case 'zh':
    case 'zh-TW':
      return count(/[\u3400-\u9fff\uf900-\ufaff]/g) >= 6
    case 'ja':
      return count(/[\u3040-\u30ff]/g) >= 2 || count(/[\u3400-\u9fff]/g) >= 8
    case 'ko':
      return count(/[\uac00-\ud7af]/g) >= 4
    case 'ru':
    case 'uk':
      return count(/[\u0400-\u04ff]/g) >= 8
    default:
      // 拉丁系:词数与字母量双下限,广告行/占位串基本被挡在外面
      return t.split(' ').length >= 5 && count(/[A-Za-z\u00c0-\u017f]/g) >= 14
  }
}

/** 取"像人话"的首段当行描述:落在语言文字系统内、长度适中;
 * 排掉徽章汤与语言切换器(整段 · 分隔的链接)。 */
export function pickLeadLine(html: string, locale: string): string | null {
  const ps = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? []
  for (const p of ps) {
    const t = p
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 10 || t.length > 140) continue
    if (!scriptOk(locale, t)) continue
    if (/(^|\s)·(\s|$)/.test(t)) continue
    return t
  }
  return null
}

/** LOCALES 再导出:收割侧按站点语言遍历时免再 import。 */
export { LOCALES }
