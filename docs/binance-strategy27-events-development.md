# CorsairQuant Signal Client and Strategy27 Event Annotations

This document owns the Strategy 27 gateway, chart-rendering, and entity
contracts. Generic Codex/tool timeout and connection policy belongs to the global
rule and shared knowledge runbook.

## Purpose

`binance-strategy27-events.user.js` is a rendering client for the Strategy 27
V10 live projection. The VPS remains the only market-data and event-analysis
authority. The userscript opens no Binance market-data WebSocket, uses no
Binance API key, and does not recalculate the four force groups.

Version 0.5.0 uses the existing installation as the CorsairQuant signal client.
Strategy29 remote ownership starts only after the local-only Strategy29 companion
publishes a valid page-scoped readiness record. Without it, the host reports
`waiting_for_companion` and leaves any legacy Strategy29 remote owner untouched.
This handshake is separate from one-time preference migration, so later reloads
continue to use the host's saved choices. Update both existing installations and
reload to complete a staged upgrade.
The historical installed script name is retained to preserve update identity.
Its private gateway URL and secret are shared by the Strategy27 consumers and
the independently controlled Strategy29 remote summary. The installation namespace
and update URLs remain unchanged; update the existing installation in place.
The retained `strategy27GatewayOrigin` and `strategy27GatewayAuthSecret` storage
keys are the single credential source, avoiding a second setup during migration.
The standalone Strategy29 script continues to own its local detector and has no
gateway request or configuration permissions. New remote modules must receive
the host's private settings adapter rather than creating another credential store.

The script reads an authenticated, loopback-only long-poll endpoint through an
SSH local forward. It draws transient entities only when the Binance route,
TradingView symbol, and `1S` chart interval all match the requested Strategy 27
symbol.

## Operator Setup

1. Keep an SSH local forward open from `127.0.0.1:<local-port>` to the VPS
   Strategy 27 gateway on `127.0.0.1:8765`.
2. Install `scripts/binance-strategy27-events.user.js` in Tampermonkey.
3. Use the CorsairQuant userscript menu to set the loopback gateway origin. The default is
   `http://127.0.0.1:18765`.
4. Use the CorsairQuant userscript menu to set the gateway installation secret. Tampermonkey
   stores it in this script's private value storage; it is never embedded in
   source, URL parameters, chart text, console messages, or status text.
5. Open the matching Binance futures route and select the one-second chart.

The secret prompt is captured from the Tampermonkey sandbox before page code can
replace the page prompt. No credential is passed through page globals, events,
localStorage or diagnostics. Strategy29's only public migration record contains
enabled state and panel coordinates, validates an exact schema and is copied once
without overwriting destination preferences. Its summary follows the route symbol
on any chart interval and remains visible while locally disabled. The host's
existing context timer samples it; visibility and pagehide abort pending summary
requests without resetting the retained cursor. A summary failure is contained at
the module boundary and does not stop the independent Strategy27 consumers.

Use the existing forward for `/v1/strategy29/status` and `/v1/strategy29/events`.
The unified gateway's disabled module state is intentional and does not require
another secret. Server monitoring and notification activation remain separate.

The macOS operator machine keeps this forward under a `launchd` user agent so
the SSH process is restarted after sleep, network changes, or a broken
connection. The ordinary browser client treats `GM_xmlhttpRequest` transport
errors/timeouts and protocol-validated HTTP 503 unavailability as recoverable:
it retains the current cursor and displayed history, shows a reconnecting status,
and retries after two seconds. A bootstrap 503 remains in bootstrap; a live
`redis_unavailable` response retries the same live cursor. Stale cursors still
use the reset/bootstrap protocol while retaining verified display history. Other HTTP/gateway errors, malformed
JSON, cursor violations, and rendering contract failures stop immediately.

A terminal ordinary-job failure suspends drawing and polling without deleting
previously verified markers or panel history. Pending candle waits and late
creations/repairs lose presentation ownership; late entities are removed.
Retained history is frozen evidence, not a live connection, and the visible
error remains until explicit recovery or a context change. The existing context
timer continues two-hour retention pruning but does not repair a suspended
layer. Use the `Reconnect Strategy 27 and restore history` userscript menu after
resolving the error to start a new context and restore the gateway snapshot.
Manual clear remains available and does not dismiss a terminal error.

## Rendering Contract

- An ordinary event receives one chart marker when a directional observation
  first appears. Its first marker direction, color, time and position remain
  immutable. Neutral observations do not create yellow flags. Later updates
  refresh panel facts without changing that directional marker.
- Every time-based marker waits for its exact matching one-second candle before
  creation, because TradingView otherwise adjusts a
  missing timestamp to the nearest available bar. Directional markers use that
  candle for placement instead of the event response midpoint: an up arrow sits
  eight screen pixels below the candle low, and a down arrow sits eight screen
  pixels above the candle high. Rendering waits on TradingView's `dataUpdated`
  event for at most three seconds. Order-book events can occur during a second
  with no trades, in which case Binance never publishes an exact one-second
  candle; after the wait, the marker is anchored to the latest prior candle so
  it never depends on a future bar. A malformed candle or the absence of both an
  exact and prior candle stops rendering with an explicit contract error.
- A single draggable panel shows the selected event's four-force facts,
  immediate price response, trigger reasons and close reason, but no future
  outcome horizons. Dragging the header keeps the panel inside the viewport and stores
  its last position in Tampermonkey private storage. This prevents persistent
  multiline notes from overlapping one-second bars while preserving the
  operator's preferred placement across chart context changes and reloads.
- The panel keeps the eight most recent events. It follows the newest event by
  default; selecting an older row pauses that behavior until `最新` is pressed.
- Notional values use compact `K` and `M` suffixes. Ratios use at most two
  decimal places. Basis-point values normally use one decimal place and use two
  only below one basis point. Binary floating-point tails and internal trigger
  keys are never shown in user-visible text.
- Incomplete or input-gap facts are marked as incomplete and carry no
  directional conclusion.

Every created entity uses the second obtained by flooring the projection's
`event_time_ms`. The script reads the entity point back after each create or
update. If TradingView shifts the point to a different bar, the entity is
removed and visualization stops with an alignment error.

`triggered_at_ms` is the trigger bucket's start boundary. The browser requires
`trigger_snapshot.bucket_start_ms` to equal it; the bucket end remains the
exclusive end of that same measurement interval.

For a closed event, `latest_snapshot` is the last eligible event bucket retained
before closure. `event_closed.event_time_ms` carries `active_end_at_ms` and can
be later than that snapshot's end when an ineligible bucket advances the event
to its lifecycle deadline without joining the event.

The script stores only its own returned marker IDs and its bounded in-memory
panel records. Route, symbol, interval and manual clear remove only those
transient entities. Ordinary stream epochs and cursor resets reset protocol
validation while preserving verified display history in the same chart context.
The independent ordinary display registry retains at most 80 events (including
neutral events), evicts by last observation time with event ID as the tie-break,
and expires after two hours without another observation. Reset messages and
bootstrap replay do not refresh its observation timestamps. Protocol lifecycle
pruning does not delete this independently bounded display history.
Old panel records display Historical until that event receives another accepted
observation; this flag changes neither the last received event status nor the
protocol phase. Same-event replay merges by the source event ID, which is stable
across transport epochs, and preserves the first directional marker. A bootstrap
merges its records instead of deleting history absent from the new epoch's
snapshot. Full reload still depends on the server snapshot and cannot recover
previous-epoch records that were never retained by the server. Sequence/cursor contract violations stop the
ordinary job with an error while retaining its already verified history.
Marker count and age are bounded on the chart; the panel retains at most eight
events.

The existing one-second context check also reconciles retained records with
TradingView's `getAllShapes()` list. A host-evicted ordinary marker is restored
using its original resolved point and drawing options, even when no new gateway
message arrives. Compound candidates restore only missing parts of their
icon/label pair, preserving the original slot and surviving entity IDs. Each
record shares one in-flight repair across timer and message callbacks. Cleanup
skips IDs proven absent, while native removal failures still stop the owning job.
Manual clear, context changes and display retention eviction invalidate ordinary
repair ownership; compound resets also invalidate their own repair ownership;
late-created entities are removed instead of resurrecting retired records.
Reconciliation does not refresh retention timestamps. Drawings remain transient
and use `disableSave: true`, but a full page reload requests a bounded display
snapshot from the gateway before long polling and rebuilds retained ordinary and
compound records. The snapshot and its continuation cursor are committed with the
same Redis operation, so live messages after that cursor cannot be skipped. A
panel history reset is a separate lifecycle event, not evidence of native entity
eviction.

## Compound Candidate Extension

ADR 032 in CorsairQuant owns the server-side rule and transport contract. The
browser does not reconstruct candidates from ordinary events or recalculate
market evidence. The client, lifecycle, panel, native chart layer and optional-job
controller are wired into the entrypoint and tested together. The source and
generated install artifact are version 0.5.0 with identical metadata headers.
The generated artifact passes syntax, release-contract and isolated execution
checks, including candidate delivery, paired entities, clear and context stop.
Binance operator-page validation remains outstanding. Server/gateway rollout
must precede browser publication; release status is tracked in
[CorsairQuant PR 324](https://github.com/jackhai9/CorsairQuant/pull/324) and
[userscripts PR 267](https://github.com/jackhai9/userscripts/pull/267).
Do not treat source unit tests or the panel fixture as deployment evidence.

- The compound client has a separate cursor for
  `/v1/strategy27/compound-candidates`. Non-JSON HTTP 404 disables only that
  client until restart. Validated HTTP 503 `compound_unavailable` and
  `redis_unavailable` clear only compound state and retry after two seconds.
  Typed request transport failures retain the cursor. Other contract failures
  are not retried. Cancellation is checked after request and async validation
  boundaries so a stopped context cannot publish a late status.
- On startup and after a stale cursor, each client first requests its dedicated
  `/bootstrap` endpoint. The ordinary snapshot preserves the latest event facts,
  the first directional marker evidence and the latest outcome per retained
  event. The compound snapshot preserves immutable candidates by original
  decision time. Both snapshots are bounded to 80 records and two hours; the
  browser applies them at the gateway's fixed observation time before continuing
  from the returned Redis Stream cursor.
  Ordinary bootstrap may replay a retained active marker envelope immediately
  before the same event's latest outcome; only this explicit bootstrap phase
  treats the omitted close transition as closed. Live polling still requires the
  normal close-before-outcome lifecycle.
- Canonical Python/JavaScript SHA-256 identities are checked against synthetic
  Python detector fixtures. Wire decimals remain exact strings for validation;
  numeric conversion is limited to presentation. Small nonzero display
  amounts retain significant digits instead of rounding to zero.
- The independent lifecycle holds at most 80 candidates for two hours measured
  from the original decision time. Exact replay does not refresh that age or
  create another marker. Heartbeats do not clear history. Epoch changes require
  `stream_state`; symbol filtering permits increasing sequence gaps, not
  regressions. Capacity eviction follows decision time and candidate ID with a
  monotonic cutoff so old replay cannot resurrect evicted observations.
- Base rule identity is `(family, direction, profile_id)`. Reinforcement also
  includes `parent_candidate_id` in its displayed lineage identity. Each
  occurrence has its own candidate ID; different rules or parents at the same
  second are never collapsed into one record.
- The same draggable panel has independent eight-row ordinary and compound
  histories. Ordinary clear/update operations do not clear compound history or
  its connection-status element. Both histories can be selected; follow-latest
  chooses the latest observation without removing either list.
- The compound controller owns its request cancellation and terminal error
  boundary. It constructs its chart layer only on the first accepted candidate,
  so a missing compound chart capability cannot fail ordinary startup. A stream
  state clears compound views without erasing the newly accepted epoch/sequence;
  a gateway reset or explicit unavailability resets both lifecycle and view.
  Manual clear preserves replay bookkeeping but invalidates pending presentation.
  Age eviction also invalidates a pending draw, and a second age check runs after
  drawing before publication to the panel. The existing context timer calls
  `reconcile()`, which prunes before repairing missing entities; there is no
  second timer. Route/interval changes and disappearance
  of the visible chart stop both clients before destroying the shared panel.
  The clear menu clears both views without restarting either client.
- Native cleanup attempts every owned entity once and aggregates failures.
  Cleanup failure stops only the compound job, clears its panel records and
  reports the original and cleanup errors without interrupting ordinary
  shutdown. An asynchronous drawing failure after context retirement is retained
  as the controller's `lastError`, without writing into a retired panel.
- Each candidate owns a 36-pixel native icon arrow and a short text label:
  dark red down/`候选高` above the candle, dark green up/`候选低` below it.
  Annotation direction remains `arrow_down`/`arrow_up`; native drawing options
  use `shape: icon` and supported arrow icons. The first icon center is 26 pixels
  from the candle edge (18-pixel half-size plus an eight-pixel gap).
  Candidates sharing a resolved candle and direction receive independent slots
  64 pixels apart. Removing one does not move surviving candidates. The slot
  key uses the actual prior candle when multiple no-trade seconds resolve there.
  The budget is 80 compound candidates / 160 native entities, plus 80 ordinary
  markers: at most 240 owned chart entities in total.
- Compound detail shows the actual background, seed, confirmation and optional
  reinforcement evidence windows. Complete IDs are selectable inside a
  collapsed details section. Low candidates disclose the unvalidated mirror
  assumption; all candidates retain exploratory wording. No confidence score
  or future-outcome fields are displayed.

For an isolated render of the actual panel module using synthetic records:

```bash
node test/manual/strategy27-compound-panel-preview.mjs
```

This uses a disposable headless Chromium page without a dev server or access
to the operator's browser/account. It verifies both directions, eight-row
retention, selection, collapse, status and viewport bounds, and prints the
temporary screenshot directory. It does not verify native TradingView entities,
gateway connectivity, loaded userscript source, or prediction accuracy.

`test/manual/strategy27-native-drawing-probe.mjs` loads the actual compound chart
module in a disposable official TradingView demo. It draws two independent
candidates on each side, reads back their points/properties, captures the native
render after drawing resources finish loading, and verifies that cleanup removes
all eight owned entities while preserving baseline drawings. Visual inspection
confirms the arrows and short labels, including distinct same-candle slots.
This demo runs at its own one-hour resolution; it does not establish Binance
`1S` compatibility or loaded userscript identity. It uses public market data and
is never an authenticated operator page.

## Development

Source lives under `src/binance-strategy27-events/`; the generated installable
artifact is `scripts/binance-strategy27-events.user.js`.

```bash
npm run test:binance-strategy27-events
npm run build:binance-strategy27-events
npm run check:binance-userscripts
node scripts/userscript-release-contract.mjs scripts/binance-strategy27-events.user.js
git diff --check
```

Live validation must confirm the current Binance main-world chart API, exact
`1S` resolution, exact route symbol, successful create/readback/remove behavior,
Tampermonkey source readback, and the actually loaded source after a hard
reload. A source-level method name alone is not end-to-end proof.

## 2026-09-06 ordinary stream recovery evidence

The loaded 0.4.3 Binance script was observed through non-pausing CDP probes on
BTRUSDT at 1S. At 03:47:33.716 UTC a successful response delivered
stream_state / transport_recovered with a new runtime epoch. The entrypoint
then reached stream_reset_clear with two ordinary markers and eight panel rows;
the next response had zero ordinary markers. Earlier event_closed responses
had retained those markers. Version 0.4.4 separates protocol reset from bounded
display ownership. This evidence identifies the browser deletion path; it does
not distinguish the underlying server Redis connection error from a timeout.

## Monitoring status and connection status

Version 0.4.5 adds a top-level last-reported monitoring status independent of
selected history, drawing completion and data connection status. An accepted
universe_removed event explicitly identifies removal; monitor_stopped identifies
stopped monitoring. These reports survive stream resets and manual history clear.
A newer event identity supersedes the report; delayed outcomes for older events
and active bootstrap replay for the same closed event cannot undo it. Outcome-only
bootstrap records also restore this status. A stream reset without a removal/stop
report displays that monitoring status awaits new evidence.

The ordinary connection line reports request delivery independently. The compound
connection text explicitly states that connectivity does not confirm monitoring
for the current symbol. Both clients use the same gateway with separate existing
paths; neither a successful empty response nor compound connectivity can mark a
symbol as re-added. No live universe-membership endpoint is available to this UI,
so the banner reports the last event evidence, not a current membership guarantee.

## Interface Language

The interface follows the existing Binance userscript locale contract: the
`/zh-CN/` route selects Simplified Chinese, and other routes select English.
Strategy 27 reuses the existing orderbook locale helpers without importing its
runtime or trading actions. The helper module also contains a static copy table;
its small initialization remains in the bundle until a separate shared-helper
extraction can migrate consumers together.

Panel headings, monitoring/connection/history notices, ordinary and compound
facts, candidate labels, menus and prompts all use the selected locale. Proper
terms such as Strategy 27, bid, ask, bps, USDT and diagnostic identities retain
their original spelling. Raw diagnostic errors retain their technical details
under a localized failure prefix.

A language-only route change repaints the same panel and preserves selection,
collapse state, monitoring evidence, both requests/cursors, history retention
and marker IDs. Bilingual annotation copies retain the first directional
candidate presentation in both languages. Compound labels update only owned
text properties with saving defaults disabled, including labels that finish
creation or repair after a language change. Changing symbol/chart/interval and
explicit reconnect still use their existing context lifecycle.

The menu uses Tampermonkey 5's returned registration IDs to update its four
entries in place. No additional grants or menu duplicates are introduced.
The English detail column wraps long labels without overlapping fact values.
Source/generated entrypoint tests cover language-only switching without new
requests or entity removal. The isolated panel preview covers both languages;
it does not certify the production gateway or a live compound sample.


## Canonical Unicode symbols

The client and Strategy27 server accept exact `BASE/USDT:USDT` symbols whose
nonempty base consists of Unicode letters or numbers (categories L and N) and
is unchanged by Unicode uppercasing. This includes Binance's Chinese asset names.
Wire symbols are never trimmed or normalized. Binance pathname segments are
percent-decoded before validating the route; malformed encodings are rejected.
Ordinary events, compound candidates, bootstrap queries, and live polling use the
same contract. Compound hashes use sorted compact JSON encoded directly as UTF-8,
matching Python `ensure_ascii=False`; existing ASCII candidate hashes do not change.
