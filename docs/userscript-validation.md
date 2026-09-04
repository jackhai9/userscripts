# Userscript Validation and Maintenance Guide

This document owns cross-script validation, lifecycle checks, and the manual
matrix for scripts that do not have a more specialized development manual. The
orderbook browser/CDP matrix is owned by
`docs/binance-orderbook-trade-ui-automation.md`; Strategy 27 rendering is owned
by `docs/binance-strategy27-events-development.md`; Brooks/m3u8 behavior is owned
by `docs/brooks-media-sync-workflow.md`. Release and remote-publish mutations
are owned by `skills/userscript-release/SKILL.md`.

## Script Matrix

| Script | Editable source | Artifact | Focused checks | Detailed guide |
| --- | --- | --- | --- | --- |
| Binance orderbook trade | `src/binance-orderbook-trade/` | `scripts/binance-orderbook-trade.user.js` | `npm run test:binance-orderbook-trade`, `npm run build:binance-orderbook-trade`, `npm run check:binance-orderbook-trade` | `docs/binance-orderbook-trade-development.md` and `docs/binance-orderbook-trade-ui-automation.md` |
| Binance trading data | `src/binance-trading-data/` | `scripts/binance-trading-data.user.js` | `node --test test/unit/binance-data-panel-*.test.js`, `npm run build:binance-trading-data`, `node --check scripts/binance-trading-data.user.js` | this document |
| Binance CoinMarketCap data | `src/binance-coinmarketcap-data/` | `scripts/binance-coinmarketcap-data.user.js` | `node --test test/unit/binance-data-panel-*.test.js`, `npm run build:binance-coinmarketcap-data`, `node --check scripts/binance-coinmarketcap-data.user.js` | this document |
| Binance Strategy 27 events | `src/binance-strategy27-events/` | `scripts/binance-strategy27-events.user.js` | `npm run test:binance-strategy27-events`, `npm run build:binance-strategy27-events`, `npm run check:binance-userscripts` | `docs/binance-strategy27-events-development.md` |
| m3u8 downloader | `src/m3u8-downloader/` | `scripts/m3u8-downloader.user.js` | `node --test test/unit/m3u8-downloader-course-export.test.js`, `npm run build:m3u8-downloader`, `npm run check:m3u8-downloader` | `docs/brooks-media-sync-workflow.md` |
| Shared Binance route/lifecycle helpers | `src/shared/` | every affected generated artifact | affected unit tests, `npm run build:binance-userscripts`, `node --check` on affected artifacts | this document plus the affected script guide |
| Auto refresh | `scripts/auto_refresh.user.js` | same file | `node --test test/unit/auto-refresh.test.js`, `node --check scripts/auto_refresh.user.js` | this document |
| CoinMarketCap valuation helper | `scripts/coinmarketcap-valuation-helper.user.js` | same file | `node --check scripts/coinmarketcap-valuation-helper.user.js` | this document |

Run the full `npm test` suite before a release. A focused check can establish
that one layer passed; it does not replace a required build, generated-artifact
comparison, or live validation step.

## Shared Contracts

- A migrated script is edited under `src/`; its generated artifact is rebuilt
  and inspected after behavior changes. An unmigrated script is edited in its
  `scripts/*.user.js` file and checked directly.
- Route and symbol identity come from the documented pathname/route contract.
  Do not infer a symbol from a page title, stale DOM, or a neighboring panel.
- Async work must carry the symbol, route, and lifecycle identity that started
  it. A route change, symbol change, hidden/closed panel, or page teardown
  invalidates work before its result can render or update shared state.
- Timer, observer, drag, and unload listeners are part of the lifecycle. Stop
  business work when its route or panel is inactive, remove listeners when the
  panel is removed, and keep only the route watcher needed to discover a future
  matching route.
- Cache, snapshot, fallback, and neutral values retain their provenance. A
  cached or partial result must not be presented as current data or counted as a
  fresh directional vote.
- Errors keep the observed HTTP, parse, mapping, or contract reason. Do not
  turn an unknown or ambiguous upstream result into a guessed default.

## Binance Trading Data Panel

The panel runs only on an actual Binance futures trading route. It derives the
symbol from the shared route parser, aligns five-minute data to Binance server
time, and keeps the business loop stopped while the document is hidden, the
panel is closed, or the route is not a trading page. A route watcher may remain
alive while the panel is paused so a later SPA transition can restart the
business loop.

Each period fetch records which endpoint produced fresh data and which endpoint
used a cached value or has no value. Fresh and cached indicators remain distinct
when the panel computes directional votes. A stale request must not render into
a newer symbol or lifecycle epoch. 4xx parameter/authentication failures are not
treated as transient network failures; any recovery behavior must remain explicit
in the source contract.

## Binance CoinMarketCap Panel

The panel runs only on a matching futures route and resolves the current Binance
base asset to one deterministic CoinMarketCap asset. Missing or ambiguous
mapping results remain visible failures; the panel must not select an arbitrary
same-symbol asset. API and page-snapshot data are labeled by their actual source
and timestamp, and a failed refresh must not overwrite a newer symbol's panel.

Route changes, hidden documents, panel close, and panel removal invalidate the
refresh epoch and clean up timers and DOM listeners. A route watcher may remain
to detect a later matching page, but it must not continue the business refresh
loop while paused.

## Auto Refresh

`auto_refresh.user.js` is intentionally narrow:

- a non-matching URL performs no work;
- a matching URL schedules the configured target time without moving an already
  missed target to the next day merely because the window regains focus;
- manual reload, focus, visibility, and repeated scheduling preserve the next
  target-time semantics;
- the script does not add a second interval or reload unrelated pages.

## Manual Matrix

Run the smallest affected set and record each path as tested or untested. Do not
claim live behavior from source inspection alone.

### Binance trading data

- Switch symbols while a fetch is pending; old results must not appear under the
  new symbol.
- Open near a five-minute boundary and verify the current period is fetched
  after the server-time boundary rather than skipped.
- Hide the tab and return; the business timer stops while hidden and resumes with
  a fresh, current-symbol fetch.
- Close the panel and verify background polling does not restart it.
- Simulate a partial endpoint failure; cached rows are marked as cached and are
  excluded from directional vote totals while missing rows remain explicit.
- Navigate from a non-trading route to a futures route and back; only the
  matching route owns a panel and active business loop.

### Binance CoinMarketCap data

- Switch symbols during an API/page fetch; the superseded result must be ignored.
- Exercise a known mapping, a missing mapping, and an ambiguous mapping; only
  the known mapping renders data.
- Verify the displayed source and update time distinguish a page snapshot from a
  data API response.
- Hide or close the panel while a refresh is pending; no stale render or timer
  survives removal.
- Navigate between matching and non-matching Binance routes and verify the
  route watcher does not leave a business loop running off-route.

### Auto refresh

- Matching URL: the configured target causes one reload at the intended time.
- Non-matching URL: no timer or reload is installed.
- Regain focus after the target time: the page reloads instead of silently
  postponing the target to tomorrow.
- Manual reload and visibility/focus changes leave the next target calculation
  correct and do not create duplicate intervals.

### Generated artifacts and reporting

- After each migrated-source build, compare the generated metadata, version,
  install URLs, and source identity with the editable source.
- Run `git diff --check` and report failures rather than retrying until a green
  result appears.
- State live/browser paths that were not exercised, and keep account, order,
  cookie, and private-site evidence out of repository artifacts.

## Change Routing

Start with this document for trading-data, CoinMarketCap-data, auto-refresh, or
cross-script lifecycle work. Then read the specialized manual named in the
script matrix when the change crosses into orderbook UI/CDP, Strategy 27 chart
rendering, Brooks media export, or release/publish behavior.
