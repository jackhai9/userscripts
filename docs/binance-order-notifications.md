# Native Order Notification Scope

The orderbook userscript scopes Binance's ordinary order toasts and trade sound
to the symbol currently displayed by its supported USDT/USDC futures route. It
does not filter the account stream, positions, open orders, or native trade
acknowledgements. There is no separate userscript or notification preference.
The native toast and sound switches retain their meaning.

## Observed cause and intervention

The public factories captured on 2026-10-07 show two independent paths:

- `39116` subscribes to both UM and CM account order streams. FILLED,
  PARTIALLY_FILLED and EXPIRED events enter a 500 ms trailing debounce with only
  the order ID. There is no symbol test. `55401` plays queued notifications with
  a two-second cooldown; its audio helper calls `play()` twice.
- `4189` updates the native account cache and emits order events using the old
  cached order. `34122` registers notification listeners. `30877` converts
  cancellation, partial-fill and fill events into toasts through a 30 ms
  debounce, without checking the page symbol.

`order-notifications/native-modules.js` contains three verified structural
templates for `39116`, `55401` and `30877`. Changes are limited to those notification
consumers. Ordinary events are checked before debounce and immediately before
presentation. Queued tokens contain only a symbol, or null for native handling;
order IDs, client order IDs, prices and quantities are not retained in tokens.
Both audio calls check the same selected token. The sound queue is pruned only
when native playback can start, never while its current cooldown still owns the
queue head.

The `39116` factories in `3314.51597d7f.js` and `3314.86064918.js` have the
same syntax tree apart from consistently renamed local identifiers. Both were
observed in concurrently open tabs on 2026-10-07: the latter left OUSDT and
encoded 龙虾USDT on native sound while USUSDT used the earlier matched source.
AINUSDT also had active sound filtering, confirming that the failure followed
the loaded source rather than the asset name. Runtime matching now uses lexical
binding equivalence rather than source text or a Binance bundle version.
Fixtures identify these variants by source SHA-256 because their module and
chunk IDs are identical. The manifest also associates replacements by source
hash, and browser fixtures require exactly one selected source per module ID.

Acorn parses each targeted factory and eslint-scope resolves its declarations
and references. The structural signature normalizes those local binding names
and removes source positions and ordinary literal formatting. It preserves
global names, object and member keys, import IDs, constants, operators, regular
expressions, template raw values, strict directives and binding relationships.
Shadowing a global or changing an event field therefore changes the signature.
The pure numeric boolean spellings `!0`/`!1` normalize to `true`/`false` because
repackers expand them while formatting. Other truthiness expressions, calls and
side effects remain structurally exact.
An equivalent factory selects a precompiled replacement; host source is never
executed or dynamically compiled by the matcher. The nine captured notification
sources reduce to three structures, including both sound producer variants.

Parsing happens only when a targeted module is captured, not on each order.
Invalid syntax, dynamic scope and sources over 64 KiB are rejected by the
existing capture-failure boundary. This accepts formatting and local renaming;
it does not attempt arbitrary program equivalence or guess changed module IDs.

The page symbol is read on each check, including after a debounce or pending
audio Promise. Each matching tab may notify, even if two tabs show the same
symbol. A symbol with no matching tab produces no ordinary notification in the
other supported trading tabs. Unknown routes retain native handling.

## Risk and unknown events

Only known ordinary order types with a valid exchange symbol and nonempty
`clientOrderId` are scoped. `origType` and `operate`, when present, must also be
known ordinary values. The native REST cache can omit those stream fields, so
their absence alone does not classify a toast as unknown. Notifications receive
the cached record, not necessarily the latest stream execution type.

LIQUIDATION, CALCULATED, unknown shapes and the documented system client ID
prefixes `autoclose-`, `adl_autoclose` and `settlement_autoclose-` retain native
handling. This does not add a toast that Binance itself suppresses. Other
account/system alerts do not enter the patched consumers. The public `5558`
adapter preserves the corresponding raw `s`, `o`, `c`, `x` and `ot` fields.
See Binance's [system order ID documentation](https://www.binance.com/zh-CN/support/announcement/detail/f2809259702b46f7abdc9c97b977908f)
and [order stream reference](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/user-data-streams).

## Startup and source changes

The existing orderbook installer supplies notification target descriptors to the
single early chart-storage queue observer. Each target has independent capture
and failure outcomes; stopping mirror writes does not stop notification scope.
No second queue accessor, global Audio override, WebSocket replacement, new
account subscription or DOM notification removal is installed by this feature.

Both sound factories must execute their verified replacements before either
changes the native string queue to classified tokens. If either structure mismatches,
both sides retain the original string contract. Pending native strings are also
preserved during activation. Toast capture is independent. Late injection,
unknown behavior or the original 30-second capture deadline leaves the affected
path native and reports its reason; native reminders may therefore still repeat
after a substantive upstream change. Local variable renaming alone does not
require a new userscript release.

`self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot()` exposes only capture status and
aggregate scope-check counts. `suppressedChecks` is a check count, not a unique
order or notification count. No account data is exposed by the diagnostic API.
Already-open pages require a fresh script load to activate this early hook.

## Reproduction and validation

`test/fixtures/binance-order-notifications/notification-manifest.json` records
factory hashes, observed source URLs, available complete chunk hashes and every
AST replacement. Three toast variants were captured as complete function source
without the complete chunk response; that distinction is explicit in the
manifest. Generate with:

```sh
node scripts/generate-order-notification-modules.mjs
npm run build:binance-orderbook-trade
node --test test/dom/binance-orderbook-trade/order-notifications.test.js test/unit/binance-chart-storage-runtime.test.js
npm run lint:tests
npm run check:binance-orderbook-trade
```

The regression first failed against the complete unmodified factories: an ETH
fill on a BTC page produced the native toast and load/play/play calls. Isolated
tests run the captured adapters, event cache, listeners, React 18.2 hooks and
native debounce with controlled clocks. Only preferences, account stream and
presentation I/O are replaced. Real orders are never required to validate this
feature. An independent esbuild repack also renames and reformats all eight
browser-host modules before exercising foreign-symbol silence and matching
sound through the actual generated userscript. Installed-source and live
notification behavior remain separate from these deterministic checks.
