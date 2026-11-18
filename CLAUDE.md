# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NEWS·TV: a static "retro TV" news site (banking, Ecuadorian financial authorities, LATAM fintech, payments, crypto) published on GitHub Pages at andrescge.github.io/news-tv. A Node collector builds one JSON edition from RSS feeds and scraped BCE pages; the browser app only reads that JSON. All UI text, error messages, test names, commit messages and the README are in Spanish — keep it that way.

## Commands

Requires Node.js 24+. ESM only (`"type": "module"`, `.mjs` scripts).

```bash
npm ci
npm test                                                        # node --test tests/*.test.mjs
node --test --test-name-pattern="BCE" tests/content.test.mjs    # single test by name
npm run collect                                                 # live network fetch; overwrites site/data/news.json
node scripts/collect.mjs --output <path>                        # same, writing elsewhere
node scripts/validate.mjs                                       # checks site/data/news.json (path is cwd-relative: run from repo root)
npx serve site                                                  # preview the site
```

There is no build step, linter or bundler. `site/` is deployed as-is.

## Architecture

Pipeline: `scripts/collect.mjs` → `site/data/news.json` → `site/app.js`.

- **`scripts/content.mjs`** — pure, network-free functions: feed/HTML parsing (`parseFeed`, `parseBce`, `parseBcePublications`), `normalize` (raw row → story, or `null` if missing title/URL/date or outside the 30-day window), `relevant` (topic filter), `deduplicate`. This is the only module with tests; functions take an injectable `now` so tests pin the clock.
- **`scripts/collect.mjs`** — owns the `SOURCES` table and orchestration. Each source has `category` (the channel), `kind` (`official` | `news` | `analysis`), and `adapter` (`rss`, `google`, `bce`, `bce-publications`, `bce-resolutions`). Per source: fetch → parse → `allowHosts` filter (on the *publisher* URL, used for Google News sources) → `normalize` → `relevant` → sort by date → cap (8 for `latam` sources, 25 otherwise). Then dedupe across all and cap 25 per category. Writes atomically via `.tmp` + rename.
- **`scripts/validate.mjs`** — gate run in CI after collecting; uses the real clock, so an edition older than 30 days fails.
- **`site/app.js`** — vanilla JS, single `state` object, full re-render functions. Filters by channel and period (1/7/30 days) client-side, re-fetches `news.json` every 10 minutes, flags the edition stale after 3 hours. All story content is inserted via `textContent`, and links pass through `safeUrl` (http/https only) — preserve this, since content comes from third-party feeds.

### Things that span files

- **Channel ids** (`ecuador`, `regulacion`, `latam`, `pagos`, `cripto`) are hardcoded in both `SOURCES[].category` and the `channels` array in `site/app.js`.
- **`relevant()` is keyed on `source.id`** with one regex branch per source; an id with no branch passes everything. Adding or changing a source means touching `SOURCES`, the matching `relevant` branch, a case in `tests/content.test.mjs`, and the sources table in `README.md` (which documents the editorial criteria per channel and is treated as the spec).
- **Failure fallback**: when a source fails, the collector carries forward that source's still-recent stories from the previous `news.json` and records `status: 'error'` with the old `lastSuccessAt`. If every source fails it exits non-zero without writing. The UI's Fuentes panel renders these per-source states.
- **Google News sources** keep the real publisher as `source`/`sourceUrl` and set `via: 'Vía Google News'`; the story `url` is the Google redirect. `normalize` strips the trailing ` - Publisher` from titles and drops excerpts that just repeat the title.
- **BCE resolutions tracking** (`bce-resolutions` adapter): the two BCE resolution pages carry no dates, so `dateResolutions` in `collect.mjs` takes each PDF's `Last-Modified` header via a HEAD request, once per document, and caches it in `news.json` under `tracked[sourceId][pdfUrl]`. Only current-year entries that pass `relevant()` are looked up. The cache travels with the edition on the `data` branch; without it the next run re-queries every candidate.
- Editorial rule: never synthesize content. No excerpt from the source means the story shows title + link only.

## Deployment and data

`.github/workflows/publish.yml` runs on every push to `main`, hourly at minute 17, and on manual dispatch. It runs tests, restores the last edition from the **`data` branch**, collects, validates, deploys `site/` to Pages, then commits the new `news.json` to `data`.

- A push to `main` is a production deploy.
- The `site/data/news.json` tracked on `main` is only a seed/fallback; the live edition lives on the `data` branch. `npm run collect` locally rewrites the tracked file — use `--output` or restore it rather than committing collection churn.
- Editions on `data` are committed by the workflow bot; don't hand-edit that branch.
