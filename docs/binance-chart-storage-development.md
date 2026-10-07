# Orderbook Chart Storage Optimization

`src/binance-orderbook-trade/chart-storage/` owns the production implementation. Build
the existing `scripts/binance-orderbook-trade.user.js` with
`npm run build:binance-orderbook-trade`. There is no separate install entry.
The earlier `experiments/binance-chart-storage/` files are historical research
and independent baselines; production imports none of them.

## Behavior and scope

The module installs before the orderbook business initializer at document-start
in the page's MAIN_WORLD. It only admits
top-level Binance perpetual trading routes accepted by the shared route parser,
including USDT and USDC symbols. Futures home, landing and other subpages receive
no storage hook or UI. The orderbook retains its own existing frame and SPA
behavior. Landing-to-trading SPA navigation does not re-run the storage installer;
only a fresh matching page starts early interception. It never places orders, changes leverage, reads credentials, changes
the proxy, clears databases or replaces global storage methods.

Two complete pinned factories are intercepted before their first execution:
`70940` changes only the mirror destination expression, while `76535` restricts
the native save extractor's input to each chart's current MainSeries symbols.
One queue observer owns both targets. Capture, source rejection and deadline
outcomes are independent; one changed upstream module does not cancel a matching
other module. Late injection leaves both native. Metadata does not guarantee
early injection on every extension configuration; rejection remains explicit.

The orderbook installer also supplies independently tracked
[notification targets](binance-order-notifications.md) to this same observer.
`startChartStorageOptimizer({ additionalTargets })` accepts explicit
`replace`, `onCapture` and `onFailure` callbacks for each non-storage module ID;
storage IDs cannot be replaced by those descriptors. They share the original
capture deadline, but mirror `stop()` does not stop their capture or handling.

### Drawing ownership

Native loading puts historical symbols' drawings into every chart that shares
their ownerSource. A different symbol's tab can therefore retain an old invisible
copy of drawings that another page has edited or deleted. The native extractor
previously wrote all those groups back on every save, restoring deleted drawings.

Before native drawing-ID deduplication, the scoped snapshot retains only drawings
belonging to the current MainSeries symbols of their own chart. All indicator
panes inherit that chart's symbol set. Other sources and drawing properties stay
unchanged. Native extraction still produces an explicit empty array for a current
symbol with no drawings, while unrelated symbols are not written. A whole chart
containing drawings without any MainSeries is rejected before storage writes;
an indicator pane without its own MainSeries is valid. The patch does not delete
historical keys, replace save events or serialize charts through a new API.

All concurrently open trading tabs need the new version; an old tab can still
write its stale hidden copies. Same-symbol concurrent editors and source-only
cross-database interruptions remain separate conflicts, not solved by ownership
filtering. No trading action is needed to validate the fix.

Each accepted mirror uses one IndexedDB read/write transaction and compares the
destination values before writing. Equal JSON trees must retain signed zero,
property order and dense array structure. Missing keys remain distinct from stored
null. Ordinary saves retain their native write sequence after drawing ownership
filtering; source reads, Basic chart settings and `clear()` remain native. No
record cache persists between batches.

Input admission defaults to 512 entries, 4 MiB per batch and 16 pending batches
with 64 MiB of copied input. Unsupported values, capacity limits, initialization
or driver/configuration rejection and synchronous transaction-creation failure
execute the original native expression once, before any optimized transaction
exists. Native handling may exceed the optimizer's limits; these limits bound
optimization, not Binance's original work. Shared references, cycles and non-JSON
input use that native path instead of silently changing their stored meaning.

Within a transaction, unsupported old values and exhausted comparison budgets
cause direct writes. They do not reject otherwise valid replacements. A genuine
transaction failure aborts the entire batch and stops future optimization; it
never replays the failed batch. The original caller still receives the failure
through its Promise boundary. Subsequent calls resume native handling.

## Lifecycle and diagnostics

`self.__BINANCE_CHART_STORAGE__.snapshot()` returns fixed aggregate counters and
startup status and an independent `drawingScope` status. `stop()` drains the current instance's accepted mirror work, including
every member of an early-rejecting native Promise array. Calls arriving during
drain wait for that finite fence, then run their native expression. After stop,
native arrays and errors pass through synchronously and statistics freeze.
The public interface exposes no stored keys, values or storage methods.
Stopping mirror optimization does not remove drawing ownership protection. If
that factory has not been captured, its original bounded startup observation
continues; pagehide terminates outstanding observations for both targets.

`acceptedBatches` counts created optimized transactions. `committedTransactions`
counts real completion events, while `committedWrites` and `skippedWrites` count
only committed work. `rejectedBatches` and `nativePassthroughBatches` describe
native routing before transaction creation, not failed saves. `failedBatches`
counts failed optimized transactions. The separate native-only experiment's
`completed` and `dispatches` fields must not be interpreted as commit counters.

Stopping does not close shared connections, undo committed data, drain other tabs
or guarantee persistence before page destruction. Leaving a supported route
retires optimization when a retained callback runs; pagehide also requests stop.

## Compatibility limits

The native per-key mirror can partially commit; an optimized destination batch
commits or aborts as a whole. Its interleaving with native clear and other tabs
therefore differs. Source reads remain non-atomic, and two databases cannot share
this transaction. No newest-revision ordering, cross-tab coordination, repair of
already queued work or universal blank-page recovery is promised. The change
addresses repeated destination transactions and unchanged writes specifically.

The retained upstream factory is generated from the exact public response and
verified with its manifest and inverse replacement. To update that source pin,
first inspect and regenerate the fixture provenance; never broaden the matcher
to accept an unknown module. The generation command accepts an explicit output:

```sh
node experiments/binance-chart-storage/generate-mirror-module.js /path/to/verified/TradingView.99bc5074.js src/binance-orderbook-trade/chart-storage/mirror-module.js
node scripts/generate-chart-drawing-save-module.mjs /path/to/verified/36648.dd8ae7dc.js
```

## Validation and release

- Runtime unit scenarios execute the real bootstrap and exact native factory.
- Production writer scenarios use real IndexedDB and the captured localForage,
  covering original-value semantics, admission, reconnect, abort and drain.
- Multi-tab scenarios use competing different revisions, native clear, reload
  and actual transaction events; no fixed sleep determines business completion.
- The anonymous smoke runner executes the generated install artifact in a fresh
  Chrome context. Tampermonkey installation requires separate exact installed
  and loaded-source checks in the user's authorized test tab.

Run the affected Node and browser tests, `npm run lint:tests`, the build/check,
one passing full `npm test`, and `git diff --check`. Publish through a reviewed
GitHub PR; verify the main raw artifact before synchronizing Tampermonkey. A
successful chart and committed test batch do not establish long-running stability
or prove that every historic white-screen incident had the same cause.
