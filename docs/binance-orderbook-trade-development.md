# Binance Orderbook Trade Development Manual

This manual owns the orderbook source layout, deterministic business contracts,
semantic DOM contracts, and project-level development checks. Browser/CDP and
live-capture procedures are owned by
docs/binance-orderbook-trade-ui-automation.md; release mutations are owned by
skills/userscript-release/SKILL.md.

## Source Of Truth

`src/binance-orderbook-trade/` is the development source for the Binance orderbook userscript.

`scripts/binance-orderbook-trade.user.js` is the generated install/update artifact. Keep it as a single readable userscript file. Do not hand-edit it for feature work.

Users install only:

```text
scripts/binance-orderbook-trade.user.js
```

## Runtime

### Initial panel placement

The floating trade panel stays hidden until the native header satisfies its
insertion contract and its spacer has nonzero layout area. While a visible
trading page is waiting, a temporary structural observer detects native header
mounts without measuring layout or reacting to script-owned and market-data
mutations. A temporary spacer ResizeObserver handles zero-area layout recovery.
Both observers disconnect after successful placement, on page hiding, when
leaving the trading route, and on pagehide. Each waiting episode also expires
after 15 seconds: pages that never satisfy the contract (one-way mode, signed
out, collapsed form) fall back to the 5-second route watchdog instead of keeping
a document-wide observer, and failed renders cannot re-arm an expired episode
until one of the events above starts a new one. Returning to the foreground schedules
an invalidated panel immediately; first placement does not depend on the route
watchdog. These observers do not change trading tasks or chart initialization.

### Chart saves and write filter

`chart-storage/install.js` runs at document-start, before Binance code, on
top-level trading routes. When the native chart starts, the script filters order-line
updates and removals in Binance's drawing-save listener. Other listeners still
receive those events. At the storage boundary, it wraps the standard `IDBObjectStore.prototype.put` so
writes of `#TV_SYMBOL-*` and `myTradingView*` records into localForage's
`keyvaluepairs` store of `chart_*` databases are compared with the stored value
inside the same transaction and skipped when identical. Binance rewrites every
loaded symbol's drawings on each chart save, so unchanged rewrites dominated the
IndexedDB writes that stalled long sessions. The filter depends only on that
persisted layout, never on Binance's bundle, module IDs or minified names, and
it never touches Binance's module queue. It stays installed for the document
lifetime, including after SPA navigation away from a trading route. See
[the storage contract](binance-chart-storage-development.md).

The order-line filter does depend on Binance's listener registration and
TradingView's chart model. When either stops matching, Binance's native save
stays in effect and the panel shows a persistent red alert naming the changed
dependency; see
[dependency break alerts](binance-chart-storage-development.md#dependency-break-alerts).

### Translation usage telemetry block

Binance's i18next post-processor (`i18n-clean-processor`) records every translation
key the page uses into the `pika-i18n-usage` IndexedDB database, only to report key
usage back to Binance. Unreported records from every tab and session accumulate
(about 1,400 records in 15 minutes across four tabs, observed on 2026-11-10), and
each page load marks them reported with one readwrite transaction per record. After
a long trading session that queued 10,000 to 81,000 transactions on that database,
delaying every other request on it; a 164-record read waited 14 seconds.

`i18n-usage/install.js` runs at document-start on top-level trading routes and wraps
the standard `IDBFactory.prototype.open`: opening exactly `pika-i18n-usage` throws a
`NotAllowedError` with no message, so Binance's error reporting does not name the
userscript, and every other open is native. Binance opens it inside a Promise
executor, caches the rejected connection, and catches its insert errors, so the page
logs `Error setting i18n-usage` (about one per few seconds while the UI renders new
keys) and one unhandled rejection from its delayed reporter per i18n instance. Translations
are returned unchanged by the post-processor and load from separate databases
(`i18n-data-*`, `pika-i18n-<locale>`); Chinese, English and the chart were verified
on a live anonymous page. The dependency alert reports a usage-like database opened
under another name (`usage-db-name`), and no blocked open within 120 seconds of
installation (`usage-db-missing`): a renamed database, another storage mechanism,
or removed telemetry. The detail says whether Binance's `__getActiveI18nKeys` debug
hook still exists. Other routes of the same origin are not covered and may still
flush records already on disk.
`self.__BINANCE_I18N_USAGE__.snapshot()` returns `{ blocked }`. Existing usage
records on disk are left in place.

### Order sound scope

Binance plays one trade sound, with no symbol, in every open futures tab whenever
any order of the account fills, partially fills or expires: each tab opens its own
account stream and receives every symbol's `ORDER_TRADE_UPDATE`. `order-sound/`
restricts that sound to the tab showing the filled symbol through two standard
boundaries, installed at document-start on top-level trading routes:

- every page WebSocket gets one extra read-only `message` listener, added before
  Binance's own, that parses only frames containing `"ORDER_TRADE_UPDATE"` and
  records whether a sounding fill belongs to the route symbol;
- `HTMLMediaElement.prototype.play` is wrapped for audio elements whose source
  path ends in `/trade-sound.mp3`.

A trade-sound `play()` is allowed when an own fill arrived within the last 10 s
and not yet sounded; that fill is then consumed. Otherwise it resolves without
playing when another symbol filled within the last 120 s, which covers Binance's
500 ms debounce and 2 s queue spacing even in throttled hidden tabs. Without
recent fill evidence the native call proceeds. Liquidations, `CALCULATED`
executions, system client IDs (`autoclose-`, `adl_autoclose`,
`settlement_autoclose-`), unknown shapes and non-trading routes count as own
fills, so every tab keeps sounding for them.

Binance's audio helper calls `play()` twice per sound; the second call reaches an
element that is already playing or already silenced. Binance's queue keeps at most
two sounds, so attribution is per sound, not per fill: when own and foreign fills
alternate inside one queue window, the own fill may sound on the foreign sound's
slot. Order toasts are not scoped.

The scope depends on the documented account event, the order fields `s`, `X`,
`x`, `o`, `ot` and `c`, and the trade-sound asset path, never on Binance's bundle.
If Binance renamed the asset or changed the stream, the native sound would return
in every tab, so both are reported through the panel's dependency alert:
`sound-stream` when the trade sound plays three times while no page WebSocket has
carried `ORDER_TRADE_UPDATE`, and `sound-asset` when another audio file plays
within three seconds after three fills while the known path never played.
`self.__BINANCE_ORDER_SOUND__.breaks()` lists the reports. `self.__BINANCE_ORDER_SOUND__.snapshot()` returns counts only:
`ownFills`, `foreignFills`, `allowed`, `suppressed` and `unattributed`.

Earlier versions scoped sounds and toasts by replacing three Binance modules; that
stopped matching after Binance's 2026-10 rebuild and was removed with the chart
module pins (see [the storage contract](binance-chart-storage-development.md)).

### Chart save completion and serialization

`core/chart-save-coalescer.js` batches the observed default
`saveChart(callback)` calls during native order-drawing bursts. A completed
batch serializes the current chart once and delivers a separate JSON snapshot
to every accepted callback, including repeated calls using the same function.
Never replace the callback queue with only its last element: unrelated callers
may depend on their own completion to continue.

Explicit options, extra arguments and non-native receivers retain the original
method's synchronous return and error behavior. Queued batches are detached
before delivery; callbacks may reenter without overwriting the current batch.
One callback failure does not suppress later callbacks and is reported at the
asynchronous callback-error boundary. Stop, action failure, timeout and an
external wrapper replacing the method still deliver accepted calls while
preserving method ownership. A retained reference to a retired wrapper forwards
new calls to its original method instead of creating an orphan queue.

These are serialization and callback guarantees, not database commit guarantees.
If each callback writes IndexedDB, it still performs its own write. Tests must
model `saveChart(callback, options)` rather than passing a snapshot as the first
argument. Browser fixtures report serialization, callback delivery and native
save requests separately, using request IDs to verify exactly-once delivery.

Strategy27/29/31 transient annotations use the shared SVG overlay and never
enter the native drawing/save pipeline. Native order lines and manual drawings
continue to use the host chart APIs. Live verification must measure new calls
within a defined observation window; accumulated counters alone cannot establish
causality for an earlier browser database stall.

Use the repository Node version:

```bash
nvm use
npm install
```

The expected version is recorded in `.nvmrc`.

If `npm install` appears silent, check whether npm is still downloading tarballs before interrupting it:

```bash
ps -axo pid,ppid,stat,etime,command | rg 'npm install|node .*npm'
ls -lt ~/.npm/_logs | sed -n '1,5p'
```

This repo has worked without a local `127.0.0.1:7890` listener as long as npm can reach `https://registry.npmjs.org/`.

## Commands

For `binance-orderbook-trade` implementation and commit/push preparation, run the
affected checks. The script-level commands are:

```bash
npm run test:binance-orderbook-trade
npm run build:binance-orderbook-trade
npm run check:binance-orderbook-trade
git diff --check
```

The build command rewrites `scripts/binance-orderbook-trade.user.js` from `src/binance-orderbook-trade/index.user.js`.

Include affected shared-contract and integration checks when the change crosses
script boundaries. Full-suite release validation and reuse of passing local
results are defined in `skills/userscript-release/SKILL.md`.

Test work also follows [Behavioral Test Policy](test-policy.md). Prefer executable
entry-to-outcome scenarios over source-text assertions for runtime behavior;
retain metadata, generated-artifact, and module-boundary contracts. Test changes
must pass `npm run lint:tests` in addition to the affected behavior checks.

## Layout

```text
src/binance-orderbook-trade/
  index.user.js
  core/
    cancel-orders.js
    continuous-ladder.js
    decimal.js
    depth-profile-book.js
    binance-native-depth-source.js
    depth-profile-session.js
    ladder-plan.js
    orderbook.js
    quantity.js
  dom/
    account-orders.js
    depth-profile.js
    trade-form.js
test/
  unit/
    binance-orderbook-trade/
  dom/
    binance-orderbook-trade/
  fixtures/binance-orderbook-trade/
  helpers/
scripts/
  build-userscript.mjs
  binance-orderbook-trade.user.js
```

## Module Boundaries

`core/` must stay browser-DOM-free. Put deterministic logic here:

- decimal normalization and exact arithmetic
- quantity allocation and step-size rounding
- cancel-order text evidence
- orderbook display-step inference
- public depth snapshot/diff synchronization and bounded reconnect lifecycle
- ladder action specs

`dom/` contains DOM traversal and selector logic that can run under jsdom fixtures:

- bottom account-orders tab detection
- active current-orders pane detection
- vertical depth-profile host discovery and canvas rendering
- trade form tab and action button filtering

`index.user.js` owns side effects:

- Binance page reads and writes
- event listeners
- real clicks
- fetch interception
- storage
- panel rendering
- async execution flow

## Strategy 29 Boundary

Bollinger detection and chart annotations belong to the independent Strategy29
script; see `docs/binance-strategy29-bollinger-development.md`. The orderbook
publishes only its live boolean drawing-busy predicate and retains shared
pre-action marker-save drains. It does not run a strategy detector or chart poll.


## Vertical Depth Profile

The optional depth profile is a userscript-owned canvas beside the TradingView price axis. It does not clone Binance's native Depth React component. A feature-gated adapter reads the active TradingView main pane height and maps each depth price through the pane's current price scale, including logarithmic and inverted modes. The divider uses Binance's latest visible trade price rather than the order-book midpoint so it follows TradingView's live-price line. If that contract is unavailable or invalid, the profile fails closed instead of falling back to an approximate scale. Binance Basic and native Depth modes do not expose the verified coordinate contract, so the profile is hidden in those modes.

The geometry adapter checks the native `hasModel()` contract before reading pane heights or panes. A missing readiness API or not-yet-created model returns `null` through the existing not-ready geometry lifecycle, avoiding first-refresh `Value is null` errors without catching pane errors or adding delays.

Every synchronous depth render creates a fresh geometry snapshot. Its 13-step inverse coordinate search memoizes native coordinate-to-price samples by the exact numeric coordinate, shared across that render's levels and initial validation samples. Search branches, precision, pixel-row ownership and cumulative quantities are unchanged. No sample survives into the next geometry, so zoom, logarithmic/inverted mode, and native scale changes are resampled. This removes repeated native calls at shared search-tree nodes without adding timers or caching depth prices/results. Invalid initial samples still reject the geometry; invalid intermediate search samples still throw.

Host synchronization passes its already-validated geometry directly into the
synchronous paint. A separately scheduled render still obtains a fresh geometry;
no snapshot is retained across frames or scale changes.

The userscript installs `core/binance-native-depth-source.js` at `document-start` and passively observes the native `/fapi/v1/rpiDepth?limit=1000` response and `{symbol}@rpiDepth@500ms` messages. It preserves Binance's original `fetch` result and WebSocket instances and never opens a second depth connection. `core/depth-profile-book.js` applies the observed `lastUpdateId`, `U`, `u`, and `pu` sequence contract and treats quantities as absolute values; zero removes a price level. The first buffered event may connect to a snapshot either by covering `lastUpdateId` within `U..u` or by naming that exact snapshot ID in `pu`; every later non-stale event must name the preceding event's `u` in `pu`. The profile keeps every active price accumulated from the native stream and defers pixel-row aggregation to rendering, so distant levels are not discarded by the snapshot limit. Rendering remains sparse: a row is painted only when at least one real price level maps to that chart pixel. `core/depth-profile-session.js` only subscribes the active symbol to that page-owned source. A sequence gap waits for Binance's native resynchronization instead of issuing a userscript-owned retry request, while a changed native RPI contract fails the profile explicitly without blocking Binance's own request.

The session must stop and invalidate old work on symbol change, non-trading routes, hidden documents, and `pagehide`. The overlay canvas uses `pointer-events: none`; only its compact collapse control may receive pointer input. Do not connect this visualization book to ladder pricing or any trading decision.

The native source still validates and applies every depth increment while no
display is subscribed. It releases its sorted profile when the last subscriber
leaves and materializes the latest book once when a subscriber returns. Duplicate
update IDs pass the same payload validation but do not rebuild or repaint an
already-ready profile. A valid repeat still restores readiness after a transport
interruption. Failed or resynchronizing books cannot become ready merely because a
new display subscribes. Each materialization owns one fresh level array per side,
so later updates never mutate an earlier delivered profile. The UI may retain its
last delivered snapshot while hidden; the source does not build additional
display copies until a consumer subscribes again.

For an active display, each symbol schedules at most one native animation frame
to sort and publish the latest book. Every incoming message still validates and
updates the book immediately; frames coalesce display snapshots, not market data.
Protocol and sequence failures cancel pending publication immediately. Last
unsubscribe, snapshot reset, socket close, sequence reset, and restore also cancel
pending frames. A returning subscriber can synchronously materialize the latest
ready book even while animation frames are paused. Geometry is validated when the
display snapshot is built; a temporary empty side that recovers within one frame
does not render an intermediate empty profile. This book remains display-only.

The existing `nativeDepthState` diagnostic separates `bookBidCount` and
`bookAskCount` from the materialized profile's `bidCount` and `askCount`.
`profileBuildCount`, `profileUpdateId`, and `subscriberCount` expose fixed-size
work counters without triggering a sort, a fetch, or retaining update history.

Compact depth labels are painted inside the existing 132px canvas. Each pixel row
keeps its largest cumulative quantity for the bar and separately sums all real
level quantities for its label, retaining the full minimum-to-maximum price band.
Labels identify band quantities in the native book's units, not cumulative totals
or changes over time. Candidates must add at least 8 CSS pixels of depth at the
current visible scale; larger quantities win, with at most two labels per side.
Both sides share collision checks against other labels, the latest-trade divider,
the collapse control, and visible status text.

Each label uses 11px text, a 16px height, and its measured width up to 88px. Price
and compact quantity are shown when they fit; a long price band uses quantity
alone instead of truncating it or pretending it belongs to a single price.
Quantities use up to three significant digits and omit repeated asset names.
Labels stay within the canvas, follow inverted scales, and are omitted when no
space remains. They repaint and clear with the depth bars without adding DOM
nodes, listeners, timers, or cross-frame state.

## Symbol Identity

`src/shared/binance-symbol.js` owns the Binance identifier character contract:
Unicode letters, numbers, and underscores. Wire symbols remain uppercase and
must match completely; whitespace, separators, or a trailing newline are invalid.
The route retains its three-code-point minimum and percent decoding. The depth
book, session, snapshot, and lowercase native stream use that same character set.
Chinese names, one-character assets such as `4USDT` and `WUSDT`, and numeric
prefixes such as `1INCHUSDT` and `1000PEPEUSDT` keep their full identities.

Open-order scope reads preserve symbol-cell boundaries before scanning text.
Every identified visible row must contain a complete contract, optionally followed
by the known `永续` or `Perp` label; an unidentified row aborts the read instead of
being removed from the evidence. Bare contracts are accepted only as complete
lines. Timestamp parsing is local to an adjacent `HH:mm[:ss]`, never a reason to
equate different numeric-prefixed contracts. Row matching compares the complete
contract, so `龙虾BTCUSDT` cannot match `BTCUSDT` or `龙虾USDT`.

## UI Localization

The userscript UI supports exactly `zh-CN` and English. Resolve the locale from the first Binance pathname segment: `/zh-CN/...` uses Chinese, while `/en/...`, other locales, and locale-less futures paths use English. A Binance SPA language switch must rebuild only the userscript panel; it must not abort a ladder, cancel, single-order, or account-rebalance task, and it must not reset the active symbol-mode-precision profile.

Keep script-owned UI copy in `contracts/panel-copy.js` as paired `localizedText(zhCN, en)` values. Dynamic status formatters must retain both languages until render time so current order, round, and cancellation counters survive a locale switch. Raw technical exceptions, Binance response messages, error codes, and native `TypeError` text stay unchanged so they remain copyable for diagnosis.

The locale primitives (`localizedText`, `formatLocalizedText`, `resolveUiLocaleFromPathname`, and related helpers) live in `src/shared/ui-locale.js`, which all six Binance scripts import. Only the orderbook bundles `contracts/panel-copy.js`, so its copy map can change without touching the other installers. A change to `src/shared/ui-locale.js` affects all six generated artifacts; bump their source metadata and rebuild them together.

Run `npm run lint:ui-copy` for status changes. CI rejects direct unpaired text or
titles at `setLadderStatus` and `setAutomaticUsdtRebalanceStatus`, including
templates, concatenation, conditional branches, and localized compositions with
raw authored words. Existing dynamic formatter returns and external diagnostics
still require behavioral review: the rule does not infer arbitrary variable or
function dataflow. Add observable `zh-CN` and English assertions, including
retained text/title after a SPA locale switch, for a new status workflow.
See [the localization audit](binance-ui-localization-audit.md) for coverage and
the remaining historical gaps.

Do not merge this contract with `contracts/binance-page-text.js`. `BINANCE_PAGE_TEXT` recognizes Binance-owned DOM in every supported page language; `PANEL_COPY` and localized status values render userscript-owned UI in the current two-language contract.

## Testing Strategy

Prefer unit tests for pure business logic. Add or update tests before moving logic into `core/`.

Use DOM tests when behavior depends on Binance-like markup. Fixtures should be minimal and targeted; avoid copying full production HTML.

Current important test coverage:

- decimal and quantity exactness
- ladder quantity allocation
- current-symbol cancel evidence
- orderbook display-step inference
- ladder action direction mapping
- account order tab scoping
- `aria-controls` pane-id collision protection
- trade action button scoping and own-panel filtering

## Generated Artifact Rules

After build, inspect the generated userscript when changing build behavior:

```bash
sed -n '1,40p' scripts/binance-orderbook-trade.user.js
```

Required properties:

- metadata block at the top
- one `==UserScript==` block
- preserved `@updateURL` and `@downloadURL`
- readable, non-minified output
- generated `@version` matches `src/binance-orderbook-trade/index.user.js`

## Continuous Close Reduce-Only Recovery

A continuous close round handles `90802022` only when one settled native JSON
response reports `success=false`, its parsed code is `90802022`, and no successful
or additional response was captured. Toast text alone never authorizes recovery.
The first rejection establishes an authoritative same-symbol, same-side position
quantity baseline. Recovery waits the existing three-second readiness cooldown
and reads that quantity again. Confirmed flat ends normally; an increased
position stops the round. A strict decrease permits rebuilding without cancelling.

An unchanged quantity permits one confirmed replacement through the existing
current-symbol, same-close-direction Basic-order workflow. Before selecting
orders to cancel, rebuild the complete ladder plan using the confirmed quantity
and the latest valid DOM closeable quantity. Fills may have reduced the position
before the first recovery read, so unchanged reads do not make the rejected
plan's original total a valid cancellation target. The usual quantity rules and
automatic level reduction apply to this fresh plan. Rejection after that
replacement triggers another cooldown and position read, not another immediate
replacement. If the position still has not decreased, recovery ends with the
native error and a no-progress explanation. Further replacements require a strict
decrease in authoritative position quantity. Submissions and cancellations do not
count as position progress. The guard lasts for the whole active round.

Planning for cancellation does not reset submission progress. Initialize the
new plan's counters only when its execution starts; preflight, cancellation, or
post-cancellation planning failures retain the previous partial count and the
cumulative confirmed submissions. After cancellation, wait and reread the
position before building the execution plan, including a normal finish when
the position has become flat.

After matched HTTP cancellation responses and terminal account events confirm
enough released quantity, continuous recovery proceeds to its existing cooldown
and authoritative position read. It does not wait for the Basic list to remove
the IDs: Binance consumes account events separately when updating that list,
so even its source data can retain a terminal order. The removed 6.5-second
list check could therefore stop a fully confirmed cancellation.

The active continuous task remembers each confirmed cancelled identity across
rounds. Exclude those identities before selecting replacement quantity or
ranking capacity-recovery candidates. A remembered identity never contributes
released quantity to a later batch. An order ID reappearing with a different
symbol or client order ID ends the task, including during capacity recovery;
it cannot enter the outer retry loop. The identity map ends with the task.
Window alignment and all pre-click identity checks still apply when selecting
new cancellation targets. Ordinary replacements keep their existing list
synchronization check; ordinary DOM waits remain event driven.

Near the tail of a close, a selected order often fills between selection and its
click. If a selected order is neither among the current Basic rows nor in the
native list's complete committed data during reduce-only recovery, the batch ends
without clicking further targets and without counting that order as released
quantity (an order that is committed but not rendered still stops the task): absence alone cannot prove the quantity
was freed, because an external order may have replaced it. The runner then waits,
rereads the authoritative position and rebuilds, so a fill continues the task,
while an unchanged position followed by another rejection stops with the existing
no-progress explanation. On 2026-11-10 the previous rule (any missing target is
terminal) stopped a JCTUSDT continuous close at round 624/628 with
`无法确认待替换订单`. The step status reads `待替换挂单已成交或消失，重新核对持仓`.
Ordinary replacements keep stopping on a missing target.

The order can also fill after its click, so its cancellation is rejected and no
matching success receipt exists. During reduce-only recovery an unconfirmed
cancellation then waits up to 3 seconds for the account stream to report that
exact order (symbol, order ID and client order ID) `FILLED` for its whole
preflight quantity. `FILLED` is terminal, so the page keeps the latest 200 trusted
whole-order fill frames and each batch starts from them; a fill that arrives
before the batch, or before the rejection, also counts. With that evidence the
batch ends like a vanished target: nothing is counted as released, a timed-out
request still in flight is no longer awaited (the filled order has nothing left
to cancel), and the runner rereads the position with the same status
`待替换挂单已成交或消失，重新核对持仓`. A partial fill, a foreign
identity, or no frame keeps the existing stop `未收到匹配的成功撤单回执，已停止重新挂单`.
On 2026-11-10 a JCTUSDT continuous close stopped that way at round 202/204 while
its last four close orders filled in the same second and the position reached
zero. Every unconfirmed cancellation logs `Cancellation not confirmed` with the
order ID, the first observed reason (`request not dispatched`, `HTTP <status>`,
`response code <code> status <status>`, `response for another order`, `no
response <error>`, `unreadable response <error>`, `multiple requests`, `response
timeout`, `account event timeout`) and whether the fill evidence arrived.
Ordinary replacements stop on an unconfirmed cancellation even with a fill frame.

Recovery rebuilds use the smaller of the confirmed API position quantity and the
latest valid DOM closeable quantity. Missing DOM quantity never falls back to the
API amount. Symbol, direction, precision, and option context stay pinned to the
active round. Cancel, position-read, context, and unconfirmed-submit errors during
this recovery are terminal and cannot inherit unrelated continuous retry policies.
Once reduce-only recovery begins, the executor disables max-open-orders capacity
recovery too, so a later `90802025` cannot trigger a separate batch of cancellations.
Ordinary single-round clicks and OPEN ladders retain their existing replacement
contract. No additional API or DOM cancellation path is introduced.

## Ladder Taker Orders

The ladder title row reads `阶梯下单 · 吃单` and is followed by `关 / 20% / 50% / 80%`.
The selection is stored per mode, symbol and precision like the other ladder options
(`jh_binance_ladder_{open,close}_taker:<SYMBOL>:<precision>`) and defaults to `关`,
which keeps every ladder order Post Only. It is read once when a round starts and
is not part of the option context, so changing it never interrupts the running round
and applies from the next one.

Taker count (`core/ladder-taker.js`, computed once on a round's first plan after
auto-fit):
- one-round ladder (open or close): `max(1, floor(orders × ratio))` for any nonzero
  ratio, capped at the order count; three orders give 0/1/1/2 for 关/20/50/80%;
- continuous close: the remainder carries to later rounds in the session
  (`carry += orders × percent`, `count = floor(carry / 100)`), so three orders at 20%
  take one market order about every other round. A ratio change restarts the carry.
  Slots that never reached a click return to the carry when the round ends, but at
  most one owed order is kept, and no round takes more than
  `ceil(orders × ratio)`, so failed rounds never build a backlog of market orders.

Each round sends its taker slots first, using the nearest levels' quantities, then
reprices the remaining levels from the current book and places them Post Only. A
taker slot is the native MARKET order: click the `MARKET` order-type tab, require
positive evidence (selected `data-tab-key="MARKET"` and no visible price input), write
only the quantity, wait for the native action button, click, and confirm through the
shared place-order acknowledgement. The form always returns to Post Only in `finally`
before any error propagates; failing to return stops the task.

Before the request leaves the page, the fetch hook checks the native body. A taker
must be `type=MARKET` with the planned symbol, `side`, `positionSide` and quantity
and carry `newClientOrderId`; a ladder maker must not be `type=MARKET`. A mismatch
or unreadable body is rejected locally and stops the task with
`下单请求与计划不一致（<field>），已拦截并停止`.

A taker budget unit is spent before the click. It returns only when no place-order
request left the page (Binance's own reason is reported), or when exactly one
settled HTTP 2xx JSON response has `success: false` and a definite error code (for
example `90802022`, which then enters the existing reduce-only recovery, so the slot
is retried once after replacement). The codes -1000, -1006, -1007 and -1008 leave
the execution status unknown and do not qualify. Any other outcome (timeout, 5xx,
several responses, unrecognized result) may have created the order and is never
retried: the script waits up to 5 seconds for a trusted account-stream frame with
the request's client order ID, continues if one arrives, and otherwise stops the
whole session with `吃单结果未确认，已停止`. A dialog that was not visible before
the click stops the task without confirming it; if the order was already accepted,
it is counted first. Stop after the request left the page counts the order as
placed and then stops; the form always returns to Post Only. A taker rejected with
`90802025` (max open orders) stops the session instead of using the maker capacity
recovery; whether Binance returns that code for market orders is not known.

Ladder makers now also depend on the native place-order body being a JSON string:
an unreadable body or a maker body with `type=MARKET` is blocked. A blocked body is
refused again for 60 seconds so a native retry cannot reach the exchange.

A taker slot is placed as Post Only instead, with
`本轮吃单改为挂单：<reason>` kept on the round's final status (or the wait between
continuous rounds), when the quantity violates
`MARKET_LOT_SIZE` (min, step or max; the max is required) or the private account
stream is not connected. These rule-based skips forfeit the round's remaining
taker slots.

Statistics cover the latest ladder task (a continuous session or one round) and
stay until the next task starts. The `吃单` title tooltip shows four lines: total
taker orders and how many fills were above (long) or below (short) the previous
fill; favorable, unfavorable, flat, no-data and pending counts 5 and 30 seconds
after each fill. The fill price is the FILLED frame's average price; an order that
ends EXPIRED or CANCELED counts as unfilled unless part of it traded, in which case
its average price is used. Favorable is judged for the position, not the single
trade: higher later prices are favorable for longs (also after a close-long sell)
and lower prices for shorts. A continuous session resets the statistics only once
it holds the account lock. Samples read the best price on the
side the order traded against (bid for a sell, ask for a buy) and record no data
when the page is hidden or on another symbol. Per-order detail is logged to the
console with `[TAKER]`.

Live evidence (JCTUSDT, 2026-11-11, one user-authorized 1-JCT market close-long):
the MARKET form has only a quantity input, a slider and an unchecked slippage
tolerance checkbox; no confirmation dialog appeared; the body was
`{symbol, type: "MARKET", side: "SELL", positionSide: "LONG", quantity: 1,
newClientOrderId, placeType: "order-form"}` (hedge mode, no `reduceOnly` field);
the HTTP response was `success: true` with `status: "NEW"`, `avgPrice: "0"` and
`reduceOnly: true`; the account stream sent NEW, then `TRADE`/`FILLED` with `ap`
and `m: false`. The fee was about 0.05% of the notional. One-way position mode was
not observed and is refused by the `positionSide` check.

## Versioning

Bump `@version` in `src/binance-orderbook-trade/index.user.js` when behavior changes, then run:

```bash
npm run build:binance-orderbook-trade
```

Do not bump for docs-only changes.

## Binance Safety Rules

Do not infer trading semantics from stale DOM or old symbol state. Anything involving quantity rules must be derived from the current symbol.

Live DOM/source evidence, DevTools prototypes, state-based browser validation,
and the evidence report contract are owned by
`docs/binance-orderbook-trade-ui-automation.md`.

Do not auto-confirm destructive Binance dialogs. The script may open Binance's native cancel confirmation, but final confirmation remains manual.

USDT account rebalancing has automatic and manually confirmed paths that share the same full-allocation planner. The inline `账户再平衡` action becomes available only after the account-order widget has continuously reported zero positions and zero open orders for two seconds, and a fresh all-symbol futures-position response also confirms that every position is flat. Starting any script trade or cancel task invalidates that eligibility immediately. When a cancellation or continuous-close task ends, readable zero account counters restart the same guarded eligibility window even if the counts did not change during the task or the earlier check was blocked by the running task. A continuous session restarts this window only after the whole session ends, not between rounds. Hidden pages defer qualification until the existing visibility lifecycle observes the account again. The action opens a script-owned native `<dialog>` styled with Binance color variables; it shows current and target balances plus the exact transfer plan, focuses Cancel by default, and proceeds only after an explicit confirmation. Escape and Cancel close it without transferring funds.

Automatic rebalancing runs once per verified globally flat episode after the same
two-second zero-counter window. Both paths allocate total available USDT to
the whole-percent targets in `src/binance-orderbook-trade/config.js` through
`buildUsdtRebalancePlan`. The allocation must name exactly Funding, Spot, and
Futures with whole percentages of at least 1 that total 100; the script rejects
any other value when it loads. The action tooltip, confirmation summary, and
already-balanced status derive the reduced ratio (70/20/10 is shown as 7:2:1)
from the same configuration, so changing the allocation needs no other edit.
Funding and Spot targets are floored to eight decimals; Futures receives the
remainder so the complete balance is conserved. Any of the three accounts may
donate to an underallocated account, including refilling Futures after a loss
once the account has no positions or open orders. Funding and Spot are adjusted
even when Futures already holds its target. At most two sequential transfers
complete the allocation, and unchanged final balances produce an empty plan for
either entrypoint. An empty automatic plan reports that no transfer is needed;
it does not record an automatic transfer completion. The manual action retains
its explicit confirmation.
Automatic qualification, waiting, progress, completion, and failure messages use
the separate `jh-binance-auto-rebalance-status` row. It starts hidden, uses safe
text/title updates, and retains paired Chinese/English status and progress across
locale-driven panel rebuilds. Known script-owned account rejection reasons are
localized at presentation; raw provider and browser diagnostics remain unchanged.
Automatic work never replaces a retained manual trading or cancellation result;
the general flat-account message is shown only when the trading row is idle.

All transfers hold the origin-wide exclusive Web Lock
`userscripts:usdt-account-operation:v1`. Script single orders, cancellations,
ladders, and whole continuous sessions hold that lock in shared mode. A busy
lock refuses a new manual or trading action immediately instead of queuing a stale click; automatic qualification alone waits for the exclusive lock with an
epoch-bound AbortSignal, then rechecks every precondition after acquisition.
Invalidating eligibility cancels a pending lock request;
continuous rounds execute inside their session lock. Ladder and continuous-task
controllers are published synchronously before requesting the lock. Each acquired
lock checks Stop before beginning chart coalescing or trade-form work, so a Stop
in the click turn cannot be lost while the browser schedules its lock callback.
Native Binance actions,
other browsers, and devices are outside this script lock's scope.

Inside the lock, the script reads `/bapi/accounts/v1/private/account/user/base-detail`
with POST `{}` and requires code `000000`, a nonempty string user ID, an existing
Futures account, and an explicit false portfolio-margin flag. It hashes the ID
with SHA-256 and stores only a versioned episode status under
`userscripts:automatic-usdt-rebalance:v1:<digest>`. Missing state initially
qualifies; `consumed` becomes `active` only after a new authoritative nonflat
snapshot. That activity observation uses the same lock in shared mode so it can
observe an ongoing script trade while remaining excluded by transfers. It starts
only while a stored record could change: a `consumed` or completed record, or any
unrecognized value, which keeps the validating path that reports it. Stored
`active`, `in_flight` and `blocked` records alone never request account identity
on account-counter changes during trading. Skipping those no-op observations leaves
persisted episodes and transfer decisions unchanged; it only removes the
eligibility-window restart and shared-lock hold that each finished observation
used to cause incidentally. The
`in_flight` marker is persisted before each transfer POST. It and `blocked` remain
terminal across reloads and later activity; neither a timer nor another tab
clears an uncertain outcome. There is no automatic retry or rollback. Missing
Web Locks, digest support, storage, or identity contracts surface an error.

The optional `outcome: 'automatic_completed'` belongs only to a `consumed` record
and is written after every automatic transfer and its expected balance are
confirmed. It preserves the completed Chinese/English message across reloads and
currency tabs. Status-only records, including deployed records, manual transfers,
zero-transfer episodes, and interrupted plans, retain their existing protection
without claiming automatic success. New authoritative activity removes the
completion marker together with the old episode; the marker never grants
transfer eligibility.

Upgrading the allocation policy preserves existing episode records. A consumed
episode, including an older completed outward-only plan, is not rerun because
its balances miss the new targets. New authoritative account activity is still
required before another automatic episode; an explicit manual rebalance can
adjust the current balances in the meantime.

Every automatic attempt and every transfer step verifies all-symbol positions,
POST `/bapi/futures/v1/private/future/order/open-orders` with `{}`, and POST
`/bapi/futures/v1/private/future/order/open-algo-order` with
`{algoType: "CONDITIONAL"}`. Both pinned order endpoints must return successful
complete arrays, including other symbols. Each step rereads account identity and
balances, then checks the route, eligibility epoch, counters, and script tasks
again synchronously immediately before persisting and submitting. Ordinary
USD-M symbol pages with no query parameters alone qualify. Any query, including
the native copy-trading `cl=public` / `cl=private` modes, prevents automatic
qualification before identity is requested.
The manual dialog opens before exclusive locking, and confirmed execution
revalidates its original account identity and exact previewed balances.

The rebalance path is pinned to the current Binance page bundle contract instead of automating the native transfer dialog. It reads Spot and Funding available USDT from `/bapi/asset/v2/private/asset-service/wallet/balance`, reads the U-M Futures transferable amount from `/bapi/futures/v1/private/future/user-data/getMaxWithdrawAmount`, and submits at most two sequential transfers through `/bapi/asset/v1/private/asset-service/wallet/transfer` with `{ asset, amount, kindType }`. Wallet rows are identified by the stable `accountType` values `MAIN`, `CARD`, and `FUTURE`; `walletName` is localized and must not be used as an identifier. The private transfer BAPI uses those same account codes; do not substitute the public SAPI names `FUNDING` or `UMFUTURE`. It does not save an API key and does not fall back to DOM clicking if this private BAPI contract changes.

For manual full rebalancing, the user must approve one native confirmation that shows the current balances, configured targets, and exact transfer list. After confirmation, the script rechecks all positions, all open orders, and the exact three-account balance snapshot before every transfer. Each successful response must then be reflected by a fresh balance read before the next transfer starts. An intervening position, order, or balance change stops the task; a partial completion is reported explicitly and is never retried or rolled back automatically.

Automatic rebalancing requires visibility again before each transfer. Hiding the tab after the user confirms a manual rebalance does not cancel its remaining transfers. The initial eligibility and preview still require a visible trading page; each confirmed transfer continues to require the same fresh account checks, matching balances, and current trading route while hidden.

Ladder replacement must stay scoped and direction-aware. Automatic replacement may cancel only visible basic open-order rows for the current symbol and the same plan direction (`开多`, `开空`, `平多`, or `平空`). It must not use current-symbol cancel-all for ladder replacement, must not touch conditional/protection orders, and must retry the ladder plan only after the replacement path is validated by current DOM rows.

Ladder preflight and final price/quantity checks resolve one unique active input
pair per synchronous check. Reacquire that pair after every awaited button or
input-stability boundary; never retain it across asynchronous work or native writes.
This avoids duplicate form scans without relaxing live-value or context checks.

User-facing failures must preserve the observed reason instead of collapsing multiple states into one generic message. In particular, an unread openable quantity, a confirmed zero available balance, and a Binance-calculated openable quantity of zero are separate outcomes. Use the panel term `价格精度` consistently instead of exposing the internal `缩放值` name. Cancellation feedback should describe the user-visible action and result, not implementation details such as row-by-row processing, observer roots, context loss, or temporary chart-state manipulation. Combined `A or B` failures are allowed only when the code cannot distinguish the causes; when each branch is already known, report that branch directly.

Ladder order acknowledgement uses two deadlines with different semantics. The script allows 3.5 seconds for the click to start the exact Binance place-order request. After that fetch is observed, it waits up to 12 seconds for the same response because Binance documents a 10-second matching-engine processing boundary. A normal response ends the wait immediately; this is not a fixed per-order delay. A response that remains unknown after the response deadline is terminal and must not be retried automatically because the original order may already exist.

Every observed place-order response keeps a sanitized diagnostic contract: HTTP status, Content-Type, `Retry-After`, `X-MBX-ORDER-COUNT-10S`, `X-MBX-ORDER-COUNT-1M`, `X-MBX-USED-WEIGHT-1M`, JSON parse status, top-level response keys, `data` field names, `success`, `code`, and the bounded error message. Never retain request headers, request bodies, authentication values, order IDs, prices, quantities, or response `data` values. Unknown outcomes remain terminal; diagnostics identify the upstream response but do not authorize retries.

Continuous ladder trading is available only for close actions through `Option/Alt + click`; an ordinary click remains one round. A round is the complete existing ladder-close workflow, including any scoped same-direction replacement and cleanup. After a completed round, the runner must observe the same symbol, close mode, current precision, and native close button as ready before starting a full one-second cooldown. It must validate readiness again after the cooldown; losing readiness restarts the wait and a new full cooldown. Every new round must rebuild its plan from the latest panel profile and live trading context. A failed, stopped, or interrupted round ends the continuous session.

An already clicked ladder or single-order task may continue when Chrome hides the page. Input and action-button stability checks use separate timer tasks while hidden because paint frames can pause; they still re-read live controls, current symbol, mode, precision, price, quantity, and the exact native response before moving to the next order. A single-order draft expires 15 seconds after its trusted price click, so a long background stall cannot later submit its old clicked price and quantity. Continuous close readiness and reduce-only recovery use those same live conditions without treating `document.hidden` as a refusal. Stop aborts an active ladder wait before any later submit. Background timers can be throttled, so neither order timing nor the one-second continuous cooldown has a strict wall-clock guarantee while hidden. A frozen or discarded page cannot run page JavaScript until Chrome resumes or reloads it; this userscript does not resume an unconfirmed order automatically after reload.

Ladder input synchronization normally has a 1200 ms foreground observation budget. If any foreground observation gap reaches 180 ms (including the first and last gaps), an unsuccessful base window receives one supplemental window ending 1200 ms after the original foreground deadline. This gap is an observation policy, not proof of the cause of a browser stall. Supplemental observations use separate 100 ms timer tasks and retain the same field state machine, 180 ms stability requirements, independent observations, and five-write limit per input identity. Late callbacks cannot renew the budget, and visibility changes cannot extend a granted supplement. Ordinary hidden waits retain their observation-count budget; single-order and action-button waits do not opt in. Stop and the existing pre-submit context, Maker, button, price, and quantity checks remain required. The three-second recovery after a safe pre-submit input failure is unchanged.

Continuous-session feedback stays in the shared ladder status row and uses `连续阶梯平多` / `连续阶梯平空` as the stable action name. The action, phase, and counters are separated with ` · ` instead of concatenating `连续` after the ordinary ladder label. `2/3 轮` means two rounds completed out of three started, `本轮 1/3 笔` reports the active or latest partial plan, and `累计 7 笔` reports all confirmed submissions across the session. Confirmed cancellations are appended only when greater than zero. The active round must combine its live progress with the completed-round aggregate; ordinary single-round status text must never overwrite the continuous-session identity. Round outcomes must expose a detached progress snapshot so a terminal continuous summary cannot be overwritten by the latest single-round message.

A session waiting for readiness, stopping, or failing before its first recorded
round has `lastRound: null`. Its status shows zero rounds and zero confirmed
submissions, with no current-plan segment. Formatting this valid initial state
must not fail or invent a round.

The active continuous-close control keeps a compact direction-specific stop action (`停止平多` / `停止平空`) on one line throughout both execution and inter-round waiting. Before the native submit control is ready, the status places `等待按钮恢复` immediately after the continuous action name. Only after the fixed cooldown actually begins may it show `1s 后继续` in that same priority position; this is a static duration label, not a countdown. `停止中`, `已停止`, `失败`, and `已中止` use the same phase slot. The button must not temporarily revert to a ladder-start action between rounds.

When a continuous close receives the observed Binance private-page response `code=90802025`, `success=false`, and the max-open-orders message, classify it as a confirmed no-submit capacity rejection. Load the complete lazy current-orders list before ranking rows; the first 50 rendered rows are not a complete candidate set. Release up to 50 current-symbol, same-close-direction Basic limit orders farthest from the current trade price, preserving the nearest orders that are most likely to complete the close. Resume the same unsubmitted ladder level so already confirmed levels are not duplicated. Permit this recovery once per round; a second confirmed capacity rejection ends the current round and lets continuous mode resume after its recovery delay. Do not use Cancel All, and do not touch open-direction, opposite-direction, conditional, or protection orders. If a selected row disappears because it fills while recovery is running, treat that slot as already released but count a cancellation only after the script confirms its own row-cancel action.

The [desktop native list](https://bin.bnbstatic.com/static/chunks/47252.4bfb3452.js)
receives the full filtered data and renders a separate window that grows by 50 near the bottom.
Read both snapshots from the same mounted host in the active Basic scope. Start ranking only
when loading is false and every rendered item's props match its source item in order, or when
the native list commits its own empty state. Neither the Basic tab count, the scrollbar position,
nor a period without new rows proves completeness. If the contract cannot be verified within
seven seconds, this attempt must not click any row.

Resolve the mounted host's current committed React Fiber before reading the list owner
and rendered window. React 18.2 can leave DOM `__reactProps$` event caches unchanged
after children-only commits; neither that cache nor an arbitrary alternate is the
current list. A memoized row may also retain a different props object with equal
values. Associate each rendered element with its current Fiber using element type,
key, and all own prop values, then verify its mounted DOM order. Reject ambiguous
ownership, duplicate order identities, or an unprovable window. The real React
regression tests cover both stale event caches and memoized rows. During loading,
show the loaded/total count before round counters; during recovery waits, show the
failure reason before the wait duration and counters.

React MemoComponent wrappers (tag 14) cannot prove a row's rendered values: a custom
comparator can commit new outer props while preserving old inner DOM. Reject those
windows. The observed native rows use SimpleMemoComponent (tag 15), whose committed
row props are checked directly. This is a React 18.2 adapter, not a public Binance
extension contract; changed host contracts must remain unavailable for cancellation.

Capacity recovery snapshots each selected row's symbol, order ID and client order ID from its native
React owner. Before each click, reacquire the current Basic row and verify its direction and identity.
The full display key prunes layout checks, while a price or quantity change requires a complete-list lookup by ID.
Allow at most two native cancellations in flight. The observed USD-M Basic endpoint is
`POST /bapi/futures/v1/private/future/order/cancel-order` (manual AINUSDT cancellation, 2026-11-07).
Wait for its matching request to start before clicking the next row; a native confirmation is always manual. Count each successful HTTP 200 receipt once, only when
the request's symbol and both IDs match the expected order and the business response has
`success=true`, `code="000000"`, matching IDs and `data.status="CANCELED"`.
Stop admitting clicks on Stop, scope change, or an unconfirmed result. Drain requests already in flight
(up to 12 seconds per request) before completing the task; a missing or mismatched receipt stays unconfirmed.
Zero known releases end the session. After a partial release, the unfinished ladder can continue;
if a later recovery selects an unresolved order from the same session, end before issuing new cancellations.

Ordinary quantity-based replacement stays sequential and does not wait 240 ms for a row to
stay absent. The same live HTTP cancellation confirmed the order ID and status, but contained
no quantity fields. For quantity, pair that response with the same order's terminal
`ORDER_TRADE_UPDATE` on the page's existing `wss://fstream.binance.com/private/stream`
connection. Match the symbol, order ID and client order ID, and require both execution type
and order status to be `CANCELED`. The released amount is the original amount minus the
cumulative fill (`q - z`), as in [Binance's account stream](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams)
and its [native order adapter](https://bin.bnbstatic.com/static/chunks/35455.143e05da.js).
An HTTP success counts as one cancellation; missing, contradictory or insufficient quantity
cannot authorize replacement orders. Never extend the preselected set to make up a shortfall.
Native row preflight accepts both current Binance `executedQty` forms: decimal strings
retained by the initial REST list and finite nonnegative numbers produced by account
updates. Keep valid strings exact; expand numeric values into non-exponent decimal text.
Validate types and decimal syntax before the decimal parser, which otherwise accepts
trimmed text. Reject invalid inputs and fills larger than `origQty`; a fully filled row
has zero remaining quantity. On 2026-11-07, one AIN list contained two numeric-zero rows
and two string-zero rows, all with string `origQty`. Treating only numbers as valid
stopped replacement preflight before cancellation. Mixed-source browser scenarios must
require quantity from both forms, and terminal account events remain the release proof.
Once the entire target quantity is confirmed, ordinary replacements wait once for the original
IDs to disappear from the Basic list. Continuous reduce-only recovery uses the terminal
receipts, then waits and rereads the authoritative position before rebuilding the plan.
Neither a cancelled order nor list synchronization certifies the trading form balance.
On 2026-11-07, one manual AINUSDT Basic cancellation matched the clicked row, the native
POST and a trusted private-stream event by symbol and both order IDs. Measured from the
start of the request, the browser observed the terminal event at 128 ms and read the
successful HTTP 200 response at 129 ms. Both `x` and `X` were `CANCELED`. The original
quantity matched the native row and the cumulative fill was zero, so the entire original
quantity was released. Partial fills are covered by offline tests.

When selecting account-order tabs, scope to the bottom account-orders tab group. Do not globally match `当前委托` or `Open Orders`.

When a pane is found through `aria-controls`, confirm it contains current-orders controls such as `隐藏其他合约` or `全撤`. Binance may reuse pane ids in unrelated tab systems.

Find `全撤` / `Cancel All` only as a visible, enabled native button inside the verified current-orders scope. Do not depend on Binance utility classes such as `cursor-pointer`; the page's native button classes can change independently of its label and role.

SVG action controls need separate treatment from normal buttons. A visible Binance SVG can have `getClientRects()` dimensions without `offsetWidth` / `offsetHeight`, and the SVG itself may not expose a native `.click()` method. If no clickable ancestor exists, dispatch a bubbling `MouseEvent("click")` and verify the live page state changes.

When orderbook depth is missing, infer missing maker prices from the current displayed orderbook step, not from exchange `tickSize`.

Orderbook precision recommendations must remain non-invasive and on demand. The script may sample latest-trade price movement once when a symbol is first seen, and once again when the user clicks refresh, but it must not keep a background sampling loop alive. Each completed sample round replaces the current symbol's stored sample snapshot; do not merge old sample rounds into a new recommendation. The sample window starts only after latest-trade rows are visible. It must not override Binance's remembered precision or change precision during ladder or single-order submission. Do not use the current visible orderbook display step as recommendation fallback: that value is already affected by the user's selected Binance precision and can turn a deliberately coarse test setting such as `1` into a false recommendation. Do not pick the smallest observed move directly; map moves to precision buckets and choose the dominant supported bucket. Applying a recommended precision requires an explicit user click.

Numeric panel profiles are scoped by current symbol, Binance orderbook precision, and trade mode (`OPEN` or `CLOSE`). Quantity multiplier, ladder percentage, level count, and row span must restore independently for each profile. Direction remains symbol-and-mode scoped, while panel expansion and precision samples keep their existing scopes. An unrecognized precision is not a default profile: disable numeric editing and reject single-order or ladder execution until the live `.orderbook-tickSize` value is available. Ladder planning, repricing, and open-order replacement must retain the captured precision and stop if it changes.

Binance's current orderbook precision control keeps `.orderbook-tickSize` and its `.tick-content` field, but portals the menu to `body`. Its native Select renders `.bn-select-overlay-options[role="listbox"]` inside `.bn-select-overlay`, with `.bn-select-option[role="option"]` choices. The custom field omits `aria-controls`; the native Select source generates a stable listbox ID and passes it through `Dropdown.overlay.props.id`.

`dom/orderbook-precision.js` resolves that ID from the current `.bn-select` host's React owner chain, stopping at the captured tick-size root. The host fiber and its alternate must each yield one identical ID; this is a stable-identity check, not a current-fiber algorithm. Missing, escaped, ambiguous, or disagreeing ownership is an explicit DOM-contract error. Resolve the menu by that exact ID and validate its current structure and visibility; never choose an unrelated numeric menu by a global option scan or by matching its values. This adapter depends on the native React ownership contract verified against the live Select/Dropdown/Tooltips source on 2026-09-12, so future host changes require fresh DOM and source evidence rather than a selector fallback.

Precision jobs and the existing tick-size observer handle only this named contract error, clear stale native options, and show a visible unavailable state. Reading the current displayed precision remains independent of menu ownership. Bootstrap rechecks symbol, root, trigger, and displayed precision after menu cleanup before accepting its option snapshot. Cleanup toggles only the captured native trigger and never selects an option; menus that were already open remain open. The observer remains scoped to tick-size child and text changes, with no document-wide portal observer or background retry loop.

Closed-dropdown precision interaction, Tampermonkey source activation, live test
scope, and state-based browser evidence are specified in
`docs/binance-orderbook-trade-ui-automation.md`.

## Manual Test Matrix

Run manual checks when behavior touches trading flow, DOM selectors, account orders, or Binance rules:

- switch symbol, then immediately click an orderbook price
- test both `LIMIT` and `MARKET`
- test open and close modes
- verify rules-not-ready refuses to order
- verify orderbook precision recommendation comes from latest-trade price movement, not from the current orderbook display precision
- verify the vertical depth profile renders only in Trading View mode, is clipped to the main K-line pane, stays aligned after price movement/zoom/scale-mode changes, does not block chart clicks, and resumes with a fresh symbol-owned session after returning from Basic or native Depth mode
- switch symbols and hide/show the tab while the profile is active; verify no old-symbol bars or stale status survive
- verify the manual precision refresh button starts one longer sample round without auto-applying or scheduling background resampling
- verify the precision apply button changes Binance orderbook precision only after an explicit user click
- verify precision decrease/increase selects the exact native divide-by-10/multiply-by-10 option, restores the corresponding symbol-mode-precision panel profile, and stops at a missing native decade option
- start ladder order, confirm start buttons are disabled while running
- with a small position, run a one-round close ladder at taker 20%: the first order is a market order, the rest are Post Only, the order-type tab returns to Post Only, and the `吃单` tooltip shows the fill; run a continuous close at 50% and confirm market orders appear on alternating counts (1, 2, 1, …)
- after clicking ordinary open and close ladders, hide or minimize Chrome while the first order is pending; verify the task completes the remaining orders with the captured direction, and that Stop prevents a pending hidden control check from submitting
- hide the page immediately after a trusted single-order price click; verify exactly one current-symbol order is submitted after the input settles
- hold a hidden single-order draft for longer than 15 seconds, then resume the page; verify the stale clicked price is refused without a native order request
- hide the page after one continuous-close round is acknowledged; verify the next round can start after live readiness and cooldown, then Stop while its response is pending and verify no additional order starts
- hide the page after confirming current-symbol cancellation or a reviewed USDT rebalance; verify the original scope, manual confirmation, per-step account checks, final balance, and temporary UI restoration
- repeat one background scenario in an actual Chrome/Tampermonkey tab and after minimizing Chrome; record the installed userscript version, hidden/frozen/discarded state, elapsed time, request count, exact exchange response, and refreshed authoritative order/account state
- Option/Alt-click a close ladder button, confirm the next round starts only after the prior round is complete, the native close action is ready, and one full second has elapsed; change ratio, levels, row span, and precision during the wait and confirm the next plan uses the updated profile
- during a continuous close cooldown, make the native close action temporarily unavailable and confirm the cooldown restarts only after readiness returns; confirm Stop also aborts the cooldown immediately
- complete multiple continuous close rounds, then stop both during a round and during cooldown; confirm every active-round status starts with `连续阶梯平多` or `连续阶梯平空` and shows completed/started rounds, live-round order ratio, cumulative confirmed submissions, and no zero-cancellation segment
- confirm continuous close keeps the direction-specific stop button between rounds, places `等待按钮恢复` or `1s 后继续` before the progress counters, and never exposes a start button during the cooldown
- cancel current-symbol orders, verify only Binance native confirmation opens
- keep the native cancel-all dialog open for longer than the former decision deadline, verify the script remains in the dialog-tracking state, then cancel and confirm the original order count and temporary page state are restored
- cancel the native cancel-all dialog through its secondary button, Escape, and backdrop; verify chart and account-order UI state restores immediately without waiting for order clearing
- reload while the native cancel-all dialog is open; verify the next page load restores the original chart OpenOrders setting from the same-tab recovery journal
- replace close ladder orders when existing reduce-only close orders occupy the closeable quantity
- replace open ladder orders only by current-symbol same-direction basic open-order rows; verify no cancel-all path or conditional/protection orders are used
- reach the 200-open-order boundary during continuous close, verify the script fully loads the lazy current-order list, cancels at most 50 farthest current-symbol same-direction Basic rows, preserves nearest rows, resumes the rejected unfinished level without duplicating confirmed levels, and moves to the next round after the recovery delay if the same capacity rejection repeats in that round
- verify SVG cancel controls work when the visible cancel target has no native `.click()` method
- verify account-orders tab and hide-other-symbol state are restored
- verify the userscript version or live behavior after a Tampermonkey update before continuing live tests
- hide the tab and return, then verify the panel recovers
- switch the Binance page from Chinese to English and back without reloading; verify panel headings, controls, tooltips, current status, round/order counters, and account-rebalance confirmation switch immediately while the current task and saved profile remain unchanged
- on an English page, trigger one expected business refusal and one raw script exception; verify the business status is English while the raw exception text and Binance error code remain unchanged and copyable

If a path was not manually tested, state that in the final summary.

## Release Handoff

Remote release, commit, PR, and publish sequencing is owned by
`skills/userscript-release/SKILL.md`. Keep this manual focused on the orderbook
source and business contracts; use the release skill for the stage authorized in
the current conversation. Browser/Tampermonkey post-release validation is
owned by `docs/binance-orderbook-trade-ui-automation.md`.
