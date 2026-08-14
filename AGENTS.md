# AGENTS.md

Daily snapshots of OpenCode Zen model pricing. A collector scrapes `opencode.ai/docs/zen/` + the `zen/v1/models` API into time-series JSON; a Vite site charts it with ECharts. Deployed to Cloudflare Pages.

## Commands
- `npm run collect` — fetch today's snapshot, append to `data/snapshots.json`, write latest to `site/data.json`. Idempotent: exits 0 without changes if today's snapshot already exists.
- `npm run backfill` — fill historical days from the Wayback Machine. **Slow**: ~1.5s sleep per Wayback request; iterates years 2026→now. Run with `fnm` env + `node` ≥22.
- `npm run dev` — Vite dev server (root `site/`, port 3000).
- No tests, lint, or typecheck configured. CI (`node collector/index.js`) runs the collector directly, not the npm script — keep behavior in sync if you change either.

Before any `npm` command, run `eval "$(fnm env --use-on-cd)"`.

## Data model
`data/snapshots.json` = array of `{ date, models: [...] }`. Each model: `{ id, display, endpoint, sdk, tiers, free, deprecated }`. `tiers` = array of `{ input, output, cachedRead, cachedWrite }`, USD per 1M tokens; `0` = free, `null` = unavailable/soon. `site/data.json` = the single latest snapshot (non-pretty JSON), not the full history.

## Parsing gotchas
- `collector/index.js` and `backfill.js` contain **near-duplicate** scraping logic (table detection, `TIER_RE` regex, `parsePrice`). Change both if you touch parsing. Table format is detected: "full" (per-tier pricing table with Model ID / Cached Write headers) vs "simple" (Model/Input/Output) vs unknown.
- Collector fetches both the docs HTML and the models API; the live price tables and the deprecated list drive the merge.

## Site
- Vanilla JS (`site/app.js`) + ECharts from CDN. Default data source is `https://raw.githubusercontent.com/dsillman2000/opencodezen-model-tracker/main/data/snapshots.json` (uses live history); falls back to local `./data.json` (latest only) if unavauinable.
- `site/app.js` hardcodes `GROUPS` provider mapping + `detectGroup()` (regions/prefixes incl. hardcoded free-model IDs). New model prefixes may need a group entry here.
- `wrangler.toml`: Pages project `oc-model-prices`, `pages_build_output_dir = "site"`. CI deploys every run via `npx wrangler pages deploy site/` using `CLOUDFLARE_API_TOKEN` secret.
