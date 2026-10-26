import Link from 'next/link'
import type { Metadata } from 'next'

import ArchiveCharts, { type ChartSeries } from '@/components/archive-charts'
import { BOARD_ORDER, facetDisplay, facetLangSlug } from '@/lib/boards'
import { getDict } from '@/app/[lang]/dictionaries'
import { fmtDay, fmtNum } from '@/lib/format'
import { dailyStarDeltas, peakDay } from '@/lib/stardelta'
import type { RepoStatusFacts, TopicPeer } from '@/lib/snapshot'
import ArchiveShare from './ArchiveShare'
import CopyCode from './CopyCode'
import { jsonLdScript } from '@/lib/jsonld'
import { altLangs } from '@/lib/locales'
import type { RepoArchive } from '@/lib/repoarchive'
import type { Locale } from '@/lib/types'
import { ArchiveIcon, GithubIcon } from './Icons'

type BoardSlug = (typeof BOARD_ORDER)[number]

/** 快照里的 board 是裸 string:只认已知榜,脏数据直接过滤(不渲染不崩页)。 */
const KNOWN: readonly string[] = BOARD_ORDER
type ArchRow = Omit<RepoArchive['appearances'][number], 'board'> & { board: BoardSlug }

const PLATE = 'rounded-[20px] border-[0.5px] border-black/10 bg-[#f5f5f7]'

/** 16 语短文案(self-contained)。metaT 使用 {n}/{k}/{stars} 占位。 */
const T: Record<
  Locale,
  { kicker: string; current: string; history: string; offBoard: string; noDesc: string; updated: string; starUnit: string; back: string; bestAt: string; descNote: string; badge: string; copy: string; streak: string; share: string; facetWord: string; story: string;
  deltaTitle: string; peakNote: string; stTitle: string; licenseLab: string; pushLab: string; issueLab: string;
  unknown: string; topicsTitle: string; stNote: string; metaT: string; starTrend: string; rankTrend: string; noHistory: string; starCap: string; forkCap: string; daysOn: string; related: string; sibs: string; peakLine: string; docs: string }
> = {
  en: { kicker: 'Repository archive', current: 'Current rankings', history: 'Momentum, past 30 days', streak: 'On a {n}-day streak', share: 'Share', deltaTitle: 'Daily star gain', peakNote: '{d}: +{n} stars in one day, well above the recent average ({avg}) — cause unverified', stTitle: 'Project status', licenseLab: 'License', pushLab: 'Last push', issueLab: 'Open issues', unknown: 'unknown', topicsTitle: 'Similar projects · shared topics', stNote: 'Collected since 2026-10-25; unknown = not yet harvested', offBoard: 'Currently off the boards', noDesc: 'No translatable description yet — one arrives as the harvest finds it.', updated: 'Data at', starUnit: 'stars', back: 'Back to boards', bestAt: 'Best', descNote: 'This description comes from the repository itself.', badge: 'Put your badge on the README', copy: 'Copy', facetWord: 'language', story: 'On boards {d}d · +{gain} stars in 30d · ~+{rate}/day', metaT: 'Real GitHub data: {n} board appearances, best #{k}, {stars} stars — with a 30-day rank history.', starCap: 'Total stars', forkCap: 'Total forks', daysOn: 'Days on boards (30d)', starTrend: 'Cumulative stars', rankTrend: 'Rank movement', noHistory: 'No leaderboard records in the last 30 days.', related: 'Racing nearby on the same board', sibs: 'More by {owner}', peakLine: 'peak {d}: +{n}', docs: 'README' },
  zh: { kicker: '仓库档案', current: '当前上榜', history: '近 30 天势头', streak: '连续在榜 {n} 天', share: '分享', deltaTitle: '每日新增 Star', peakNote: '{d} 单日 +{n} 星,明显高于近期平均({avg})——增长原因待核实', stTitle: '项目状态', licenseLab: '许可证', pushLab: '最近 push', issueLab: 'Open Issues(含 PR)', unknown: '未知', topicsTitle: '同类项目 · 共享主题', stNote: '自 2026-10-25 起采集;未知 = 尚未采集到', offBoard: '当前未上榜', noDesc: '暂无该语言的简介——收割到会自动出现。', updated: '数据截至', starUnit: '星', back: '回到榜单', bestAt: '最好成绩', descNote: '简介来自仓库自身文档。', badge: '把上榜徽章放进你的 README', copy: '复制', facetWord: '语言', story: '上榜 {d} 天 · 近 30 天 +{gain} 星 · 日均 +{rate}', metaT: 'GitHub 实时数据:共上榜 {n} 次,最好成绩第 {k} 名,累计 {stars} 星,附近 30 天名次变化。', starCap: '累计 Star', forkCap: 'Fork 总数', daysOn: '近 30 天在榜天数', starTrend: '累计 Star 走势', rankTrend: '名次走势', noHistory: '近 30 天没有上榜记录。', related: '同榜竞速 · 名次近邻', sibs: '同一作者的其它上榜项目', peakLine: '最猛 {d} 单日 +{n}', docs: '项目文档' },
  'zh-TW': { kicker: '倉庫檔案', current: '當前上榜', history: '近 30 天勢頭', streak: '連續在榜 {n} 天', share: '分享', deltaTitle: '每日新增 Star', peakNote: '{d} 單日 +{n} 星,明顯高於近期平均({avg})——增長原因待核實', stTitle: '專案狀態', licenseLab: '授權條款', pushLab: '最近 push', issueLab: 'Open Issues(含 PR)', unknown: '未知', topicsTitle: '同類專案 · 共享主題', stNote: '自 2026-10-25 起採集;未知 = 尚未採集到', offBoard: '當前未上榜', noDesc: '尚無該語言的簡介——收割到會自動出現。', updated: '資料截至', starUnit: '星', back: '回到榜單', bestAt: '最好成績', descNote: '簡介來自倉庫自身文件。', badge: '把上榜徽章放進你的 README', copy: '複製', facetWord: '语言', story: '上榜 {d} 天 · 近 30 天 +{gain} 星 · 日均 +{rate}', metaT: 'GitHub 真實資料:上榜紀錄 {n} 條,最好 #第{k}名,累計 {stars} 星,附近 30 天名次歷史。', starCap: '累計 Star', forkCap: 'Fork 總數', daysOn: '近 30 天在榜天數', starTrend: '累計 Star 走勢', rankTrend: '名次走勢', noHistory: '近 30 天沒有上榜紀錄。', related: '同榜競速 · 名次近鄰', sibs: '同一作者的其它上榜專案', peakLine: '最猛 {d} 單日 +{n}', docs: '專案文件' },
  ja: { kicker: 'リポジトリアーカイブ', current: '現在のランクイン', history: '直近30日の推移', streak: '{n} 日連続ランクイン', share: 'シェア', deltaTitle: '日次スター増加', peakNote: '{d} に 1 日で +{n} スター(近期平均 {avg} を大幅超過)— 原因は未確認', stTitle: 'プロジェクト状態', licenseLab: 'ライセンス', pushLab: '最終 push', issueLab: '未解決 Issue(PR 含む)', unknown: '不明', topicsTitle: '類似プロジェクト · 共有トピック', stNote: '2026-10-25 から収集。不明 = 未収集', offBoard: '現在ランク外', noDesc: 'この言語の説明はまだありません。取得後に自動で表示されます。', updated: 'データ時点', starUnit: 'スター', back: 'ランキングへ戻る', bestAt: '最高順位', descNote: '説明はリポジトリ自身のドキュメント由来です。', badge: 'README にバッジを貼ろう', copy: 'コピー', facetWord: '言語別', story: '掲載 {d} 日 · 直近30日 +{gain} スター · 日平均 +{rate}', metaT: 'GitHub の実データ:{n} ランキングに登場、最高 #{k}、スター {stars}。直近 30 日の順位履歴付き。', starCap: '累計スター', forkCap: 'フォーク数', daysOn: '直近 30 日のランクイン日数', starTrend: 'スター累計の推移', rankTrend: 'ランキング推移', noHistory: '直近 30 日間のランクイン記録はありません。', related: '同ランキングで競う隣接リポジトリ', sibs: '同じ作者の他のランクイン', peakLine: '最大 {d} に +{n}', docs: 'プロジェクト文書' },
  ko: { kicker: '저장소 아카이브', current: '현재 순위', history: '최근 30일 추이', streak: '연속 {n}일 등재', share: '공유', deltaTitle: '일별 스타 증가', peakNote: '{d} 하루 +{n} 스타, 최근 평균({avg})보다 뚜렷하게 높음 — 원인 미확인', stTitle: '프로젝트 상태', licenseLab: '라이선스', pushLab: '최근 push', issueLab: '열린 이슈(PR 포함)', unknown: '미확인', topicsTitle: '비슷한 프로젝트 · 공유 토픽', stNote: '2026-10-25부터 수집. 미확인 = 아직 미수집', offBoard: '현재 순위 밖', noDesc: '이 언어 소개가 아직 없습니다. 수집되면 자동 표시됩니다.', updated: '데이터 기준', starUnit: '스타', back: '랭킹으로', bestAt: '최고 순위', descNote: '소개는 저장소 자체 문서에서 왔습니다.', badge: 'README에 뱃지를 붙여보세요', copy: '복사', facetWord: '언어별', story: '등재 {d}일 · 최근 30일 +{gain} 스타 · 일평균 +{rate}', metaT: 'GitHub 실제 데이터: {n}개 랭킹 등재, 최고 #{k}, 별 {stars}. 최근 30일 순위 기록 포함.', starCap: '누적 스타', forkCap: '포크 수', daysOn: '최근 30일 기록 일수', starTrend: '누적 스타 추이', rankTrend: '순위 추이', noHistory: '최근 30일간 기록이 없습니다.', related: '같은 보드의 이웃 랭커', sibs: '같은 작성자의 다른 등재 프로젝트', peakLine: '최고 {d} +{n}', docs: '프로젝트 문서' },
  de: { kicker: 'Repo-Archiv', current: 'Aktuelle Platzierungen', history: 'Verlauf der letzten 30 Tage', streak: '{n} Tage in Folge', share: 'Teilen', deltaTitle: 'Tägliche Sterne', peakNote: '{d}: +{n} Sterne an einem Tag, deutlich ueber dem recenten Schnitt ({avg}) — Ursache ungeprueft', stTitle: 'Projektstatus', licenseLab: 'Lizenz', pushLab: 'Letzter Push', issueLab: 'Offene Issues (inkl. PR)', unknown: 'unbekannt', topicsTitle: 'Ähnliche Projekte · gemeinsame Topics', stNote: 'Seit 2026-10-25 erfasst; unbekannt = noch nicht erhoben', offBoard: 'Derzeit nicht in den Boards', noDesc: 'Noch keine Beschreibung in dieser Sprache – kommt automatisch.', updated: 'Datenstand', starUnit: 'Sterne', back: 'Zu den Boards', bestAt: 'Bestplatzierung', descNote: 'Diese Beschreibung stammt vom Repository.', badge: 'Badge in dein README', copy: 'Kopieren', facetWord: 'Sprachfilter', story: '{d} Tage auf Boards · +{gain} Sterne in 30 T. · ~+{rate}/Tag', metaT: 'Echte GitHub-Daten: auf {n} Boards gelistet, Bestplatzierung #{k}, {stars} Sterne – mit 30-Tage-Rankingverlauf.', starCap: 'Sterne total', forkCap: 'Forks total', daysOn: 'Ranking-Tage (30 T.)', starTrend: 'Kumulierte Sterne', rankTrend: 'Platzierungsverlauf', noHistory: 'Keine Ranglisten-Einträge in den letzten 30 Tagen.', related: 'Rangnachbarn auf demselben Board', sibs: 'Weitere von {owner}', peakLine: 'Spitze {d}: +{n}', docs: 'Projektdokument' },
  fr: { kicker: 'Archive du dépôt', current: 'Classements actuels', history: 'Évolution sur 30 jours', streak: '{n} jours d’affilée', share: 'Partager', deltaTitle: 'Gain quotidien', peakNote: '{d} : +{n} étoiles en un jour, bien au-dessus de la moyenne récente ({avg}) — cause non vérifiée', stTitle: 'État du projet', licenseLab: 'Licence', pushLab: 'Dernier push', issueLab: 'Issues ouvertes (PR incl.)', unknown: 'inconnu', topicsTitle: 'Projets similaires · sujets partagés', stNote: 'Collecté depuis 2026-10-25 ; inconnu = pas encore récolté', offBoard: 'Actuellement hors classements', noDesc: 'Pas encore de description dans cette langue — elle apparaîtra automatiquement.', updated: 'Données au', starUnit: 'stars', back: 'Retour aux classements', bestAt: 'Meilleur rang', descNote: 'Cette description provient du dépôt lui-même.', badge: 'Mettez le badge dans votre README', copy: 'Copier', facetWord: 'par langue', story: '{d} jours classé · +{gain} étoiles en 30 j · ~+{rate}/jour', metaT: 'Données GitHub réelles : classé sur {n} classements, meilleur rang #{k}, {stars} stars — avec l’historique sur 30 jours.', starCap: 'Étoiles totales', forkCap: 'Forks totaux', daysOn: 'Jours classés (30 j)', starTrend: 'Étoiles cumulées', rankTrend: 'Évolution du rang', noHistory: 'Aucun classement au cours des 30 derniers jours.', related: 'Voisins de classement sur le même tableau', sibs: 'Autres dépôts de {owner}', peakLine: 'pic {d} : +{n}', docs: 'Documentation du projet' },
  es: { kicker: 'Archivo del repositorio', current: 'Clasificaciones actuales', history: 'Evolución de los últimos 30 días', streak: '{n} días seguidos', share: 'Compartir', deltaTitle: 'Ganancia diaria', peakNote: '{d}: +{n} estrellas en un día, muy por encima de la media reciente ({avg}) — causa sin verificar', stTitle: 'Estado del proyecto', licenseLab: 'Licencia', pushLab: 'Último push', issueLab: 'Issues abiertos (PR incl.)', unknown: 'desconocido', topicsTitle: 'Proyectos similares · temas compartidos', stNote: 'Recolectado desde 2026-10-25; desconocido = aún no recopilado', offBoard: 'Fuera de los rankings actualmente', noDesc: 'Aún no hay descripción en este idioma — aparecerá automáticamente.', updated: 'Datos al', starUnit: 'estrellas', back: 'Volver a los rankings', bestAt: 'Mejor puesto', descNote: 'Esta descripción procede del propio repositorio.', badge: 'Pon la insignia en tu README', copy: 'Copiar', facetWord: 'por idioma', story: '{d} días en tablas · +{gain} estrellas en 30 días · ~+{rate}/día', metaT: 'Datos reales de GitHub: en {n} rankings, mejor #{k}, {stars} estrellas — con historial de 30 días.', starCap: 'Estrellas totales', forkCap: 'Forks totales', daysOn: 'Días en rankings (30 d)', starTrend: 'Estrellas acumuladas', rankTrend: 'Evolución del puesto', noHistory: 'Sin registros en los últimos 30 días.', related: 'Vecinos de ranking en el mismo tablero', sibs: 'Más de {owner}', peakLine: 'pico {d}: +{n}', docs: 'Documentación del proyecto' },
  pt: { kicker: 'Arquivo do repositório', current: 'Colocações atuais', history: 'Evolução em 30 dias', streak: '{n} dias seguidos', share: 'Compartilhar', deltaTitle: 'Ganho diário', peakNote: '{d}: +{n} estrelas em um dia, bem acima da média recente ({avg}) — causa não verificada', stTitle: 'Estado do projeto', licenseLab: 'Licença', pushLab: 'Último push', issueLab: 'Issues abertos (PR incl.)', unknown: 'desconhecido', topicsTitle: 'Projetos similares · temas compartilhados', stNote: 'Coletado desde 2026-10-25; desconhecido = ainda não coletado', offBoard: 'Fora dos rankings no momento', noDesc: 'Ainda sem descrição neste idioma — aparece automaticamente.', updated: 'Dados de', starUnit: 'estrelas', back: 'Voltar aos rankings', bestAt: 'Melhor colocação', descNote: 'Esta descrição vem do próprio repositório.', badge: 'Coloque o emblema no seu README', copy: 'Copiar', facetWord: 'por idioma', story: '{d} dias em quadros · +{gain} estrelas em 30 dias · ~+{rate}/dia', metaT: 'Dados reais do GitHub: em {n} rankings, melhor #{k}, {stars} estrelas — com histórico de 30 dias.', starCap: 'Total de estrelas', forkCap: 'Total de forks', daysOn: 'Dias nos rankings (30 d)', starTrend: 'Estrelas acumuladas', rankTrend: 'Evolução da posição', noHistory: 'Sem registros nos últimos 30 dias.', related: 'Vizinhos de ranking no mesmo quadro', sibs: 'Mais de {owner}', peakLine: 'pico {d}: +{n}', docs: 'Documentação do projeto' },
  it: { kicker: 'Archivio repository', current: 'Classifiche attuali', history: 'Andamento degli ultimi 30 giorni', streak: '{n} giorni di fila', share: 'Condividi', deltaTitle: 'Guadagno giornaliero', peakNote: '{d}: +{n} stelle in un giorno, ben oltre la media recente ({avg}) — causa non verificata', stTitle: 'Stato del progetto', licenseLab: 'Licenza', pushLab: 'Ultimo push', issueLab: 'Issue aperte (PR incl.)', unknown: 'sconosciuto', topicsTitle: 'Progetti simili · argomenti condivisi', stNote: 'Raccolto dal 2026-10-25; sconosciuto = non ancora raccolto', offBoard: 'Attualmente fuori classifica', noDesc: 'Ancora nessuna descrizione in questa lingua — arriverà automaticamente.', updated: 'Dati al', starUnit: 'stelle', back: 'Torna alle classifiche', bestAt: 'Miglior posizione', descNote: 'Questa descrizione proviene dal repository.', badge: 'Metti il badge nel tuo README', copy: 'Copia', facetWord: 'per lingua', story: '{d} giorni in classifica · +{gain} stelle in 30 giorni · ~+{rate}/giorno', metaT: 'Dati reali da GitHub: in {n} classifiche, miglior #{k}, {stars} stelle — con cronologia di 30 giorni.', starCap: 'Stelle totali', forkCap: 'Fork totali', daysOn: 'Giorni in classifica (30 g)', starTrend: 'Stelle cumulate', rankTrend: 'Andamento della posizione', noHistory: 'Nessun record negli ultimi 30 giorni.', related: 'Vicini di classifica sullo stesso tabellone', sibs: 'Altri di {owner}', peakLine: 'picco {d}: +{n}', docs: 'Documentazione del progetto' },
  ru: { kicker: 'Архив репозитория', current: 'Текущие места', history: 'Динамика за 30 дней', streak: '{n} дн. подряд', share: 'Поделиться', deltaTitle: 'Прирост за день', peakNote: '{d}: +{n} звёзд за день, заметно выше среднего ({avg}) — причина не проверена', stTitle: 'Статус проекта', licenseLab: 'Лицензия', pushLab: 'Последний push', issueLab: 'Открытые issues (вкл. PR)', unknown: 'неизвестно', topicsTitle: 'Похожие проекты · общие темы', stNote: 'Собирается с 2026-10-25; неизвестно = ещё не собрано', offBoard: 'Сейчас вне рейтингов', noDesc: 'Описания на этом языке пока нет — появится автоматически.', updated: 'Данные на', starUnit: 'звёзд', back: 'К рейтингам', bestAt: 'Лучшее место', descNote: 'Описание взято из самого репозитория.', badge: 'Поставьте бейдж в свой README', copy: 'Скопировать', facetWord: 'по языку', story: '{d} дн. в рейтингах · +{gain} звёзд за 30 дней · ~+{rate}/день', metaT: 'Реальные данные GitHub: в {n} рейтингах, лучшее #{k}, {stars} звёзд — с историей за 30 дней.', starCap: 'Всего звёзд', forkCap: 'Всего форков', daysOn: 'Дней в рейтингах (30 дн.)', starTrend: 'Накопленные звёзды', rankTrend: 'Динамика мест', noHistory: 'Нет записей за последние 30 дней.', related: 'Соседи по рейтингу в том же топе', sibs: 'Другое от {owner}', peakLine: 'пик {d}: +{n}', docs: 'Документация проекта' },
  uk: { kicker: 'Архів репозиторію', current: 'Поточні місця', history: 'Динаміка за 30 днів', streak: '{n} дн. поспіль', share: 'Поділитися', deltaTitle: 'Приріст за день', peakNote: '{d}: +{n} зірок за день, помітно вище середнього ({avg}) — причину не перевірено', stTitle: 'Статус проєкту', licenseLab: 'Ліцензія', pushLab: 'Останній push', issueLab: 'Відкриті issues (вкл. PR)', unknown: 'невідомо', topicsTitle: 'Схожі проєкти · спільні теми', stNote: 'Збирається з 2026-10-25; невідомо = ще не зібрано', offBoard: 'Наразі поза рейтингами', noDesc: 'Опису цією мовою ще немає — з’явиться автоматично.', updated: 'Дані на', starUnit: 'зірок', back: 'До рейтингів', bestAt: 'Найкраще місце', descNote: 'Опис узято з самого репозиторію.', badge: 'Поставте бейдж у свій README', copy: 'Скопіювати', facetWord: 'за мовою', story: '{d} дн. у рейтингах · +{gain} зірок за 30 днів · ~+{rate}/день', metaT: 'Реальні дані GitHub: у {n} рейтингах, найкраще #{k}, {stars} зірок — з історією за 30 днів.', starCap: 'Усього зірок', forkCap: 'Усього форків', daysOn: 'Днів у рейтингах (30 дн.)', starTrend: 'Накоплені зірки', rankTrend: 'Динаміка місць', noHistory: 'Немає записів за останні 30 днів.', related: 'Сусіди рейтингу в тому ж топі', sibs: 'Інше від {owner}', peakLine: 'пік {d}: +{n}', docs: 'Документація проєкту' },
  pl: { kicker: 'Archiwum repozytorium', current: 'Aktualne miejsca', history: 'Przebieg z 30 dni', streak: '{n} dni z rzędu', share: 'Udostępnij', deltaTitle: 'Dzienny przyrost', peakNote: '{d}: +{n} gwiazdek w jeden dzień, wyraźnie powyżej średniej ({avg}) — przyczyna niezweryfikowana', stTitle: 'Status projektu', licenseLab: 'Licencja', pushLab: 'Ostatni push', issueLab: 'Otwarte issues (z PR)', unknown: 'nieznane', topicsTitle: 'Podobne projekty · wspólne tematy', stNote: 'Zbierane od 2026-10-25; nieznane = jeszcze nie zebrane', offBoard: 'Obecnie poza rankingami', noDesc: 'Opisu w tym języku jeszcze nie ma — pojawi się automatycznie.', updated: 'Dane na', starUnit: 'gwiazdek', back: 'Powrót do rankingów', bestAt: 'Najlepsze miejsce', descNote: 'Opis pochodzi z samego repozytorium.', badge: 'Wklej odznakę do swojego README', copy: 'Kopiuj', facetWord: 'wg języka', story: '{d} dni na tablicach · +{gain} gwiazdek w 30 dni · ~+{rate}/dzień', metaT: 'Prawdziwe dane GitHub: w {n} rankingach, najlepsze #{k}, {stars} gwiazdek — z historią 30 dni.', starCap: 'Wszystkich gwiazdek', forkCap: 'Wszystkich forków', daysOn: 'Dni w rankingach (30 d)', starTrend: 'Skumulowane gwiazdki', rankTrend: 'Przebieg miejsc', noHistory: 'Brak wpisów w ostatnich 30 dniach.', related: 'Sąsiedzi rankingu na tej samej tablicy', sibs: 'Więcej od {owner}', peakLine: 'szczyt {d}: +{n}', docs: 'Dokumentacja projektu' },
  tr: { kicker: 'Depo arşivi', current: 'Mevcut sıralamalar', history: 'Son 30 gün grafiği', streak: '{n} gün üst üste', share: 'Paylaş', deltaTitle: 'Günlük kazanç', peakNote: '{d}: tek günde +{n} yıldız, son dönem ortalamasının ({avg}) belirgin üstünde — neden doğrulanmadı', stTitle: 'Proje durumu', licenseLab: 'Lisans', pushLab: 'Son push', issueLab: 'Açık issue (PR dahil)', unknown: 'bilinmiyor', topicsTitle: 'Benzer projeler · ortak konular', stNote: '2026-10-25’ten beri toplanıyor; bilinmiyor = henüz toplanmadı', offBoard: 'Şu an sıralamalarda yok', noDesc: 'Bu dilde henüz açıklama yok — otomatik görünecek.', updated: 'Veri tarihi', starUnit: 'yıldız', back: 'Sıralamalara dön', bestAt: 'En iyi sıra', descNote: 'Bu açıklama depodan gelir.', badge: 'Rozeti README’ne koy', copy: 'Kopyala', facetWord: 'dile göre', story: 'Panolarda {d} gün · 30 günde +{gain} yıldız · günde ~+{rate}', metaT: 'Gerçek GitHub verisi: {n} sıralamada, en iyi #{k}, {stars} yıldız — 30 günlük geçmişle.', starCap: 'Toplam yıldız', forkCap: 'Toplam fork', daysOn: 'Son 30 günde sıralama günü', starTrend: 'Toplam yıldız', rankTrend: 'Sıra grafiği', noHistory: 'Son 30 günde sıralama kaydı yok.', related: 'Aynı panoda komşu sıralar', sibs: '{owner}’den başkaları', peakLine: 'zirve {d}: +{n}', docs: 'Proje belgeleri' },
  vi: { kicker: 'Hồ sơ kho lưu trữ', current: 'Thứ hạng hiện tại', history: 'Diễn biến 30 ngày', streak: '{n} ngày liên tiếp', share: 'Chia sẻ', deltaTitle: 'Tăng sao hằng ngày', peakNote: '{d}: +{n} sao trong một ngày, cao hẳn mức trung bình gần đây ({avg}) — nguyên nhân chưa kiểm chứng', stTitle: 'Trạng thái dự án', licenseLab: 'Giấy phép', pushLab: 'Push gần nhất', issueLab: 'Issue mở (gồm PR)', unknown: 'chưa rõ', topicsTitle: 'Dự án tương tự · chủ đề chung', stNote: 'Thu thập từ 2026-10-25; chưa rõ = chưa thu thập được', offBoard: 'Hiện không có trong bảng xếp hạng', noDesc: 'Chưa có mô tả ngôn ngữ này — sẽ tự xuất hiện.', updated: 'Dữ liệu tại', starUnit: 'sao', back: 'Về bảng xếp hạng', bestAt: 'Thứ hạng tốt nhất', descNote: 'Mô tả đến từ chính kho lưu trữ.', badge: 'Gắn huy hiệu vào README của bạn', copy: 'Sao chép', facetWord: 'theo ngôn ngữ', story: '{d} ngày trên bảng · +{gain} sao trong 30 ngày · ~+{rate}/ngày', metaT: 'Dữ liệu GitHub thật: có mặt trên {n} bảng, cao nhất #{k}, {stars} sao — kèm lịch sử 30 ngày.', starCap: 'Tổng sao', forkCap: 'Tổng fork', daysOn: 'Số ngày có mặt (30 ngày)', starTrend: 'Tổng số sao', rankTrend: 'Diễn biến thứ hạng', noHistory: 'Không có bản ghi nào trong 30 ngày qua.', related: 'Hàng xóm xếp hạng trên cùng bảng', sibs: 'Khác của {owner}', peakLine: 'đỉnh {d}: +{n}', docs: 'Tài liệu dự án' },
  id: { kicker: 'Arsip repositori', current: 'Peringkat saat ini', history: 'Grafik 30 hari', streak: '{n} hari berturut-turut', share: 'Bagikan', deltaTitle: 'Kenaikan harian', peakNote: '{d}: +{n} bintang dalam sehari, jauh di atas rata-rata terkini ({avg}) — penyebab belum terverifikasi', stTitle: 'Status proyek', licenseLab: 'Lisensi', pushLab: 'Push terakhir', issueLab: 'Issue terbuka (termasuk PR)', unknown: 'tidak diketahui', topicsTitle: 'Proyek serupa · topik bersama', stNote: 'Dikumpulkan sejak 2026-10-25; tidak diketahui = belum terkumpul', offBoard: 'Saat ini tidak ada di papan', noDesc: 'Belum ada deskripsi untuk bahasa ini — muncul otomatis.', updated: 'Data per', starUnit: 'bintang', back: 'Kembali ke papan', bestAt: 'Peringkat terbaik', descNote: 'Deskripsi berasal dari repositori itu sendiri.', badge: 'Pasang lencana di README kamu', copy: 'Salin', facetWord: 'per bahasa', story: '{d} hari di papan · +{gain} bintang dalam 30 hari · ~+{rate}/hari', metaT: 'Data nyata GitHub: masuk {n} papan, terbaik #{k}, {stars} bintang — dengan riwayat 30 hari.', starCap: 'Total bintang', forkCap: 'Total fork', daysOn: 'Hari di papan (30 hari)', starTrend: 'Jumlah bintang kumulatif', rankTrend: 'Pergerakan peringkat', noHistory: 'Tidak ada catatan dalam 30 hari terakhir.', related: 'Tetangga peringkat di papan yang sama', sibs: 'Lainnya dari {owner}', peakLine: 'puncak {d}: +{n}', docs: 'Dokumentasi proyek' },
}

/** 先现役、后老兵,每种语言/榜只保留"最近一次"记录,顺序 = 榜单官方顺序。 */
function sortedAppearances(archive: RepoArchive): ArchRow[] {
  const current = archive.appearances.filter((a) => a.current && KNOWN.includes(a.board))
  const pool = current.length > 0 ? current : archive.appearances.filter((a) => KNOWN.includes(a.board))
  return [...pool].sort((a, b) => {
    const oa = KNOWN.indexOf(a.board)
    const ob = KNOWN.indexOf(b.board)
    if (oa !== ob) return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob)
    if (a.language === '') return -1
    if (b.language === '') return 1
    return a.language.localeCompare(b.language)
  }) as ArchRow[]
}

export default function RepoArchiveView({
  archive,
  locale,
  descText,
  related,
  relatedBoard,
  siblings,
  statusFacts,
  topicPeers,
  readmeHtml,
}: {
  archive: RepoArchive
  locale: Locale
  descText: string | null
  related?: Array<{ fullName: string; rank: number; stars: number }>
  /** 近邻所在榜(基准口径优先):标题里标出来,不让读者猜是哪个榜的语境 */
  relatedBoard?: string
  /** 同作者的其他上榜仓(纯名单,repo_seen 来的,不带星数就不编数) */
  siblings?: string[]
  statusFacts?: RepoStatusFacts
  topicPeers?: TopicPeer[]
  readmeHtml?: string | null
}) {
  const dict = getDict(locale)
  const t = T[locale]
  const badgeBaseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  const rows = sortedAppearances(archive)
  const hasCurrent = archive.appearances.some((a) => a.current)
  const best = rows.reduce((m, a) => (a.rank < m.rank ? a : m), rows[0])
  const topPlate = best.rank <= 3
  const boardLabel = (a: { board: BoardSlug; language: string }) => {
    const base = dict.boards[a.board]?.name ?? a.board
    return a.language ? `${base} · ${facetDisplay(a.language)}` : base
  }
  const shortBoard = (board: BoardSlug) => dict.shortBoards[board] ?? dict.boards[board]?.name ?? board
  // 名牌副标签:分面名次必须带"分面"字样,防止 "#7" 被读成基准榜名次(走查实测误读)
  const plateLabel = best.language
    ? `${shortBoard(best.board)} · ${facetDisplay(best.language)} ${t.facetWord}`
    : boardLabel(best)
  // 跳榜锚点:LiveBoardList 数据到货后滚到对应行并划光
  const anchor = `#r=${encodeURIComponent(archive.fullName)}`

  const starByDay = new Map<string, number>()
  for (const d of archive.daily) {
    const cur = starByDay.get(d.day) ?? 0
    if (d.stars > cur) starByDay.set(d.day, d.stars)
  }
  const starPoints = [...starByDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, value]) => ({ day, value }))
  const daysOnBoard = starPoints.length
  const deltaPoints = dailyStarDeltas(starPoints).map((d) => ({ day: d.day, value: d.delta }))
  const peak = peakDay(dailyStarDeltas(starPoints))
  const rankGroups: ChartSeries[] = dailyGroups(archive)
    .map(([board, points]) => ({
      board,
      label: shortBoard(board),
      points: points.map((p) => ({ day: p.day, value: p.rank })),
    }))
    .reverse()

  return (
    <div className="mx-auto max-w-4xl px-5 pb-20 pt-12 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(softwareJsonLd(archive, locale, descText)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(archive, locale)) }}
      />

      {/* —— 英雄区:左名头右名牌 —— */}
      <div className="grid items-start gap-8 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="kicker">{dict.meta.siteName} · {t.kicker}</p>
          <h1 className="hero-title mt-2 break-all">
            <ArchiveIcon size={26} className="mr-2 inline-block align-[-3px] text-accent" />
            {archive.fullName}
          </h1>
          {descText ? (
            <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink/80">
              {descText}
              {' '}
              <span className="text-[12px] text-sub">({t.descNote})</span>
            </p>
          ) : (
            <p className="mt-4 max-w-2xl text-[14px] text-sub">{t.noDesc}</p>
          )}
          <p className="mt-4 flex items-center gap-x-4 gap-y-1 text-[13px] text-sub">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${hasCurrent ? 'bg-good' : 'bg-black/30'}`} />
              {t.updated} {fmtDay(archive.updatedAt, locale)}
            </span>
            <a href={archive.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
              <GithubIcon size={13} />
              {archive.fullName.split('/')[0]}
            </a>
            <ArchiveShare label={t.share} title={archive.fullName} url={`${(process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')}/${locale}/repo/${archive.fullName}`} />
          </p>
        </div>

        {/* 名牌:档案页的视觉锚 —— 最好名次大数字 */}
        <div className={`${PLATE} w-full max-w-[210px] px-6 py-6 text-center md:w-[210px] ${topPlate ? 'ring-1 ring-accent/35' : ''}`}>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-sub">{t.bestAt}</p>
          <p className={`mt-1 text-[52px] font-bold leading-none tracking-tight tabular-nums ${topPlate ? 'text-accent' : 'text-ink'}`}>
            #{best.rank}
          </p>
          <p className="mt-2 truncate text-[12.5px] text-sub">{plateLabel}</p>
        </div>
      </div>

      {/* —— 三联砖 —— */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="card px-5 py-4">
          <p className="text-[30px] font-bold leading-none tabular-nums tracking-tight text-ink">{fmtNum(archive.totalStars ?? 0, locale)}</p>
          <p className="mt-2 text-[12.5px] text-sub">{t.starCap}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[30px] font-bold leading-none tabular-nums tracking-tight text-ink">{fmtNum(archive.totalForks ?? 0, locale)}</p>
          <p className="mt-2 text-[12.5px] text-sub">{t.forkCap}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[30px] font-bold leading-none tabular-nums tracking-tight text-ink">{daysOnBoard}</p>
          <p className="mt-2 text-[12.5px] text-sub">{t.daysOn}</p>
        </div>
      </div>

      {/* —— 速览行:一句数据事实回答"最近势头如何"(纯数据拼装,无编辑观点) —— */}
      {(() => {
        if (starPoints.length < 2) return null
        const gain = starPoints[starPoints.length - 1]!.value - starPoints[0]!.value
        const currentBoards = archive.appearances.filter((a) => a.current).length
        if (gain <= 0 || currentBoards <= 0) return null
        // 最猛单日(星速层每日差分,窗口 ≤30 天):诚实展示"哪天冲得最猛"
        let peakDay = ''
        let peakGain = 0
        for (let i = 1; i < starPoints.length; i += 1) {
          const delta = starPoints[i]!.value - starPoints[i - 1]!.value
          if (delta > peakGain) {
            peakGain = delta
            peakDay = starPoints[i]!.day
          }
        }
        // 连续在榜天数:从最近有拍的日子往回数连续日(近 30 天窗口,满 30 显示 30+)。
        // "现在"用数据侧锚点(最新一拍时刻),不读墙钟 —— cacheComponents 生产契约
        // 禁止渲染期 Date.now()(实测:读钟会让档案页在生产断流成 200 空体)。
        const daySet = new Set(starPoints.map((p) => p.day))
        const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10)
        let streak = 0
        {
          const latest = starPoints[starPoints.length - 1]!.day
          const latestMs = Date.parse(`${latest}T00:00:00Z`)
          const nowMs = Date.parse(archive.updatedAt)
          if (nowMs - latestMs < 2 * 86_400_000) {
            for (let i = 0; ; i += 1) {
              const day = utcDay(latestMs - i * 86_400_000)
              if (!daySet.has(day)) break
              streak += 1
              if (streak >= 30) break
            }
          }
        }
        return (
          <p className="mt-3 px-1 text-[12.5px] text-sub">
            {t.story
              .replace('{d}', String(daysOnBoard))
              .replace('{gain}', fmtNum(gain, locale))
              .replace('{rate}', fmtNum(Math.round(gain / Math.max(1, daysOnBoard)), locale))}
            {/* 最猛单日是第二句数据事实:窗口短于 3 天不说(样本太小,说=编) */}
            {peakGain > 0 && peakDay && starPoints.length >= 3 && (
              <span className="ml-2 whitespace-nowrap text-[11.5px] text-sub">
                {t.peakLine.replace('{d}', peakDay.slice(5)).replace('{n}', fmtNum(peakGain, locale))}
              </span>
            )}
            {streak >= 2 && (
              <span className="ml-2 rounded-full bg-good/10 px-2 py-0.5 text-[11.5px] font-medium text-good">
                {t.streak.replace('{n}', String(streak))}{streak >= 30 ? '+' : ''}
              </span>
            )}
          </p>
        )
      })()}

      {/* —— 项目状态:有数据就展示,没有标未知(2026-10-25 起采集) —— */}
      <section className="mt-6">
        <div className={`${PLATE} px-5 py-4`}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
            <span className="font-semibold text-ink/80">{t.stTitle}</span>
            <span className="text-sub">{t.licenseLab}: <span className="font-medium text-ink/80">{statusFacts?.license ?? t.unknown}</span></span>
            <span className="text-sub">
              {t.pushLab}: <span className="font-medium text-ink/80">{statusFacts?.pushedAt ? fmtDay(statusFacts.pushedAt, locale) : t.unknown}</span>
            </span>
            <span className="text-sub">{t.issueLab}: <span className="font-medium text-ink/80">{statusFacts?.issues != null ? fmtNum(statusFacts.issues, locale) : t.unknown}</span></span>
          </div>
          <p className="mt-1.5 text-[11px] text-sub/80">{t.stNote}</p>
        </div>
      </section>

      {/* —— 上榜徽章:作者的荣誉证书,贴进 README 即外链回档案页 —— */}
      <section className="mt-6">
        <div className={`${PLATE} flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 外部可嵌入的 SVG 徽章,非站点内容图 */}
          <img
            src={`/api/badge/${archive.fullName}.svg`}
            alt={`${t.badge} · ${archive.fullName}`}
            height={20}
            className="h-5 w-auto"
          />
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-ink/70">
            [![{t.badge}]({badgeBaseUrl}/api/badge/{archive.fullName}.svg)]({badgeBaseUrl}/{locale}/repo/{archive.fullName})
          </code>
          <CopyCode
            label={t.copy}
            text={`[![${t.badge}](${badgeBaseUrl}/api/badge/${archive.fullName}.svg)](${badgeBaseUrl}/${locale}/repo/${archive.fullName})`}
          />
        </div>
        <div className={`${PLATE} mt-2 flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4`}>
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-ink/70">
            {`<a href="${badgeBaseUrl}/${locale}/repo/${archive.fullName}"><img src="${badgeBaseUrl}/api/badge/${archive.fullName}.svg" alt="${t.badge}" height="20"></a>`}
          </code>
          <CopyCode
            label={t.copy}
            text={`<a href="${badgeBaseUrl}/${locale}/repo/${archive.fullName}"><img src="${badgeBaseUrl}/api/badge/${archive.fullName}.svg" alt="${t.badge}" height="20"></a>`}
          />
        </div>
      </section>

      {/* —— 项目文档:GitHub 渲染的 README(repo_docs 快照)—— 爬虫的正粮,访客的百科 —— */}
      {readmeHtml && (
        <section className="mt-10">
          <h2 className="section-title">{t.docs}</h2>
          <div
            className={`${PLATE} md-body mt-3 max-h-[640px] overflow-y-auto px-5 py-4 sm:px-6`}
            dangerouslySetInnerHTML={{ __html: readmeHtml }}
          />
        </section>
      )}

      {/* —— 当前上榜:名次芯片 + 跳榜定位 —— */}
      <section className="mt-10">
        <h2 className="section-title">{t.current}</h2>
        {!hasCurrent && (
          <p className={`${PLATE} mt-3 flex items-center gap-2 px-4 py-3 text-[13px] text-sub`}>
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-black/30" />
            {t.offBoard}
            {archive.lastSeenAt ? ` · ${t.updated} ${fmtDay(archive.lastSeenAt, locale)}` : ''}
          </p>
        )}
        <ul className="card mt-4 divide-y-[0.5px] divide-black/6">
          {rows.map((a) => (
            <li key={`${a.board}:${a.language}`} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#f5f5f7] text-[14px] font-semibold tabular-nums ${
                  a.rank <= 3 ? 'text-accent' : 'text-ink/70'
                }`}
              >
                {a.rank}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-medium text-ink">{boardLabel(a)}{!a.current && <span className="text-sub"> · {t.offBoard}</span>}</p>
                <p className="text-[12.5px] text-sub">
                  {fmtNum(a.stars, locale)} {t.starUnit} · {fmtNum(a.forks, locale)} fork · {dict.boards[a.board]?.metricLabel}
                  {!a.current && ` · ${fmtDay(a.takenAt, locale)}`}
                </p>
              </div>
              <Link
                href={a.language ? `/${locale}/boards/${a.board}/${facetLangSlug(a.language)}${anchor}` : `/${locale}/boards/${a.board}${anchor}`}
                prefetch={false}
                className="ml-auto text-[13px] font-medium text-accent-strong hover:underline"
                aria-label={`${archive.fullName} · ${boardLabel(a)}`}
              >
                {shortBoard(a.board)} {a.language ? `· ${facetDisplay(a.language)}` : ''} →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* —— 走势图 —— */}
      <section className="mt-10">
        <h2 className="section-title">{t.history}</h2>
        {archive.daily.length === 0 || starPoints.length === 0 ? (
          <p className="card mt-4 px-4 py-4 text-[13px] text-sub">{t.noHistory}</p>
        ) : (
          <div className="card mt-4 px-3 py-4 sm:px-4">
            <ArchiveCharts
              starPoints={starPoints}
              starLabel={t.starTrend}
              starUnit={t.starUnit}
              rankGroups={rankGroups}
              rankLabel={t.rankTrend}
              deltaPoints={deltaPoints}
              deltaLabel={t.deltaTitle}
              locale={locale}
            />
            {peak && (
              <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink/70">
                {t.peakNote
                  .replace('{d}', peak.day)
                  .replace('{n}', String(peak.delta))
                  .replace('{avg}', String(peak.avgOthers))}
              </p>
            )}
          </div>
        )}
      </section>

      {/* —— 同榜竞速:名次近邻的内链网(爬虫与读者的横跳通道) —— */}
      {related && related.length > 0 && (
        <section className="mt-10">
          <h2 className="section-title">{t.related}{relatedBoard && <span className="text-sub"> · {shortBoard(relatedBoard as BoardSlug) ?? relatedBoard}</span>}</h2>
          <ul className="card mt-4 divide-y-[0.5px] divide-black/6">
            {related.map((r) => (
              <li key={r.fullName}>
                <Link
                  href={`/${locale}/repo/${r.fullName}`}
                  prefetch={false}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] sm:px-5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#f5f5f7] text-[14px] font-semibold tabular-nums text-ink/70">
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{r.fullName}</span>
                  <span className="text-[12.5px] tabular-nums text-sub">
                    {fmtNum(r.stars, locale)} {t.starUnit}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* —— 同作者的其他上榜仓:内链网第二层(爬虫与读者的纵向通道) —— */}
      {(siblings?.length ?? 0) > 0 && (
        <section className="mt-10">
          <h2 className="section-title">{t.sibs.replace('{owner}', archive.fullName.split('/')[0])}</h2>
          <ul className="card mt-4 divide-y-[0.5px] divide-black/6">
            {siblings!.map((sib) => (
              <li key={sib}>
                <Link
                  href={`/${locale}/repo/${sib}`}
                  prefetch={false}
                  className="block px-4 py-3 text-[14.5px] font-medium text-ink transition-colors hover:bg-black/[0.03] sm:px-5"
                >
                  {sib}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(topicPeers?.length ?? 0) > 0 && (
        <section className="mt-10">
          <h2 className="section-title">{t.topicsTitle}</h2>
          <ul className="card mt-4 divide-y-[0.5px] divide-black/6">
            {topicPeers!.map((peer) => (
              <li key={peer.fullName}>
                <Link
                  href={`/${locale}/repo/${peer.fullName}`}
                  prefetch={false}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] sm:px-5"
                >
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{peer.fullName}</span>
                  <span className="hidden shrink-0 gap-1.5 sm:flex">
                    {peer.sharedTopics.slice(0, 3).map((tp) => (
                      <span key={tp} className="rounded-full bg-black/6 px-2 py-0.5 text-[10.5px] text-ink/60">{tp}</span>
                    ))}
                  </span>
                  <span className="shrink-0 text-[12.5px] tabular-nums text-sub">{fmtNum(peer.stars, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10">
        <Link href={`/${locale}`} prefetch={false} className="text-[13.5px] font-medium text-accent-strong hover:underline">
          ← {t.back}
        </Link>
      </p>
    </div>
  )
}

/** 每榜的名次带:day 升序点列。 */
type DayPoint = { day: string; rank: number }

function dailyGroups(archive: RepoArchive): Array<[BoardSlug, DayPoint[]]> {
  const map = new Map<string, DayPoint[]>()
  for (const d of archive.daily) {
    if (!KNOWN.includes(d.board)) continue
    const list = map.get(d.board) ?? []
    list.push({ day: d.day, rank: d.rank })
    map.set(d.board, list)
  }
  for (const list of map.values()) list.sort((a, b) => a.day.localeCompare(b.day))
  return [...map.entries()] as Array<[BoardSlug, DayPoint[]]>
}

/** 面向爬虫的结构化数据。数字与页面上可见内容一致。 */
function softwareJsonLd(archive: RepoArchive, locale: Locale, descText: string | null) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    '@id': `${base}/${locale}/repo/${archive.fullName}#software`,
    name: archive.fullName,
    ...(descText ? { description: descText } : {}),
    url: archive.htmlUrl,
    codeRepository: archive.htmlUrl,
    inLanguage: locale,
    ...(archive.updatedAt ? { dateModified: archive.updatedAt } : {}),
  }
}

function breadcrumbJsonLd(archive: RepoArchive, locale: Locale) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const dict = getDict(locale)
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: dict.meta.siteName, item: `${base}/${locale}` },
      { '@type': 'ListItem', position: 2, name: archive.fullName, item: `${base}/${locale}/repo/${archive.fullName}` },
    ],
  }
}

export function repoArchiveMetadata(lang: Locale, archive: RepoArchive): Metadata {
  const dict = getDict(lang)
  const t = T[lang]
  const path = `/${lang}/repo/${archive.fullName}`
  const rows = sortedAppearances(archive)
  const best = rows.reduce((m, a) => (a.rank < m.rank ? a : m), rows[0])
  const title = archive.fullName
  const description = t.metaT
    .replace('{n}', String(rows.length))
    .replace('{k}', String(best ? best.rank : 1))
    .replace('{stars}', fmtNum(archive.totalStars ?? 0, lang))
  return {
    title,
    description,
    alternates: {
      canonical: path,
      languages: altLangs(`/repo/${archive.fullName}`),
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: dict.meta.siteName,
      type: 'website',
      locale: lang,
      // 动态分享卡(catch-all 不能挂 opengraph-image 文件,走 /repo-og 路由)
      images: [{ url: `/${lang}/repo-og/${archive.fullName}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/${lang}/repo-og/${archive.fullName}`],
    },
    robots: { index: true, follow: true },
  }
}
