# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NEWS·TV: a static "retro TV" news site (banking, Ecuadorian financial authorities, LATAM fintech, payments, crypto, press about Endeavor-entrepreneur companies in LATAM) published on GitHub Pages at andrescge.github.io/news-tv. A Node collector builds one JSON edition from RSS feeds and scraped BCE pages; the browser app only reads that JSON. All UI text, error messages, test names, commit messages and the README are in Spanish — keep it that way.

## Commands

Requires Node.js 24+. ESM only (`"type": "module"`, `.mjs` scripts).

```bash
npm ci
npm test                                                        # node --test tests/*.test.mjs
node --test --test-name-pattern="BCE" tests/content.test.mjs    # single test by name
npm run collect                                                 # live network fetch; overwrites site/data/news.json
node scripts/collect.mjs --output <path>                        # same, writing elsewhere
node scripts/validate.mjs [path]                                # checks <path>, default site/data/news.json (cwd-relative: run from repo root)
npm run endeavor                                                # regenerates scripts/data/endeavor-latam.json from the endeavor.org API (live network)
npx serve site                                                  # preview the site
```

There is no build step, linter or bundler. `site/` is deployed as-is.

## Architecture

Pipeline: `scripts/collect.mjs` → `site/data/news.json` → `site/app.js`.

- **`scripts/content.mjs`** — pure, network-free functions: feed/HTML parsing (`parseFeed` incl. RSS 1.0/RDF, `parseBce`, `parseBcePublications`, `parseBceResolutions`, `parseSupercias`, `parseRegistroOficial`), `normalize` (raw row → story, or `null` if missing title/URL/date or outside the 30-day window; copies `tier`/`access` and sets `category` via `channelFor`), `FILTERS` + `relevant`, `ROUTES` + `channelFor`, `limitFor`, `accumulate`, `composeChannel`/`composeEdition`, `deduplicate`. Functions take an injectable `now` so tests pin the clock.
- **`scripts/collect.mjs`** — owns the `SOURCES` table (exported; tests import it) and orchestration. Required per-source fields: `id`, `name`, `category` (channel), `kind` (`official` | `news` | `company` | `organization`; labels live in `kinds` in `site/app.js`), `tier` (1 official/reference, 2 specialised, 3 organisation/company), `access` (`open` | `paywall` | `mixed`), `language` (`es` | `en`), `adapter` (`rss`, `google`, `bce`, `bce-publications`, `bce-resolutions`, `supercias`, `registro-oficial`), `url`, `site`. Optional: `limit` (max stories **per period** per channel, default 25), `limits` (per-channel override, e.g. `{ cripto: 2 }`), `allowHosts` (Google sources: publisher-URL whitelist; not required for `search` sources), `denyHosts` (publisher-URL blacklist), `search` (`'endeavor'`: the URL is built from rotating name lots instead of `url`), `extraUrls` (secondary feeds merged into the source), `pages`/`backfillPages` (Registro Oficial `?paged=N` pages per run / when the source has no history), `byline` (prefix titles with `dc:creator`). Only the primary `url` must succeed; secondary URLs warn and stop. Running the module only collects when it is the entry point (`run()` guard), so importing it is side-effect free.
- **`scripts/validate.mjs`** — gate run in CI after collecting; optional path argument; uses the real clock, so an edition older than 30 days fails. Checks unique ids, known channels and valid `tier`/`access`/`stale`/`language` when present, and a well-formed `endeavor` tag (non-empty `company`, `url` passing `safeUrl`).
- **`scripts/endeavor.mjs`** — regenerates `scripts/data/endeavor-latam.json` from `https://endeavor.org/wp-json/wp/v2/company` (all pages; keeps `region-latin-america`, merges per-office duplicates, refuses to write under 100 companies). The JSON is generated, never hand-edited; `content.mjs` imports it.
- **`site/app.js`** — vanilla JS, single `state` object, full re-render functions. Filters by channel and period client-side, re-fetches `news.json` every 10 minutes, flags the edition stale after 3 hours. All story content is inserted via `textContent`, and links pass through `safeUrl` (http/https only) — preserve this, since content comes from third-party feeds.

### Pipeline per run

1. **Fetch.** Google sources run sequentially (2.5 s pause, one retry honouring `Retry-After`, capped at 30 s); all others run in parallel, also with one retry.
2. **Per source.** parse → `allowedHost` → `normalize` → `relevant`. `normalize` clips excerpts with `clipExcerpt` (≤ 280 chars, cut at a word boundary + «…», untouched when it fits).
3. **`accumulate`.** Merges the fresh stories with that source's stories from the previous edition that are still within 30 days and still pass the current filter (`passes` = `allowedHost` + `relevant`), deduplicated by id. Carried excerpts of exactly 280 chars without «…» (hard cuts from older editions) are re-clipped at a word boundary. If the source failed, the carried stories get `stale: true`; if it responded, they carry no flag. Sources no longer in `SOURCES` carry nothing.
4. **`deduplicate`.**
   - `oneCopy` keeps each story in a single channel. Copies match by canonical URL, by the same medium plus title, or by an identical normalised title of 30 or more characters. The best copy wins (has an excerpt, direct link), placed in the first channel of `CHANNEL_ORDER`: regulacion > ecuador > latam > cripto > pagos.
   - The cross-outlet coverage merge then runs in `mergeCoverage` channels (default `latam` and `endeavor`).
5. **`composeEdition`.** Composes each channel:
   - Stories go into period buckets `PERIOD_DAYS` = 1/7/15/30 days.
   - Each source keeps at most `limitFor(source, channel)` stories per bucket, picked by `spaced()` (evenly over time, always the newest), so a source contributes about 4×limit across 30 days.
   - The channel cap is `MAX_PER_CHANNEL` = 80, split across buckets by `shares()` (water-filling).
   - Tier 3 is held to 20 % or less.
   - Every story then goes through `tagEndeavor` (adds or recomputes the `endeavor` field).
6. **Write.** Each `sources[]` entry gets `tier`/`access`/`language`, and `recentCount` = the number of its stories in the final edition. The file is written atomically via `.tmp` + rename. If every source fails, the collector exits non-zero without writing.

### Things that span files

- **Channel ids** (`ecuador`, `regulacion`, `latam`, `pagos`, `cripto`, `endeavor`) are hardcoded in `CHANNELS` (`content.mjs`), `SOURCES[].category`, and the `channels` array in `site/app.js` (key N tunes the Nth channel; the grid in `styles.css` has one column per channel). `endeavor` is not in `CHANNEL_ORDER`, so it ranks last in `oneCopy`.
- **Filters are data.**
  - `FILTERS[source.id] = { include, exclude, on, path, skipPath, test }`:
    - `include` / `exclude` are regexes on the title, or on title + excerpt when `on: 'text'`.
    - `path` / `skipPath` are applied to the URL pathname.
    - `test` is a custom predicate.
  - Shared themes are named constants: `EC_FINANCE`, `LATAM_FINTECH`, `CRYPTO_POLICY_EN`, `BIS_PAYMENTS`, etc. They are joined with `rx()`.
  - An id with no entry passes everything.
  - `ROUTES[source.id]` sends title-matching stories to another channel: BCE boletines about the Junta go to regulacion, and BIS crypto speeches go to cripto. This is how one feed serves two channels without being fetched twice.
  - Adding or changing a source means touching four places: `SOURCES`, its `FILTERS` entry, cases in `SAMPLES` in `tests/content.test.mjs`, and the sources table in `README.md`. The README documents the editorial criteria per channel and is treated as the spec.
- **Registro Oficial** (`registro-oficial` adapter): the WordPress feed's `content:encoded` is the edition summary.
  - `parseRegistroOficial` groups norms under the uppercase organ headings, keeps only financial organs (`RO_ORGANS`), and drops noise (`RO_NOISE`, Junta codes `-A`/`-G`).
  - It emits one story per edition: the first norm as the title, and the edition plus the other norms as the excerpt.
  - Juridical, constitutional and special editions are skipped by path.
- **Google News sources** keep the real publisher as `source`/`sourceUrl` and set `via: 'Vía Google News'`; the story `url` is the Google redirect. `normalize` strips the trailing ` - Publisher` from titles and drops excerpts that just repeat the title.
- **BCE resolutions tracking** (`bce-resolutions` adapter): the two BCE resolution pages carry no dates, so `dateResolutions` in `collect.mjs` takes each PDF's `Last-Modified` header via a HEAD request, once per document, and caches it in `news.json` under `tracked[sourceId][pdfUrl]`. Only current-year entries that pass `relevant()` are looked up. The cache travels with the edition on the `data` branch; without it the next run re-queries every candidate.
- **Endeavor cross-check** (`matchEndeavor` / `tagEndeavor` in `content.mjs`): tags any story whose title (or, for unambiguous names, excerpt) names a company in `ENDEAVOR_COMPANIES` with `endeavor: { company, country, vertical, url }`; the UI shows «EMPRESA ENDEAVOR · empresa · país» linking to the directory entry, and must keep working when the field or the channel is absent.
  - Whole-word only (`bounded`: no letter/digit on either side, nor a word joined by `.`/`-`). Unambiguous names match accent- and case-folded.
  - `ENDEAVOR_AMBIGUOUS` (plus every name of ≤3 characters): title only, exact spelling or capitalised initial, needs `ENDEAVOR_CONTEXT` (or the `latam` channel), rejected by `ENDEAVOR_NOISE` and by `notACompany` (adjacent capitalised word = a person; mid-sentence in a Title Case headline).
  - `ENDEAVOR_EXCLUDED` names are never matched or searched; `ENDEAVOR_ALIASES[slug]` adds press spellings (Addi, Mercado Libre). Fix false positives by editing these lists and adding a case to the Endeavor tests, not by editing the JSON.
- **Endeavor LATAM channel** (`endeavor-prensa`, `search: 'endeavor'`): `searchCompanies` (fintech vertical or Ecuador office, `ENDEAVOR_SEARCH`) → `searchBatches` (flat `("A" OR "B") [qualifier] when:30d`, ≤ `maxWords`; ambiguous names in their own lots with one shared qualifier — Google returns nothing for nested groups) → `searchLots` (× es/en editions) → `rotation`. `fetchSearch` in `collect.mjs` fetches `perRun` lots sequentially and stores `{ cursor, lots }` in `tracked['endeavor-prensa']`; on 429 it stops and the cursor only advances past consumed lots. Its filter keeps only titles that `matchEndeavor(…, { titleOnly: true })` confirms and drops stock-market noise (`ENDEAVOR_MARKET_NOISE`) and promotional headlines (`ENDEAVOR_PROMO`: coupons, «0% de inicial», giveaways, «por tiempo limitado», user rewards). Its `allowHosts` is `ENDEAVOR_PRESS_HOSTS` (`content.mjs`): the explicit, commented list of accepted outlets by publisher domain (press with its own newsroom; includes every tier 1/2 news source's domain, which a test enforces). PR wires, company/exchange blogs, aggregators, promo sites and quote pages stay out; to accept an outlet, add its domain there plus a test case. `denyHosts` still drops endeavor.org and the national Endeavor sites. `endeavor-ar` (tier 3, organization) also lives in this channel.
- **Cross-outlet coverage merge**: in the `mergeCoverage` channels (default `latam` and `endeavor`), stories from different outlets about the same deal collapse into one. Two stories match when they share a company-like capitalized word plus a money amount, or two such words, within four days. The one with an excerpt and a direct link wins.
- Editorial rule: never synthesize content. No excerpt from the source means the story shows title + link only.

## Deployment and data

`.github/workflows/publish.yml` runs on every push to `main`, hourly at minute 17, and on manual dispatch. It runs tests, restores the last edition from the **`data` branch**, collects, validates, deploys `site/` to Pages, then commits the new `news.json` to `data`.

- A push to `main` is a production deploy.
- The `site/data/news.json` tracked on `main` is only a seed/fallback; the live edition lives on the `data` branch. `npm run collect` locally rewrites the tracked file — use `--output` or restore it rather than committing collection churn.
- Editions on `data` are committed by the workflow bot; don't hand-edit that branch.
