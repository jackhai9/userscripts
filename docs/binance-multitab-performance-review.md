# Binance Multi-tab Performance Review

Date: 2026-10-10. Baseline: `f477d2c12b7838df1e7aee45c3b4463e1ad9e38e`.

## Scope and live evidence

This investigation covers the orderbook, trading-data, CMC-data, Strategy27,
Strategy29 and Strategy31 clients during long-lived Binance sessions. It follows
the [earlier performance audit](userscript-performance-review.md). Source and
controlled tests identify the fixes below; they do not establish the fraction of
live Chrome CPU attributable to each userscript.

The initial bounded inspection found substantial resource pressure on an
eight-logical-core, 16 GiB Mac: about 6.6 GiB swap and 4.4 GiB compressed memory.
Two Chrome renderers reached approximately 133% and 113% CPU, with reported
process memory around 2.3 GB and 4.0 GB. Renderer PIDs were not conclusively mapped
to individual symbols. STRKUSDT and USUSDT were present initially; VVVUSDT was
opened later, so the tab set was not constant.

In a 12.23-second foreground USUSDT sample, PerformanceObserver recorded 43 long
tasks totaling 7,804 ms, with a 1,203 ms maximum. It also recorded 53 long animation
frames, with a maximum near 1,274 ms. Attribution named Sentry-wrapped callbacks,
native Binance modules and TradingView. A wrapper name does not identify the
wrapped callback's root cause. Hidden-page zero counts do not establish zero
background CPU.

The older pages had been running for about 9.4 hours. Sampled JS heaps changed
from approximately 570/597 MB to 414/421 MB; this is not evidence of monotonic
heap growth. The approximately 611 million bytes (583 MiB) reported for IndexedDB
are shared origin disk usage, not per-tab JS heap, and must not be added once per
tab. Trade task panels read completed, failed or idle during inspection; the
sample did not prove that continuous order submission was running on every page.

All temporary observers and DOM probes were removed. The live sample is retained
locally in `test-results/runtime-performance/live-baseline.json`. The changes were
not installed into those pages during this investigation. Later lower renderer
CPU therefore cannot be attributed to these fixes.

## Confirmed work removed

### Native depth profiles

`core/binance-native-depth-source.js` previously built and sorted a complete
display profile for every native increment even with no display subscribers.
The source now validates and applies every increment to the real book, but builds
the display profile only when a consumer needs it. Returning consumers receive
the current quantities immediately. The last unsubscribe releases the source's
sorted cache; the UI can still retain its last delivered snapshot.

An already-ready duplicate update no longer rebuilds or republishes a profile.
Validation still runs first, and valid repeated updates still restore readiness
after reconnection or transport failure. Failed or resynchronizing state cannot
be revived merely by subscribing. Fresh profiles remain independent snapshots.
Profile construction now sorts one new array per side and calculates cumulative
quantities on the newly created levels, reducing temporary copies.

The visualization does not supply ladder prices or trading decisions. The change
does not truncate valid levels, open another data stream, alter exchange sequence
validation or change order submission timing. Fixed-size diagnostics distinguish
raw book counts, subscriber count, profile version and total builds.

### Cached Strategy29 markers

The detector already reused results for an unchanged complete OHLC snapshot, but
the caller still normalized every signal and projected every marker on each poll.
It now reconciles the existing presentation when both the complete candle cache
and the committed overlay snapshot are unchanged. An interrupted render cannot
be reused as a successfully committed snapshot. This matters when native drawing
ownership changes between rendering and the async cache commit.

Reconciliation still checks current route/chart/session, mutation permission,
projection object identities and pane dimensions. Native data, viewport and
resize events schedule projection independently; hidden/busy recovery redraws.
Every actual projection reads the main series' first value at most once. The
generic overlay `render()` still validates and copies complete new input.

Every active poll still exports and compares all closed OHLC rows, preserving
older-candle revisions and clock-only candle closure. There is no speculative
tail-only history check or reliance on an unverified data-event contract. Shared
overlay consumers in Strategy27 and Strategy31 receive the same frame-local
projection change and are included in validation.

### Retired data-panel requests

Trading history had stale-response guards but no transport cancellation. Three
rapid symbol activations could retain 7, then 14, then 21 historical requests;
queued failures could retry after route departure. One route-session controller
now cancels all seven history requests. Clock, current funding and funding interval
metadata keep their independent controllers. Epoch and request-identity guards
continue to protect newer work from old completions.

CMC refreshes now pass one cancellation signal through mapping, detail, optional
page snapshot and holder stages. Cancellation ends the chain without a fallback,
extra lookup, stale cache write or endpoint-failure label. Every terminal GM
callback removes its abort listener; stage boundaries also check an already
changed pathname before the watchdog runs.

Route departure, close and `pagehide` cancel owned work. BFCache `pageshow`
restores one current session for a previously activated page. Repeated restoration
or visibility events do not duplicate initialization. A closed panel stays closed,
and a never-visited hidden page still waits for first activation. Ordinary tab
hiding retains the two panels' sessions and follows their existing background
refresh schedules.

## Controlled comparisons

These counts execute real source logic through synthetic external transports and
chart fixtures. They are not live Chrome CPU or memory-reduction percentages.

| Scenario | Baseline | Changed |
| --- | ---: | ---: |
| Depth, 1,000 levels per side, no subscriber, initialization plus 200 updates: sorts | 402 | 0 |
| Same depth scenario: levels visited by sorting | 402,000 | 0 |
| Depth with a subscriber: profiles delivered including initialization | 201 | 201 |
| Strategy29, 6,000 candles, 444 signals, 11 unchanged samples: marker projections | 4,884 | 444 |
| Same marker scenario: first-value reads | 4,884 | 1 |
| Same marker scenario: complete candle exports | 11 | 11 |
| Three unresolved trading history sessions: outstanding historical requests | 7 / 14 / 21 | 7 / 7 / 7 |
| Leaving futures with the third historical batch pending: outstanding requests | 21 | 0 |

The depth benchmark compares every final level and cumulative quantity across
all three before/after samples, and asserts unchanged socket/fetch counts. Its
operation counters include initialization; timing covers only the subsequent
200 updates. The latest local Node medians were about 230 ms versus 1.38 ms with
no subscriber, and 224 ms versus 204 ms with a subscriber. Timing varies with
machine load and is secondary to the operation counts.

## Storage, gateway and continuous-trading findings

- Continuous-ladder progress retains aggregate counts and the last round, with
  duplicate-outcome tracking in a WeakSet. No growing per-round history was found
  in that state. This does not rule out native Binance DOM work during trading.
- Strategy27 candidates have count and age retention; Strategy29 local markers
  are limited to 1,000 per direction. Its remote summary keeps three events per
  timeframe and reads at most two event pages per poll. Strategy31 requests a
  bounded 200-event snapshot. The review did not establish an unbounded retained
  signal collection or a new gateway-request multiplier.
- Strategy overlays use owned SVG, not native drawing entities or chart-save
  requests. The existing mirror optimizer admits at most 512 entries and 4 MiB
  per batch, with 16 pending batches and 64 MiB of copied input. Those are limits
  of the optimizer, not a bound on all native Binance storage work. No new
  persistence mechanism or deletion of user drawings/data is introduced.
- The raw native depth book represents active price levels and may grow as the
  exchange sends additional levels. Arbitrary truncation would corrupt full-depth
  quantities and is not an acceptable memory fix. This change removes repeated
  display copies and leaves protocol-owned levels intact.

## Reproduction and validation

Use Node 24.16.0 from `.nvmrc`. The main checkout can be busy in another session;
this task uses the sibling `userscripts-performance` worktree. Dependencies must
be physically local: cross-checkout dependency symlinks change esbuild's source
paths and correctly fail the coverage registry's scope assertion.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:binance-userscripts
npm run lint:tests
npm run lint:ui-copy
npm run check:binance-userscripts
node test/manual/binance-depth-performance-benchmark.mjs f477d2c12b7838df1e7aee45c3b4463e1ad9e38e
node --test --test-concurrency=1 'test/unit/**/*.test.js' 'test/dom/**/*.test.js'
npm run test:ui -- --workers=1 --reporter=line
git diff --check
```

The source versions are orderbook 2.7.228, trading-data 1.2.4, CMC-data 0.2.4,
Strategy27 0.6.15, Strategy29 0.5.13 and Strategy31 0.1.9. Their public install URLs
remain unchanged. All six builds and generated syntax checks passed. The recorded
artifact SHA-256 values were checked again after the last test edits; every
artifact remains byte-for-byte identical to its validated build, with matching
source metadata and unchanged installation identity.

### Final validation results

- The complete Node suite passed **2,616 / 2,616** tests with concurrency one.
  Subsequent changes affect only browser-test synchronization and documentation;
  production source, generated artifacts, Node tests, dependencies and runtime
  remain unchanged, so this result is reused for the final inputs.
- The first complete browser run executed 619 scenarios: 617 passed and two
  failed at test synchronization boundaries. Those failures remain recorded in
  `browser-full-first.txt`; they are not reported as a passing full run.
- An intermediate affected run was stopped after exposing a frozen native
  drawing-discovery window. It remains a failed/interrupted attempt in
  `browser-clock-affected.txt`, with its trace retained separately.
- After the fixes described below, all **381 / 381** scenarios across all 33
  direct and transitive Clock-helper consumer files passed with one worker and
  zero retries. The selection is saved in `clock-affected-plan.json`, and the
  result in `browser-clock-affected-final.txt`. This includes the new Clock
  regression and the complete continuous-readiness and active-ladder-context
  files. The unchanged 239 other scenarios retain their first-run passing
  results. Together these provide passing evidence for all **620** current
  browser scenarios; this is not a single fresh 620-scenario run.
- Final test lint, UI-copy lint and `git diff --check` passed. Coverage was not
  recollected in this pass.
- Independent read-only reviews passed for native depth, chart markers and both
  data panels, and for the final browser-test changes. The marker review found
  an interrupted-render cache mismatch; the final regression verifies that an
  A -> B -> A candle sequence restores the correct overlay before reuse.
- Four rendered fixture screenshots were inspected: native depth labels, dense
  markers, Strategy27/29/31 coexistence, and both English data panels after a
  background return. They are retained under `screenshots/`. They show controlled
  generated-artifact rendering, not the user's live Binance page.

All paths above are relative to `test-results/runtime-performance/`.

### Browser-test synchronization repairs

The former Clock helper sampled `Date.now()` and asked Playwright to pause 100ms
later. A slow command could arrive after that timestamp and fail with
`Cannot fast-forward to the past`. The helper now fixes sampled wall time while
pausing, then compensates using elapsed monotonic time. The dedicated regression
delays the actual Clock boundary by 250ms and verifies the original timer
deadline and repeated pause/resume. Its temporary wall-time rollback limitation
is documented in the [UI automation manual](binance-orderbook-trade-ui-automation.md).

The continuous-readiness request assertion retained its three-second deadline
but now polls every 100ms. The first failure trace showed a request arriving
before that deadline after the last default predicate had already run.

Earlier request observation also exposed a distinct test phase boundary: a
network response gate does not complete the 250ms native order-drawing discovery
window. One trace paused 109ms after the third submit, leaving its remaining
141ms frozen even after the response succeeded. Continuous-readiness scenarios
now advance that existing discovery window explicitly while holding the response.
The generic Clock helper adds no implicit business-time advance, and dedicated
drawing scenarios still control their own before/after deadlines. The two-round
completion and Stop-while-pending regressions passed before the complete affected
rerun. No production trading timing, confirmation or safety rule was changed.

## Remaining live verification

No authenticated order placement, cancellation, transfer, browser reload or
Tampermonkey update was performed. The new artifacts were not installed or loaded
in live Chrome. The bounded observer sample above does not establish current
page-world hook state or the new artifacts' runtime performance. Fixture BFCache
events establish lifecycle logic, not actual Chrome freeze/discard behavior.

After an authorized publication and installation, verify the exact installed and
loaded sources, then compare the same three tabs over comparable observation
windows. Measure CPU, JS heap and long tasks separately. Check foreground return,
symbol changes, pending-request cancellation, pan/zoom and signal corrections.
Long-lived behavior and actual user trading need separate observation; this
bounded investigation does not certify that every possible source of lag is gone.
