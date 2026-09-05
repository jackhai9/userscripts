# Binance Strategy 27 Event Annotations

This document owns the Strategy 27 gateway, chart-rendering, and entity
contracts. Generic Codex/tool timeout and connection policy belongs to the global
rule and shared knowledge runbook.

## Purpose

`binance-strategy27-events.user.js` is a rendering client for the Strategy 27
V10 live projection. The VPS remains the only market-data and event-analysis
authority. The userscript opens no Binance market-data WebSocket, uses no
Binance API key, and does not recalculate the four force groups.

The script reads an authenticated, loopback-only long-poll endpoint through an
SSH local forward. It draws transient entities only when the Binance route,
TradingView symbol, and `1S` chart interval all match the requested Strategy 27
symbol.

## Operator Setup

1. Keep an SSH local forward open from `127.0.0.1:<local-port>` to the VPS
   Strategy 27 gateway on `127.0.0.1:8765`.
2. Install `scripts/binance-strategy27-events.user.js` in Tampermonkey.
3. Use the userscript menu to set the loopback gateway origin. The default is
   `http://127.0.0.1:18765`.
4. Use the userscript menu to set the gateway installation secret. Tampermonkey
   stores it in this script's private value storage; it is never embedded in
   source, URL parameters, chart text, console messages, or status text.
5. Open the matching Binance futures route and select the one-second chart.

The macOS operator machine keeps this forward under a `launchd` user agent so
the SSH process is restarted after sleep, network changes, or a broken
connection. The browser client treats only `GM_xmlhttpRequest` transport errors
and timeouts as recoverable: it retains the current cursor, displays a
reconnecting status, and retries after two seconds. HTTP responses, gateway
errors, malformed JSON, cursor violations, and rendering contract failures
still stop immediately.

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
panel records. Route, symbol, interval, epoch, cursor, or sequence
discontinuities abort the request and remove only those transient entities.
Marker count and age are bounded on the chart; the panel retains at most eight
events.

The existing one-second context check also reconciles retained records with
TradingView's `getAllShapes()` list. A host-evicted ordinary marker is restored
using its original resolved point and drawing options, even when no new gateway
message arrives. Compound candidates restore only missing parts of their
icon/label pair, preserving the original slot and surviving entity IDs. Each
record shares one in-flight repair across timer and message callbacks. Cleanup
skips IDs proven absent, while native removal failures still stop the owning job.
Clear, reset, context changes and retention eviction invalidate repair ownership;
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
generated install artifact are version 0.4.2 with identical metadata headers.
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
