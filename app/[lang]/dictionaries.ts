import type { BoardSlug } from '@/lib/boards'

import { enDict } from './dict/en'
import { zhDict } from './dict/zh'
import { jaDict } from './dict/ja'
import { koDict } from './dict/ko'
import { zhTWDict } from './dict/zh-TW'
import { deDict } from './dict/de'
import { frDict } from './dict/fr'
import { esDict } from './dict/es'
import { ptDict } from './dict/pt'
import { itDict } from './dict/it'
import { ruDict } from './dict/ru'
import { ukDict } from './dict/uk'
import { plDict } from './dict/pl'
import { trDict } from './dict/tr'
import { viDict } from './dict/vi'
import { idDict } from './dict/id'
import type { Locale } from '@/lib/types'
import { isLocale as isLocaleCode } from '@/lib/locales'

export interface BoardFaq {
  q: string
  a: string
}

export interface BoardCopy {
  name: string
  tagline: string
  metricLabel: string
  /** 主指标补注（例如“累计”/“本周新增”） */
  metricHint: string
  desc: string
  faqs: BoardFaq[]
}

export interface Dict {
  locale: Locale
  meta: {
    siteName: string
    homeTitle: string
    homeDescription: string
    homeKeywords: string
  }
  nav: {
    home: string
    logoTag: string
    srcNote: string
  }
  home: {
    // SEO 价值块(信息差/找项目/赚钱关键词的可见落点)
    valueTitle: string
    valueSub: string
    brickOneTitle: string
    brickOneDesc: string
    brickTwoTitle: string
    brickTwoDesc: string
    brickThreeTitle: string
    brickThreeDesc: string
    heroKicker: string
    heroTitleTop: string
    heroTitleGradient: string
    heroSub: string
    heroStatRepos: string
    heroStatStars: string
    heroStatDaily: string
    weeklySectionKicker: string
    weeklySectionTitle: string
    milestoneSectionKicker: string
    milestoneSectionTitle: string
    milestoneSectionSub: string
    boardsKicker: string
    boardsTitle: string
    boardsSub: string
    viewBoard: string
  }
  boards: Record<BoardSlug, BoardCopy>
  shortBoards: Record<BoardSlug, string>
  ui: {
    watchAsk: string
    /** Web Push 跨线提醒(关注页开关;VAPID 未配置时客户端不渲染) */
    pushTitle: string
    pushOn: string
    pushOff: string
    pushBlocked: string
    /** 榜单行上方的筛选/排序控件四词(原内嵌于 LiveBoardList 的 CTRL 表,已并入字典单一体系) */
    filterAll: string
    filterOrder: string
    filterNet: string
    filterRate: string
    allLanguages: string
    /** “总榜”这类累计口径列的小标签(区别于周/月增量) */
    totalLabel: string
    updated: string
    autoRefresh: string
    dataUpdated: string
    sourceGithubSearch: string
    sourceGithubTrending: string
    degradedFallback: string
    rateLimited: string
    viewAll: string
    stars: string
    forks: string
    issues: string
    language: string
    metricSecondary: string
    starsPerDayUnit: string
    daysOnline: string
    pushedAt: string
    milestoneGap: string
    milestoneLines: string
    milestoneGraduated: string
    milestoneJustCrossed: string
    milestoneToast: string
    milestoneToastSub: string
    celebration: string
    definition: string
    openQuestions: string
    faqTitle: string
    crossAdd: string
    inlinks: string
    up: string
    down: string
    newEntry: string
    drawerTitle: string
    drawerLoading: string
    drawerFail: string
    drawerNoReadme: string
    drawerOpen: string
    drawerArchive: string
    drawerClose: string
    drawerPrev: string
    drawerNext: string
    drawerRank: string
    drawerFrom: string
    searchPlaceholder: string
    searchRelated: string
    searchOutside: string
    searchEmpty: string
    searchAll: string
    searchMissing: string
    searchAllBtn: string
    moversTitle: string
    moversEmpty: string
    watchTitle: string
    watchOwn: string
    watchSee: string
    watchEmpty: string
    watchDelta: string
    watchCap: string
    watchGone: string
  }
  footer: {
    about: string
    sourceTitle: string
    sourceBody: string
    boardsTitle: string
    langTitle: string
    disclaimer: string
    copyright: string
  }
  notFound: {
    title: string
    body: string
    back: string
  }
  history: {
    title: string
    subtitle: string
    pickDate: string
    latest: string
    daysCount: string
    empty: string
    accumulating: string
    metricLabel: string
    sourceLabel: string
    degradedNote: string
    note: string
    backToBoard: string
  }
}

export const DICT: Record<Locale, Dict> = {
  en: enDict,
  zh: zhDict,
  'zh-TW': zhTWDict,
  ja: jaDict,
  ko: koDict,
  de: deDict,
  fr: frDict,
  es: esDict,
  pt: ptDict,
  it: itDict,
  ru: ruDict,
  uk: ukDict,
  pl: plDict,
  tr: trDict,
  vi: viDict,
  id: idDict,
}

export { isLocaleCode as isLocale }

/** 输给客户端列表组件的文案子集（避免整本 dictionary 进 RSC 载荷）。 */
export function liveStrings(locale: Locale) {
  const d = DICT[locale]
  return {
    updated: d.ui.updated,
    autoRefresh: d.ui.autoRefresh,
    rateLimited: d.ui.rateLimited,
    degraded: d.ui.degradedFallback,
    watchAsk: d.ui.watchAsk,
    pushTitle: d.ui.pushTitle,
    pushOn: d.ui.pushOn,
    pushOff: d.ui.pushOff,
    pushBlocked: d.ui.pushBlocked,
    filterAll: d.ui.filterAll,
    filterOrder: d.ui.filterOrder,
    filterNet: d.ui.filterNet,
    filterRate: d.ui.filterRate,
    starsUnit: d.ui.stars,
    forksUnit: d.ui.forks,
    issueUnit: d.ui.issues,
    languageUnit: d.ui.language,
    pushedLabel: d.ui.pushedAt,
    daysOldLabel: d.ui.daysOnline,
    perDayUnit: d.ui.starsPerDayUnit,
    searchPlaceholder: d.ui.searchPlaceholder,
    searchRelated: d.ui.searchRelated,
    searchOutside: d.ui.searchOutside,
    searchEmpty: d.ui.searchEmpty,
    searchAll: d.ui.searchAll,
    searchMissing: d.ui.searchMissing,
    searchAllBtn: d.ui.searchAllBtn,
    moversTitle: d.ui.moversTitle,
    moversEmpty: d.ui.moversEmpty,
    watchTitle: d.ui.watchTitle,
    watchOwn: d.ui.watchOwn,
    watchSee: d.ui.watchSee,
    watchEmpty: d.ui.watchEmpty,
    watchDelta: d.ui.watchDelta,
    watchCap: d.ui.watchCap,
    watchGone: d.ui.watchGone,
    toLineLabel: d.ui.milestoneGap,
    crossedLabel: d.ui.milestoneGraduated,
    toastPrefix: d.ui.milestoneToast,
    toastSuffix: d.ui.stars,
    upLabel: d.ui.up,
    downLabel: d.ui.down,
    newLabel: d.ui.newEntry,
    totalLabel: d.ui.totalLabel,
    drawer: {
      title: d.ui.drawerTitle,
      loading: d.ui.drawerLoading,
      fail: d.ui.drawerFail,
      noReadme: d.ui.drawerNoReadme,
      open: d.ui.drawerOpen,
      archive: d.ui.drawerArchive,
      close: d.ui.drawerClose,
      prev: d.ui.drawerPrev,
      next: d.ui.drawerNext,
      rank: d.ui.drawerRank,
      from: d.ui.drawerFrom,
    },
  }
}

export function getDict(locale: Locale): Dict {
  return DICT[locale]
}
