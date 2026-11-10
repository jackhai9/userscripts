# Chart Write Filter

`src/binance-orderbook-trade/chart-storage/` filters saves caused by native order lines and skips unchanged
chart writes in the browser database. It is built into `scripts/binance-orderbook-trade.user.js` with
`npm run build:binance-orderbook-trade`; there is no separate install entry.
`experiments/binance-chart-storage/` contains earlier research and independent
baselines; production imports none of it.

## Problem

Binance persists TradingView chart state with localForage (IndexedDB driver) in
databases named `chart_*` (`chart_futures` on USDⓈ-M pages), object store
`keyvaluepairs`, with out-of-line string keys:

- `#TV_SYMBOL-<SYMBOL>@PRICETYPE=...`: drawings of one symbol;
- `myTradingView...`: chart layout and settings records.

About 100 ms after every drawing event, Binance asks TradingView to save the
chart. Each placed or cancelled order draws or removes an order line, so automated
ladders trigger saves continuously. Each save writes the chart record and layout
list, then calls `setItem('#TV_SYMBOL-' + symbol, drawings)` for every symbol whose
drawings are loaded in the chart (109 symbols observed), changed or not. Its
mirror callback then reads every chart record again.

In the user's Chrome, binance.com's IndexedDB LevelDB grew to about 690 MB and
compacted about 35 GB within one browser session; write volume rose about twenty
times during automated order sessions. Chrome's IndexedDB service then stopped
answering, even `indexedDB.databases()`. TradingView initialization waits on chart
storage, so its tab spins while Basic and Depth charts keep working. A Chrome
restart recovered the service on 2026-10-30; it stalled again by 2026-11-04.

## Order-line events

The host subscribes separately to TradingView's `onAutoSaveNeeded` and
`drawing_event`. Its drawing listener schedules a complete save for every
event except click and move. In a 52-second AINUSDT observation, nine order-line
property changes and three order-line removals scheduled twelve saves. Each of
the thirteen snapshots entering persistence in that window contained 130 drawing
keys. Saved layout and drawing callbacks can straddle an observation window.

`order-line-saves.js` installs during the same-origin iframe bootstrap. After
Binance rewrites the bootstrap document, `innerWindowLoad` lets the script
enqueue a `widgetReady` handler before Binance registers its drawing listener.
Binance registers six topics in one synchronous batch. The script checks that
the study and drawing callbacks test the same readiness flag and call the same
save function, and that the drawing callback contains only the observed switch.
Minified variable names can change together. A different batch or callback body
keeps the native subscription. Repeat subscriptions and cancellations retain
TradingView's one-registration-per-call semantics.

Only `properties_changed` and `remove` of an identified `LineToolOrder` skip
this listener. For property changes, each chart model can resolve the source ID;
a conflict with a hand drawing preserves the save. For deletion, TradingView
detaches the source before emitting the event. The script captures the order ID
for the synchronous duration of the model's `removeSource` call and restores
the previous context on exit. A later drawing can reuse the same ID safely.
The integration depends on the host callback, iframe bootstrap and model methods
from [the audited build](https://bin.bnbstatic.com/static/chunks/94661.4723577e.js).
Native order lines, user drawings and their events remain visible to other
subscribers. Layout saves and ordinary autosave run through their original paths.
If a chart model disappears during identification, Binance receives the event.
Restoring a previously hidden order-line checkbox can complete without a save
while its native drawing listener is filtered. On other widgets the recovery
still coalesces and waits for the original save callbacks.

### Dependency break alerts

Falling back to Binance's native save keeps drawings safe but silently restores
the save storm, so every dependency mismatch is reported instead of only being
tolerated. `observeOrderLineSaves()` reports each reason once per page through
`onContractBreak`, deferred to a microtask so a failing handler cannot drop the
TradingView event being delivered. The orderbook script logs each report with
`console.error` and shows a persistent red panel row ("币安依赖已变化，需更新脚本")
whose tooltip groups the changed dependencies by hook, with their consequence and
details. `__BINANCE_CHART_STORAGE__.orderLineSaves().breaks` lists the same entries.

| Reason | Detected when |
| --- | --- |
| `bootstrap` | `innerWindowLoad` runs without `widgetReady`; `widgetReady` runs without `tradingViewApi`; a frame publishes `tradingViewApi` without the `innerWindowLoad → widgetReady` hook running; a frame outside `iframe#tradingview_*` in `.chart-widget-root` publishes it; the chart frame is cross-origin; or the frame has drawn its chart (a canvas on two checks) while the API is missing or `widgetReady` has not called back |
| `api-shape` | the ready API lacks `_chartWidgetCollection.getAll`, `subscribe` or `unsubscribe` |
| `subscription-batch` | a ready widget was never filtered because the six-topic batch was not observed |
| `listener-shape` | the batch completed but the study and drawing callbacks no longer match (both bodies are included) |
| `removal-hook` | the model prototype has no writable `removeSource`, or the recognized listener stayed unfiltered because removal tracking could not be installed |
| `removal-capture` | three removal bursts of filtered order lines, at least one second apart, bypassed `removeSource` before any removal was captured |
| `chart-model` | a widget no longer exposes `hasModel`/`model().model().getLineToolById` |
| `lookup-error` | model lookups or order-line ID reads threw in three bursts at least five seconds apart (one burst is a chart being replaced) |
| `order-event-type` | a live order line emits `points_changed`, which the filter does not skip |
| `order-tool-name` | a drawing whose tool name contains `order` is not `LineToolOrder` |
| `event-type` | `drawing_event` carries a type outside TradingView's documented set |

Absence-type breaks are judged by a check of every same-origin frame, every 30
seconds for at most 20 ticks after each load of that frame. A verdict needs the
same API on two consecutive ticks; a pending `widgetReady` callback of the frame's
window defers it, because chart storage has delayed TradingView startup by up to
two and a half minutes; and a widget is judged one full tick after it becomes
ready, so Binance's subscriptions can arrive. Removals within one second count as
one burst, so a chart teardown that detaches every order line at once is not a
break. A recognized listener that Binance later unsubscribes is not a break.
Transient lookup errors while a chart is replaced stay unreported. The alert does
not change any save behavior.

Not detected: a chart that never draws within the 20 ticks (TradingView stays
blank, which the user sees), and an order tool renamed without `order` in its
name. A multi-chart frame that legitimately has no drawing-save listener would be
reported as `subscription-batch`; no such frame has been observed.

The unchanged-write filter reports `write-layout` through its own handler. Every
event the order-line listener passes to Binance's save, except click and move,
opens a 30-second window. A window that saw only puts to chart-like targets the
filter does not recognize (a database, store or string key matching
`chart|tradingview|tv_symbol|drawing`), and no recognized write, counts as a miss;
a recognized write resets the count, and a window with no chart-like put proves
nothing. Three misses report the observed targets.
`__BINANCE_CHART_STORAGE__.writeFilterBreaks()` lists the report. A layout moved
to names matching none of those words is not detected.

## Design

`installChartWriteFilter()` runs at document-start in the page world, before
Binance code, on top-level Binance futures trading routes. It replaces
`IDBObjectStore.prototype.put` with a wrapper. A put is filtered only when all of
these hold; every other put calls the native method unchanged:

- exactly two arguments and a string key starting with `#TV_SYMBOL-` or
  `myTradingView`;
- the store is named `keyvaluepairs`, has no key path, and belongs to a readwrite
  transaction on a database whose name starts with `chart_`.

A filtered put:

1. clones the value with `structuredClone` at call time, as the native put
   captures it; an uncloneable value throws the same synchronous error;
2. reads the stored value with `get` in the same readwrite transaction and
   returns that request to the caller;
3. on success, skips the write when the stored and new values are equal JSON
   trees, and otherwise issues the native put with the clone. When both are
   `undefined` (localForage stores `null` as `undefined`), `getKey` decides
   whether the key must still be created;
4. if the read fails, prevents that failure from aborting the transaction and
   writes the clone, as the native put would have overwritten the record;
5. if the deferred write fails, stops its error event at the request, so the
   transaction aborts with the real error and localForage rejects with it.

Readwrite transactions on the same store are serialized, so the comparison and
the write cannot interleave with another tab's write. A later write that matches
the value stored when it was requested is still written if another tab changed
the record in between.

Equality covers primitives, arrays and plain objects, including objects created
in the TradingView iframe realm. Property order and signed zero are significant,
because native reads expose both. Dates, maps, blobs, sparse arrays and arrays
with extra properties never compare equal, so such records are always written.

The filter depends only on Binance's persisted data layout: the database prefix,
the localForage store name and the key families. It does not depend on Binance's
bundle, module IDs, minified names or chunk queue, and never touches that queue.
If Binance changed the layout, writes would simply stop matching and keep their
native behavior.

## Limits

- The deferred write assumes the put is the caller's last request for that key in
  its transaction and that the caller does not commit early. localForage meets
  this: each `setItem` opens its own transaction with one put and resolves on
  transaction completion. Requests issued after the put in the same transaction
  would run before the deferred write.
- Transactions are not reduced. Each `setItem` still opens one readwrite
  transaction, and the mirror's reads are unchanged; only unchanged writes and
  their LevelDB compaction are removed.
- The filter stays installed for the document lifetime, including after SPA
  navigation away from a trading route. It only skips identical writes.
- A hidden tab that loaded another symbol's drawings earlier can still write its
  stale copy when it differs from the stored value. The earlier drawing-ownership
  patch that prevented this replaced Binance modules and is removed (see below).

### Symbol switching and mirror reads (2026-11-06)

On five open USDⓈ-M pages the TradingView snapshot contained 1,172 drawings per
page. The chart collection's `skipLineToolsFromOtherSymbols` option retained the
current symbol's 0, 1, 9, 2 and 1 drawings respectively, with their original IDs.
This option belongs to the collection serializer. Binance calls the widget's
default `save(callback)` and uses the resulting snapshot for persistence.

An isolated Chromium replay used the same TradingView widget build, a synthetic
datafeed, the captured Binance load/save functions and real IndexedDB. Two
synthetic symbols each had one independently identified horizontal line. The
experiment varied which drawing keys the loader could enumerate at startup,
then switched from A to B with `activeChart().setSymbol()`. Before saving B,
another write deleted A's line in storage. The third case passed the collection's
symbol-scoped charts to the same host save function.

| Startup reads | Save input on B | Drawing keys written | B's original line | A's deletion |
| --- | --- | --- | --- | --- |
| A and B | Default snapshot | A and B | Preserved | Reversed |
| A only | Default snapshot | A and B | Erased | Reversed |
| A and B | Symbol-scoped charts | B | Preserved | Preserved |

The host calls its storage loader before constructing the widget. Its ordinary
symbol-change path calls `setSymbol` on the existing chart. The incoming
drawing must be restored before any save that could interpret its absence as
deleting the last drawing. A two-chart layout also needs the drawing keys for
both charts, including each price type. A save-side replay kept B's drawing
and A's explicit deletion when the input snapshot contained just the drawings
owned by those charts; a stale B snapshot that still included A revived A.

The November mirror callback uses one regional futures database as its target.
In a replay with the mirror enabled and five eligible keys (three drawing keys
and two layout records), a matching source and target still incurred one key
scan and five reads, then zero puts. Using a different source namespace copied
all five records into an empty target. With the mirror disabled it issued zero
storage requests. The October host fixture has two mirror targets. Use the
matching host build when measuring either branch.

Evaluate save scoping separately from initial loading and mirroring. Preserve
the host's full layout, each chart's owned drawings, explicit last-line deletions
and unrelated records. A load change also needs a switch-time restoration test;
a mirror change needs both same-database and cold-destination coverage. The
replay measured key access and persisted IDs.

Public build inputs: [drawing storage](https://bin.bnbstatic.com/static/chunks/12952.c43077d1.js),
[mirror](https://bin.bnbstatic.com/static/chunks/TradingView.43d7e8be.js),
[widget lifecycle](https://bin.bnbstatic.com/static/chunks/94661.4723577e.js)
and [regional target](https://bin.bnbstatic.com/static/main.00641edb.js).

## Removed module replacement

Earlier versions intercepted Binance's Rspack chunk queue and replaced two Binance
modules with byte-for-byte pinned copies: the TradingView mirror (`70940`) and the
drawing save extractor (`76535`). Order notification scoping replaced three more
modules matched by normalized syntax trees. After Binance's 2026-10 frontend
rebuild, module IDs and sources changed (`20272`, `22092`), every pin stopped
matching, and all protection silently fell back to native behavior. Both
mechanisms bound userscript code to Binance's minified bundle and were removed
together with their generators, fixtures and the bundled parser. Trade-sound
scoping now uses standard browser boundaries; see the orderbook development
manual.

## Diagnostics

`self.__BINANCE_CHART_STORAGE__.snapshot()` returns fixed counters only:

- `compared`: filtered puts;
- `skipped`: identical values not written;
- `written`: native puts issued after comparison;
- `unreadable`: stored values that failed to read and were overwritten.

`self.__BINANCE_CHART_STORAGE__.orderLineSaves()` reports `matched` (recognized
listener instances) and `skipped` (order-line save notifications suppressed).
A zero match count after the chart is ready means the listener filter has not
attached. Neither diagnostic exposes stored keys, drawings or storage methods.

## Validation

```sh
node --test test/unit/binance-chart-storage-json.test.js test/unit/binance-order-line-saves.test.js
npx playwright test e2e/binance-orderbook/specs/chart-storage-write-filter.pw.js e2e/binance-orderbook/specs/chart-storage-orderbook-entry.pw.js
npm run build:binance-orderbook-trade
npm run check:binance-orderbook-trade
```

The browser scenarios use real Chromium IndexedDB and the captured localForage
1.10.0 module from `test/fixtures/binance-chart-storage/` (taken from
`main.37a180b9.js` on 2026-10-06). The current `main.00641edb.js` contains the same
`setItem` path: one `put`, resolve on transaction completion, reject with the
request error or the transaction error. They cover repeated identical saves of
110 records, changed, new, reordered and cleared records, other keys and
databases, non-JSON values, values changed by the caller after the request,
concurrent saves, aborted transactions, a real quota failure, an unreadable stored
value and a cross-tab write behind a held lock.

These tests do not prove live behavior. After installing a new version, verify the
loaded artifact version, read the counters on a page with TradingView open, and
compare LevelDB write and compaction activity in
`~/Library/Application Support/Google/Chrome/Default/IndexedDB/https_www.binance.com_0.indexeddb.leveldb/LOG`
over comparable trading periods.
