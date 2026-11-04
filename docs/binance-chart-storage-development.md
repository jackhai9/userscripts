# Chart Write Filter

`src/binance-orderbook-trade/chart-storage/` filters unchanged chart writes in the
browser database. It is built into `scripts/binance-orderbook-trade.user.js` with
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

## Removed module replacement

Earlier versions intercepted Binance's Rspack chunk queue and replaced two Binance
modules with byte-for-byte pinned copies: the TradingView mirror (`70940`) and the
drawing save extractor (`76535`). Order notification scoping replaced three more
modules matched by normalized syntax trees. After Binance's 2026-10 frontend
rebuild, module IDs and sources changed (`20272`, `22092`), every pin stopped
matching, and all protection silently fell back to native behavior. Both
mechanisms bound userscript code to Binance's minified bundle and were removed
together with their generators, fixtures and the bundled parser.

## Diagnostics

`self.__BINANCE_CHART_STORAGE__.snapshot()` returns fixed counters only:

- `compared`: filtered puts;
- `skipped`: identical values not written;
- `written`: native puts issued after comparison;
- `unreadable`: stored values that failed to read and were overwritten.

It exposes no keys, values or storage methods.

## Validation

```sh
node --test test/unit/binance-chart-storage-json.test.js
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
