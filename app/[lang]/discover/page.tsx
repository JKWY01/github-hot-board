import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { connection } from 'next/server'

import { isLocale } from '@/app/[lang]/dictionaries'
import { discoverFacets, discoverQuery, type DiscoverFilters, type DiscoverRow } from '@/lib/discover'
import { fmtNum } from '@/lib/format'
import { LOCALES } from '@/lib/locales'
import type { Locale } from '@/lib/types'

/** 发现页(noindex 工具页,不进 sitemap/搜索):库内组合筛选。
 *  筛选态走 URL 参数(可分享/可后退),chips 是链接,服务端渲染结果。
 *  近 7 天增量 = 自有快照对比;新入库无基线显示 —,不猜。 */

export const instant = false

/** 吸底条等处复用的发现页标题(16 语 T 表已有,不另开字典键)。 */
export const discoverTitle = (lang: Locale) => T[lang].title

const T: Record<Locale, Record<string, string>> = {
  en: { title: 'Discover', lead: 'Combine filters over our own library: language × topic × star band × age.', fLang: 'Language', fTopic: 'Topic', fStars: 'Stars', fAge: 'Created', fSort: 'Sort', all: 'All', a7: '≤ 7 days', a30: '≤ 30 days', a90: '≤ 90 days', ay: 'This year', sortStars: 'By total stars', sortGain: 'By 7-day gain', empty: 'No repos match these filters.', sourceUnavailable: 'Data source is unavailable — please retry shortly.', colRepo: 'Repo', colGain: '7-day gain', note: '7-day gain compares our own snapshots (collected since 2026-10-18); recently indexed repos show “—”. This page is noindex.' },
  zh: { title: '发现', lead: '在自己库里组合筛选:语言 × 主题 × Star 档 × 创建时间。', fLang: '语言', fTopic: '主题', fStars: 'Star 档', fAge: '创建时间', fSort: '排序', all: '全部', a7: '7 天内', a30: '30 天内', a90: '90 天内', ay: '今年', sortStars: '按累计 Star', sortGain: '按近 7 天增长', empty: '没有符合条件的仓库。', sourceUnavailable: '数据源暂不可用，请稍后重试。', colRepo: '项目', colGain: '近 7 天', note: '近 7 天增量来自自有快照对比(自 2026-10-18 起采集),新入库仓库显示“—”。本页 noindex,不进搜索。' },
  'zh-TW': { title: '發現', lead: '在自己庫裡組合篩選:語言 × 主題 × Star 檔 × 建立時間。', fLang: '語言', fTopic: '主題', fStars: 'Star 檔', fAge: '建立時間', fSort: '排序', all: '全部', a7: '7 天內', a30: '30 天內', a90: '90 天內', ay: '今年', sortStars: '按累計 Star', sortGain: '按近 7 天增長', empty: '沒有符合條件的倉庫。', sourceUnavailable: '資料來源暫不可用，請稍後重試。', colRepo: '專案', colGain: '近 7 天', note: '近 7 天增量來自自有快照對比(自 2026-10-18 起採集),新入庫倉庫顯示「—」。本頁 noindex。' },
  ja: { title: '発見', lead: '自庫で組み合わせ検索:言語 × トピック × スター帯 × 期間。', fLang: '言語', fTopic: 'トピック', fStars: 'スター帯', fAge: '作成時期', fSort: '並び順', all: 'すべて', a7: '7日以内', a30: '30日以内', a90: '90日以内', ay: '今年', sortStars: '累計スター順', sortGain: '直近7日増加順', empty: '条件に合うリポジトリはありません。', sourceUnavailable: 'データソースが一時的に利用できません。しばらくしてから再試行してください。', colRepo: 'リポジトリ', colGain: '7日増加', note: '7日増加は自有スナップショット比較(2026-10-18〜)。新規収録は「—」。本頁は noindex。' },
  ko: { title: '발견', lead: '자체 라이브러리 조합 필터: 언어 × 토픽 × 스타 구간 × 기간.', fLang: '언어', fTopic: '토픽', fStars: '스타 구간', fAge: '생성 시기', fSort: '정렬', all: '전체', a7: '7일 이내', a30: '30일 이내', a90: '90일 이내', ay: '올해', sortStars: '누적 스타순', sortGain: '최근 7일 증가순', empty: '조건에 맞는 저장소가 없습니다.', sourceUnavailable: '데이터 소스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', colRepo: '저장소', colGain: '7일 증가', note: '7일 증가는 자체 스냅샷 비교(2026-10-18~). 신규 수집은 “—”. 이 페이지는 noindex.' },
  de: { title: 'Entdecken', lead: 'Kombinierte Filter über die eigene Bibliothek: Sprache × Thema × Sternband × Alter.', fLang: 'Sprache', fTopic: 'Thema', fStars: 'Sterne', fAge: 'Erstellt', fSort: 'Sortierung', all: 'Alle', a7: '≤ 7 Tage', a30: '≤ 30 Tage', a90: '≤ 90 Tage', ay: 'Dieses Jahr', sortStars: 'Nach Gesamtsternen', sortGain: 'Nach 7-Tage-Zuwachs', empty: 'Keine Repos passen auf diese Filter.', sourceUnavailable: 'Datenquelle vorübergehend nicht verfügbar – bitte später erneut versuchen.', colRepo: 'Repo', colGain: '7-Tage', note: '7-Tage-Zuwachs aus eigenen Snapshots (seit 2026-10-18); neue Einträge zeigen „—“. Seite ist noindex.' },
  fr: { title: 'Découvrir', lead: 'Filtres combinés sur notre propre bibliothèque : langue × sujet × tranche d’étoiles × ancienneté.', fLang: 'Langue', fTopic: 'Sujet', fStars: 'Étoiles', fAge: 'Création', fSort: 'Tri', all: 'Tous', a7: '≤ 7 j', a30: '≤ 30 j', a90: '≤ 90 j', ay: 'Cette année', sortStars: 'Par étoiles totales', sortGain: 'Par gain sur 7 j', empty: 'Aucun dépôt ne correspond à ces filtres.', sourceUnavailable: 'Source de données indisponible – veuillez réessayer plus tard.', colRepo: 'Dépôt', colGain: '7 j', note: 'Gain sur 7 j calculé sur nos snapshots (depuis 2026-10-18) ; « — » si trop récent. Page noindex.' },
  es: { title: 'Descubrir', lead: 'Filtros combinados sobre nuestra biblioteca: idioma × tema × banda de estrellas × antigüedad.', fLang: 'Idioma', fTopic: 'Tema', fStars: 'Estrellas', fAge: 'Creación', fSort: 'Orden', all: 'Todos', a7: '≤ 7 días', a30: '≤ 30 días', a90: '≤ 90 días', ay: 'Este año', sortStars: 'Por estrellas totales', sortGain: 'Por ganancia en 7 días', empty: 'Ningún repo coincide con estos filtros.', sourceUnavailable: 'Fuente de datos no disponible; inténtalo de nuevo más tarde.', colRepo: 'Repo', colGain: '7 días', note: 'Ganancia de 7 días sobre snapshots propios (desde 2026-10-18); «—» si es reciente. Página noindex.' },
  pt: { title: 'Descobrir', lead: 'Filtros combinados na nossa biblioteca: idioma × tema × faixa de estrelas × idade.', fLang: 'Idioma', fTopic: 'Tema', fStars: 'Estrelas', fAge: 'Criação', fSort: 'Ordem', all: 'Todos', a7: '≤ 7 dias', a30: '≤ 30 dias', a90: '≤ 90 dias', ay: 'Este ano', sortStars: 'Por estrelas totais', sortGain: 'Por ganho em 7 dias', empty: 'Nenhum repo corresponde a estes filtros.', sourceUnavailable: 'Fonte de dados indisponível; tente novamente mais tarde.', colRepo: 'Repo', colGain: '7 dias', note: 'Ganho de 7 dias sobre snapshots próprios (desde 2026-10-18); «—» se recente. Página noindex.' },
  it: { title: 'Scopri', lead: 'Filtri combinati sulla nostra libreria: lingua × argomento × fascia di stelle × età.', fLang: 'Lingua', fTopic: 'Argomento', fStars: 'Stelle', fAge: 'Creazione', fSort: 'Ordine', all: 'Tutti', a7: '≤ 7 giorni', a30: '≤ 30 giorni', a90: '≤ 90 giorni', ay: 'Quest’anno', sortStars: 'Per stelle totali', sortGain: 'Per guadagno 7 giorni', empty: 'Nessun repo corrisponde a questi filtri.', sourceUnavailable: 'Origine dati non disponibile; riprova più tardi.', colRepo: 'Repo', colGain: '7 giorni', note: 'Guadagno 7 giorni su snapshot propri (dal 2026-10-18); «—» se recente. Pagina noindex.' },
  ru: { title: 'Обзор', lead: 'Комбинированный фильтр по собственной библиотеке: язык × тема × диапазон звёзд × возраст.', fLang: 'Язык', fTopic: 'Тема', fStars: 'Звёзды', fAge: 'Создан', fSort: 'Сортировка', all: 'Все', a7: '≤ 7 дн.', a30: '≤ 30 дн.', a90: '≤ 90 дн.', ay: 'В этом году', sortStars: 'По всем звёздам', sortGain: 'По приросту за 7 дней', empty: 'Под эти фильтры нет репозиториев.', sourceUnavailable: 'Источник данных недоступен — попробуйте позже.', colRepo: 'Репо', colGain: '7 дней', note: 'Прирост за 7 дней — по своим снапшотам (с 2026-10-18); «—» если недавно. Страница noindex.' },
  uk: { title: 'Огляд', lead: 'Комбінований фільтр за власною бібліотекою: мова × тема × діапазон зірок × вік.', fLang: 'Мова', fTopic: 'Тема', fStars: 'Зірки', fAge: 'Створено', fSort: 'Сортування', all: 'Усі', a7: '≤ 7 дн.', a30: '≤ 30 дн.', a90: '≤ 90 дн.', ay: 'Цього року', sortStars: 'За всіма зірками', sortGain: 'За приростом за 7 днів', empty: 'Під ці фільтри немає репозиторіїв.', sourceUnavailable: 'Джерело даних недоступне — спробуйте пізніше.', colRepo: 'Репо', colGain: '7 днів', note: 'Приріст за 7 днів — за власними знімками (з 2026-10-18); «—» якщо недавно. Сторінка noindex.' },
  pl: { title: 'Odkrywaj', lead: 'Filtry łączone na własnej bibliotece: język × temat × przedział gwiazdek × wiek.', fLang: 'Język', fTopic: 'Temat', fStars: 'Gwiazdki', fAge: 'Utworzono', fSort: 'Sortowanie', all: 'Wszystkie', a7: '≤ 7 dni', a30: '≤ 30 dni', a90: '≤ 90 dni', ay: 'W tym roku', sortStars: 'Po gwiazdkach łącznie', sortGain: 'Po przyroście 7-dniowym', empty: 'Brak repozytoriów dla tych filtrów.', sourceUnavailable: 'Źródło danych chwilowo niedostępne – spróbuj ponownie później.', colRepo: 'Repo', colGain: '7 dni', note: 'Przyrost 7-dniowy z własnych migawek (od 2026-10-18); „—” jeśli nowy. Strona noindex.' },
  tr: { title: 'Keşfet', lead: 'Kendi kitaplığımızda birleşik filtre: dil × konu × yıldız aralığı × yaş.', fLang: 'Dil', fTopic: 'Konu', fStars: 'Yıldız', fAge: 'Oluşturma', fSort: 'Sıralama', all: 'Tümü', a7: '≤ 7 gün', a30: '≤ 30 gün', a90: '≤ 90 gün', ay: 'Bu yıl', sortStars: 'Toplam yıldıza göre', sortGain: '7 günlük artışa göre', empty: 'Bu filtrelere uyan depo yok.', sourceUnavailable: 'Veri kaynağı kullanılamıyor – lütfen kısa süre sonra tekrar deneyin.', colRepo: 'Depo', colGain: '7 gün', note: '7 günlük artış kendi anlık görüntülerimizden (2026-10-18’den beri); yenilerde “—”. Sayfa noindex.' },
  vi: { title: 'Khám phá', lead: 'Kết hợp bộ lọc trên thư viện của mình: ngôn ngữ × chủ đề × khoảng sao × thời gian.', fLang: 'Ngôn ngữ', fTopic: 'Chủ đề', fStars: 'Khoảng sao', fAge: 'Thời gian tạo', fSort: 'Sắp xếp', all: 'Tất cả', a7: '≤ 7 ngày', a30: '≤ 30 ngày', a90: '≤ 90 ngày', ay: 'Năm nay', sortStars: 'Theo tổng sao', sortGain: 'Theo tăng 7 ngày', empty: 'Không có repo khớp bộ lọc.', sourceUnavailable: 'Nguồn dữ liệu tạm thời không khả dụng — vui lòng thử lại sau.', colRepo: 'Repo', colGain: '7 ngày', note: 'Tăng 7 ngày so với ảnh chụp tự có (từ 2026-10-18); mới thu thập hiện “—”. Trang noindex.' },
  id: { title: 'Temukan', lead: 'Filter gabungan di pustaka kami: bahasa × topik × rentang bintang × usia.', fLang: 'Bahasa', fTopic: 'Topik', fStars: 'Bintang', fAge: 'Dibuat', fSort: 'Urutkan', all: 'Semua', a7: '≤ 7 hari', a30: '≤ 30 hari', a90: '≤ 90 hari', ay: 'Tahun ini', sortStars: 'Berdasarkan total bintang', sortGain: 'Berdasarkan kenaikan 7 hari', empty: 'Tidak ada repo yang cocok.', sourceUnavailable: 'Sumber data tidak tersedia — silakan coba lagi nanti.', colRepo: 'Repo', colGain: '7 hari', note: 'Kenaikan 7 hari dari snapshot sendiri (sejak 2026-10-18); yang baru menunjukkan “—”. Halaman noindex.' },
}

const BANDS = { s0: '<100', s1: '100–1k', s2: '1k–10k', s3: '10k+' } as const
const AGES = { '7': 'a7', '30': 'a30', '90': 'a90', year: 'ay' } as const

function pick(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key]
  return typeof v === 'string' && v ? v.slice(0, 40) : undefined
}

export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return { robots: { index: false, follow: true } }
  return {
    title: T[lang].title,
    robots: { index: false, follow: true },
    alternates: { canonical: `/${lang}/discover` },
  }
}

export default async function DiscoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { lang } = await params
  const sp = await searchParams
  await connection() // 阻塞渲染 + searchParams 时态
  if (!isLocale(lang)) notFound()
  const t = T[lang]

  // 2026-10-29 OOM 批:参数边界在渲染入口收口(独立提交①配套)。
  // sanitize 返回 null = 非法形态(注入/超长/非法字符):短路为空查询,
  // 不进 'use cache'(拒绝类不产生持久缓存键)、不调 discoverQuery;合法长尾照常全链路。
  // 注意:下方 discoverFacets() 冷读仍可能触 DB(拒绝类≠绝对零 DB 访问)。
  const { sanitizeDiscoverLang, sanitizeDiscoverTopic } = await import('@/lib/discover')
  const langF = sanitizeDiscoverLang(pick(sp, 'lang')) ?? undefined
  const topicF = sanitizeDiscoverTopic(pick(sp, 'topic')) ?? undefined
  const bandF = (['s0', 's1', 's2', 's3'] as const).find((b) => b === pick(sp, 'band'))
  const ageF = (['7', '30', '90', 'year'] as const).find((a) => a === pick(sp, 'age'))
  const sortF = pick(sp, 'sort') === 'gain' ? 'gain' : 'stars'
  const filters: DiscoverFilters = { lang: langF, topic: topicF, band: bandF, age: ageF, sort: sortF }

  // 库不可达/超时时 fill 会 throw(discover-meta unavailable)——给降级卡,不裸 500。
  // 过载降级(评审五轮 P1):discoverQuery 显式返回 status='overloaded',
  // 页面渲染独立繁忙提示,与"没有符合条件的仓库"(真查 0 行)严格区分——过载不再伪装成正常空结果。
  let rows: DiscoverRow[] = []
  let facets: Awaited<ReturnType<typeof discoverFacets>> = { languages: [], topics: [] }
  let degraded = false      // 数据源不可用(throw)
  let overloaded = false    // 长尾并发过载(预算超时/队列满,可控降级)
  // 拒绝类短路(评审二轮+三轮口径校准):
  // ① 不调用 discoverQuery() → 不创建该查询的持久缓存条目(键空间零膨胀);
  // ② 仍调用 discoverFacets() → 筛选项是 UI 导航(访客需要看到合法选项);
  //    注意:discoverFacets() 在冷缓存或预计算回退时仍可能访问 DB(不是绝对零 DB 访问,
  //    但热态走 tag 缓存 ~1-2ms,见 discover-facets-store.ts)。
  const invalidParams = pick(sp, 'lang') !== undefined && langF === undefined
    || pick(sp, 'topic') !== undefined && topicF === undefined
  try {
    if (invalidParams) {
      facets = await discoverFacets()
    } else {
      // 先取 facets(预计算行直读,极快~1-2ms),作为常用参数判定的基准
      facets = await discoverFacets()
      const q = await discoverQuery({ ...filters, facetsRef: facets })
      rows = q.rows
      overloaded = q.status === 'overloaded'
    }
  } catch {
    degraded = true
  }

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const cur: Record<string, string | undefined> = {
      lang: langF, topic: topicF, band: bandF, age: ageF,
      sort: sortF === 'gain' ? 'gain' : undefined,
      ...patch,
    }
    for (const [k, v] of Object.entries(cur)) if (v) q.set(k, v)
    const qs = q.toString()
    return `/${lang}/discover${qs ? `?${qs}` : ''}`
  }

  const chip = (label: string, active: boolean, to: string) => (
    <Link
      key={label + to}
      href={to}
      prefetch={false}
      aria-current={active ? 'true' : undefined}
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${active ? 'bg-ink text-white' : 'bg-black/6 text-ink/65 hover:bg-black/12 hover:text-ink'}`}
    >
      {label}
    </Link>
  )

  const group = (label: string, children: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-14 shrink-0 text-right text-[11.5px] font-semibold uppercase tracking-wider text-sub">{label}</span>
      {children}
    </div>
  )

  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-12 sm:px-6">
      <p className="kicker">GitHub Hot Board</p>
      <h1 className="hero-title mt-2">{t.title}</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-sub">{t.lead}</p>

      <div className="mt-8 space-y-2.5">
        {group(t.fLang, <>{chip(t.all, !langF, href({ lang: undefined }))}{facets.languages.map(([l, n]) => chip(`${l} ${n}`, langF?.toLowerCase() === l.toLowerCase(), href({ lang: l })))}</>)}
        {group(t.fTopic, <>{chip(t.all, !topicF, href({ topic: undefined }))}{facets.topics.map(([tp, n]) => chip(`#${tp} ${n}`, topicF?.toLowerCase() === tp.toLowerCase(), href({ topic: tp })))}</>)}
        {group(t.fStars, <>{chip(t.all, !bandF, href({ band: undefined }))}{(Object.keys(BANDS) as Array<keyof typeof BANDS>).map((b) => chip(BANDS[b], bandF === b, href({ band: b })))}</>)}
        {group(t.fAge, <>{chip(t.all, !ageF, href({ age: undefined }))}{(Object.keys(AGES) as Array<keyof typeof AGES>).map((a) => chip(t[AGES[a]], ageF === a, href({ age: a })))}</>)}
        {group(t.fSort, <>{chip(t.sortStars, sortF === 'stars', href({ sort: undefined }))}{chip(t.sortGain, sortF === 'gain', href({ sort: 'gain' }))}</>)}
      </div>

      <div className="mt-8">
        {degraded ? (
          // 评审八轮 P1:数据源故障与"没有符合条件的仓库"语义分离——故障不是查询结果
          <p className="py-14 text-center text-[13.5px] text-sub">{t.sourceUnavailable}</p>
        ) : overloaded ? (
          <p className="py-14 text-center text-[13.5px] text-sub">{lang === 'zh' ? '查询繁忙,请稍后重试' : 'Search is busy right now — please retry shortly'}</p>
        ) : rows.length === 0 ? (
          <p className="card px-6 py-10 text-center text-[14px] text-sub">{t.empty}</p>
        ) : (
          <ul className="card divide-y-[0.5px] divide-black/6">
            {rows.map((r, i) => (
              <li key={r.fullName}>
                <Link href={`/${lang}/repo/${r.fullName}`} prefetch={false} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] sm:px-5">
                  <span className="w-8 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink/35">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{r.fullName}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-sub">
                      {[r.language, ...r.topics.slice(0, 3)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13.5px] font-semibold tabular-nums text-ink">{fmtNum(r.stars, lang)}</span>
                    <span className={"block text-[11.5px] tabular-nums " + (r.gain7 && r.gain7 > 0 ? 'text-good' : 'text-sub')}>
                      {r.gain7 != null ? (r.gain7 > 0 ? `+${fmtNum(r.gain7, lang)}` : fmtNum(r.gain7, lang)) : '—'} <span className="hidden sm:inline">{t.colGain}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-sub/80">{t.note}</p>
      </div>
    </div>
  )
}
