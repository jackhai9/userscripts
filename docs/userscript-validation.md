# Userscript Validation and Maintenance Guide

This document owns cross-script validation, lifecycle checks, and the manual
matrix for scripts that do not have a more specialized development manual. The
orderbook browser/CDP matrix is owned by
`docs/binance-orderbook-trade-ui-automation.md`; Strategy 27 rendering is owned
by `docs/binance-strategy27-events-development.md`; Brooks/m3u8 behavior is owned
by `docs/brooks-media-sync-workflow.md`. Release and remote-publish mutations
are owned by `skills/userscript-release/SKILL.md`.

The eight-script performance audit, operation-count baselines, and reproduction
commands are recorded in `docs/userscript-performance-review.md`.

The behavioral test rules, reviewed fake contracts, virtual-time boundaries,
and explicit migration inventory are owned by [Behavioral Test Policy](test-policy.md).
Use [Affected Test Selection](test-selection.md) for dependency-based local and CI
selection, and [Source Coverage](test-coverage.md) for the complete-source coverage
scope, threshold policy, and report interpretation.

## Script Matrix

| Script | Editable source | Artifact | Focused checks | Detailed guide |
| --- | --- | --- | --- | --- |
| Binance Strategy 29 Bollinger | `src/binance-strategy29-bollinger/` | `scripts/binance-strategy29-bollinger.user.js` | `npm run test:binance-strategy29-bollinger`, `npm run build:binance-strategy29-bollinger`, `npm run check:binance-strategy29-bollinger` | `docs/binance-strategy29-bollinger-development.md` |
| Binance orderbook trade | `src/binance-orderbook-trade/` | `scripts/binance-orderbook-trade.user.js` | `npm run test:binance-orderbook-trade`, `npm run build:binance-orderbook-trade`, `npm run check:binance-orderbook-trade` | `docs/binance-orderbook-trade-development.md` and `docs/binance-orderbook-trade-ui-automation.md` |
| Binance trading data | `src/binance-trading-data/` | `scripts/binance-trading-data.user.js` | `node --test test/unit/binance-data-panel-*.test.js`, `npm run build:binance-trading-data`, `node --check scripts/binance-trading-data.user.js` | this document |
| Binance CoinMarketCap data | `src/binance-coinmarketcap-data/` | `scripts/binance-coinmarketcap-data.user.js` | `node --test test/unit/binance-data-panel-*.test.js`, `npm run build:binance-coinmarketcap-data`, `node --check scripts/binance-coinmarketcap-data.user.js` | this document |
| Binance Strategy 27 events | `src/binance-strategy27-events/` | `scripts/binance-strategy27-events.user.js` | `npm run test:binance-strategy27-events`, `npm run build:binance-strategy27-events`, `npm run check:binance-userscripts` | `docs/binance-strategy27-events-development.md` |
| m3u8 downloader | `src/m3u8-downloader/` | `scripts/m3u8-downloader.user.js` | `node --test test/unit/m3u8-downloader-course-export.test.js`, `npm run build:m3u8-downloader`, `npm run check:m3u8-downloader` | `docs/brooks-media-sync-workflow.md` |
| Shared Binance route/lifecycle helpers | `src/shared/` | every affected generated artifact | affected unit tests, `npm run build:binance-userscripts`, `node --check` on affected artifacts | this document plus the affected script guide |
| Auto refresh | `scripts/auto_refresh.user.js` | same file | `node --test test/unit/auto-refresh.test.js`, `node --check scripts/auto_refresh.user.js` | this document |
| CoinMarketCap valuation helper | `scripts/coinmarketcap-valuation-helper.user.js` | same file | `node --check scripts/coinmarketcap-valuation-helper.user.js` | this document |

Use the affected checks during implementation and commit/push preparation.
`skills/userscript-release/SKILL.md` owns the full-suite release gate and reuse of
passing local results for unchanged inputs. A focused check establishes only its
tested layer; it does not replace an affected build, generated-artifact comparison,
or required live validation step.
The default suite runs all `test/unit/**/*.test.js` and `test/dom/**/*.test.js`
files. Scripts under `test/manual/` are explicit manual probes and previews;
they are not automatically executed by the test runner.

Test changes also run `npm run lint:tests`. `npm run test:affected -- --list`
explains the selected Node and browser files before execution. The scheduled
`Userscript Tests` workflow runs the complete Node and browser coverage pipeline;
ordinary PR and main-push runs select tests using an explicit Git base. Existing
script-specific workflows retain their independent checks. All three workflows
read the Node version from `.nvmrc`.

## Shared Contracts

- A migrated script is edited under `src/`; its generated artifact is rebuilt
  and inspected after behavior changes. An unmigrated script is edited in its
  `scripts/*.user.js` file and checked directly.
- Route and symbol identity come from the documented pathname/route contract.
  Do not infer a symbol from a page title, stale DOM, or a neighboring panel.
- The shared route parser activates scripts only for
  `/[locale/]futures/<asset>USDT` and `<asset>USDC` perpetual routes, with an
  optional trailing slash. The asset must be nonempty; Unicode letters, numbers,
  and underscores retain their exchange identity. This is the scripts' supported
  route syntax, not a live exchange listing check. Individual strategies retain
  their narrower USDT market and timeframe requirements. Other quote assets,
  dated contracts, landing pages, `home`, `quiz`, multi-chart pages, calculators,
  and wallet routes do not activate panels or business requests.
  Keep the broad metadata match and lightweight route watcher so SPA navigation
  from a landing page can activate a supported contract and remove it on return.
- Binance identifiers share the Unicode letter/number/underscore character
  contract in `src/shared/binance-symbol.js`. Include Chinese, one-character,
  numeric-only, and numeric-prefixed assets when validating route, depth, order
  scope, and available-balance parsing. Canonical gateway symbols retain the
  separate exact server contract in `src/shared/canonical-symbol.js`.
- Async work must carry the symbol, route, and lifecycle identity that started
  it. A route change, symbol change, panel close, or page teardown invalidates
  work before its result can render or update shared state. Follow each script's
  visibility contract: the two data panels below retain an activated session
  while hidden; visibility alone does not invalidate its requests.
- Timer, observer, drag, and unload listeners are part of the lifecycle. Stop
  business work when its route or panel is inactive, remove listeners when the
  panel is removed, and keep only the route watcher needed to discover a future
  matching route.
- Cache, snapshot, fallback, and neutral values retain their provenance. A
  cached or partial result must not be presented as current data or counted as a
  fresh directional vote.
- Errors keep the observed HTTP, parse, mapping, or contract reason. Do not
  turn an unknown or ambiguous upstream result into a guessed default.

### Data panel positions

The trading-data and CoinMarketCap panels store independent `{left, top}`
preferences. Only a completed primary-button drag that changes the displayed
position writes that panel's preference. Creating, resizing, reloading, or
closing a page must not save its temporary viewport adjustment or overwrite a
position saved by another tab. Header clicks and collapse controls do not save
coordinates. A drag interrupted by resize, window blur, or a move with the
primary button already released is canceled without saving.

For every resize, project the saved preference into the current viewport while
keeping the header reachable. Enlarging the viewport restores the saved
coordinates. Both panels are 384 px wide, limited by the viewport. Without a
saved preference, one panel uses the
right edge with a 16 px margin and a 60 px top offset. When both are present,
viewports at least 816 px wide place them side by side, with CMC to the left of
trading and a 16 px gap. Smaller viewports split the available height into two
scrollable panels with 8 px outer margins and an 8 px vertical gap. These defaults
are never persisted. Saved positions remain authoritative, even when a user's
chosen positions overlap; an overwritten earlier position cannot be reconstructed.

`src/shared/data-panel-layout.js` owns this presentation calculation. Mount,
close, and removal notify the other panel through the local
`jh-data-panels-layout-change` event. Reflow cancels an active drag before
projecting coordinates, so an automatic move cannot become a saved drag when the
mouse is released. The event only reflows existing panels; it does not start
business work or broadcast again. Close and removal clean up the listener.
Completing a real drag saves once and recalculates the available body height.

`e2e/binance-orderbook/specs/data-panel-position.pw.js` covers this contract with
the generated scripts, real browser geometry, native storage, and isolated data
providers. JSDOM lifecycle tests do not establish viewport geometry.

Both panels use the existing pathname locale contract: `/zh-CN/` selects Chinese;
English and other supported routes select English. Names, controls, explanations,
status text, number units, and time formatting change together. Ordinary ratios
and percentages use two decimal places; funding percentages and small token
prices retain enough significant digits to distinguish nonzero values from zero.

## Binance Trading Data Panel

The panel runs only on an actual Binance futures trading route. It derives the
symbol from the shared route parser and aligns five-minute data to Binance server
time. An initially hidden document waits for its first visible activation. Once
activated, hiding the tab retains the same route session, in-flight requests,
data, and historical schedule. Closing the panel or leaving a trading route stops
the business loop. The route watcher remains active off-route and while hidden
so a later SPA transition can start a new session; old-symbol and old-path
responses cannot publish into that session.

Current funding refreshes 15 seconds after request completion in the foreground
and 60 seconds after completion in the background. Successful and failed requests
both establish this deadline; the displayed receipt timestamp changes only on
success. Visibility changes recalculate the deadline from that same completion
time, never restart initialization or overlap an existing request. Returning to
an overdue quote schedules one refresh while retaining its existing value and
provenance. An active session includes calibration and initial requests that are
still pending.

Historical data retains its five-minute boundaries, five-second first delay,
10/15/20/30-second retry schedule, and hourly server calibration while hidden.
A delayed timer starts only the latest publication window. Initial and periodic
responses that arrive after their own five-minute window expires are discarded
before updating values, votes, or the receipt timestamp; the current window is
then scheduled once. Browser timer throttling can delay these requests, and a
frozen or discarded page cannot execute JavaScript until resumed or reloaded.

The one-second age display retains its footer elements and updates only changed
text. It pauses while hidden and updates immediately on return, including removal
of a current funding quote whose settlement has expired. It does not recreate
the timestamp row or alter the historical data-fetch schedule.

Each period fetch records which endpoint produced fresh data and which endpoint
used a cached value or has no value. Fresh and cached indicators remain distinct
when the panel computes directional votes. A stale request must not render into
a newer symbol or lifecycle epoch. 4xx parameter/authentication failures are not
treated as transient network failures; any recovery behavior must remain explicit
in the source contract.

### History and current funding

The table has metric, historical trend, and value columns. Names follow the
approved Binance data-page terminology. Each chart uses the observations' actual
timestamps, rather than equally spaced synthetic timestamps. Missing observations
break the line. One observation is a point, and an empty series stays unavailable.
Taker activity uses separate buy and sell volume bars; its numeric field is clearly
labelled as the buy/sell ratio. Click or focus a chart to inspect its values and
dated observations; arrow keys select points and Escape closes the detail.

Compact rows use 4 px vertical padding and 26 px charts. The footer states the
shared five-minute sampling period and distinguishes settled funding history;
individual observation counts appear in the opened history detail. The funding
row also retains its settled-history caption, last settled value, current rate,
confirmed interval, and countdown. The composite heading opens the voting rules
with native `details`/`summary`; its current open state survives display refreshes.
Body text remains 13 px on desktop and annotations remain at least 11 px.

All Binance requests use the existing `https://www.binance.com` origin:

| Display | Endpoint | Source fields |
| --- | --- | --- |
| Open interest | `/futures/data/openInterestHist` | `timestamp`, `sumOpenInterest` |
| Top trader account ratio | `/futures/data/topLongShortAccountRatio` | `timestamp`, `longShortRatio` |
| Top trader position ratio | `/futures/data/topLongShortPositionRatio` | `timestamp`, `longShortRatio` |
| Global account ratio | `/futures/data/globalLongShortAccountRatio` | `timestamp`, `longShortRatio` |
| Taker volume and buy/sell ratio | `/futures/data/takerlongshortRatio` | `timestamp`, `buyVol`, `sellVol`, `buySellRatio` |
| Basis rate | `/futures/data/basis` | `timestamp`, `basisRate`; requests use `pair` and `contractType=PERPETUAL` |
| Settled funding history | `/fapi/v1/fundingRate` | `fundingTime`, `fundingRate`; up to 40 settlements |
| Current funding and next settlement | `/fapi/v1/premiumIndex` | `symbol`, `lastFundingRate`, `time`, `nextFundingTime` |
| Current settlement interval | `/fapi/v1/fundingInfo` | the unique matching `symbol` and `fundingIntervalHours` |

The six five-minute series retain `period=5m`, `limit=30`, the publication grace
period, and the existing delayed-publication retry schedule. History parsing
requires finite numeric values and increasing timestamps. Malformed values do
not become zero or fresh votes. The open-interest-to-market-cap row divides
`sumOpenInterest` by `CMCCirculatingSupply` in the same contract base unit; it does
not apply another multiplier to 1000-token contracts.

The single funding row combines the last settled rate and its historical chart
with the separate current rate, interval, and countdown. Only the settled value
participates in the existing simplified funding vote. Current funding follows
the visibility cadence above, with a 10-second request deadline.
Interval metadata refreshes independently at activation and each full historical
cycle, also with a 10-second deadline. It must never block a historical refresh.
An absent metadata row means an unknown interval, not an assumed eight hours.

Requests and responses retain session, path, and symbol ownership. Changing
routes or closing aborts the current-rate, interval, and clock requests;
superseded responses cannot publish. A failed current refresh can retain an actual
previous quote with a visible cache/error label. A first failure without data is
labelled unavailable rather than cached. Metadata cache status is independent.

Server-clock requests have a five-second deadline. Samples whose round trip
exceeds two seconds are rejected; accepted samples use the request/response
midpoint to estimate offset. The countdown states when calibration is unavailable.
At the supplied settlement time it shows waiting for update and withdraws the old
current quote until a new authoritative next settlement arrives. The one-second
display timer updates existing value/status nodes. Current and clock updates do
not recreate historical charts or reset the history footer's receipt timestamp.

### Public provider evidence

`test/unit/binance-trading-data-market.test.js` retains numeric samples observed
at `2026-10-09T07:16:15Z`: STRK current funding was `0.00005000`, while the latest
settled rate was `0.00000029` at `1791518400000`; the next settlement was
`1791532800000`, with a reported four-hour interval. These are dated fixture
values, not current quotes. A 1000PEPE sample had OI `17073744019` and Binance CMC
supply `413772355107.944`; CMC's underlying PEPE supply was
`413772355107943.94`. Their ratio requires no additional 1000 multiplier and
displays `4.13%`.

Public GETs on the scripts' actual `www.binance.com` origin were also checked at
`2026-10-09T09:05:25Z`: `premiumIndex?symbol=STRKUSDT` and `fundingInfo` both
returned HTTP 200, and STRK's unique interval row reported four hours. Protocol
reference: [official Binance market-data SDK](https://github.com/binance/binance-connector-python/blob/master/clients/derivatives_trading_usds_futures/src/binance_sdk_derivatives_trading_usds_futures/rest_api/api/market_data_api.py).
SDK titles establish API meaning, not exact website text. The approved English
labels still need a verbatim check against the live native data page; that visual
check and installed Tampermonkey verification are separate from offline tests.

## Binance CoinMarketCap Panel

The panel runs only on a matching futures route and resolves the current Binance
base asset to one deterministic CoinMarketCap asset. Missing or ambiguous
mapping results remain visible failures; the panel must not select an arbitrary
same-symbol asset. API and page-snapshot data are labeled by their actual source
and timestamp, and a failed refresh must not overwrite a newer symbol's panel.
The existing `1000` and `1000000` multiplier mapping recognizes Unicode letters
as the start of an asset name; numeric-only names such as `4` retain their digits.

Route changes, panel close, and panel removal invalidate the refresh epoch and
clean up business timers. Responses belong to the complete pathname as well as
the symbol, so even a same-symbol language change starts a new session. A route
watcher remains to detect later matching pages, including transitions while
hidden; it does not run business requests off-route or after close.

An initially hidden document waits until first visited. An activated panel keeps
its data, expanded interpretation, pending requests, and session when hidden.
Automatic refresh uses one timeout: 30 seconds after the last completed attempt
in the foreground and five minutes in the background. Failed attempts also set
the deadline without claiming a successful fetch. Returning
before that deadline makes no request; returning after the foreground deadline
silently refreshes once without replacing the table with Loading. Visibility
cannot duplicate an in-flight refresh or reset its timing anchor. A manual
Refresh keeps its explicit superseding-request behavior. Browser throttling or
freezing can delay the schedule; missed intervals are not replayed.

The CMC table has metric, value, and interpretation columns, with expandable
definitions. A short name and separate qualifier identify each ratio's numerator,
denominator, period, and unit. The display uses CMC-reported turnover and liquidity
ratios rather than recomputing them from potentially asynchronous fields. FDV's
comparison is the snapshot's FDV divided by circulating market cap; supply share
uses circulating divided by total supply. Missing or non-positive comparison
denominators do not produce a ratio. Null, empty, or invalid provider numbers stay
unavailable, while genuine zero stays zero. Treasury holdings retain their token
unit and cannot become a holder-address count.

Compact rows keep their brief interpretation visible. Secondary notes are in the
interpretation button's tooltip and expanded explanation, and token units share
the value line when space allows. Automatic table layout reserves the complete
width of a small token price or 24-hour change before wrapping prose; browser
checks compare text ranges against their own cells as well as overall overflow.
Body text remains 12 px on desktop and
annotations remain at least 11 px. The generated-panel browser scenarios require
both default panels, all metric rows, and both footers to fit a 1366-by-768 desktop
without scrolling in Chinese and English. Narrow screens retain separate scroll
areas and no horizontal overflow.

Interpretations describe what the value supports. The volume ratio's 50% threshold
is explicitly a descriptive convention, not a statistical anomaly or trading
signal. Valuation comparisons need peers, volume changes need history, DEX
liquidity is not Binance order-book depth, and profile disclosure scores do not
establish project safety. The refresh schedule, mapping rules, source timestamps,
and API/page-snapshot provenance remain separate from presentation.

For a browser-openable offline implementation preview, run
`node e2e/binance-orderbook/helpers/data-panels-preview.mjs` after the two builds
and open `output/data-panels-preview/index.html` with a `file://` URL. The generator
embeds unchanged generated artifacts and labelled example data. It supports both
languages, light/dark themes, and each panel separately, without external network
requests. It is not live Binance or Tampermonkey evidence.

### Background lifecycle validation (2026-10-09)

Trading-data `1.2.2` and CMC-data `0.2.2` passed the full 2548-test Node suite,
including 23 focused background-lifecycle scenarios, and all 41 generated-panel
browser scenarios. Both builds, generated syntax and release metadata checks,
test lint, and `git diff --check` passed. The browser checks cover simulated
visibility and suspended animation frames; the rendered English panels were
inspected with both historical and CMC interpretation details kept open.

The controlled host verifies that ten quick returns preserve the same rows and
initial request batch, without postponing the original foreground deadline.
Other checks cover background cadence, request completion while hidden, failure
cooldowns, late initial/cycle responses, full-path ownership when the host
replaces its history methods, clock continuity,
and settlement expiry on return. These are deterministic request and UI checks,
not CPU or memory measurements. Current Chrome timer throttling, freezing or
discarding, Tampermonkey installation, and live Binance responses remain untested.

### Compact layout validation (2026-10-09)

Trading-data `1.2.1` and CMC-data `0.2.1` passed the full 2528-test Node suite,
all 39 panel browser scenarios, both builds, generated syntax checks, test lint,
metadata/install URL checks, and independent source review. Six new browser
scenarios verify complete default panels on a 1366-by-768 screen and precise
small prices staying inside their value cells at 1366/320 px in both languages.
Resize scenarios wait for browser rendering frames before reading geometry.

At the same 1600-by-1056 preview viewport, the Chinese trading panel decreased
from approximately 897 to 500 px high and CMC from 779 to 567 px. English heights
decreased from 913 to 534 px and 826 to 618 px. Both widths are now 384 px, with
unchanged 13/12 px desktop body text and a minimum 11 px annotation size. The
four preview combinations again have no panel overlap, horizontal overflow,
page errors, or external HTTP requests. These are offline rendering results;
the installed Tampermonkey scripts and live Binance pages were not operated.

### Data-panel implementation validation (2026-10-09)

The trading-data `1.2.0` and CMC-data `0.2.0` implementations passed independent
source review, both builds, generated syntax checks, test lint, metadata/install
URL checks, and exact preview-to-artifact comparison. Full `npm test` passed
2501 tests. The four rendered preview combinations cover Chinese/English,
light/dark themes, desktop, and 390/320 px widths; they have no default panel
overlap, horizontal overflow, page errors, or external HTTP requests.

Full `npm run test:ui` passed 605 of 606 cases, including all 33 data-panel
position/presentation cases. The remaining failure is in
`active-ladder-context-behavior.pw.js`, before its saved-order-count change:
the existing `pauseScenarioClock` reads page time and then calls
`pauseAt(pageNow + 100)` across process boundaries. The recorded delay exceeded
that margin, producing `Cannot fast-forward to the past`. The scenario, helper,
fixture, orderbook artifact, and package inputs match the unchanged base commit
`6b0f788e`; this is an outstanding browser-test timing failure, not a passed
scenario. Live native-page comparison and Tampermonkey installation remain
unverified, including verbatim English labels.

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

### Data panel positions

- Place the two panels separately, shrink the window, and enlarge it again;
  both return to their saved positions without rewriting the position keys.
- Open or reload a small second window and close it; the original saved
  positions remain available in a larger window.
- Drag a panel in one tab, then close an older tab; reopening uses the newer
  position.
- Click the header or collapse control without dragging; only the collapse
  preference may change. Complete a drag; only that panel's position is saved.
- Interrupt a drag by resizing, switching window focus, or releasing the mouse
  outside the document; later movement cannot continue or save the old drag.
- Mount or close the other panel while the header is held without movement;
  releasing it must not save the resulting automatic layout.
- Check both installation orders, a single panel, and both panels at desktop and
  narrow widths. Defaults must not cover each other or write position preferences.
- Collapse, drag to a lower position, and expand; content scrolls inside the
  remaining height without an extra position write.

### Binance trading data

- Switch symbols while a fetch is pending; old results must not appear under the
  new symbol.
- Open near a five-minute boundary and verify the current period is fetched
  after the server-time boundary rather than skipped.
- Switch tabs repeatedly within 15 seconds; retain the same rows, current quote,
  and history timestamp without new calibration or history requests. Once current
  funding is overdue, returning requests it once without clearing the old value.
- Keep the initialized tab hidden: funding refreshes at 60-second completion
  intervals, history retains its five-minute schedule, and hourly calibration
  continues. The second-by-second display stops and catches up immediately on
  return, including a settlement boundary crossed while hidden.
- Delay browser callbacks or pending history across several publication windows;
  process only the latest window after its five-second delay. A late initial or
  cycle response cannot appear as freshly received current-period data.
- Close the panel and verify background polling does not restart it.
- Simulate a partial endpoint failure; cached rows are marked as cached and are
  excluded from directional vote totals while missing rows remain explicit.
- Navigate from a non-trading route to a futures route and back; only the
  matching route owns a panel and active business loop.
- Switch Chinese/English routes and themes; inspect metric names, ratio units,
  controls, errors, timestamps, and keyboard chart details in both languages.
- Compare current funding with the native top-of-page quote and settled points
  with the native data chart at matching times. Check the reported interval and
  countdown, including settlement expiry, unavailable metadata, and calibration
  failure. Do not compare quotes captured at different times as equal snapshots.
- Delay or fail the current funding and interval endpoints; history must still
  render. Current-only refreshes must preserve the historical chart and footer.
- Check a tiny nonzero settled rate, genuine zero, missing data, and a 1000-token
  contract; none may acquire a fabricated zero, interval, or multiplier.

### Binance CoinMarketCap data

- Switch symbols during an API/page fetch; the superseded result must be ignored.
- Exercise a known mapping, a missing mapping, and an ambiguous mapping; only
  the known mapping renders data.
- Verify the displayed source and update time distinguish a page snapshot from a
  data API response.
- Hide the tab while a refresh is pending; its current-symbol response still
  renders and a quick return causes no duplicate request or Loading state.
- Keep the tab hidden through a five-minute refresh, then return; only an overdue
  foreground snapshot triggers one silent refresh. Repeated returns after errors
  must respect the completion-based cooldown.
- Close or leave the route while a refresh is pending; no stale render or timer
  survives removal, and visibility events cannot reopen a closed panel.
- Navigate between matching and non-matching Binance routes and verify the
  route watcher does not leave a business loop running off-route.
- Expand interpretations for FDV, volume/cap, liquidity/cap, supply, holders, and
  profile score; their stated bases must agree with the displayed data.
- Check partial/missing fields and very small token prices in both languages;
  unavailable values and genuine zero must remain distinguishable.

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
