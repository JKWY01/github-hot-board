import type { BoardSlug } from '@/lib/boards'
import type { Locale } from '@/lib/types'

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

const zhBoards: Record<BoardSlug, BoardCopy> = {
  overall: {
    name: '总榜 · 史上最强',
    tagline: 'GitHub 开源历史上，累计 Star 数最多的一百个项目。',
    metricLabel: '累计 Star',
    metricHint: '总数',
    desc: '按仓库历史累计 Star 数降序排列，数据来自 GitHub Search API（stars:>1000、排除 fork 仓库），缓存约 5～15 分钟刷新一次。',
    faqs: [
      { q: '为什么我的项目没有上榜？', a: '本榜只收录累计 Star 超过 1000 且不是其他仓库 fork 的项目；GitHub Search 索引存在一定延迟，新晋项目通常几小时内即可入池。' },
      { q: '与官方 Trending 有什么区别？', a: '官方 Trending 关注的是近期增速；本榜看重的是长期累计热度，更适合观察开源世界的“常青资产”。' },
    ],
  },
  weekly: {
    name: '周榜 · 本周点火',
    tagline: '过去七天，GitHub 上星标增势最猛的项目，官方 Trending 实时顺序。',
    metricLabel: '本周新增 Star',
    metricHint: '周增量',
    desc: '数据直接读取 GitHub 官方 Trending 周榜页面，榜单顺序与官方一致，右侧数字为官方标注的本周新增 Star 数，属于真实增量。',
    faqs: [
      { q: '数字和官方页面有时对不上？', a: '抓取结果在缓存期内（约 15 分钟），官方数字可能继续变化；每次自动刷新后会重新对齐。' },
      { q: '为什么不及抓失败时会换口径？', a: 'GitHub 并未提供官方 Trending API。当页面抓取受阻时，周榜会临时切换为“近 7 天新创建仓库按星数排序”的降级口径，并在页面顶部明确标注。' },
    ],
  },
  monthly: {
    name: '月榜 · 本月风潮',
    tagline: '以三十天为窗口，看看这个月真正的赢家。',
    metricLabel: '本月新增 Star',
    metricHint: '月增量',
    desc: '数据直接读取 GitHub 官方 Trending 月榜页面，榜单顺序与官方一致，右侧数字为官方标注的本月新增 Star 数，属于真实增量。',
    faqs: [
      { q: '为什么月榜里会有老项目？', a: '月增量关注的是“这个月发生了什么”，而不是项目创建时间；老项目借势翻红同样会进入月榜。' },
      { q: '抓取受阻时如何处理？', a: '与周榜一致：临时切换为“近 30 天新创建仓库按星数排序”的降级口径，并明确标注。' },
    ],
  },
  annual: {
    name: '年度新星榜',
    tagline: `今年创建的项目里，谁最快跑出影响力。`,
    metricLabel: '累计 Star（今年创建）',
    metricHint: '总数',
    desc: '仅统计本年度（1 月 1 日之后）创建的仓库，按累计 Star 降序，排除 fork 仓库。它回答的问题是：今年开源圈真正的爆款有哪些。',
    faqs: [
      { q: '为什么和总榜的数字可能重叠？', a: '年度新星榜限定“今年创建”，如果某项目今年创建且也已进入总榜，两边出现同一项目是正常的。' },
      { q: '刷新频率是多少？', a: '与所有 Search API 榜单一致：每 5～15 分钟（取决于是否配置 GitHub Token）。' },
    ],
  },
  rising: {
    name: '潜力榜 · 90 天斜率',
    tagline: '按“星/天”增长斜率排序，90 天内新项目的最大黑马池。',
    metricLabel: '星 / 天',
    metricHint: '斜率',
    desc: '统计近 90 天内创建的仓库，按 平均每天获得的 Star 数（累计 Star ÷ 站龄）降序。斜率 normalize 了上线时间，理论上比“累计数”更能反映当下势能。',
    faqs: [
      { q: '斜率会不会被短期冲量扭曲？', a: '会。斜率是平均数，上线两三天冲到几千星的项目斜率会很高；建议与“黑马榜”（要求低绝对星数）交叉阅读。' },
      { q: '与“年度新星榜”有何不同？', a: '年度榜限制创建于今年并按累计数排序；本榜限制 90 天内创建并按日均增速排序，时间窗更短、更看势头。' },
    ],
  },
  dark: {
    name: '黑马榜 · 被雪藏的爆发候选',
    tagline: '低绝对星数 × 高斜率 × 近期仍在维护，爆发通常从这里开始。',
    metricLabel: '星 / 天',
    metricHint: '斜率',
    desc: '在过去 90 天内新建、累计 Star 在 30–1500 之间、且斜率仍为正的仓库中，按“星/天”斜率从高到低取前 80。这类项目往往还没进入大众视野，属于“被雪藏”的爆发候选。',
    faqs: [
      { q: '为什么是独立查询，而不直接从潜力榜里筛？', a: '口径不同：黑马是“先按星数区间（30–1500）过滤、再按斜率排序”；若复用潜力榜（按斜率排序后取前 100）再过滤，榜头会被星数更少、出现更晚的小仓库挤满，反而漏掉真正的黑马。' },
      { q: '为什么设置 30 和 1500 两个门槛？', a: '低于 30 星时斜率的噪音太大（几个朋友点星就是 10 星/天）；高于 1500 星的仓库大多已进入大众视野。两者之间是“有一定拉力、尚未被发现”的甜区。' },
    ],
  },
  overlooked: {
    name: '被忽视榜 · 活跃却无人问津',
    tagline: '近 30 天仍在高强度维护，却只有几百星的宝贵项目。',
    metricLabel: '累计 Star（升序）',
    metricHint: '总数',
    desc: '筛选“最近 30 天内持续 push、Star 介于 100～800”的仓库并按 Star 升序排列。Star 少而代码活跃度高，说明维护者在认真做一件事，只是好事尚未被发现。',
    faqs: [
      { q: '这类项目一定有潜力吗？', a: '未必。快节奏维护也可能是死磕个人兴趣；但相比久未更新的仓库，它们至少证明“有人在认真经营”。' },
      { q: '为什么按 Star 升序？', a: '升序把“最冷清但仍在维护”的项目排在头部，突出“忽视感”；如果你更关心质量，可以按 500～800 一带的项目再过滤。' },
    ],
  },
  controversial: {
    name: '黑红榜 · 争议指数',
    tagline: 'Fork 与 Issue 异常高、Star 平平 —— 流量与风评两极分化的项目。',
    metricLabel: '争议指数',
    metricHint: '启发式',
    desc: '争议指数 = (Fork 数 × 2 + Issue 数) ÷ Star 数，在累计 Star 超 3000 的仓库中取极值。它衡量的是“关注远大于认可”的结构性矛盾；这是启发式指标，不代表社区真实情感。',
    faqs: [
      { q: '这个指数科学吗？', a: '不科学，也不假装科学。它是结构性代理指标：一个被广泛复制改造（高 Fork）或让人疯狂提问题（高 Issue）却收获很少 Star 的项目，通常都处于“黑红”的舆论场。' },
      { q: '为什么 Issue 数会包含 PR？', a: 'GitHub 的 open_issues 字段口径本身包含 Pull Request，本榜不做剔除，页面如实标注。' },
    ],
  },
  forks: {
    name: 'Fork 之王',
    tagline: '被最多人复制改造的代码，另一个维度的开源影响力。',
    metricLabel: '累计 Fork',
    metricHint: '总数',
    desc: '按仓库累计 Fork 数降序排列。Fork 代表“拿走我的代码去改造”，是观察自由软件精神的另一种流量。',
    faqs: [
      { q: '为什么 Fork 王与总榜首分同名单？', a: '学习性质的资源库（如面试题合集）常是 Fork 高而 Star 相对平平，两个维度并不重合。' },
      { q: '为什么排除 fork 仓库本身？', a: '排除 GitHub 标记为 fork 的分支仓库，避免榜单被同一项目的多份副本污染。' },
    ],
  },
  milestone: {
    name: '实时里程碑 · 破星直播',
    tagline: '紧盯 1,000、10,000、50,000、100,000 四条星标分割线，正在冲线的仓库都在这里。',
    metricLabel: '距下一档',
    metricHint: '差值',
    desc: '每 5～15 分钟搜索一次处于四个里程碑阈值 ±80 星附近的活跃仓库，并按剩余差值排序。页面每分钟轮询；出现在屏幕上时若成功跨线，将触发庆典动画与“恭喜突破”提示。',
    faqs: [
      { q: '必须停留在页面才会看到庆典吗？', a: '是。跨线检测由浏览器端比对两次轮询数据完成，因此请在页面停留；服务器不会替你持有历史状态。' },
      { q: '“差值”为什么可能为 0？', a: '仓库已越过某条阈值但仍停留在 ±80 的候选窗口内，属于“刚刚破线”的状态。' },
    ],
  },
}

const enBoards: Record<BoardSlug, BoardCopy> = {
  overall: {
    name: 'All-Time Champions',
    tagline: 'The 100 most starred projects in GitHub history.',
    metricLabel: 'Total stars',
    metricHint: 'lifetime',
    desc: 'Ranked by lifetime star count, sourced from the GitHub Search API (stars:>1000, forks excluded), refreshed every 5–15 minutes.',
    faqs: [
      { q: 'Why is my project missing?', a: 'The board only includes projects with more than 1000 lifetime stars that are not forks of another repository. Search indexing may lag by a few hours.' },
      { q: 'How is this different from official Trending?', a: 'Official Trending measures recent velocity; this board values accumulated heat — the evergreen assets of open source.' },
    ],
  },
  weekly: {
    name: 'Weekly Surge',
    tagline: 'Which repos exploded this week — straight from official Trending.',
    metricLabel: 'Stars this week',
    metricHint: 'this week',
    desc: 'Data is read directly from the official GitHub Trending weekly page. Order follows the official page; the number on the right is the real “stars this week” delta.',
    faqs: [
      { q: 'Numbers sometimes differ from the official page?', a: 'Fetching results are cached for ~15 minutes while the official numbers keep moving. A refresh re-aligns them.' },
      { q: 'What happens if crawling fails?', a: 'GitHub has no official Trending API. On failure, this board temporarily switches to “newest repos created in 7 days, ranked by stars” and clearly labels the fallback on the page. ' },
    ],
  },
  monthly: {
    name: 'Monthly Wave',
    tagline: 'A 30-day window on the real winners of this month.',
    metricLabel: 'Stars this month',
    metricHint: 'this month',
    desc: 'Data is read directly from the official GitHub Trending monthly page. Order follows the official page; the number on the right is the real “stars this month” delta.',
    faqs: [
      { q: 'Why do old projects appear here?', a: 'Monthly deltas track what happened this month, regardless of creation date — a comeback story qualifies too.' },
      { q: 'Crawl blocked?', a: 'Same fallback as the weekly board: newest repos created in 30 days ranked by stars, clearly labeled.' },
    ],
  },
  annual: {
    name: 'Fresh of the Year',
    tagline: 'This year’s most influential new projects.',
    metricLabel: 'Total stars (created this year)',
    metricHint: 'lifetime',
    desc: 'Only repositories created after January 1 of the current year, ranked by total stars, forks excluded. The real hits of this year in open source.',
    faqs: [
      { q: 'Overlap with the overall board?', a: 'Yes — a repo created this year and already in the all-time rankings appears on both, which is expected.' },
      { q: 'Refresh rate?', a: 'Same as all Search API boards: every 5–15 minutes depending on token availability.' },
    ],
  },
  rising: {
    name: 'Rising Slope',
    tagline: 'Stars per day within the last 90 days — the biggest new talent pool.',
    metricLabel: 'Stars / day',
    metricHint: 'slope',
    desc: 'Repositories created within 90 days, ranked by average stars gained per day (lifetime stars ÷ age). The slope normalizes launch date, reflecting current momentum.',
    faqs: [
      { q: 'Can the slope be gamed?', a: 'Short-term spikes can distort the average. Cross-read with the Dark Horses board, which requires low absolute star counts.' },
      { q: 'Different from Fresh of the Year?', a: 'The annual board caps creation at this year and ranks by total; this board caps at 90 days and ranks by daily slope.' },
    ],
  },
  dark: {
    name: 'Dark Horses',
    tagline: 'Low absolute stars × steep slope × still maintained. Breakouts start here.',
    metricLabel: 'Stars / day',
    metricHint: 'slope',
    desc: 'Repositories created within the last 90 days, totalling 30–1500 stars with a positive slope, ranked by stars per day — top 80. These projects are usually barely discovered yet: “buried” breakout candidates.',
    faqs: [
      { q: 'Why a dedicated query instead of slicing Rising?', a: 'Different methodology: filter by the star band (30–1500) first, then rank by slope. Reusing Rising’s top-100 before filtering would flood the top with tiny, brand-new repos and hide real breakout candidates.' },
      { q: 'Why the 30 and 1500 thresholds?', a: 'Under 30 stars the slope is mostly noise (a handful of friends off to an 10 stars/day start); above 1500 they are already widely noticed. In between is the sweet spot: real pull, barely discovered.' },
    ],
  },
  overlooked: {
    name: 'Underappreciated Gems',
    tagline: 'Actively maintained for 30+ days straight, yet only a few hundred stars.',
    metricLabel: 'Total stars (ascending)',
    metricHint: 'count',
    desc: 'Repositories pushed within the last 30 days with 100–800 stars, ordered ascending. Low stars + high activity means someone is doing careful work that has not been noticed yet.',
    faqs: [
      { q: 'Are these hidden gems guaranteed good?', a: 'Not necessarily — intense maintenance can be a passion project. But compared with stale repos, at least someone is actively running it. ' },
      { q: 'Why ascending order?', a: 'Ascending puts the coldest-but-alive projects at the top, maximizing the “ignored” feeling. ' },
    ],
  },
  controversial: {
    name: 'The Controversy Index',
    tagline: 'Fork-heavy, issue-heavy, star-light — projects that polarize the crowd.',
    metricLabel: 'Controversy index',
    metricHint: 'heuristic',
    desc: 'Index = (forks × 2 + open issues) ÷ stars, extremes among repos with over 3000 stars. It measures the structural tension of “attention far exceeding endorsement”. A heuristic, not a sentiment analysis.',
    faqs: [
      { q: 'Is this index scientific?', a: 'No, and it does not pretend to be. It is a structural proxy: repos that get widely copied (forks) or endlessly questioned (issues) while earning few stars usually live in a polarized spotlight.' },
      { q: 'Why do issues include PRs?', a: 'GitHub’s open_issues field itself includes pull requests. We do not subtract them and we say so. ' },
    ],
  },
  forks: {
    name: 'King of Forks',
    tagline: 'The most copied, forked and reworked code on GitHub.',
    metricLabel: 'Total forks',
    metricHint: 'lifetime',
    desc: 'Ranked by lifetime fork count. A fork means “I’m taking this code to change it” — a different channel of open source influence. ',
    faqs: [
      { q: 'Why doesn’t the fork list mirror the top-stars list?', a: 'Learning-style collections often accumulate many forks while their star count stays moderate. The two dimensions do not collapse into one. ' },
    ],
  },
  milestone: {
    name: 'Live Milestones',
    tagline: 'Repos sprinting toward the 1k / 10k / 50k / 100k star lines, watched live.',
    metricLabel: 'Stars to next line',
    metricHint: 'gap',
    desc: 'Every 5–15 minutes we search for active repos sitting within ±80 stars of four milestone thresholds (1k, 10k, 50k, 100k). The page polls every minute; if a line is crossed, a celebration animation and a “milestone reached” toast appear.',
    faqs: [
      { q: 'Must I keep the page open to see celebrations?', a: 'Yes. Crossing is detected in the browser by comparing successive polls — the server holds no history for you. ' },
      { q: 'Why can the “gap” be zero?', a: 'The repo has crossed a line but still sits in the ±80 window — the “just crossed” state. ' },
    ],
  },
}

export interface Dict {
  locale: Locale
  htmlLang: string
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
    allLanguages: string
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
    drawerClose: string
    drawerPrev: string
    drawerNext: string
    drawerRank: string
    drawerFrom: string
  }
  langs: { zh: string; en: string; current: string }
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
  zh: {
    locale: 'zh',
    htmlLang: 'zh-CN',
    meta: {
      siteName: 'GitHub 火线榜',
      homeTitle: 'GitHub 火线榜 · 实时开源项目热榜（总榜/周榜/月榜/潜力/黑红）',
      homeDescription: '实时追踪 GitHub 项目热度：史上最强总榜、官方 Trending 周月榜、年度新星、90 天潜力、黑马、被忽视的宝藏、黑红争议榜、Fork 之王与实时里程碑直播。全部口径公开，每分钟自动刷新。',
      homeKeywords: 'GitHub 排行榜, GitHub 热榜, GitHub Trending, 开源项目排行, 每周热榜, 明星项目, 黑马项目, HN, 开源风向',
    },
    nav: {
      home: '首页',
      logoTag: '火线榜',
      srcNote: '数据来自 GitHub 官方',
    },
    home: {
      heroKicker: 'GITHUB OPEN SOURCE PULSE',
      heroTitleTop: '今天，',
      heroTitleGradient: '谁在燃烧。',
      heroSub: '十个不同维度的 GitHub 榜单：史上最强、周月风潮、潜力与黑马、被忽视的宝藏、黑红的争议，全部来自官方数据的实时脉搏。',
      heroStatRepos: '收录项目',
      heroStatStars: '累计星标',
      heroStatDaily: '本周新增',
      weeklySectionKicker: 'WEEKLY SURGE',
      weeklySectionTitle: '本周点火',
      milestoneSectionKicker: 'LIVE MILESTONES',
      milestoneSectionTitle: '破星直播',
      milestoneSectionSub: '每分钟轮询一次，冲线时刻皆有庆典。请留在屏幕前见证。',
      boardsKicker: 'TEN LENSES',
      boardsTitle: '十张榜单，十种解读。',
      boardsSub: '每张榜公开口径与数据源，逐页即可验证。',
      viewBoard: '查看榜单',
    },
    boards: zhBoards,
    shortBoards: {
      overall: '总榜',
      weekly: '周榜',
      monthly: '月榜',
      annual: '年度',
      rising: '潜力',
      dark: '黑马',
      overlooked: '被忽视',
      controversial: '黑红',
      forks: 'Fork 王',
      milestone: '里程碑',
    },
    ui: {
      allLanguages: '全部语言',
      updated: '更新于',
      autoRefresh: '每 60 秒自动刷新',
      dataUpdated: '数据快照',
      sourceGithubSearch: 'GitHub Search API',
      sourceGithubTrending: 'GitHub Trending 官方页',
      degradedFallback: '口径降级中：Trending 抓取受阻，已切换为搜索口径',
      rateLimited: 'GitHub 接口暂时限流，正在为你展示缓存快照，稍后自动恢复',
      viewAll: '查看全部',
      stars: '星标',
      forks: 'Fork',
      issues: 'Issue',
      language: '语言',
      metricSecondary: '次指标',
      starsPerDayUnit: '星/天',
      daysOnline: '天站龄',
      pushedAt: '最近维护',
      milestoneGap: '距下一档',
      milestoneLines: '目标线',
      milestoneGraduated: '刚刚跨线',
      milestoneJustCrossed: '刚跨越',
      milestoneToast: '恭喜突破',
      milestoneToastSub: '项目跨过里程碑线',
      celebration: '庆祝时刻',
      definition: '口径说明',
      openQuestions: '常见问题',
      faqTitle: '口径与数据说明',
      crossAdd: '横向对比其他榜单：',
      inlinks: '相关榜单',
      up: '上升',
      down: '下降',
      newEntry: '新进榜',
      drawerTitle: '仓库详情',
      drawerLoading: '正在读取 GitHub 页面…',
      drawerFail: '这一页暂时没读到,稍后再试。',
      drawerNoReadme: '这个仓库没有 README,完整内容在 GitHub 上。',
      drawerOpen: '在 GitHub 打开',
      drawerClose: '关闭',
      drawerPrev: '上一名',
      drawerNext: '下一名',
      drawerRank: '榜位',
      drawerFrom: '页面渲染自 GitHub',
    },
    langs: { zh: '中文', en: 'English', current: '当前语言' },
    footer: {
      about: 'GitHub 火线榜是一个非营利的开源观察工具：以 GitHub 官方公开数据为唯一来源，实时呈现“什么项目正在被世界看见”。',
      sourceTitle: '数据来源',
      sourceBody: 'GitHub Search API 与 github.com/trending 公开页面。本站不做任何标记、无后门、无假数据。',
      boardsTitle: '榜单',
      langTitle: '语言',
      disclaimer: '各榜单为启发式指标，仅供参考研究。Star/Fork 数量不直接等于质量。',
      copyright: 'GitHub 火线榜 · 数据版权属于 GitHub 及相应项目作者',
    },
    notFound: {
      title: '页面不存在',
      body: '这条 Repository 看起来已经被宇宙移走，或从未存在。',
      back: '回到首页',
    },
    history: {
      title: '往日榜',
      subtitle: '每半小时拍一整张榜，按日期回看当时的完整排名。',
      pickDate: '选择日期',
      latest: '最新一拍',
      daysCount: '天',
      empty: '这一天没有留下档案。',
      accumulating: '档案正在积累——每天自动多存几拍。',
      metricLabel: '指标值',
      sourceLabel: '当拍口径',
      degradedNote: '当拍为搜索口径（Trending 抓取受阻时的替身）。',
      note: '历史拍只存排名、仓库与数字，不含实时简介。基准口径（全语言）。',
      backToBoard: '返回实时榜',
    },
  },
  en: {
    locale: 'en',
    htmlLang: 'en',
    meta: {
      siteName: 'GitHub Hot Board',
      homeTitle: 'GitHub Hot Board · Live open-source leaderboards (All-time / Weekly / Rising / Underrated)',
      homeDescription: 'Live GitHub project leaderboards: all-time champions, official Trending weekly & monthly, fresh-of-the-year, 90-day rising slope, dark horses, underappreciated gems, the controversy index, fork kings and live milestone tracking. Transparent methodology, minute-level refresh. ',
      homeKeywords: 'GitHub leaderboard, trending repos, open source rankings, weekly stars, rising projects, underrated repos',
    },
    nav: {
      home: 'Home',
      logoTag: 'Hot Board',
      srcNote: 'Data from official GitHub',
    },
    home: {
      heroKicker: 'GITHUB OPEN SOURCE PULSE',
      heroTitleTop: 'Open source is ',
      heroTitleGradient: 'burning.',
      heroSub: 'Ten lenses on the GitHub firehose: all-time champions, weekly & monthly surges, rising slopes, dark horses, underappreciated gems and the drama index — all measured, none fabricated. ',
      heroStatRepos: 'Repos tracked',
      heroStatStars: 'Stars counted',
      heroStatDaily: 'Stars this week',
      weeklySectionKicker: 'WEEKLY SURGE',
      weeklySectionTitle: 'This week’s fire',
      milestoneSectionKicker: 'LIVE MILESTONES',
      milestoneSectionTitle: 'Crossing the line, live',
      milestoneSectionSub: 'Polled every minute. Stay on screen to witness a line being crossed. ',
      boardsKicker: 'TEN LENSES',
      boardsTitle: 'Ten boards, ten readings.',
      boardsSub: 'Every board publishes its methodology and data source — verify it yourself. ',
      viewBoard: 'Open the board',
    },
    boards: enBoards,
    shortBoards: {
      overall: 'All-time',
      weekly: 'Weekly',
      monthly: 'Monthly',
      annual: 'Fresh',
      rising: 'Rising',
      dark: 'Dark horses',
      overlooked: 'Underrated',
      controversial: 'Controversy',
      forks: 'Fork kings',
      milestone: 'Milestones',
    },
    ui: {
      allLanguages: 'All languages',
      updated: 'Updated',
      autoRefresh: 'Auto refresh every 60s',
      dataUpdated: 'Data snapshot',
      sourceGithubSearch: 'GitHub Search API',
      sourceGithubTrending: 'GitHub Trending official page',
      degradedFallback: 'Fallback mode: Trending crawl blocked, switched to Search-based methodology',
      rateLimited: 'GitHub API is rate limited right now — serving cached snapshot, will auto-recover',
      viewAll: 'View all',
      stars: 'stars',
      forks: 'forks',
      issues: 'issues',
      language: 'Language',
      metricSecondary: 'secondary',
      starsPerDayUnit: 'stars/day',
      daysOnline: 'days old',
      pushedAt: 'last push',
      milestoneGap: 'to next line',
      milestoneLines: 'line',
      milestoneGraduated: 'Just crossed',
      milestoneJustCrossed: 'crossed',
      milestoneToast: 'Milestone reached',
      milestoneToastSub: 'project crossed the line',
      celebration: 'celebration',
      definition: 'Methodology',
      openQuestions: 'FAQ',
      faqTitle: 'Methodology & data notes',
      crossAdd: 'Cross-compare with other boards: ',
      inlinks: 'Related boards',
      up: 'up',
      down: 'down',
      newEntry: 'New entry',
      drawerTitle: 'Repository',
      drawerLoading: 'Reading the GitHub page…',
      drawerFail: 'Could not read the page — try again later.',
      drawerNoReadme: 'No README here — the full page lives on GitHub.',
      drawerOpen: 'Open on GitHub',
      drawerClose: 'Close',
      drawerPrev: 'Previous',
      drawerNext: 'Next',
      drawerRank: 'Rank',
      drawerFrom: 'Page rendered from GitHub',
    },
    langs: { zh: '中文', en: 'English', current: 'Language' },
    footer: {
      about: 'A non-commercial observation tool for open source. Pure official GitHub data, live — revealing the projects the world is watching right now.',
      sourceTitle: 'Data sources',
      sourceBody: 'GitHub Search API and the public github.com/trending page. No manual injection, no fabricated data. ',
      boardsTitle: 'Boards',
      langTitle: 'Language',
      disclaimer: 'Boards are heuristics for research reference. Stars and forks are not quality. ',
      copyright: 'GitHub Hot Board · data copyright belongs to GitHub and the respective projects',
    },
    notFound: {
      title: 'Page not found',
      body: 'This repository seems to have left the universe, or never existed. ',
      back: 'Back home',
    },
    history: {
      title: 'Time Machine',
      subtitle: 'The full board is photographed every 30 minutes — rewind by date to see the ranking at that moment.',
      pickDate: 'Pick a date',
      latest: 'latest tap',
      daysCount: 'd',
      empty: 'No archive exists for this date.',
      accumulating: 'Archive is accumulating — a few snapshots are stored automatically every day.',
      metricLabel: 'metric',
      sourceLabel: 'tap source',
      degradedNote: 'That tap used the Search-based fallback (official Trending crawl was blocked).',
      note: 'Historical taps store rank, repo and numbers only, without live descriptions. Base language pool.',
      backToBoard: 'Back to live board',
    },
  },
}

export function isLocale(value: string): value is Locale {
  return value === 'zh' || value === 'en'
}

/** 输给客户端列表组件的文案子集（避免整本 dictionary 进 RSC 载荷）。 */
export function liveStrings(locale: Locale) {
  const d = DICT[locale]
  return {
    updated: d.ui.updated,
    autoRefresh: d.ui.autoRefresh,
    rateLimited: d.ui.rateLimited,
    degraded: d.ui.degradedFallback,
    starsUnit: d.ui.stars,
    forksUnit: d.ui.forks,
    issueUnit: d.ui.issues,
    languageUnit: d.ui.language,
    pushedLabel: d.ui.pushedAt,
    daysOldLabel: d.ui.daysOnline,
    perDayUnit: d.ui.starsPerDayUnit,
    toLineLabel: d.ui.milestoneGap,
    crossedLabel: d.ui.milestoneGraduated,
    toastPrefix: d.ui.milestoneToast,
    toastSuffix: d.ui.stars,
    upLabel: d.ui.up,
    downLabel: d.ui.down,
    newLabel: d.ui.newEntry,
    totalLabel: d.ui.allLanguages === '全部语言' ? '总数' : 'total',
    drawer: {
      title: d.ui.drawerTitle,
      loading: d.ui.drawerLoading,
      fail: d.ui.drawerFail,
      noReadme: d.ui.drawerNoReadme,
      open: d.ui.drawerOpen,
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
