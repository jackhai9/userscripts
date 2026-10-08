# Binance Strategy 29 Bollinger Signals

For component diagrams, shared gateway ownership, ports, and operator usage, see
the [signal gateway architecture guide (Chinese)](signal-gateway-architecture.zh-CN.md).

## Scope and Installation

The standalone `binance-strategy29-bollinger.user.js` owns the local
Bollinger/SMA60 observer and its read-only server summary. The existing Strategy27
installation supplies only shared authenticated transport.
Source is `src/binance-strategy29-bollinger/`. The local observer reads only
already-loaded native chart candles. The summary reads the authenticated
unified loopback gateway; it does not call Binance market-data or account APIs,
submit orders, rotate hidden charts, or add remote events as chart drawings.

Install Strategy29 0.5.9 with orderbook 2.7.199 or later, or use it alone.
Install CorsairQuant signal client 0.6.7 for the remote summary.
Do not combine it with the embedded observer in orderbook 2.7.198.
After updating/disabling the old script, reload the page. An embedded observer
is an explicit conflict: Strategy29 stops and displays an upgrade/reload notice.
If the old script loads later, the observer stops and clears its own overlay.
This is not a supported compatibility mode; Strategy29 never removes old-script
or user drawings.

The orderbook runs in page context. Strategy29 runs in a Tampermonkey
sandbox with read access to its previous non-sensitive preferences, and passes
`unsafeWindow` explicitly to the chart runtime. Gateway credentials belong only
to the separate unified client's private storage. The orderbook registers a
synchronous boolean drawing-busy predicate under
`Symbol.for('jh-userscripts.chart-mutation-owners')`; it unregisters on permanent
page teardown. A missing owner means there is no coordinated orderbook instance,
not a guessed order/account state. No task objects or financial actions cross
this boundary. The orderbook retains its native save-controller protocol. Strategy27,
Strategy29 and Strategy31 do not install or arm that controller; their SVG presentation never
enters the native drawing model. The ownership record validates protocol version 1
and rejects incompatible versions. These are coordination
contracts between trusted scripts, not a security boundary against page code.

The standalone entry has a per-page singleton on `unsafeWindow`. One poll
discovers charts/routes and evaluates the existing monitor. Hidden documents and
BFCache pagehide pause it; visibility/pageshow resumes it. Permanent disposal
removes its listeners, aborts an in-flight summary request, and invalidates
pending overlay work. Non-trading routes perform no candle exports or gateway
requests.
The read-only diagnostics retain one `lastLocalFailure` after local fatal cleanup
or stop. It records the export/reconcile/detect/render stage, thrown value type,
bounded name (64 characters) and message (512 characters), route, interval and
pre-cleanup counts. String rejections supply the message directly; missing string
name/message fields are null, and arbitrary rejected objects are not serialized.
Each field is read once. A throwing host accessor leaves that field null and adds
its name to `unreadableFields`; this diagnostic boundary cannot replace the original
monitor failure with a property-read failure.
If a host Proxy throws during rejection classification, the monitor stops that
context and records `classificationFailed: true`; normal fatal errors record false.
The frozen detector/core source and its direct invalid-context assertion remain unchanged.
A later healthy context does not clear historical failure evidence. Missing
exact candle timestamps are excluded by the overlay projection rather than
snapped to another candle.
It describes the last fatal event, not necessarily the active context. It does not
store stack traces, candles, requests or gateway credentials, and is never persisted
or sent to the remote service. Recoverable snapshot races leave it unchanged.
Each overlay instance owns its DOM and exact event subscriptions independently.
Strategy27 uses the same SVG renderer with its own event and compound placement policies.

## Panel Language and Position

The summary follows the existing pathname locale contract: `/zh-CN/` uses Chinese,
while English and other routes use English. Strategy29 imports the existing pure
orderbook locale helpers without modifying orderbook or shared runtime behavior.
Headers, connection and selection states, signal names, processing labels,
notification totals and empty states have bilingual copy. Technical
identifiers and arbitrary server diagnostic details remain verbatim, with localized
labels. Chart arrows contain no textual labels.

A same-symbol locale change rerenders retained status, events and connection text
without retiring requests, rebuilding the client or resetting its cursor. Gateway
configuration menus belong to the shared provider in the Strategy27 installation.

Drag the header with the primary mouse button. Header buttons do not start a drag.
Mouse release or window blur saves only `{left, top}` under the private userscript
key `strategy29SummaryPanelPosition`; route changes and page reloads restore it.
The panel clamps its position after viewport, content, collapse and language changes.
The title bar captures the primary pointer so dragging continues across the chart
iframe. Pointer release, cancellation, lost capture and window blur finish once;
destroying the panel releases capture and removes its listeners. Invalid persisted
coordinates fail explicitly. No credentials cross the page boundary.

## Automatic Cross-Timeframe Server Summary

Strategy29 owns the summary panel, requests, lifecycle and private panel position.
There is no summary enable/disable menu: the summary starts automatically when
the shared gateway provider is available. Gateway origin and secret remain in
the existing Strategy27 installation's private storage. Strategy29 receives only
allowlisted public observation responses through the shared page capability;
it has no credential prompt or privileged network grant.

The panel follows only the current Binance route symbol but shows
every timeframe watched for that symbol by the server. It therefore continues to
show 1m, 1h, and other server states and recent signals regardless of the chart
interval currently open. It labels delivery counts as global because those
counts cover the complete server outbox rather than just the current symbol.
Server status freshness and signal times remain separate from local chart state.
Panel timestamps explicitly use `UTC+08` rather than inheriting the browser's
ambient timezone.

The main view shows the current symbol, connection, monitoring selection,
configured intervals, event-check time and recent signals. Each configured
interval retains up to three signals, then all retained rows share the same
descending close-time and sequence ordering. With six configured intervals the
maximum is 18 rows. An interval with no retained events is named separately;
the panel never fills its quota with another interval or synthetic signals.
The default-collapsed Diagnostics section contains specification compatibility,
the local detector fingerprint, selection details, stored processing progress
and global delivery totals. Processing rows sort by interval duration, from
minutes through days and weeks. Actionable connection, compatibility, selection
and processing failures remain visible in the main view; raw processing reasons
remain in Diagnostics. Delivery totals describe the server-wide notification
outbox and do not establish whether notifications are enabled.

Observer API compatibility is `29_2_spec_v4`; durable event records retain
`29_2_spec_v2` and are validated independently; the chart detector retains the frozen
V1 reference and unchanged hash. The server independently ranks an activity-score
universe and applies its configured intervals. Each status poll replaces current
membership: removed symbols show "Symbol is not watched by the current selection" while
retained event history remains visible, and re-entering units can show warming
until producer readiness and historical baseline complete. The browser does not
choose markets or infer intervals from other strategies.

The exact status contract includes public `universe` metadata: generation, refresh
state/reason, selected markets, configured intervals, selected/ready/pending unit
counts and refresh timestamps/age. It shares the server SQLite snapshot with unit
progress and delivery counts. The panel distinguishes unavailable selection,
selected units awaiting observation and a healthy selection excluding the current
market. Unavailable selection suppresses healthy-looking processing rows while
retained events remain visible. A never-successful refresh displays no successful
time; generation-mismatched producer readiness contributes no ready units.
The aggregate is labeled `live units ready`. Per-period rows show the last stored
processing status, with `ready` displayed as neutral `Processed`; they do not
certify current live readiness. A stored ready row with zero live-ready units is
valid during producer-generation or admission/baseline transitions and must not
be rejected by the client validator.
Refresh metadata must match the reported state: successful and stale selections
require success time, age and expiry; failed refreshes require an error time;
missing or incompatible facts carry null metadata. Fail-closed selection may
retain a complete prior-success group. Expired selection can originate from fresh
or stale facts. Clock rollback does not invalidate otherwise coherent metadata.

Authentication failure affects only the remote summary, not local chart detection.
Invalid provider state stops the remote module at its job boundary, retires its
panel and request, and displays a localized failure notice. Local sampling keeps
running. The stopped module does not automatically retry invalid configuration.
The shared provider preserves the Strategy27 installation namespace, update URL
and private gateway keys. Update both existing scripts and reload. Both load
orders are supported. Without the current provider, Strategy29 displays a localized
update/reload notice while local chart detection continues. Previous host-owned
summary releases do not receive the retired readiness handshake, so they cannot
start a second panel beside the current Strategy29 runtime. Runtime version 4
refuses to reuse the legacy singleton. The final position saved by the old
Strategy27 host is handed back once as a strictly validated nonsecret coordinate
record. Strategy29 saves its own completion version and position; later reloads
preserve subsequent Strategy29 drags instead of reapplying the old host position.
An invalid handoff stops only the remote summary without copying a position or
completion marker. Credentials and the retired enable preference never migrate.

The public transport accepts only exact fixed status/event routes and validated
query fields. Requests carry no caller-selected origin, headers or body. The
provider owns authentication, redirect rejection, bounded response size, a
10-second deadline and cancellation. A settings revision retires old responses
before they can advance Strategy29's cursor. Unicode letter/number base symbols
retain their exact canonical identity, including symbols such as `牛来/USDT:USDT`.

The unified gateway reports `module_disabled` when the server module is intentionally
off, `gateway_unavailable` when an enabled fixed backend cannot be reached, and
`database_unavailable` only for the backend's own database failure. The panel labels
these separately. Installing the unified client does not activate server monitoring.

The browser polls status first and then consumes at most two event pages per
scheduled poll. A new route requests `mode=latest_per_timeframe&limit=3` for its
canonical symbol. The server reads its configured intervals, the three newest
retained events for each interval, and a global increment cursor from one SQLite
snapshot. Current market membership does not filter retained event history.
Subsequent increments can contain no matching events while still advancing that
cursor. `cursor_expired` clears only remote rows and requests another per-interval
snapshot. Rows are retained independently for each interval by descending signal
close time, with descending durable sequence breaking ties, and then displayed
in that same combined order. The snapshot response remains sequence-ascending so
the global increment contract is unchanged. Historical backfills cannot evict
newer signal times merely by being inserted later.

The client remembers the last nonempty set of configured intervals. A change to
that set clears remote rows and resets the cursor before requesting a new
snapshot; order-only changes and selection generations do not reset it. An empty
configuration during unavailable selection preserves the last known set and
history. If initialization consumed events before any configuration was known,
the first nonempty set also resynchronizes. A failed resynchronization leaves the
cursor unset. Status and events are separate requests that can straddle a server
restart, so snapshot validation uses the protocol's 13 supported intervals and a
39-row maximum, not the preceding status response's interval count. Each interval
is still capped at three and the snapshot must have `has_more: false`.
An empty increment advances the event-check timestamp without sorting retained
records or replacing their DOM rows. Nonempty increments sort once for retention
and rendering; locale changes still rebuild the translated rows.
This requires the server's explicit per-interval snapshot
query contract; a server rejecting it stops the remote context visibly.
Publish the V4 observer API contract before the client, then verify installed
source identity and reload before remote acceptance. Publication of either
component does not enable the observer, gateway, or notifications.

Route changes, page hiding, disabling, and disposal abort the owned request.
Hiding retains the current client, cursor, and panel rows; resume uses a fresh
request owner and continues increments. Route/settings changes retire the old
context. A permanent local runtime failure disposes the remote summary and removes
its panel; visibility or pageshow cannot revive it. Responses check their original abort signal before changing client state;
completion handlers also check request ownership, so an old request cannot publish
or clear the in-flight flag of resumed work. No extra recurring timer is installed:
the existing one-second runtime sample applies a five-second remote gate.
Only the first request displays `Connecting`. Subsequent background polls retain
the last completed connection state until the new result arrives; genuine
unavailability and transport errors remain visible during the next request.

Transport failures and a temporarily unavailable database remain retryable
remote states. Authentication, request, JSON, and response-contract failures
stop only the remote context until it is restarted through a route or settings
change. None of these states stop the local detector or remove local markers.
The status validator first checks the shared schema/spec/time identity envelope.
A different spec exposes only those three fields; no incompatible unit, selection
or delivery payload is interpreted. The panel clears current health rows, displays
the mismatch and preserves retained events; event consumption is blocked. Matching
V4 API responses require every exact field and a coherent refresh state/reason
combination. An unknown schema envelope remains a contract error. The local reference hash is displayed and exposed
for audit, but the current server status schema does not carry a hash, so the UI
does not claim hash-level remote parity.

## Bidirectional Bollinger Alerts

The chart alert is timeframe-agnostic and evaluates closed bars only. It supports TradingView second, minute, hour, day, and week resolutions; month resolutions are intentionally unsupported because their duration is calendar-dependent. It scans every closed bar already loaded in TradingView and does not issue a separate market-data request or force the chart to load older history. The active-page poll exports the current window once per second. Detection runs again when the `count:firstTime:lastTime` window or any closed-bar OHLC content changes; unchanged content is compared against a compact numeric snapshot instead of serializing the whole history on every poll. The cached signal set is projected onto a script-owned SVG layer. Loading older chart history expands the annotated range even when the latest bar is unchanged. Viewport changes reproject visible markers independently of the detector poll.

A bearish setup requires the Bollinger middle line to cross down through SMA60 while the band center is declining. A bullish setup is generated by the exact price-axis mirror: OHLC values are transformed as `open=-open`, `high=-low`, `low=-high`, `close=-close`, and the indicator axes are transformed as `middle=-middle`, `upper=-lower`, `lower=-upper`, `ma60=-ma60`. This yields a middle-line cross up through SMA60, pre-cross closes in the middle/upper channel, and post-cross middle-line support without maintaining a second drifting detector. Both directions use the same warning/confirmation/reversal lifecycle. Bearish warning dots are red and remain above the candle high; bullish warning dots are green and remain below the candle low. Bearish confirmation is a red down arrow and bullish confirmation is a green up arrow. A reversal uses the opposite colored/directional arrow. Mirrored marker prices remain on the corresponding side of the candle (bullish confirmation below the low, bearish confirmation above the high). If overlapping setups in one direction reverse on the same candle, the newest setup owns that direction's visual reversal; opposite-direction signals retain distinct IDs and are both rendered.

The current Binance `trading-platform-30` chart runtime exposes `exportData()` as row-major numeric-keyed OHLC objects. The parser deliberately enforces that observed contract and fails if the schema changes. It validates the entire export before filtering closed bars: intraday timestamps must lie on the UTC interval grid, D/W timestamps must be at UTC midnight, weekly timestamps must be Mondays, and positive timestamp deltas must be multiples of the bar duration. Missing bars remain valid; multi-day and multi-week feeds do not have to share the Unix epoch's phase. Off-grid or incompatible-spacing snapshots are recoverable and never reach detection.

`dataReady()` alone is insufficient: Binance's chart implementation checks whether data is nonempty, not whether an interval switch has completed. A chart-owned interval session subscribes to `onIntervalChanged()` and `onDataLoaded()`. An interval change increments a revision and blocks exports until data completion; callbacks never export or mutate drawings. Every asynchronous export and scheduled overlay redraw revalidates the session identity/revision as well as chart instance, route symbol, and resolution. This rejects stale work even after a rapid `1S -> 1 -> 1S` switch. Stop, page hiding, teardown, and chart replacement dispose the session and remove only the script-owned overlay.

Each interval session uses a private subscription owner token. The observed Binance chart integration calls `unsubscribeAll(null)` on both data-loaded and interval-changed channels when binding its own callbacks. Sharing the null owner lets that native initialization silently remove our callbacks, leaving a running monitor stuck waiting for data that has already arrived. Cleanup uses the same private token and exact callbacks; it never clears native or other-script subscriptions.

The exposed chart API can exist before its internal model during initial loading. Target discovery and current-target validation use the observed Trading Platform 30 `hasModel()` contract before reading `resolution()`. A missing model is an expected not-ready state, not a fatal error; the existing poll resumes when the model exists. Model readiness does not replace the interval/data session guard.

Indicator calculation traverses each fixed window directly without allocating sliced/mapped close arrays for every bar. Summation order and detector thresholds remain unchanged.

Markers use a script-owned SVG inside the main-series pane's canvas container. The overlay is clipped to that pane and has `pointer-events: none`; it does not cover the price/time axes or intercept drawing interactions. Each direction allows 1,000 signals, for 2,000 total. Validation rejects an over-limit or malformed snapshot before publishing it. Offscreen signals remain in the bounded signal set but create no SVG nodes. Keyed nodes are reused, and unchanged attributes are not rewritten.

Projection uses the inspected TradingView model: exact `timePointToIndex(time, 0)`, candle timestamp readback, `indexToCoordinate`, and the main series' `priceToCoordinate(price, firstValue)`. Missing candle times are omitted rather than snapped to adjacent bars. Scale conversion belongs to TradingView, including logarithmic and inverted axes. The current model, series, scale and pane identities are checked before drawing; a changed projection contract stops the context instead of guessing coordinates.

Time-range, bar-spacing, offset, price-range/mode/height, candle-data and pane-resize events coalesce into one animation frame. There is no continuous animation loop or added market-data request. Interval invalidation immediately hides the old layer, even while an orderbook owner is busy. Hiding the document cancels pending redraw work; clear removes the exact instance's SVG, listeners, observer and frame. Cleanup does not need native drawing ownership because it never touches native entities. Rendering still respects the existing orderbook mutation gate. Asynchronous redraw errors clear presentation and enter the existing monitor failure diagnostics or Strategy31 stopped notice.

`window.__TM_STRATEGY29_DEBUG__.diagnostics` exposes timer/task presence, readiness, cached/rendered counts, the aggregate mutation gate and non-sensitive remote state. `markerOverlayStats` reports attached state, signal/visible counts, rendered frames, subscriptions and a pending frame. These are rendering counters, not successful database-save counts. Diagnostics contain no secrets, requests, order details or persisted candles and add no periodic work.

### Why overlays do not use native drawings

Binance's observed integration schedules `widget.save` 100 ms after non-click/non-move drawing events. `disableSave` excludes temporary entities from saved JSON but does not suppress the events. The previous marker controller coalesced serialization while preserving every callback: a 2026-10-05 snapshot showed 2,000 save requests/callbacks and 102 serializations. Those counters did not establish that asynchronous database writes had completed.

Strategy27, Strategy29 and Strategy31 therefore create, update and remove no native drawings and do not wrap `saveChart` or IndexedDB. The shared native save controller remains available to the orderbook. Its serialization coalescer delivers every accepted save callback with an independent snapshot; it does not merge downstream database writes. Manual-drawing persistence remains owned by Binance.

During the same incident, `chart_futures` database opening succeeded but readonly requests remained pending; `chart_spot` reads completed. Disabling scripts and reloading OPN alone did not recover it. Reloading the remaining old US page allowed OPN to recover without another refresh, browser restart or database deletion. This identifies the chart configuration read as the immediate blocker and demonstrates a lifecycle relationship, but does not prove a particular script held a lock or was the sole underlying browser fault. Removing marker-generated save traffic addresses the independently verified write amplification. Do not describe this as proof that all possible IndexedDB hangs are fixed.

## Verification

During implementation and commit/push preparation, run the affected Strategy29
checks with `npm run test:binance-strategy29-bollinger`, rebuild affected artifacts,
and run `npm run check:binance-userscripts`. For cross-script coordination changes,
include both affected single-script builds and the relevant `npm run test:ui`
scenarios. Full-suite release validation and reuse of passing local results are
defined in `skills/userscript-release/SKILL.md`.
The cross-script browser fixture loads the actual generated artifacts in both
orders. The sandbox entry test proves that Strategy29 installs its singleton on
the page `unsafeWindow`. Remote contract/controller tests cover strict symbol
round trips, bounded cursors, spec mismatch, 409 reset, stale response ownership,
and failure isolation. Independent bundle tests cover controller identity, active
owners, save drain, protocol conflicts and unregister. Marker tests cover exact candle placement, historical coverage, scale changes,
interval invalidation, hidden-page cleanup, independent instances and zero native
drawing/save calls. Browser tests exercise actual SVG rendering and isolated
cross-page IndexedDB readback; these are not production database tests.

Before a separately authorized installation/release, inspect both real installed
sources, reload once, and verify both load orders, chart interval switches,
hide/show, old-version conflict notice and the minimum non-financial orderbook
path. Fixture results do not certify the current native TradingView build.
