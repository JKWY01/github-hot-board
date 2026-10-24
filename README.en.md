# GitHub Hot Board · GitHub 火线榜

[中文](README.md)

Ten boards tracking what's hot on open-source GitHub. One data source: public data only. The methodology sits on every board page, in both Chinese and English. Boards refresh every 60 seconds.

Three things up front, no fine print:

- No fabricated data. If a board page says it's sorted by weekly stars gained, that's what it's sorted by. When a source dies mid-cycle, the page says so instead of quietly substituting numbers.
- No paid data. GitHub Search API and the official trending page are the whole story; no special access is needed.
- No invented history. The "Time Machine" index accumulates from 2026-10-18 onward. Earlier dates don't exist here.

## The ten boards

| # | Board | Source | Method |
|---|---|---|---|
| 1 | All-time · strongest ever | Search API | Lifetime stars, descending (forks excluded) |
| 2 | Weekly · igniting now | Official Trending, weekly | Official order + officially reported weekly star gain |
| 3 | Monthly · trend of the month | Official Trending, monthly | Same, monthly window |
| 4 | Fresh · debuts of the year | Search API | Created this year, ranked by total stars |
| 5 | Rising · 90-day slope | Search API | Created within 90 days, ranked by stars/day |
| 6 | Dark horses | Search API | Rising pool, sliced where total stars are still under 1,500 |
| 7 | Underrated · active, cold | Search API | Pushed continuously for 30 days, stars 100–800, ascending |
| 8 | Controversy index | Search API derived | (Forks×2 + Issues) ÷ Stars, extremes only. A structured heuristic, not sentiment |
| 9 | Fork kings | Search API | Lifetime forks, descending |
| 10 | Milestones · live crossing | Search API × 4 | Repos within ±80 stars of 1k / 10k / 50k / 100k, polled every 60s, confetti on crossing |

The big three (overall / weekly / monthly) have language facets (javascript / typescript / python / go / rust / java / c / c++), at URLs like `/en/boards/weekly/python`. `c++` becomes `/cpp` in paths because `+` dies at the routing layer; queries still use GitHub's native language names. Old links are 308-normalized by `proxy.ts` before routing.

## Data architecture

One sentence: **the selling path and the sourcing path never touch.**

```
GitHub ──(only the sync job)──> Postgres (Neon or self-hosted) ──(site SELECTs only)──> visitors
```

- A scheduled sync (`lib/sync.ts`) walks all 34 keys (10 boards + language facets) and writes two tables:
  - `board_head`: the newest tap per key; the site reads this. New taps overwrite old ones in place.
  - `board_snapshots`: one row per repo per rank — an archive of each tap, whatever it was.
- Triggers: `npm run sync` (local, needs the server running), `POST /api/sync` (with CRON_SECRET), or GitHub Actions every 30 minutes (`.github/workflows/sync.yml`).
- The rendering path makes **zero requests to GitHub**. Fallback chain: database → local disk snapshots (rebuild hydrates from `.data/`, no GitHub calls) → live fetch. If sync is down for a while, data goes stale in a labeled way; it does not go fake.
- When GitHub blocks the trending crawl, weekly/monthly pivot to a Search-based stand-in, labeled as such on the page.

### Time Machine

Every sync snapshots the full board, so any day × any board can be replayed:

```
/en/history/overall/2026-10-19
```

Entry point is in the footer. Historical taps store rank, repo and numbers, not live descriptions. Retention: `SNAPSHOT_RETENTION_DAYS` (60 by default). These pages are noindex utility pages and stay out of the sitemap.

## Run it locally

```bash
npm install
cp .env.example .env.local
# fill GITHUB_TOKEN / NEXT_PUBLIC_SITE_URL / DATABASE_URL — see table
npm run dev
```

| Variable | Required? | Notes |
|---|---|---|
| `GITHUB_TOKEN` | recommended | Classic PAT, no scopes checked. Search goes from 60 req/h to 5,000 |
| `NEXT_PUBLIC_SITE_URL` | on deploy | Final domain for canonical / sitemap / OG |
| `DATABASE_URL` | on deploy | Neon Postgres connection string; schema is created on first write |
| `CRON_SECRET` | required on deploy | Gate for `/api/sync` `/api/snapshot` `/api/refresh` `/api/dbcheck` — `Authorization: Bearer <secret>` header only (constant-time compare; **`?secret=` query is no longer accepted**, secrets must not end up in access logs). Unset = loopback-only access; set it on any public deploy |

Debug switches: `GHB_FILL_DEBUG=1` logs the read path (DB hit vs hydration), `GHB_SQL_DEBUG=1` logs actual SQL.

## Deploying

1. Create a project at [Neon](https://neon.tech); grab the pooled connection string.
2. Import the repo into Vercel; set the four variables above (make `CRON_SECRET` a long random string).
3. Add repo Actions secrets `SYNC_URL` (`https://<domain>/api/sync`) and `CRON_SECRET`; the 30-minute sync starts turning.
4. Submit the sitemap once in your search console — `/robots.txt` already points the way.

Self-hosting works the same (this project's own production runs this way): `npm run build && npm run start`. The data plane only needs a reachable Postgres — managed Neon or your own instance (Docker/1Panel etc.). For self-hosted databases, run a daily rolling `pg_dump` — see `scripts/ghb-backup.sh` (one backup per day, keeps the last 7).

## Operations

```bash
npm run sync                       # one manual round (~4 min, single retry)
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/dbcheck  # DB health: head keys, snapshot rows
gh run watch                       # watch the Actions sync
```

Sync walks slowly on purpose (rate limits and half-open connections): about 4 minutes per round, well within a 30-minute cadence. Snapshot rows older than 60 days are pruned automatically; `board_head` keeps only the newest tap. Nothing to babysit.

## Market analysis (optional, separate from the site)

The site serves boards; deep time-series digging happens in `scripts/market.mjs` against the GH Archive public mirror (~10% sampling — good for shapes and rankings, not exact counts):

```bash
node scripts/market.mjs repo vercel/next.js --days 60   # star burst / inflection days (rename-aware)
node scripts/market.mjs track agent --months 12          # track-level trends
node scripts/market.mjs risers --days 30 --limit 15      # star rockets in any window
```

One platform fact worth keeping (established 2026-10): GitHub has removed the REST `stargazers`/`subscribers` detail endpoints platform-wide. The per-star timeline survives only in event archives, and renamed repos are archived under the old name — the `repo` command handles both spellings.

## Adding a board

1. `lib/boards.ts`: add a `getXxxData()`, dispatch it in `getBoardData`, register it in `BOARD_META`.
2. `app/[lang]/dictionaries.ts`: add `BoardCopy` (name / method note / FAQ) in both languages.
3. Open `facets` in `BOARD_META` if the board should have language sub-boards.
4. Routes, nav, footer and sitemap follow `BOARD_ORDER` automatically.

## Known limits, stated plainly

- Trending numbers can lag the official page by up to one sync cycle (≤30 min).
- Search caps at 1,000 results per query; the all-time board shows the top 300 pool, which covers the entire front page story.
- The controversy board is a structural heuristic (fork/issue ratios), clearly labeled as such. Its candidate pool is the all-time top-300 board filtered to ≥3000 stars — a comparison inside the hall of fame, not a platform-wide scan. `open_issues` includes PRs (that is the GitHub field's semantics, stated on the page).
- The rising board (90-day slope) first narrows to the top 300 ninety-day repos by stars (the Search API working set), then re-ranks by slope; the slope itself favors younger repos.
- The dark-horse board keeps the top 100 by slope (page copy says the same).
- Milestone crossings are detected while a page is open; the server keeps no state. For "who crossed 1k historically", give Time Machine a few days to accumulate.
- Time Machine stores the base-language pool only. Facet taps exist in the database but have no page entrance yet.
- Not affiliated with GitHub. Boards are research reference, not judgment.
