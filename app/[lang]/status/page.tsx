import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { connection } from 'next/server'

import { facetDisplay } from '@/lib/facet'
import { fmtNum } from '@/lib/format'
import { isLocale } from '@/app/[lang]/dictionaries'
import { LOCALES } from '@/lib/locales'
import { dbStats, dbUrlConfigured, readHeadHealth } from '@/lib/snapshot'
import type { Locale } from '@/lib/types'

/** 数据健康页:把"口径诚实"产品化 —— 34 个键各自的新鲜度、来源、降级状态全部摊开,
 *  与站点读路径同源(board_head),所见即访客所得。noindex 工具页。 */

export const instant = false

export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

const T: Record<Locale, {
  title: string; lead: string; db: string; dbDown: string; dbOff: string
  fresh: string; aging: string; stale: string; keyCol: string; srcCol: string
  rowsCol: string; ageCol: string; degraded: string; base: string; lang: string
}> = {
  en: { title: 'Data health', lead: 'Every board key, its source and freshness — the same rows the site serves. No cosmetics: if a tap is late or degraded, it shows.', db: 'Database', dbDown: 'Database unreachable right now — the site falls back to snapshots; boards stay readable.', dbOff: 'DATABASE_URL not configured — this deployment runs disk/live-fetch mode.', fresh: 'fresh', aging: 'aging', stale: 'stale', keyCol: 'Board', srcCol: 'Source', rowsCol: 'Rows', ageCol: 'Age', degraded: 'degraded', base: 'base', lang: 'lang' },
  zh: { title: '数据健康', lead: '全部榜单键的来源与新鲜度,与站点读路径同一张表 —— 数据旧就显示旧,不涂脂抹粉。', db: '数据库', dbDown: '数据库暂时不可达 —— 站点自动回落磁盘快照,榜单照常可读。', dbOff: '未配置 DATABASE_URL —— 当前部署以磁盘/现场拉取模式运行。', fresh: '新鲜', aging: '变旧', stale: '过期', keyCol: '榜单', srcCol: '来源', rowsCol: '行数', ageCol: '年龄', degraded: '降级中', base: '基准', lang: '分面' },
  'zh-TW': { title: '資料健康', lead: '全部榜單鍵的來源與新鮮度,與站點讀取路徑同一張表 —— 資料舊就顯示舊,不塗脂抹粉。', db: '資料庫', dbDown: '資料庫暫時不可達 —— 站點自動回落磁碟快照,榜單照常可讀。', dbOff: '未設定 DATABASE_URL —— 目前部署以磁碟/現場擷取模式運行。', fresh: '新鮮', aging: '變舊', stale: '過期', keyCol: '榜單', srcCol: '來源', rowsCol: '行數', ageCol: '年齡', degraded: '降級中', base: '基準', lang: '分面' },
  ja: { title: 'データ健全性', lead: '全ボードキーのソースと鮮度。サイトの読み取り経路と同じテーブル — 古ければ古いと表示します。', db: 'データベース', dbDown: 'データベースに現在接続できません — サイトはスナップショットへ自動フォールバックし、ボードは読めます。', dbOff: 'DATABASE_URL 未設定 — このデプロイはディスク/直接取得モードで動作しています。', fresh: '新鮮', aging: '経過', stale: '期限切れ', keyCol: 'ボード', srcCol: 'ソース', rowsCol: '行数', ageCol: '経過時間', degraded: '縮退中', base: 'ベース', lang: '言語' },
  ko: { title: '데이터 상태', lead: '모든 보드 키의 출처와 신선도. 사이트 읽기 경로와 같은 테이블 — 오래됐으면 오래됐다고 표시합니다.', db: '데이터베이스', dbDown: '데이터베이스에 접속할 수 없습니다 — 사이트는 스냅샷으로 자동 전환되어 보드는 계속 읽을 수 있습니다.', dbOff: 'DATABASE_URL 미설정 — 이 배포는 디스크/직접 가져오기 모드로 동작합니다.', fresh: '신선', aging: '경과', stale: '만료', keyCol: '보드', srcCol: '출처', rowsCol: '행 수', ageCol: '경과', degraded: '저하 중', base: '기본', lang: '언어' },
  de: { title: 'Datenzustand', lead: 'Quelle und Frische aller Board-Schlüssel — dieselbe Tabelle, die die Seite ausliefert. Alt heißt alt, ohne Schminke.', db: 'Datenbank', dbDown: 'Datenbank gerade nicht erreichbar — die Seite fällt auf Snapshots zurück, Boards bleiben lesbar.', dbOff: 'DATABASE_URL nicht gesetzt — dieses Deployment läuft im Festplatten-/Live-Modus.', fresh: 'frisch', aging: 'älter', stale: 'veraltet', keyCol: 'Board', srcCol: 'Quelle', rowsCol: 'Zeilen', ageCol: 'Alter', degraded: 'degradiert', base: 'Basis', lang: 'Sprache' },
  fr: { title: 'Santé des données', lead: 'Source et fraîcheur de chaque clé de classement — la même table que celle servie aux visiteurs. Vieux s’affiche vieux.', db: 'Base de données', dbDown: 'Base injoignable pour l’instant — le site bascule sur les instantanés, les classements restent lisibles.', dbOff: 'DATABASE_URL non configurée — ce déploiement tourne en mode disque/récupération directe.', fresh: 'frais', aging: 'vieillissant', stale: 'périmé', keyCol: 'Classement', srcCol: 'Source', rowsCol: 'Lignes', ageCol: 'Âge', degraded: 'dégradé', base: 'base', lang: 'langue' },
  es: { title: 'Salud de los datos', lead: 'Fuente y frescura de cada clave de tablero — la misma tabla que se sirve a los visitantes. Si está viejo, se muestra viejo.', db: 'Base de datos', dbDown: 'Base de datos inalcanzable ahora — el sitio recurre a instantáneas; los tableros siguen legibles.', dbOff: 'DATABASE_URL sin configurar — este despliegue funciona en modo disco/obtención directa.', fresh: 'fresco', aging: 'envejeciendo', stale: 'caducado', keyCol: 'Tabla', srcCol: 'Fuente', rowsCol: 'Filas', ageCol: 'Edad', degraded: 'degradado', base: 'base', lang: 'idioma' },
  pt: { title: 'Saúde dos dados', lead: 'Fonte e frescor de cada chave de quadro — a mesma tabela servida aos visitantes. Velho aparece como velho.', db: 'Banco de dados', dbDown: 'Banco inacessível no momento — o site recorre aos snapshots; os quadros continuam legíveis.', dbOff: 'DATABASE_URL não configurado — este deploy roda em modo disco/busca direta.', fresh: 'fresco', aging: 'envelhecendo', stale: 'vencido', keyCol: 'Quadro', srcCol: 'Fonte', rowsCol: 'Linhas', ageCol: 'Idade', degraded: 'degradado', base: 'base', lang: 'idioma' },
  it: { title: 'Salute dei dati', lead: 'Fonte e freschezza di ogni chiave di classifica — la stessa tabella servita ai visitatori. Se è vecchia, appare vecchia.', db: 'Database', dbDown: 'Database momentaneamente irraggiungibile — il site passa agli snapshot; le classifiche restano leggibili.', dbOff: 'DATABASE_URL non configurata — questo deploy gira in modalità disco/fetch diretto.', fresh: 'fresco', aging: 'invecchiando', stale: 'scaduto', keyCol: 'Classifica', srcCol: 'Fonte', rowsCol: 'Righe', ageCol: 'Età', degraded: 'degradato', base: 'base', lang: 'lingua' },
  ru: { title: 'Состояние данных', lead: 'Источник и свежесть каждого ключа рейтингов — та же таблица, которую видят посетители. Устарело — так и показываем.', db: 'База данных', dbDown: 'База сейчас недоступна — сайт переключается на снимки, рейтинги остаются читаемыми.', dbOff: 'DATABASE_URL не задан — этот деплой работает в режиме диск/прямая выборка.', fresh: 'свежие', aging: 'стареют', stale: 'устарели', keyCol: 'Рейтинг', srcCol: 'Источник', rowsCol: 'Строки', ageCol: 'Возраст', degraded: 'деградация', base: 'базовый', lang: 'язык' },
  uk: { title: 'Стан даних', lead: 'Джерело й свіжість кожного ключа рейтингів — та сама таблиця, яку бачать відвідувачі. Застаріло — так і показуємо.', db: 'База даних', dbDown: 'База зараз недоступна — сайт переходить на знімки, рейтинги залишаються читабельними.', dbOff: 'DATABASE_URL не задано — цей деплой працює в режимі диск/пряма вибірка.', fresh: 'свіжі', aging: 'старіють', stale: 'застарілі', keyCol: 'Рейтинг', srcCol: 'Джерело', rowsCol: 'Рядки', ageCol: 'Вік', degraded: 'деградація', base: 'базовий', lang: 'мова' },
  pl: { title: 'Kondycja danych', lead: 'Źródło i świeżość każdego klucza tablicy — ta sama tabela, którą dostają odwiedzający. Stare pokazujemy jako stare.', db: 'Baza danych', dbDown: 'Baza chwilowo nieosiągalna — strona przechodzi na migawki, tablice pozostają czytelne.', dbOff: 'DATABASE_URL nie ustawione — to wdrożenie działa w trybie dysk/pobieranie na żywo.', fresh: 'świeże', aging: 'starzejące się', stale: 'przeterminowane', keyCol: 'Tablica', srcCol: 'Źródło', rowsCol: 'Wiersze', ageCol: 'Wiek', degraded: 'degradacja', base: 'bazowy', lang: 'język' },
  tr: { title: 'Veri sağlığı', lead: 'Her papanın anahtarının kaynağı ve tazeliği — ziyaretçiye sunulan tablonun aynısı. Eskiyse eskimiş görünür.', db: 'Veritabanı', dbDown: 'Veritabanına şu an ulaşılamıyor — site anlık görüntülere düşer, pano okunabilir kalır.', dbOff: 'DATABASE_URL ayarlı değil — bu dağıtım disk/canlı çekme modunda çalışıyor.', fresh: 'taze', aging: 'eskiliyor', stale: 'bayat', keyCol: 'Pano', srcCol: 'Kaynak', rowsCol: 'Satır', ageCol: 'Yaş', degraded: 'bozuldu', base: 'temel', lang: 'dil' },
  vi: { title: 'Sức khỏe dữ liệu', lead: 'Nguồn và độ mới của từng khóa bảng — cùng một bảng mà khách truy cập nhận được. Cũ thì hiển thị cũ.', db: 'Cơ sở dữ liệu', dbDown: 'CSDL tạm không truy cập được — site tự chuyển sang ảnh chụp, các bảng vẫn đọc được.', dbOff: 'Chưa cấu hình DATABASE_URL — bản triển khai này chạy chế độ đĩa/lấy trực tiếp.', fresh: 'mới', aging: 'đang cũ', stale: 'quá hạn', keyCol: 'Bảng', srcCol: 'Nguồn', rowsCol: 'Số dòng', ageCol: 'Tuổi', degraded: 'suy giảm', base: 'chuẩn', lang: 'ngôn ngữ' },
  id: { title: 'Kesehatan data', lead: 'Sumber dan kesegaran setiap kunci papan — tabel yang sama dengan yang diterima pengunjung. Kalau basi, tampak basi.', db: 'Basis data', dbDown: 'Basis data sempat tak terjangkau — situs beralih ke snapshot, papan tetap terbaca.', dbOff: 'DATABASE_URL belum diatur — deployment ini berjalan mode disk/ambil langsung.', fresh: 'segar', aging: 'menua', stale: 'kedaluwarsa', keyCol: 'Papan', srcCol: 'Sumber', rowsCol: 'Baris', ageCol: 'Usia', degraded: 'terdegradasi', base: 'dasar', lang: 'bahasa' },
}

/** 新鲜度色档:同步节奏 30 分钟。≤40 分钟 = 绿;≤90 分钟(GHB_DB_MAX_MIN 默认值)= 琥珀;更久 = 红。 */
function ageBucket(ageMs: number): 'fresh' | 'aging' | 'stale' {
  if (ageMs <= 40 * 60_000) return 'fresh'
  if (ageMs <= 90 * 60_000) return 'aging'
  return 'stale'
}

const AGE_STYLE: Record<'fresh' | 'aging' | 'stale', string> = {
  fresh: 'bg-good/10 text-good',
  aging: 'bg-[#fff3d6] text-[#9a6b00]',
  stale: 'bg-bad/10 text-bad',
}

const SRC_LABEL: Record<string, string> = {
  'github-search': 'Search API',
  'github-trending': 'Trending 官方页',
  'github-search-fallback': 'Search 降级口径',
}

function fmtAge(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${min % 60} min`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return { robots: { index: false, follow: true } }
  return {
    title: `${T[lang].title} · GitHub Hot Board`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/${lang}/status` },
  }
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  await connection() // 阻塞渲染:noindex 工具页,但要的是"此刻"的库态
  if (!isLocale(lang)) notFound()
  const t = T[lang]

  const [rows, stats] = await Promise.all([readHeadHealth(), dbStats()])
  // 本页在顶部已 await connection() 声明请求时态 —— 此刻读钟是"真实的现在",
  // 不是预渲染期的 unstable 值(与 proxy.ts 往日榜的同款语义)。
  // eslint-disable-next-line react-hooks/purity -- 动态页请求时刻读钟,见上注
  const now = Date.now()

  const overall = rows && rows.length > 0
    ? {
        fresh: rows.filter((r) => ageBucket(now - Date.parse(r.takenAt)) === 'fresh').length,
        degraded: rows.filter((r) => r.degraded).length,
        oldest: Math.max(...rows.map((r) => now - Date.parse(r.takenAt))),
      }
    : null

  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-12 sm:px-6">
      <p className="kicker">GitHub Hot Board</p>
      <h1 className="hero-title mt-2">{t.title}</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-sub">{t.lead}</p>

      {/* 总览卡 */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="card px-5 py-4">
          <p className="text-[30px] font-bold leading-none tabular-nums tracking-tight text-ink">
            {overall ? `${overall.fresh}/${rows?.length ?? 0}` : '—'}
          </p>
          <p className="mt-2 text-[12.5px] text-sub">{t.fresh} · ≤40 min</p>
        </div>
        <div className="card px-5 py-4">
          <p className={`text-[30px] font-bold leading-none tabular-nums tracking-tight ${overall && overall.degraded > 0 ? 'text-bad' : 'text-ink'}`}>
            {overall ? overall.degraded : '—'}
          </p>
          <p className="mt-2 text-[12.5px] text-sub">{t.degraded}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[30px] font-bold leading-none tabular-nums tracking-tight text-ink">
            {stats ? fmtNum(stats.rows, lang === 'zh' ? 'zh' : 'en') : '—'}
          </p>
          <p className="mt-2 text-[12.5px] text-sub">{t.db} · board_snapshots</p>
        </div>
      </div>

      {/* 库态横幅 */}
      {!dbUrlConfigured() && (
        <p className="mt-6 rounded-2xl border-[0.5px] border-black/10 bg-[#f8f8fa] px-4 py-3 text-[13px] text-sub">{t.dbOff}</p>
      )}
      {dbUrlConfigured() && !rows && (
        <p className="mt-6 rounded-2xl border-[0.5px] border-black/10 bg-[#fff8e6] px-4 py-3 text-[13px] text-bad">{t.dbDown}</p>
      )}

      {/* 34 键明细 */}
      {rows && rows.length > 0 && (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b-[0.5px] border-black/8 text-[11px] uppercase tracking-wider text-sub">
                <th className="px-4 py-2.5 font-medium">{t.keyCol}</th>
                <th className="px-2 py-2.5 font-medium">{t.srcCol}</th>
                <th className="px-2 py-2.5 text-right font-medium">{t.rowsCol}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t.ageCol}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const age = now - Date.parse(r.takenAt)
                const bucket = ageBucket(age)
                return (
                  <tr key={r.key} className="border-b-[0.5px] border-black/5 last:border-b-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{r.board}</span>
                      <span className="ml-1.5 text-sub">
                        {r.language ? `${t.lang} · ${facetDisplay(r.language)}` : t.base}
                      </span>
                      {r.degraded && (
                        <span className="ml-2 rounded-full bg-bad/10 px-2 py-0.5 text-[10.5px] font-medium text-bad">{t.degraded}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-sub">{SRC_LABEL[r.source] ?? r.source}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-sub">{r.itemCount}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums ${AGE_STYLE[bucket]}`}>
                        {fmtAge(age)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
