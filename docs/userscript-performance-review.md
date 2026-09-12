# Userscript Performance Review

Date: 2026-09-12. Baseline: `ee78e438f22e1c7d0f4317f8d5d563a8b2936292`.

## Scope and evidence

The review covers all eight repository-owned userscripts, their source entrypoints,
hot DOM paths, recurring work, and lifecycle cleanup. Generated artifacts were
checked against their sources, not edited independently. Third-party Tampermonkey
scripts and native Binance/TradingView/CMC application code are outside this scope.

The measurements below count actual calls and DOM operations in deterministic
fixtures. They are not estimates of live page CPU, memory savings, or latency.
The same synthetic inputs run against the baseline and current implementations.
Real Chromium fixtures also exercise the CMC layout and media-scanning changes.

## Audit coverage

| Script | Finding and outcome | Version |
| --- | --- | --- |
| Binance orderbook trade | Host synchronization measured depth geometry twice before one paint. The synchronous paint now consumes the first validated snapshot; independent frames still measure fresh geometry. | 2.7.206 |
| Binance trading data | The one-second age display reparsed and replaced three footer elements every tick. The panel creates those elements once and updates changed text only. | 1.1.16 |
| Binance CoinMarketCap data | Reviewed the 30-second refresh, five-second route watchdog, refresh epochs, drag listeners, and hidden/closed/non-trading cleanup. No comparable redundant hot path was established; behavior is unchanged. | 0.1.17, unchanged |
| Binance Strategy27 events | Each context tick discovered the same chart root twice. The target resolver now receives the root validated within that synchronous tick. | 0.6.4 |
| Binance Strategy29 Bollinger | Empty event increments sorted retained records twice and rebuilt up to 20 rows. Empty increments now update freshness without replacing rows; nonempty increments reuse one sorted list. | 0.5.4 |
| m3u8 downloader | One changed video/source caused a document-wide video scan. Mutation work now queues only affected videos and deduplicates them before the existing animation frame. | 0.10.38 |
| Auto refresh | Reviewed exact URL matching, the scheduled target and the 30-second missed-target check. No DOM scanning or expensive recurring work was found; scheduling is unchanged. | 1.0.10, unchanged |
| CoinMarketCap valuation helper | Every mutation batch read layout and ancestor text for every `span,p,div` before checking its label. Matching now precedes expensive checks, and batches share one scan per animation frame. | 0.2.9 |

Shared route patches remain idempotent, and route dispatch retains its existing
deduplication. TradingView marker ownership, full-history detection, native shape
audits, cooperative batch yields, and chart-save coordination remain unchanged.
Those checks protect current chart/session identity and require live profiling
before any further attempt to reduce their work.

## Operation counts

| Deterministic scenario | Baseline | Optimized |
| --- | ---: | ---: |
| CMC initial scan with two metric cards and 1,000 unrelated quote rows: layout reads | 6,020 | 8 |
| Same CMC document, ten mutation batches before the next paint: full text scans | 10 | 1 |
| Same ten CMC batches: layout reads / computed-style reads | 60,200 / 30,100 | 8 / 4 |
| One changed source among 100 videos: video scans | 100 | 1 |
| Same media mutation: document-wide video queries | 1 | 0 |
| Ten empty Strategy29 increments with 20 retained signals: list replacements | 10 | 0 |
| Same empty increments: newly created elements | 800 | 0 |
| Ten Strategy27 context ticks: chart-root queries | 20 | 10 |
| One orderbook host synchronization: native geometry snapshots | 2 | 1 |
| Sixty trading-data age updates: footer subtree replacements | 60 | 0 |

The first seven rows are reproduced by the standalone benchmark. The final three
are covered by source-entrypoint regression tests that were observed failing with
the baseline behavior and passing after the changes. Their assertions also check
displayed values, current client ownership, and fresh geometry on the next render.

## Preserved contracts

- CMC keeps the full text fallback scan so delayed nearby values, replaced labels,
  and newly eligible cards remain discoverable. Only matching text reaches layout
  checks; explainer-based matching and the top-left visibility boundary are intact.
  Queued scans validate the current route when they execute.
- Media scanning still performs initial, DOM-ready, and load discovery. Added
  nested sources resolve to their owning video. Removed videos, videos adopted
  into another document, and picture-only sources do not enter the scan. Pending
  videos are pruned during mutation delivery and checked again at frame execution.
  XHR interception, URL deduplication, export persistence and queue semantics are
  unchanged.
- Strategy29 still advances freshness and the client cursor on empty responses.
  Locale changes rebuild translated rows; ordering, retention, cursor reset, and
  nonempty event replacement retain their existing semantics.
- Each Strategy27 tick still validates visible-root uniqueness before resolving
  the frame, native chart, exact symbol, and one-second interval. The historical
  migration fixture remains frozen at its original API and version.
- Depth price-scale validation, logarithmic/inverted mapping, and coordinate
  precision are unchanged. Geometry is reused only synchronously, never cached
  across paints. Chinese and numeric symbols, including `龙虾USDT` and `4USDT`,
  remain covered by real Chromium depth fixtures.
- Trading-data fetch frequency, server-time alignment, retry boundaries, and
  visibility/close lifecycle are unchanged. Repeated footer updates in the same
  second produce no DOM writes.

## Reproduction

Use the repository-supported Node runtime. The completed local verification used
Node 24.16.0.

```sh
node test/manual/userscript-performance-benchmark.mjs ee78e438f22e1c7d0f4317f8d5d563a8b2936292
node --test test/dom/coinmarketcap-valuation-helper.test.js test/dom/m3u8-media-scan.test.js test/dom/binance-trading-data-footer.test.js
node --test test/unit/binance-orderbook-trade/depth-profile-render-cycle.test.js
node --test test/dom/binance-strategy27-events/strategy27-entrypoint.test.js test/dom/binance-strategy29-bollinger/strategy29-summary-panel.test.js
npm test
npm run test:ui -- --reporter=line
```

The benchmark writes only its JSON report to stdout. Supplying a baseline revision
reads historical source through `git show`; it does not check out another branch.
The Strategy29 panel comparison uses unchanged current dependencies. The benchmark
stubs network requests and uses synthetic data only.

The new CMC browser fixture initially lacked a UTF-8 declaration and rendered
Chinese text as mojibake. The fixture now declares UTF-8 in both its response and
markup. This was a deterministic fixture defect, not a retry or suppressed failure.

Final validation completed:

- 1,017 unit/DOM tests passed; zero failures, cancellations, or skips.
- 80 Chromium tests passed with Playwright retries set to zero.
- All five affected generated bundles exactly match an in-memory rebuild from
  current source, including metadata headers. All eight install scripts passed
  syntax checks, and `git diff --check` passed.
- The CMC cards and Chinese/numeric-symbol depth screenshots were inspected in
  isolated fixtures. Operation counts were rechecked after the media document
  ownership regression was fixed.

Local evidence is under `test-results/userscript-performance/`: the before/after
operation counts, artifact hashes, final unit/browser output, verification totals,
and inspected screenshots. Release, public-artifact, and installation evidence is
recorded separately from these performance measurements.

## Verification limits

The performance measurements were collected in isolated fixtures. The live browser
attempt during implementation validation was blocked by the caller-identity policy.
Chromium fixture screenshots establish local rendering only, not live Binance or
CMC performance, and no logged-in Brooks export was exercised. Tampermonkey source
readback and post-reload loaded-source evidence are separate release checks; neither
can be inferred from the fixture results.

Independent read-only reviewers were requested but did not return a completed
verdict because model services returned rate-limit/unavailable errors. This review
gap remains explicit; passing automated checks is not an independent-review claim.
