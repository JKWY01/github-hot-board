/** 十榜玩法指南(/guide)的逐语种文案。
 * 独立于 app/[lang]/dict 的词典体系:这套正文是长文,塞进词典会让 16 个 locale 文件同时膨胀,
 * 收在这里一个模块管到底;翻译与站内 UI 词典同标准成套,不搞"缺语种回退英文"。
 * 核心主打长尾:GitHub 趋势怎么看 / GitHub 排行榜有哪些 / trending 如何交叉验证。 */

import type { Locale } from '@/lib/types'

export interface GuideCopy {
  metaTitle: string
  metaDesc: string
  kicker: string
  h1: string
  lead1: string
  lead2: string
  faqs: Array<{ q: string; a: string }>
  boardsKicker: string
  boardsTitle: string
  footerLine: string
  /** 首页"榜单总览"区指向本页的锚文本 */
  homeCta: string
}

const zh: GuideCopy = {
  metaTitle: "GitHub 趋势与排行榜怎么用:十榜玩法指南",
  metaDesc:
    "十张 GitHub 排行榜各看什么、怎么交叉验证:总榜看家底,周榜月榜看势能,黑马与被忽视找遗珠,黑红看争议,里程碑直播盯冲线。附语言分榜与 30 天名次曲线用法。",
  kicker: "HOW TO READ",
  h1: "十榜玩法指南:把 GitHub 趋势读成信号",
  lead1:
    "官方 Trending 只回答「现在谁火」。火线榜把它拆成十个口径:总榜看家底,周榜月榜看势能,年度新星与 90 天斜率看新得快不快,黑马与被忽视找漏网之鱼,黑红看争议,Fork 之王看二创生态,里程碑直播盯 1k / 10k / 50k / 100k 的冲线瞬间。",
  lead2:
    "榜单要交叉着读:一个项目同时上周榜和潜力榜,多半是真增长;只在黑红榜出现而新星榜没有名字,更可能是话题噪音。每个项目都有档案页,30 天名次曲线一眼分辨稳定爬升与一夜冲顶。",
  faqs: [
    {
      q: "GitHub 官方 Trending 和火线榜有什么区别?",
      a: "Trending 只呈现此刻的热度;火线榜在它之上补了名次历史、争议指数、日均斜率和「活跃却冷清」的被忽视项目,十个视角互相印证,火得有没有底子一眼可见。",
    },
    {
      q: "数据从哪来,会不会掺水?",
      a: "只有公开数据一种来源:GitHub Search API 和官方 Trending 页。每张榜的取数口径直接贴在页面上,口径失效时明示,不悄悄换数。",
    },
    {
      q: "多久更新一次?",
      a: "数据管线每 30 分钟进一轮货,站点 60 秒轮询;里程碑直播榜里的项目冲过阈值当场跨线。",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "按口径挑一张,进榜看货",
  footerLine:
    "十六种界面语言,行描述按仓库自身的本地化 README 呈现;每个名字都能点进档案页。",
  homeCta: "打开十榜玩法指南",
}

const en: GuideCopy = {
  metaTitle: "How to read GitHub trends: the ten-board field guide",
  metaDesc:
    "What ten GitHub leaderboards measure and how to cross-read them: all-time giants, weekly surges, monthly waves, annual newcomers, 90-day slopes, dark horses, overlooked gems, controversy index, fork champions and live milestones — plus language sub-boards and 30-day rank curves.",
  kicker: "HOW TO READ",
  h1: "The ten-board field guide: reading GitHub trends as signals",
  lead1:
    "Official Trending only answers who is hot right now. The Hot Board splits that into ten lenses: all-time giants for the foundation, weekly and monthly boards for momentum, annual newcomers and the 90-day slope for how fast the new kids climb, dark horses and overlooked gems for what slipped through, the controversy index for drama, fork champions for ecosystem reach, and a live milestone board watching the 1k / 10k / 50k / 100k crossings.",
  lead2:
    "Read boards against each other: a repo rising on both the weekly and the potential board is likely real growth; appearing only on the controversy board while absent from newcomers is more likely noise. Every repo has an archive page — the 30-day rank curve separates steady climbs from one-night spikes.",
  faqs: [
    {
      q: "How is this different from official GitHub Trending?",
      a: "Trending shows the moment. The Hot Board adds rank history, a controversy index, per-day slopes and a board for actively-maintained-but-overlooked repos — ten lenses that confirm or contradict each other, so you can see whether the hype has bones.",
    },
    {
      q: "Where does the data come from?",
      a: "Public data only: the GitHub Search API and the official Trending pages. Every board states its rules on the page; when a rule breaks, the page says so instead of quietly switching numbers.",
    },
    {
      q: "How often does it update?",
      a: "The pipeline ingests every 30 minutes, the site polls every 60 seconds, and the live milestone board reacts the moment a repo crosses a threshold.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Pick a lens, open a board",
  footerLine:
    "Sixteen interface languages; row descriptions follow each repo's own localized README when available. Every entry links to its archive page.",
  homeCta: "Open the ten-board field guide",
}

const zhTW: GuideCopy = {
  metaTitle: "GitHub 趨勢與排行榜怎麼用:十榜玩法指南",
  metaDesc:
    "十張 GitHub 排行榜各看什麼、怎麼交叉驗證:總榜看家底,週榜月榜看勢能,黑馬與被忽視找遺珠,黑紅看爭議,里程碑直播盯衝線。附語言分榜與 30 天名次曲線用法。",
  kicker: "HOW TO READ",
  h1: "十榜玩法指南:把 GitHub 趨勢讀成訊號",
  lead1:
    "官方 Trending 只回答「現在誰頂」。火線榜把它拆成十個口徑:總榜看家底,週榜月榜看勢能,年度新星與 90 天斜率看新得快不快,黑馬與被忽視找漏網之魚,黑紅看爭議,Fork 之王看二創生態,里程碑直播盯 1k / 10k / 50k / 100k 的衝線瞬間。",
  lead2:
    "榜單要交叉著讀:一個專案同時上週榜和潛力榜,多半是真成長;只在黑紅榜出現而新星榜沒有名字,更可能是話題噪音。每個專案都有檔案頁,30 天名次曲線一眼分辨穩定爬升與一夜衝頂。",
  faqs: [
    {
      q: "GitHub 官方 Trending 和火線榜有什麼不同?",
      a: "Trending 只呈現此刻的熱度;火線榜補上名次歷史、爭議指數、日均斜率與「活躍卻冷清」的被忽視專案,十個視角互相印證,火得有沒有底子一眼可見。",
    },
    {
      q: "資料從哪來,會不會摻水?",
      a: "只有公開資料一種來源:GitHub Search API 和官方 Trending 頁。每張榜的取數口徑直接貼在頁面上,口徑失效時明示,不悄悄換數。",
    },
    {
      q: "多久更新一次?",
      a: "資料管線每 30 分鐘進一輪貨,站點 60 秒輪詢;里程碑直播榜裡的專案衝過門檻當場跨線。",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "按口徑挑一張,進榜看貨",
  footerLine: "十六種介面語言,列描述按儲存庫自身的本地化 README 呈現;每個名字都能點進檔案頁。",
  homeCta: "打開十榜玩法指南",
}

const ja: GuideCopy = {
  metaTitle: "GitHubトレンドとランキングの使い方:十榜ガイド",
  metaDesc:
    "10種類のGitHubランキングがそれぞれ何を測り、どう交差読みするか:総合で実力、週間・月間で勢い、年間新星と90日スロープで伸びしろ、ダークホースと「見過ごされ榜」で掘り出し物、物議指数で話題性、フォーク王で二次創作、マイルストーン実況で節目の瞬間を。",
  kicker: "HOW TO READ",
  h1: "十榜ガイド:GitHubトレンドをシグナルとして読む",
  lead1:
    "公式Trendingが答えるのは「今いちばん熱いのは誰か」だけ。Hot Boardはそれを10の視点に分解します:総合榜は実力、週間・月間は勢い、年間新星と90日スロープは伸びしろ、ダークホースと見過ごされ榜は取り残された宝、物議榜は論争、フォーク王は二次創作の生態系、マイルストーン実況は1k / 10k / 50k / 100kの突破の瞬間を見張ります。",
  lead2:
    "榜は交差させて読むのが鉄則です。週間榜とポテンシャル榜に同時に載るリポジトリは本物の成長であることが多く、物議榜にだけ名前があり新星榜に現れないなら話題性だけのノイズかもしれません。全リポジトリにアーカイブページがあり、30日分の順位カーブで着実な上昇と一夜限りの急騰を区別できます。",
  faqs: [
    {
      q: "公式Trendingとの違いは?",
      a: "Trendingは今の熱のみを示します。Hot Boardは順位履歴・物議指数・1日あたりのスロープ・活動中なのに評価が追いついていないリポジトリの榜を追加し、10視点で相互検証できます。",
    },
    {
      q: "データはどこから?",
      a: "公開データのみ:GitHub Search APIと公式Trending。各榜の集計ルールはページに明記され、ルールが無効になった場合は黙って数字を差し替えず明示します。",
    },
    {
      q: "更新頻度は?",
      a: "データは30分ごとに一巡、サイトは60秒でポーリング。マイルストーン実況榜はしきい値を超えた瞬間に更新されます。",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "口径を選んで榜へ",
  footerLine:
    "16言語のUI。行の説明文は各リポジトリのローカライズ済みREADMEがあればそれを優先表示。すべての名前からアーカイブページへ飛べます。",
  homeCta: "十榜ガイドを開く",
}

const ko: GuideCopy = {
  metaTitle: "GitHub 트렌드·랭킹 사용법: 10강 가이드",
  metaDesc:
    "10장의 GitHub 순위표가 각각 무엇을 보는지, 어떻게 교차 검증하는지: 총괄로 위상을, 주간·월간으로 모멘텀을, 신년 신성과 90일 기울기로 성장 속도를, 다크호스와 조명 받지 못한 보물을, 논쟁 지수로 해프닝을, 마일스톤 라이브로 1k / 10k / 50k / 100k 진입 순간을 봅니다.",
  kicker: "HOW TO READ",
  h1: "10강 가이드: GitHub 트렌드를 신호로 읽기",
  lead1:
    "공식 Trending은 지금 누가 뜨거운지만 답합니다. GitHub Hot Board는 이를 열 가지 렌즈로 나눕니다: 총괄로 위상, 주간·월간으로 모멘텀, 올해 신성과 90일 기울기로 성장 속도, 다크호스와 조명받지 못한 보물로 누락된 발견, 논쟁 지수로 사건사고, 포크 왕으로 이차 창작 생태계, 마일스톤 라이브로 1k / 10k / 50k / 100k 돌파 순간을 지켜봅니다.",
  lead2:
    "순위표는 교차해서 읽습니다. 주간표와 잠재력표에 동시에 오른 저장소는 진짜 성장일 확률이 높고, 논쟁표에만 이름이 있는 프로젝트는 화제성 노이즈일 수 있습니다. 모든 저장소에 아카이브 페이지가 있어 30일 순위 커브로 꾸준한 상승과 단발성 급등을 구분합니다.",
  faqs: [
    {
      q: "공식 Trending과 뭐가 다른가요?",
      a: "Trending은 현재 열기만 보여줍니다. Hot Board는 순위 히스토리, 논쟁 지수, 일평균 기울기, 활발한데 저평가된 저장소의 조명을 더하고, 10개 시점이 서로를 검증합니다.",
    },
    {
      q: "데이터 출처는?",
      a: "공개 데이터만 사용합니다: GitHub Search API와 공식 Trending. 각 표의 산출 규칙은 페이지에 그대로 적고, 규칙이 무효화되면 조용히 수치를 바꾸지 않고 명시합니다.",
    },
    {
      q: "얼마나 자주 갱신되나요?",
      a: "파이프라인은 30분마다 데이터를 굴리고, 사이트는 60초 폴링, 마일스톤 라이브표는 임계값 통과 즉시 갱신됩니다.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "렌즈를 골라 표로 이동",
  footerLine:
    "16개 언어 UI. 항목 설명은 저장소 자체의 현지화 README가 있으면 따릅니다. 모든 이름은 아카이브 페이지로 연결됩니다.",
  homeCta: "10강 가이드 열기",
}

const de: GuideCopy = {
  metaTitle: "GitHub-Trends richtig lesen: der Zehn-Bretter-Guide",
  metaDesc:
    "Was zehn GitHub-Ranglisten messen und wie man sie kreuzliest: Allzeit-Klassiker, Wochenschub, Monatswellen, Jahresnewcomer, 90-Tage-Steigung, Dark Horses, Übersehenswerte, Kontroversindex, Fork-Champions und Live-Meilensteine — plus Sprach-Rankings und 30-Tage-Rangkurven.",
  kicker: "HOW TO READ",
  h1: "Der Zehn-Bretter-Guide: GitHub-Trends als Signale lesen",
  lead1:
    "Das offizielle Trending beantwortet nur, wer gerade heiß ist. Das Hot Board zerlegt das in zehn Linsen: Allzeit-Klassiker für das Fundament, Wochen- und Monatsbretter für Schwung, Jahresnewcomer und 90-Tage-Steigung für das Wachstumstempo, Dark Horses und Übersehene für Verpasstes, der Kontroversindex für Drama, Fork-Champions fürs Ökosystem und ein Live-Meilenstein-Brett, das die Momente im Auge behält, in denen 1k / 10k / 50k / 100k fallen.",
  lead2:
    "Lies die Bretter gegeneinander: Wer auf dem Wochen- und dem Potenzial-Brett gleichzeitig steigt, wächst wahrscheinlich wirklich; wer nur beim Kontroversindex auftaucht, ist eher Themenrauschen. Jedes Repo hat eine Archivseite — die 30-Tage-Rangkurve trennt stetigen Aufstieg vom Ein-Nacht-Anstieg.",
  faqs: [
    {
      q: "Wie unterscheidet sich das vom offiziellen Trending?",
      a: "Trending zeigt den Augenblick. Das Hot Board ergänzt Ranghistorie, Kontroversindex, Tagessteigungen und eine Liste für aktiv gepflegte, aber übersehene Repos — zehn Linsen, die einander bestätigen oder widersprechen.",
    },
    {
      q: "Woher kommen die Daten?",
      a: "Nur öffentliche Quellen: die GitHub Search API und die offiziellen Trending-Seiten. Jedes Brett dokumentiert seine Regel direkt auf der Seite; bricht eine Regel, wird das offen gesagt statt still Zahlen zu wechseln.",
    },
    {
      q: "Wie oft aktualisiert sich das?",
      a: "Die Pipeline zieht alle 30 Minuten Ware, die Seite fragt alle 60 Sekunden nach, und das Live-Meilenstein-Brett schlägt genau dann zu, wenn ein Repo die Schwelle reißt.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Linse wählen, Brett öffnen",
  footerLine:
    "16 Sprachen im Interface; Zeilenbeschreibungen folgen, wo vorhanden, dem lokalisierten README des Repos. Jeder Name führt zur Archivseite.",
  homeCta: "Den Zehn-Bretter-Guide öffnen",
}

const fr: GuideCopy = {
  metaTitle: "Comment lire les tendances GitHub : le guide des dix palmarès",
  metaDesc:
    "Ce que mesurent dix classements GitHub et comment les recouper : géants tout-temps, poussées hebdo, vagues mensuelles, nouveautés annuelles, pente 90 jours, outsiders, pépites ignorées, indice de controverse, champions du fork et jalons en direct — plus sous-classements par langue et courbes de classe sur 30 jours.",
  kicker: "HOW TO READ",
  h1: "Le guide des dix palmarès : lire les tendances GitHub comme des signaux",
  lead1:
    "Le Trending officiel répond seulement à « qui est chaud maintenant ». Le Hot Board décompose cela en dix prismes : les géants tout-temps pour le socle, l'élan hebdomadaire et mensuel, la vitesse des nouveaux venus (de l'année et pente 90 jours), les outsiders et les pépites ignorées pour ce qui a échappé à la foule, la controverse pour le drame, les champions du fork pour l'écosystème, et un palmarès live des jalons à l'affût des passages 1k / 10k / 50k / 100k.",
  lead2:
    "Lisez les palmarès en miroir : un dépôt qui monte à la fois en hebdo et en potentiel, c'est une vraie croissance ; s'il n'apparaît qu'au palmarès de controverse, c'est sans doute du bruit. Chaque dépôt possède une page d'archives — la courbe sur 30 jours distingue l'ascension régulière du pic d'une nuit.",
  faqs: [
    {
      q: "Quelle différence avec le Trending officiel ?",
      a: "Trending montre l'instant. Le Hot Board ajoute l'historique de classement, un indice de controverse, des pentes quotidiennes et une liste des dépôts actifs mais ignorés — dix prismes qui se confirment ou se contredisent.",
    },
    {
      q: "D'où viennent les données ?",
      a: "Uniquement des données publiques : la GitHub Search API et les pages Trending officielles. Chaque palmarès affiche ses règles sur la page ; si une règle casse, c'est dit explicitement plutôt que changé en silence.",
    },
    {
      q: "À quelle fréquence les mises à jour ?",
      a: "Le pipeline charge toutes les 30 minutes, le site interroge toutes les 60 secondes, et le palmarès live des jalons réagit au franchissement d'un seuil.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Choisissez un prisme, ouvrez un palmarès",
  footerLine:
    "Seize langues d'interface ; les descriptions suivent le README localisé du dépôt quand il existe. Chaque nom mène à sa page d'archives.",
  homeCta: "Ouvrir le guide des dix palmarès",
}

const es: GuideCopy = {
  metaTitle: "Cómo leer las tendencias de GitHub: la guía de diez tablas",
  metaDesc:
    "Qué mide cada una de las diez tablas de GitHub y cómo cruzarlas: gigantes históricos, impulsos semanales, olas mensuales, novatos del año, pendientes de 90 días, caballos oscuros, joyas ignoradas, índice de controversia, campeones del fork y hitos en vivo — más subtablas por lenguaje y curvas de 30 días.",
  kicker: "HOW TO READ",
  h1: "La guía de diez tablas: leer las tendencias de GitHub como señales",
  lead1:
    "Trending oficial solo responde quién es caliente ahora mismo. La Hot Board lo divide en diez lentes: los gigantes de todos los tiempos como cimiento, el impulso semanal y mensual, la velocidad de los novatos (del año y pendiente de 90 días), caballos oscuros y joyas ignoradas para lo que se resbaló, el índice de controversia para el drama, los campeones del fork para el ecosistema, y una tabla viva de hitos que vigila los cruces de 1k / 10k / 50k / 100k.",
  lead2:
    "Lee las tablas en cruz: un repositorio que sube en la semanal y en la de potencial a la vez suele ser crecimiento real; si solo aparece en la de controversia, probablemente es ruido. Cada repo tiene su página de archivo: la curva de 30 días separa la subida constante del pico de una noche.",
  faqs: [
    {
      q: "¿En qué se diferencia del Trending oficial?",
      a: "Trending muestra el instante. La Hot Board añade historial de posición, índice de controversia, pendientes diarias y una tabla de repos activos pero ignorados — diez lentes que se confirman o se contradicen.",
    },
    {
      q: "¿De dónde salen los datos?",
      a: "Solo datos públicos: la API de búsqueda de GitHub y las páginas oficiales de Trending. Cada tabla expone sus reglas en la propia página; si una regla se rompe, se anuncia, no se cambia en silencio.",
    },
    {
      q: "¿Cada cuánto se actualiza?",
      a: "El pipeline ingiere cada 30 minutos, la página consulta cada 60 segundos y la tabla de hitos en vivo reacciona al cruzar un umbral.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Elige una lente, abre una tabla",
  footerLine:
    "Dieciséis idiomas de interfaz; las descripciones siguen el README localizado de cada repo cuando existe. Cada nombre lleva a su página de archivo.",
  homeCta: "Abrir la guía de diez tablas",
}

const pt: GuideCopy = {
  metaTitle: "Como ler as tendências do GitHub: o guia das dez classificações",
  metaDesc:
    "O que dez rankings de GitHub medem e como cruzá-los: gigantes de todos os tempos, impulso semanal, ondas mensais, novatos do ano, inclinação de 90 dias, foras-de-série, joias ignoradas, índice de controvérsia, campeões de fork e marcos ao vivo — com sub-ranking por linguagem e curvas de 30 dias.",
  kicker: "HOW TO READ",
  h1: "O guia das dez classificações: ler tendências do GitHub como sinais",
  lead1:
    "O Trending oficial responde só quem está quente neste instante. A Hot Board decompõe isso em dez lentes: os gigantes de todos os tempos como alicerce, o ímpeto semanal e mensal, a velocidade dos recém-chegados (do ano e inclinação de 90 dias), foras-de-série e joias ignoradas para o que escapou, o índice de controvérsia para o drama, os campeões de fork para o ecossistema, e um ranking ao vivo de marcos a vigiar as travessias de 1k / 10k / 50k / 100k.",
  lead2:
    "Leia as tabelas em cruz: um repositório que sobe na semanal e na de potencial em simultâneo costuma ser crescimento real; se só aparece na de controvérsia, provavelmente é ruído. Cada repo tem página de arquivo — a curva de 30 dias separa a subida firme do pico de uma noite.",
  faqs: [
    {
      q: "Que diferença há para o Trending oficial?",
      a: "O Trending mostra o instante. A Hot Board junta histórico de posição, índice de controvérsia, inclinações diárias e uma lista de repos ativos mas ignorados — dez lentes que se confirmam ou se contradizem.",
    },
    {
      q: "De onde vêm os dados?",
      a: "Apenas dados públicos: a API de pesquisa do GitHub e as páginas oficiais de Trending. Cada ranking expõe as suas regras na própria página; se uma regra falha, é dito em voz alta em vez de trocar números em silêncio.",
    },
    {
      q: "Com que frequência atualiza?",
      a: "O pipeline carrega a cada 30 minutos, o site consulta a cada 60 segundos e o ranking ao vivo de marcos reage ao cruzar um limiar.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Escolha uma lente, abra uma classificação",
  footerLine:
    "Dezasseis idiomas de interface; as descrições seguem o README localizado de cada repo quando existe. Cada nome leva à página de arquivo.",
  homeCta: "Abrir o guia das dez classificações",
}

const it: GuideCopy = {
  metaTitle: "Come leggere i trend GitHub: la guida alle dieci classifiche",
  metaDesc:
    "Cosa misurano le dieci classifiche GitHub e come incrociarle: giganti di sempre, spinta settimanale, onde mensili, esordienti dell'anno, pendenze a 90 giorni, cavalli oscuri, perle ignorate, indice di polemica, campioni di fork e pietre miliari dal vivo — con sotto-classifiche per linguaggio e curve a 30 giorni.",
  kicker: "HOW TO READ",
  h1: "La guida alle dieci classifiche: leggere i trend GitHub come segnali",
  lead1:
    "Il Trending ufficiale risponde solo a chi è caldo adesso. La Hot Board divide il tutto in dieci lenti: i giganti di sempre come fondamento, lo slancio settimanale e mensile, la velocità degli esordienti (dell'anno e pendenza a 90 giorni), cavalli oscuri e perle ignorate per ciò che è scivolato via, l'indice di polemica per il dramma, i campioni di fork per l'ecosistema e una classifica live delle pietre miliari in attesa dei passaggi 1k / 10k / 50k / 100k.",
  lead2:
    "Leggi le classifiche a incrocio: un repo che sale sia in quella settimanale sia in quella potenziale è crescita vera; se compare solo in quella polemica, bene sospettare rumore. Ogni repo ha una pagina d'archivio — la curva a 30 giorni distingue l'ascesa costante dal picco di una notte.",
  faqs: [
    {
      q: "Che differenza c'è col Trending ufficiale?",
      a: "Trending mostra l'istante. La Hot Board aggiunge storico di posizione, indice di polemica, pendenze giornaliere e una lista di repo attivi ma ignorati — dieci lenti che si confermano o contraddicono a vicenda.",
    },
    {
      q: "Da dove arrivano i dati?",
      a: "Solo dati pubblici: la Search API di GitHub e le pagine Trending ufficiali. Ogni classifica dichiara le sue regole sulla pagina; se una regola si rompe, lo si dichiara invece di cambiare numeri in silenzio.",
    },
    {
      q: "Ogni quanto si aggiorna?",
      a: "La pipeline carica ogni 30 minuti, il sito interroga ogni 60 secondi e la classifica live delle pietre miliari reagisce al superamento di una soglia.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Scegli una lente, apri una classifica",
  footerLine:
    "Sedici lingue d'interfaccia; le descrizioni seguono il README localizzato di ciascun repo quando esiste. Ogni nome porta alla pagina d'archivio.",
  homeCta: "Aprire la guida alle dieci classifiche",
}

const ru: GuideCopy = {
  metaTitle: "Как читать тренды GitHub: путеводитель по десяти доскам",
  metaDesc:
    "Что измеряют десять GitHub-рейтингов и как читать их в перекрестие: гиганты всех времён, недельные рывки, месячные волны, новички года, 90-дневный склон, тёмные лошадки, обделённые жемчужины, индекс скандала, короли форков и живые рубежи — с подрейтингами по языкам и кривыми за 30 дней.",
  kicker: "HOW TO READ",
  h1: "Путеводитель по десяти доскам: читать тренды GitHub как сигналы",
  lead1:
    "Официальный Trending отвечает лишь «кто горяч прямо сейчас». Hot Board раскладывает это на десять линз: гиганты всех времён — фундамент, недельный и месячный напор — импульс, скорость новичков (года и 90-дневный склон), тёмные лошадки и обделённые жемчужины — то, что просочилось мимо толпы, индекс скандала — драма, короли форков — экосистема, и живая доска рубежей, караулящая пересечения 1k / 10k / 50k / 100k.",
  lead2:
    "Читайте доски в перекрестие: репозиторий, растущий сразу в недельной и в потенциальной, — настоящий рост; только в скандале без новичков — скорее шум. У каждого репозитория есть архивная страница — кривая за 30 дней отличает ровный подъём от однодневного пика.",
  faqs: [
    {
      q: "Чем это отличается от официального Trending?",
      a: "Trending показывает момент. Hot Board добавляет историю позиций, индекс скандала, дневные склоны и список активных, но обделённых вниманием репозиториев — десять линз, подтверждающих или опровергающих друг друга.",
    },
    {
      q: "Откуда данные?",
      a: "Только публичные: GitHub Search API и официальные страницы Trending. Правила каждой доски написаны прямо на странице; если правило ломается — это объявляется, а не меняется молча.",
    },
    {
      q: "Как часто обновляется?",
      a: "Конвейер забирает данные каждые 30 минут, сайт опрашивает каждые 60 секунд, живая доска рубежей срабатывает в момент пересечения порога.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Выбери линзу — открой доску",
  footerLine:
    "Шестнадцать языков интерфейса; описания строк следуют локализованному README репозитория, когда он есть. Каждое имя ведёт в архив.",
  homeCta: "Открыть путеводитель по доскам",
}

const uk: GuideCopy = {
  metaTitle: "Як читати тренди GitHub: гід із десяти дощок",
  metaDesc:
    "Що міряють десять GitHub-списків і як їх перехресно читати: гіганти всіх часів, тижневі ривки, місячні хвилі, новачки року, 90-денний нахил, темні коники, обійдені перли, індекс скандалу, королі форків і живі рубежі — з підсписками за мовами та кривими за 30 днів.",
  kicker: "HOW TO READ",
  h1: "Гід із десяти дощок: читати тренди GitHub як сигнали",
  lead1:
    "Офіційний Trending відповідає лише на питання «хто гарячий щойно». Hot Board розкладає це на десять лінз: гіганти всіх часів — фундамент, тижневий і місячний натиск — імпульс, швидкість новачків (року та 90-денний нахил), темні коники й обійдені перли — те, що прослизнуло повз натовп, індекс скандалу — драма, королі форків — екосистема, і жива дошка рубежів, що пасе перетинання 1k / 10k / 50k / 100k.",
  lead2:
    "Читайте дошки перехрестям: репозиторій, що росте водночас у тижневому і в потенційному, — справжнє зростання; лише у скандалі без новачків — швидше шум. Кожен репозиторій має архівну сторінку — крива за 30 днів відрізняє рівний зліт від добового піку.",
  faqs: [
    {
      q: "Чим це відрізняється від офіційного Trending?",
      a: "Trending показує мить. Hot Board додає історію позицій, індекс скандалу, денні нахили та список активних, але обійдених увагою репозиторіїв — десять лінз, що підтверджують чи спростовують одна одну.",
    },
    {
      q: "Звідки дані?",
      a: "Лише публічні: GitHub Search API та офіційні сторінки Trending. Правила кожної дошки прямо на сторінці; коли правило ламається — про це кажуть уголос, а не мовчки міняють числа.",
    },
    {
      q: "Як часто оновлення?",
      a: "Конвеєр забирає дані щопів години, сайт опитує щохвилини, жива дошка рубежів реагує в момент перетинання порогу.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Обери лінзу — відкрий дошку",
  footerLine:
    "Шістнадцять мов інтерфейсу; описи рядків слідують локалізованому README репозиторію, коли він є. Кожне ім'я веде в архів.",
  homeCta: "Відкрити гід із досками",
}

const pl: GuideCopy = {
  metaTitle: "Jak czytać trendy GitHub: przewodnik po dziesięciu tablicach",
  metaDesc:
    "Co mierzy dziesięć rankingów GitHub i jak je krzyżowo czytać: giganci wszech czasów, tygodniowe pchnięcia, miesięczne fale, debiutanci roku, 90-dniowe nachylenie, ciemne konie, pominięte perły, indeks kontrowersji, królowie forków i na żywo kamienie milowe — z pod-rankingami języków i krzywymi 30 dni.",
  kicker: "HOW TO READ",
  h1: "Przewodnik po dziesięciu tablicach: trendy GitHub jako sygnały",
  lead1:
    "Oficjalny Trending odpowiada tylko na pytanie, kto jest teraz gorący. Hot Board rozkłada to na dziesięć soczewek: giganci wszech czasów — fundament, tygodniowy i miesięczny napór — pęd, tempo debiutantów (roku i 90-dniowe nachylenie), ciemne konie i pominięte perły — to, co przecisnęło się obok tłumu, indeks kontrowersji — dramat, królowie forków — ekosystem, a na żywo tablica kamieni milowych polująca na przekroczenia 1k / 10k / 50k / 100k.",
  lead2:
    "Czytaj tablice krzyżowo: repo rosnące równocześnie w tygodniowej i w potencjałowej to zwykle prawdziwy wzrost; tylko w kontrowersji bez debiutantów — raczej szum. Każde repo ma stronę archiwum — krzywa 30 dni odróżnia równy wzrost od jednonocnego piku.",
  faqs: [
    {
      q: "Czym to się różni od oficjalnego Trending?",
      a: "Trending pokazuje moment. Hot Board dodaje historię pozycji, indeks kontrowersji, dzienne nachylenia i listę aktywnych, lecz pomijanych repo — dziesięć soczewek, które potwierdzają lub obalają się nawzajem.",
    },
    {
      q: "Skąd dane?",
      a: "Wyłącznie publiczne: GitHub Search API i oficjalne strony Trending. Zasady każdej tablicy są wypisane na stronie; gdy reguła pada, mówimy wprost, nie podmieniamy liczb po cichu.",
    },
    {
      q: "Jak często aktualizacja?",
      a: "Potok ładuje dane co 30 minut, strona zapytuje co 60 sekund, a tablica kamieni milowych na żywo reaguje w chwili przekroczenia progu.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Wybierz soczewkę, otwórz tablicę",
  footerLine:
    "Szesnaście języków interfejsu; opisy wierszy podążają za zlokalizowanym README repo, gdy istnieje. Każda nazwa prowadzi do archiwum.",
  homeCta: "Otwórz przewodnik po tablicach",
}

const tr: GuideCopy = {
  metaTitle: "GitHub trendlerini okuma rehberi: on listelik kılavuz",
  metaDesc:
    "On GitHub sıralamasının ölçtüğü şey ve çapraz okuma: tüm zamanların devleri, haftalık itiş, aylık dalgalar, yılın çaylakları, 90 günlük eğim, karanlık atlar, gözden kaçan cevherler, tartışma endeksi, fork şampiyonları ve canlı kilometre taşları — dil alt sıralamaları ve 30 günlük sıra eğrileriyle.",
  kicker: "HOW TO READ",
  h1: "On listelik kılavuz: GitHub trendlerini sinyal olarak okumak",
  lead1:
    "Resmi Trending yalnızca şu an kim sıcak sorusunu yanıtlar. Hot Board bunu on merceğe böler: tüm zamanların devleri temel, haftalık ve aylık hamle ivme, çaylakların hızı (yılın ve 90 günlük eğim), karanlık atlar ve gözden kaçanlar kalabalığın yanından sızanlar, tartışma endeksi drama, fork şampiyonları ekosistem, ve 1k / 10k / 50k / 100k geçişlerini nöbet tutan canlı kilometre taşı listesi.",
  lead2:
    "Listeleri çapraz oku: hem haftalıkta hem potansiyelde yükselen repo gerçek büyümedir; yalnız tartışmada görünen büyük ihtimal gürültü. Her repoya arşiv sayfası var — 30 günlük sıra eğrisi sağlam tırmanışı bir gecelik sıçramadan ayırır.",
  faqs: [
    {
      q: "Resmi Trending'den farkı ne?",
      a: "Trending anı gösterir. Hot Board sıra geçmişi, tartışma endeksi, günlük eğimler ve aktif ama gözden kaçan repoların listesini ekler — birbirini onaylayan ya da çürüten on mercek.",
    },
    {
      q: "Veriler nereden geliyor?",
      a: "Yalnızca açık veri: GitHub Search API ve resmi Trending sayfaları. Her listenin kuralları doğrudan sayfada yazar; kural kırılırsa sessizce sayı değiştirilmez, açıkça söylenir.",
    },
    {
      q: "Ne sıklıkta güncelleniyor?",
      a: "Hat 30 dakikada bir veri çeker, sayfa 60 saniyede bir yoklar, canlı kilometre taşı listesi eşiğin geçildiği an tetiklenir.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Bir mercek seç, listeyi aç",
  footerLine:
    "On altı arayüz dili; satır açıklamaları varsa reponun kendi yerelleştirilmiş README'sini izler. Her isim arşiv sayfasına gider.",
  homeCta: "On listelik rehberi aç",
}

const vi: GuideCopy = {
  metaTitle: "Cách đọc xu hướng GitHub: cẩm nang mười bảng",
  metaDesc:
    "Mười bảng xếp hạng GitHub đo gì và đọc chéo thế nào: các kẻ hùng từ trước đến nay, cú hích tuần, sóng tháng, tân binh trong năm, độ dốc 90 ngày, ngựa ô, ngọc bị bỏ qua, chỉ số gây tranh cãi, vua fork và cột mốc trực tiếp — kèm bảng phụ theo ngôn ngữ và đường cong 30 ngày.",
  kicker: "HOW TO READ",
  h1: "Cẩm nang mười bảng: đọc xu hướng GitHub như tín hiệu",
  lead1:
    "Trending chính thức chỉ trả lời ai đang nóng lúc này. Hot Board chia nó thành mười góc nhìn: các kẻ hùng từ trước đến nay làm nền tảng, cú hích tuần và tháng làm đà, tốc độ của tân binh (trong năm và độ dốc 90 ngày), ngựa ô cùng ngọc bị bỏ qua cho thứ lọt qua khe hở, chỉ số gây tranh cãi cho drama, vua fork cho hệ sinh thái phái sinh, và bảng cột mốc trực tiếp canh giữ từng cột mốc 1k / 10k / 50k / 100k.",
  lead2:
    "Đọc các bảng chéo nhau: repo lên cả bảng tuần lẫn bảng tiềm năng thường là tăng trưởng thật; chỉ xuất hiện ở bảng tranh cãi nhiều khả năng là nhiễu. Mỗi repo có trang lưu trữ — đường cong 30 ngày phân biệt leo dốc đều với cú phốt một đêm.",
  faqs: [
    {
      q: "Khác gì với Trending chính thức?",
      a: "Trending chỉ thấy khoảnh khắc. Hot Board thêm lịch sử thứ hạng, chỉ số gây tranh cãi, độ dốc hằng ngày và danh sách repo hoạt động nhưng bị bỏ qua — mười góc nhìn xác minh hoặc bác bỏ lẫn nhau.",
    },
    {
      q: "Dữ liệu từ đâu?",
      a: "Chỉ dùng dữ liệu công khai: GitHub Search API và các trang Trending chính thức. Luật của từng bảng ghi ngay trên trang; khi luật gãy, nói ra rõ ràng thay vì lặng lẽ thay số.",
    },
    {
      q: "Cập nhật bao lâu một lần?",
      a: "Đường ống nạp dữ liệu mỗi 30 phút, trang hỏi thăm mỗi 60 giây, bảng cột mốc trực tiếp bắn đúng khoảnh khắc vượt ngưỡng.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Chọn một lăng kính, mở một bảng",
  footerLine:
    "Mười sáu ngôn ngữ giao diện; mô tả dòng bám theo README nội địa hóa của repo nếu có. Mỗi tên đều dẫn tới trang lưu trữ.",
  homeCta: "Mở cẩm nang mười bảng",
}

const idn: GuideCopy = {
  metaTitle: "Cara membaca tren GitHub: panduan sepuluh papan",
  metaDesc:
    "Apa yang diukur sepuluh papan peringkat GitHub dan cara membacanya silang: raksasa sepanjang masa, dorongan mingguan, gelombang bulanan, pendatang baru setahun, kemiringan 90 hari, kuda gelap, permata terabaikan, indeks kontroversi, raja fork dan tonggak langsung — dengan sub peringkat bahasa dan kurva 30 hari.",
  kicker: "HOW TO READ",
  h1: "Panduan sepuluh papan: membaca tren GitHub sebagai sinyal",
  lead1:
    "Trending resmi hanya menjawab siapa yang sedang panas. Hot Board memecahnya menjadi sepuluh lensa: raksasa sepanjang masa sebagai fondasi, dorongan mingguan dan bulanan sebagai momentum, kecepatan pendatang baru (dalam setahun dan kemiringan 90 hari), kuda gelap dan permata terabaikan untuk yang lolos dari kerumunan, indeks kontroversi untuk drama, raja fork untuk ekosistem, dan papan tonggak langsung yang mengawal persinggahan 1k / 10k / 50k / 100k.",
  lead2:
    "Baca papan silang: repo yang naik sekaligus di papan mingguan dan potensi biasanya tumbuh sungguhan; yang hanya muncul di papan kontroversi lebih mungkin derau. Setiap repo punya halaman arsip — kurva peringkat 30 hari membedakan pendakian stabil dari lonjakan semalam.",
  faqs: [
    {
      q: "Apa bedanya dengan Trending resmi?",
      a: "Trending cuma menampilkan saat itu. Hot Board menambah riwayat peringkat, indeks kontroversi, kemiringan harian, dan daftar repo aktif yang terabaikan — sepuluh lensa yang saling menguatkan atau menyangkal.",
    },
    {
      q: "Data dari mana?",
      a: "Hanya data publik: GitHub Search API dan halaman Trending resmi. Aturan tiap papan tertulis langsung di halaman; saat aturan patah, hal itu dinyatakan terbuka, bukan mengganti angka diam-diam.",
    },
    {
      q: "Seberapa sering diperbarui?",
      a: "Pipeline menarik data setiap 30 menit, situs memantau tiap 60 detik, dan papan tonggak langsung meledak tepat saat ambang terlewati.",
    },
  ],
  boardsKicker: "TEN BOARDS",
  boardsTitle: "Pilih lensa, buka papan",
  footerLine:
    "Enam belas bahasa antarmuka; deskripsi baris mengikuti README terlokalisasi repo bila ada. Setiap nama menuju halaman arsip.",
  homeCta: "Buka panduan sepuluh papan",
}

/** 逐语种成套(键域与 lib/locales 的 Locale 完全一致,缺失会在类型层报错)。 */
export const GUIDES: Record<Locale, GuideCopy> = {
  en,
  zh,
  "zh-TW": zhTW,
  ja,
  ko,
  de,
  fr,
  es,
  pt,
  it,
  ru,
  uk,
  pl,
  tr,
  vi,
  id: idn,
}

/** 带兜底的取用(理论上所有合法 locale 都有成套文案,en 兜底只为类型安全)。 */
export function guideFor(lang: string): GuideCopy {
  return GUIDES[lang as Locale] ?? en
}
