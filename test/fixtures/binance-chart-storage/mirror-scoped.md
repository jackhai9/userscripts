# Scoped mirror factory fixture

`mirror-scoped-callback.js` retains the complete public `70940` factory for source
identity checks and the original mirror callback with its original lexical
declarations. Dependencies execute from the separately verified
`host-persistence.js` factories. The test wrapper supplies the namespace and the
two native control refs; it does not reimplement the mirror or save algorithm.

`experiments/binance-chart-storage/generate-mirror-module.js` accepts the exact
public `TradingView.99bc5074.js` response file. It pins the whole source SHA-256,
uses Acorn to identify one `70940` method and one mirror `Wr=fr.map(...)`
expression, pins their ranges and original factory hash, rejects any occurrence
of the injected dispatch identifier, and proves that reversing the replacement
reproduces the entire original factory byte for byte. Generated files are
deterministic and contain static JavaScript methods, without runtime evaluation.

The only transformed expression is:

```js
__dispatchChartMirror(Sr,fr,()=>ORIGINAL_FR_MAP_EXPRESSION)
```

The thunk retains the original compiled async per-key map, including its falsy
key guard and native `setItem` call. `replaceChartMirrorFactory` checks the exact
original `Function.prototype.toString` result synchronously during registration.
The generated patched test callback is verified equal to the corresponding
callback slice of the complete generated factory.

This boundary replaces the earlier global localForage facade as the current
experiment candidate. That facade changes the native transaction ordering of
`setItem` relative to reads, remove and clear. Here the native instances and
methods remain intact: source reads, mirror guards/catch, ordinary TradingView
save, Basic and reset paths retain their original source. Only a mirror's
destination writes enter the explicitly scoped batch writer. Its default `lab`
scope permits only `https://chart-storage.test`; `isolated-ususdt-probe` permits
only the exact top-level `https://www.binance.com/zh-CN/futures/USUSDT` page. The
latter cannot prove profile isolation: the separate harness must own a fresh
anonymous Chrome process/profile. Default production refusal, storage contracts
and limits are unchanged. Its whole-batch atomicity,
interleaving and explicit capacity errors still differ from native per-key writes.

```sh
node experiments/binance-chart-storage/generate-mirror-module.js \
  /path/to/TradingView.99bc5074.js
```

The browser helper serves exact raw source through three local asset routes;
all other network requests remain governed by the isolated lab's blocking
route. Browser execution is necessary for the function-source test because the
Playwright Node module loader reformats imported JavaScript. Such reformatted
source correctly fails the strict production source check.

Offline validation has distinct layers: complete-module source identity and inverse
replacement; exact original and transformed callback execution with real
localForage, original save/Basic functions and IndexedDB; synthetic 70940 factory
lifecycle in the original captured Rspack runtime. The synthetic lifecycle
test verifies registration, cache and cleanup behavior, not complete React
initialization of public module 70940. Both runtime-order regressions first
failed when a replacement callback synchronously stopped observation but still
installed its candidate; the bootstrap now rechecks active state before wrapping
the factory. Capture rejects as stopped while the original factory and cache
continue normally.

The scoped suite contains 19 scenarios, and the separate real-IndexedDB writer
suite contains 18. Before the explicit page-probe scope, their combined experiment run, including historical suites,
passed 105 browser scenarios; eight Node origin/path/frame cases (including
non-lab writer refusal) and the full test-policy lint passed separately. Writer
tests cover atomic failure, quotas, limits, empty input and a finite stop fence.
After that fence, retained callbacks execute their exact original per-key thunk;
ordinary native APIs are never held behind the mirror fence. The 32-chain data
and transaction/read/write measurements are recorded in the
[experiment README](../../../experiments/binance-chart-storage/README.md).
The scope extension subsequently passed all 18 Node origin/path/frame cases
after three new cases first failed, all 37 mirror browser scenarios, and the
complete test-policy lint.

A separate anonymous Chrome `154.0.8037.98` run also validated and executed the
complete static `70940` factory once. It supplied a native-only thunk dispatcher,
left the lab writer disabled, and recorded `dispatches: 0`. The inspected
screenshot showed the USUSDT chart and orderbook after native `dataReady()` became
true. That is complete-module startup evidence, not execution of the injected
mirror branch or real batch writes. The result and screenshot are in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-native-preflight-HeCAar/`.
It does not establish existing-profile compatibility, Tampermonkey delivery,
production batch behavior, cross-database atomicity or blank-page recovery.

The later independent native-shape probe recorded a bounded interval change
from `60` to `15` with completed mirrors increasing from 6 to 7. All seven final
completions targeted `chart_delivery` with IndexedDB, without mirror or JSON-shape
failures; maxima were four entries, 49,003 batch bytes and 24,504 record bytes.
The inspected screenshot showed the data-ready chart and orderbook; observation
stopped and its temporary browser closed. Evidence is in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-shape-probe-yDfadK/`.
This native-only result does not establish real-page batch execution, and the
seven final mirrors are not attributed to one action.

On **2026-10-07 Beijing time**, an independent anonymous Chrome `154.0.8037.98`
run enabled the batch writer through the explicit probe scope. Its report starts
at `2026-10-06T16:24:24.572Z`. Five batches committed five transactions, eight
writes and eleven skipped writes, with zero failures, rejections, aborts or
pending work; peaks were two batches and 98,006 bytes. The bounded one-hour to
fifteen-minute transition advanced completed mirrors from 4 to 5. After stop,
the four-hour stage advanced them from 5 to 6 and native calls from zero to one,
with the entire writer statistics unchanged. Each stage read back four entries
matching its captured dispatch snapshot. The chart was data-ready, the inspected
screenshot showed candles, moving averages, volume and the orderbook, and the
browser closed without page errors. Evidence is in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-bulk-probe-3YcdXL/`.
This is actual anonymous-page batch and mounted native-continuation evidence,
not installation or enablement in the user's logged-in profile.

Three prior attempts stopped at an ambiguous anonymous-UI locator, before any
factory match or dispatch; using the unique button role fixed the check. They
are not storage failures. The standalone anonymous runner/entry/contract retain
fixed-URL runtime guards and diagnostic failure counts. Four Node contract tests
plus 18 scope/origin and 18 native-only preflight cases passed, totaling 40; the
37 mirror browser scenarios also passed.

Before Tampermonkey delivery, a separate native-only acceptance must verify real
document-start timing and MAIN_WORLD execution. The official
[Content Script API](https://www.tampermonkey.net/documentation.php?q=content_script_api)
documentation gives Chrome document-start support to **UserScripts API Dynamic**,
but not default Content Script or ordinary UserScripts API mode. Official
[`@sandbox`](https://www.tampermonkey.net/documentation.php?q=sandbox) documentation
says `raw` requests MAIN_WORLD but can use another enabled sandbox if that
injection is unavailable. The metadata is not runtime proof. Full extension
acceptance must also show strict source pin before first execution, actual native
mirror completion and cleanup; the Chrome initialization-script probe does not
substitute for those checks.

The native-only core, entry and build now produce `native-preflight.user.js` as
an independently reviewed, unpublished and uninstalled artifact. Its verified
four-source dependency graph excludes the writer and runtime loaders. It records
bounded in-memory statistics for 30 seconds, synchronously forwards the exact
native thunk result/error, and stops on manual request, pagehide, scope change
or deadline. No stored values are inspected and no storage calls are added.
Its existence does not prove Tampermonkey timing or MAIN_WORLD delivery; the
logged-in profile, long-running concurrent workload and blank-page root-cause
recovery also remain unverified.

The generated native-only artifact was separately executed through `addInitScript`
in anonymous Chrome `154.0.8037.98` on October 7 Beijing time (report start
`2026-10-06T16:30:27.651Z`). Attempts, exact matches and factory executions each
equaled one; capture completed, with four native thunk dispatches and 15 entries
counted. There were no failures or page errors; manual stop retired observation
and the browser closed. The inspected screenshot showed the chart and orderbook.
Evidence is in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-native-artifact-probe-JSBjWC/`.
`completed` means module capture, and dispatch count does not certify asynchronous
storage commits. This verifies the generated artifact in a Chrome startup hook,
not Tampermonkey timing or installation; it remains unpublished and uninstalled.
