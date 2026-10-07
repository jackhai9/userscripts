# Binance Futures startup stall observed on 2026-10-02

This is incident evidence, not a standing diagnosis or permission to change a
browser profile. The assistant performed no refresh, extension change, cache
deletion, proxy change, or trading action during the investigation.

## Page purpose

`/zh-CN/futures/` is a real contract-entry route. The observed Binance application
registers `futures` with route ID `743f`. Its page module delegates to module
`41906`, which selects a valid previous UM contract or defaults to `BTCUSDT`.
An indefinitely empty page is not its intended final state.

Sources: [entry module](https://bin.bnbstatic.com/static/chunks/page-743f.ce7935bd.js),
[contract selection](https://bin.bnbstatic.com/static/chunks/78955.382ce295.js).
The precise downstream history push/replace implementation was not inspected.

## Observed failure and recovery

Both a concrete USUSDT trading page and the contract-entry page had HTTP 200
documents and completed load events, but remained in startup. The router was
not ready, its transition remained pending, and the trading page had no native
orderbook or chart container. A small userscript panel does not establish host
application readiness.

The current [framework](https://bin.bnbstatic.com/static/common/framework.2922525e.js)
waits for route readiness before hydration. Its registered theme `beforeResolve`
hook records `get-cache-theme-config-start`, awaits configuration, then records
the end marker and advances the route. In the
[main bundle](https://bin.bnbstatic.com/static/main.37a180b9.js), module `99940`
first awaits a localForage cache read. A cache miss loads a theme JavaScript
chunk. The cache wait has no application-level deadline; webpack's separate
script loader does have a 120-second deadline.

The user subsequently reported that the pages had recovered. The currently
loaded documents contained the following timing records; values are milliseconds
from each document's navigation start:

| Document | Time origin | Event | Start | End |
| --- | --- | --- | ---: | ---: |
| USUSDT | 1790915945589.4 | Theme configuration | 924 | 1214752 |
| USUSDT | 1790915945589.4 | Language cache branch | 856 | 1214836 |
| Futures home | 1790915960355 | Language startup gate | 647 | 1200211 |

The USUSDT theme gate and home language gate ended about 225 ms apart in wall
time. USUSDT then had a ready router, native orderbook, chart container, and
canvas. A subsequent theme read took 5 ms. A fresh read-only
`indexedDB.databases()` metadata query completed in 3 ms and confirmed the theme
database existed, without reading its records.

Earlier, an IndexedDB metadata query remained pending at a subsequent check.
Intervening document navigations invalidated its remote object, so its eventual
outcome cannot be recovered or equated with the later successful query. These
samples span different document lifetimes; do not describe the entire session
as one uninterrupted navigation or claim that nobody refreshed it.

The strongest supported conclusion is a stalled theme/configuration route gate,
with browser-local storage readiness implicated by the concurrent cache waits
and recovery. The precise storage driver, blocking connection, rejected versus
pending internal theme operation, and browser defect remain unproven. A rejected
async hook that never calls its continuation can also leave a route pending.

## Network comparison

macOS HTTP, HTTPS, and SOCKS settings pointed to `127.0.0.1:7890`.
One bounded request for the exact main bundle through that proxy returned HTTP
200 in 0.904 seconds. A direct request timed out during connection establishment
after 15 seconds. These results establish only those two shell request paths;
they do not certify every browser request or exclude an earlier transient
network failure. There is no evidence here that disabling the proxy is a fix.

## Related upstream reports

- [localForage #821](https://github.com/localForage/localForage/issues/821)
  describes a first `getItem()` that never settles after cross-tab object-store
  changes. [PR #807](https://github.com/localForage/localForage/pull/807) fixed a
  connection/version-change problem. The maintainer
  [released 1.10.0](https://github.com/localForage/localForage/pull/807#issuecomment-901439908)
  and a reporter [confirmed the fix](https://github.com/localForage/localForage/pull/807#issuecomment-901563757).
  The observed Binance bundle already contains localForage 1.10.0 and
  `onversionchange` connection closing. Missing this old fix is not a supported
  explanation for the current incident.
- [#685](https://github.com/localForage/localForage/issues/685) reports silent
  `indexedDB.open()` hangs and community recovery after Chrome restart. Another
  reporter [found site-data clearing also unresponsive](https://github.com/localForage/localForage/issues/685#issuecomment-381134641).
  The [maintainer did not establish a root cause](https://github.com/localForage/localForage/issues/685#issuecomment-381339640).
- [#912](https://github.com/localForage/localForage/issues/912#issuecomment-883958597)
  contains a Chrome multi-tab pending-operation report. An earlier comment
  [associates clearing data across open tabs with a hang](https://github.com/localForage/localForage/issues/912#issuecomment-566066515).
  These are community observations, not confirmed remedies for Binance.
- [Chrome Page Lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
  recommends closing IndexedDB connections before freezing so other same-origin
  tabs are not affected. [MDN's blocked event documentation](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event)
  explains version-change blocking. Neither proves a freeze or lock occurred here.

The cited GitHub discussions were inspected with their full comment threads,
follow-ups, and linked fix. Direct Binance Reddit threads were inaccessible
during this investigation and are not treated as verified supporting evidence.

## Next occurrence

Preserve the failed page, record document time origin and the route/cache marks,
and compare browser storage readiness with bounded network evidence before
changing settings. Collect from navigation start if the goal is to identify the
specific unresolved storage operation. Browser restart is a community recovery
experiment, not a proven durable fix; clearing site data is not the first step.
Do not patch Binance's router or call its continuation from a userscript.

The separate userscript bug was broad route recognition (`home` became `HOME`)
and Strategy31's non-trading status lifecycle. Fixing those defects does not
establish that the host startup stall is fixed.

## 2026-10-06: native lock-queue hotspot and verified session recovery

This follow-up identified a native browser bottleneck, beyond the earlier
application-level cache gate. It did not identify the initial transaction
producer or establish a permanent fix.

In the normal Chrome profile, USUSDT rendered while 1000LUNCUSDT, PHAUSDT and
ALICEUSDT retained the Futures skeleton. Their theme-start marks had no matching
end. Existing ALICE requests included pending native IndexedDB opens for
`theme-config-futures-trade-ui` and `i18n-data-zh-CN`. The user reported that
unsigned-in DIAUSDT rendered both the orderbook and TradingView in incognito.
This comparison alone did not isolate extensions, authentication and storage.

The user also supplied a screenshot of `chrome://indexeddb-internals/` showing
only its heading and filter input, without database rows or a Force close button.
The exact-version [frontend source](https://github.com/chromium/chromium/blob/154.0.8037.98/content/browser/resources/indexed_db/indexeddb_internals.ts#L188)
registers the input listener only after metadata arrives. The
[backend](https://github.com/chromium/chromium/blob/154.0.8037.98/content/browser/indexed_db/indexed_db_context_impl.cc#L596)
waits for bucket metadata callbacks, including work posted to bucket contexts;
the UI also waits for all loaded storage partitions. One stalled branch can
therefore prevent the entire list from appearing.

A three-second native sample of Chrome 154.0.8037.98 ARM64 captured all 233
samples of one busy worker inside `Connection::RemoveTransaction`; 232 of them
continued through the blocking-check path below:

```text
BucketContext::RunTasks
Database::RunTasks
Connection::RemoveTransaction
Transaction::IsTransactionBlockingOtherClients
PartitionedLockManager::IsBlockingAnyRequest
```

The deepest frames repeatedly included `SupportsUserData::GetUserData` through
the lock-request filter. Offline symbolication used the
[official dSYM](https://dl.google.com/chrome/mac/stable/dsym/googlechrome-154.0.8037.98-arm64-dsym.tar.bz2),
whose UUID exactly matched the running Framework:
`4C4C4433-5555-3144-A154-EC6770D35233`. `atos` reported an unsupported DWARF
attribute but returned function names; no source-line resolution is claimed.

The matching source shows that
[`RemoveTransaction`](https://github.com/chromium/chromium/blob/154.0.8037.98/content/browser/indexed_db/instance/connection.cc#L238)
checks remaining started transactions, while
[`IsBlockingAnyRequest`](https://github.com/chromium/chromium/blob/154.0.8037.98/components/services/storage/indexed_db/locks/partitioned_lock_manager.cc#L151)
walks held locks and their waiting queues. These loops explain the sampled work;
the sample does not reveal queue lengths, database names or the originating
JavaScript calls. Do not label it a proven deadlock, corruption, or userscript
defect.

Recovery observations, with explicit permission to close the four named tabs:

- Gracefully closing only USUSDT's existing theme-cache connection did not
  restore the failed pages. A successful `close()` call did not prove all work
  on that connection had finished.
- Closing all four normal-profile Binance tabs reduced the sampled Chrome
  process CPU from about 104.5% to 4.6%. The same worker waited in 254 of 255
  subsequent samples.
- Without restarting Chrome or clearing site data, the user observed that the
  existing IndexedDB internal page automatically displayed its list.
- A newly opened, sole DIAUSDT tab rendered the orderbook and TradingView,
  verified in a screenshot. Its initial theme-cache gate took about 287 ms.
- One ordinary reload also rendered both components; the initial theme gate
  took about 103 ms. The page remained mounted at a later four-minute check.

The initial culprit tab, transaction producer, and the contribution of native
Binance code versus extensions remain unknown. Incognito success and this
recovery do not prove either side innocent. Keeping one trading tab is the
verified session workaround; its long-term stability and reopening multiple
trading tabs were not validated. No proxy, extension, or persistent-cache change
was made in this follow-up, and Force close was not performed.

Upstream [CL 6133080](https://chromium-review.googlesource.com/c/chromium/src/+/6133080)
optimized this blocking check, including a single-client shortcut; its core
behavior is already present in this Chrome version.
[CL 7252092](https://chromium-review.googlesource.com/c/chromium/src/+/7252092)
adds diagnostic connection counts rather than a performance fix. Both public
CL message/comment threads and final diffs were inspected. The linked
[issue 384476946](https://issues.chromium.org/issues/384476946) was not readable
anonymously, so its full discussion, status and applicability remain unverified.
No confirmed new repair version or applicable official switch was found.

Local incident artifacts are under `/tmp/binance-multi-startup-o2R1Oy/`, including
`symbolicated-idb-worker.json`, `recovery-result.json`, and the before/after
screenshots. The large downloaded symbol files are disposable and are not
required to read those retained results.

## 2026-10-06: recurrence and chart-save transaction amplification

After additional trading tabs were opened, the user supplied two IndexedDB
internal-page screenshots. One explicitly showed `chart_delivery` /
`keyvaluepairs`, with a running readwrite transaction followed by many blocked
readwrite transactions, aged about 127 seconds. The other showed blocked writes
to a `usage` store, but omitted its database heading. Transaction identifiers
are not queue lengths. These screenshots are snapshots, not continuous traces.

A bounded transaction observer on USUSDT subsequently counted 13,050 newly
created `chart_delivery` readwrite transactions, 1,460 `chart_futures` readonly
transactions and 591 `chart_futures` readwrite transactions. The observation
was shorter than 105 seconds; its precise stop timestamp was not retained, so
it does not establish a 60-second rate. The first through 7,000th sampled
delivery writes spanned about 510 ms. A 2,000-listener limit meant most delivery
transactions were untracked after creation; zero observed chart completions
does not prove that all 13,050 transactions remained blocked. The observer did
not read records or initiate transactions, and the native method was restored.

The loaded [TradingView chunk](https://bin.bnbstatic.com/static/chunks/TradingView.99bc5074.js)
was byte-for-byte identical to the inspected public source. Module `70940`:

1. Reads all current-namespace keys and selects `#TV_SYMBOL-*` and
   `myTradingView*` keys.
2. Reads every selected value concurrently.
3. Unconditionally writes every selected key to the other chart namespace,
   again concurrently. The namespaces include `chart_futures` and
   `chart_delivery`; a USDT page therefore writes the delivery database without
   a COIN-M page being open.

This synchronization runs after native saves and directly on active-chart
changes. Its entry count must not be labeled a save count. Native save callbacks
also write the current layout and symbol data before invoking synchronization.

A second observation combined transaction counts, drawing-event subscriptions
and conditional breakpoints that always returned false. Breakpoints were bound
to verified executable locations in the loaded source; they did not replace
save callbacks. During 45.115 seconds it observed:

| Observation | Count |
| --- | ---: |
| Native scheduled-save executions | 21 |
| Drawing `properties_changed` / `remove` events | 15 / 5 |
| `onAutoSaveNeeded` events | 1 |
| New synchronization starts | 3 |
| Key-read batches / total selected keys | 27 / 7,830 |
| Synchronization batches reaching destination writes | 0 |
| New current-chart readonly / readwrite transactions | 7,836 / 24 |

The read batches averaged 290 keys. There were more resumed read batches than
new synchronization starts, demonstrating that this window included earlier
asynchronous work. The prior 13,050 writes equal 45 times 290, but that arithmetic
alone does not prove the prior batch count or a constant historical key count.
Debugger instrumentation can affect scheduling and performance; these counts
are not an uninstrumented performance benchmark.

A separate 40.393-second drawing observer identified all 11 property-change
events as `LineToolOrder`; six removals originated in the native shape update
loop in [chunk 66202](https://bin.bnbstatic.com/static/chunks/66202.233a75ac.js).
The user confirmed an automatic task was running during this observation.
Native `Gr` schedules a complete save after every drawing event except `click`
and `move`, using independent 100-ms timers. The precise automatic task was not
inspected or stopped.

At the same time, a screenshot confirmed MUBARAKUSDT had a populated orderbook
but an empty TradingView region, with no chart iframe. This recurrence was not
fixed by the earlier session recovery. The evidence identifies active native
save amplification; it does not prove a corrupted database or exclude every
other producer. The separate `pika-i18n-usage` producer was also observed.

All conditional breakpoints and drawing observers were removed, and the native
transaction method was verified restored. No records were read or deleted by
these probes. Evidence files are in `/tmp/binance-idb-producer-nfcyS5/`, including
`us-transaction-observation.json`, `combined-save-mirror-count.json` and
`drawing-origin-count.json`.

### Order-line visibility control

The current [TradingView library](https://www.binance.com/static/chart/tradingview/en/trading-platform-30/bundles/library.50c4aba0e2bfdfef5b8b.js)
defines `LineToolTrading.state()` as returning `null`.
[LineToolOrder](https://www.binance.com/static/chart/tradingview/en/trading-platform-30/bundles/line-tool-order.bd1676028df5fdf272ee.js)
inherits that implementation. The pane serializer excludes null source states:
these order lines are not saved in the chart snapshot. Their property and remove
events nevertheless reach Binance's drawing-save listener. This identifies
unnecessary whole-chart persistence triggered by transient order graphics.

With explicit permission, the native USUSDT chart menu's checked `当前委托`
(`Open Orders`) option was temporarily unchecked, then restored. The automatic
task was not stopped or controlled by the diagnostic. One initial toggle and
one initial restore attempt encountered a closed tooltip and failed their
pre-action assertions; neither attempt clicked anything. The actual checkbox
transitions were separately verified as false and then true.

- A 60.001-second observation beginning about 27 seconds after hiding the lines
  recorded zero drawing events, zero scheduled native saves and zero chart
  writes. Only ten current-chart readonly transactions were created.
- The browser process still showed about 92.2% CPU, and MUBARAKUSDT still had no
  TradingView iframe. Stopping this producer did not immediately drain or abort
  previously queued work.
- Restoring the original checked state produced thirteen property-change
  events and thirteen native saves within the remaining approximately
  eleven-second observation segment. The setting was verified checked again.

This on/off/on comparison establishes that the native order-display path was
an active save producer. It does not by itself prove every failed page was
blocked exclusively by that producer. Hiding these graphics is a validated
way to stop this source while leaving the order list available; permanent
application and another all-tab recovery require separate authorization.

Simply serializing callbacks is not a complete repair: active-chart changes
bypass that entry point, some callbacks discard their completion Promise, and
the native mirror catches failures before all remaining writes necessarily
finish. It also retains the same total work and can accumulate a JS queue.
A repair preserving order graphics would need to filter the native save
listener specifically, including reliable identification of removed order
graphics, while preserving manual drawings and other subscribers. Such a
userscript implementation has not been validated or deployed.

The original display state was restored, all diagnostic globals and breakpoints
were removed, and `IDBDatabase.prototype.transaction` was verified native.
Additional evidence: `orders-hidden-count.json`, `orders-restored-count.json`
and `before-hide-save-count.json` in the same incident directory.

### Contribution of the userscript save coalescer

The user questioned whether the earlier batch-save optimization was involved.
The USUSDT page's loaded orderbook source was version `2.7.217` and contained the
complete current generated install artifact byte-for-byte. This establishes
loaded-source identity for that tab, not just installed metadata.

The October 5 change `a846922` replaced each burst/round's last `pendingSave`
with an array of accepted callbacks. `deliverSaveCallbacks` serializes once,
then synchronously invokes every callback with a separate copy of the final
snapshot. It does not await callback Promises. For N native persistence
callbacks, the old intercepted batch started one native persistence chain;
the current batch starts N chains. Each successful chain can subsequently
mirror K historical keys. Thus `fullSaveCount: 1` describes serialization,
not one database save or one transaction. Current tests explicitly require one
serialization and N callback deliveries; they do not establish fewer native
database writes.

A 45.009-second live observation directly counted one coalescer batch containing
eight accepted callbacks and eight callback invocations. The same window
counted eighteen native scheduled-save executions. These window counts need not
represent identical sets of requests, but they prove the current coalescer was
actively replaying multiple persistence callbacks in one batch. Evidence is in
`coalescer-attribution.json`; the conditional breakpoints were removed afterward.

This is a verified contribution and a performance-contract gap, not proof that
the change caused every earlier blank page. Native saves outside the coalescer
and active-chart synchronization also remain. Returning to unconditional
last-callback dropping would lose other callers' completion behavior. A repair
must distinguish redundant native persistence from callbacks that must be
delivered, or remove the unnecessary native broker-drawing save trigger at a
reliably identified boundary. No such durable repair is claimed here.

### Historical global-facade prototype: first stage

The following three stages preserve the original global-facade research. That
design changes native mixed-operation ordering and is no longer the production
candidate. The current module-scoped mirror experiment is described afterwards.

With authorization for an isolated experiment, a prototype was added under
[`experiments/binance-chart-storage/`](../experiments/binance-chart-storage/README.md).
It uses an exact public Binance Rspack runtime and localForage module `43917`
fixture, a fresh Playwright Chromium context, synthetic chart records and real
IndexedDB. All external requests in these lab tests are blocked. The two initial
entrypoints (`adapter.js` and `capture.js`) reject origins other than
`https://chart-storage.test`; no adapter was installed in a
real Binance document, and no production database or trading action was touched.

The tested intervention is the library's actual `createInstance` boundary after
its first factory execution. A synchronous capture hook runs before the host's
`require` returns. A separate facade survives the library's asynchronous driver
initialization, queues calls across instances in issue order and combines them
into bounded native transactions. Each write compares against the stored value
inside that transaction and skips only an unchanged existing record. Every
accepted optimized-batch Promise and callback completes after commit or abort. It does
not reuse one transaction behind multiple unmodified localForage handlers.

For 290 prepopulated synthetic records and eight sequential unchanged-save
rounds, native localForage produced 4,640 transactions and 2,320 puts. The same
workflow through the prototype produced 16 transactions and zero puts. Eight
simultaneous save rounds produced ten transactions and zero puts. Both prototype
workloads delivered 4,640 distinct callbacks, returned matching results, retained
matching persisted data, and ended with no pending requests. Comparison increased
native gets from 2,320 to 4,640 in the sequential workload; this is evidence of
reduced transaction/write amplification, not reduced total reads or a measured
CPU/latency improvement.

The browser tests also cover initialization, mixed-operation ordering,
null-versus-missing keys, native barriers, capacity errors, abort rollback,
callback exceptions, connection close/version change, stop/drain, persistence
after reload and simultaneous two-page writes. A held native transaction ensures
the two-page test has both writes queued before releasing the lock; only one
physical put is needed when both request the same new value.

All 31 Chromium scenarios and three Node origin-guard tests passed, including
real quota exhaustion configured before the first database write. That quota
case rejected every operation in the batch with `QuotaExceededError`, completed
all callbacks and preserved prior values. Test-policy lint and experiment syntax
checks passed. The rendered lab report was inspected. Results and the remaining
production boundary are recorded in the experiment README.

This remains a restricted prototype. The test browser is Chromium
`151.0.7922.34`, not the affected Chrome `154.0.8037.98` profile. Module identity,
early injection, real chart values and all native callers require validation
before an actual page adapter can be designed. Batched rollback and read
completion timing differ from native localForage, and native barriers retain
their own one-time connection recovery. The prototype cannot make two databases
atomic, repair separate application read/modify/write races or drain previously
queued transactions. No permanent blank-page repair is claimed by these tests.

### Historical storage integration follow-up: 2026-10-06

Further source inspection and regression tests identified two integration
obstacles before any production storage interception:

1. Installing the original chunk `push` wrapper before the Rspack runtime
   missed first execution. The runtime retains that wrapper as a parent append
   callback, reached after registration and synchronous host execution. The
   new `bootstrap.js` observes the runtime's first `push` assignment and captures
   the export before the host uses it, for both module/runtime script orders.
   Diagnostic failure rejects observation without poisoning the host's cached
   module. Cleanup also preserves a newly created queue during an active append.
2. TradingView's save callback returns JSON parsed inside its iframe. Comparing
   its object prototype with the parent's `Object.prototype` rejected valid
   snapshots. The adapter now recognizes native plain JSON objects across realms;
   real iframe regressions verify nested data and own `__proto__` properties,
   while Date, class and forged-prototype values remain rejected.

The current user USUSDT page's module factory was read without requiring the
module, reading records or refreshing the page. Its complete module-property
SHA-256 was `f33d0f78c185ff592f1f0781e21baab63e7db937054866c37afdfda028e9e647`,
matching the fixture. This verifies one current build, not a stable public API.

The added passive `preflight.js` briefly observes the real export's
`createInstance` and returns each original instance. It records fixed chart
database/default-store metadata and creation times, with at most sixteen
timestamp records. It does not wrap instance methods, initialize storage,
record keys/values, or enable the adapter. Only this preflight and bootstrap
additionally allow the exact top-level USUSDT incident path. The storage adapter
and original capture remain restricted to the lab origin. Manual stop and a
30-second deadline restore the native factory; dedicated tests prove retained
original instances still work and passive observation adds no IndexedDB opens,
transactions, gets or puts. Other cleanup branches have not each been separately
tested.

The expanded validation passed all 45 Chromium scenarios (31 prototype and
14 integration) and eight Node origin/path/frame rejection cases. Test-policy
lint and syntax checks also passed. These fixture-based scenarios use real
IndexedDB; they do not exercise the user's installed extension or account.

Anonymous Chrome `154.0.8037.98` observations then used separate temporary
profiles, no extensions and no login, with synchronous `addInitScript`
installation before navigation. The initial run established capture before the
first chart instance. A later screenshot showed the default Basic chart and
orderbook working, so waiting for a TradingView iframe in that mode was an
incorrect test premise. One mode-selection attempt also timed out because the
actual native label is `Trading View`, including the space.

Using the verified label produced an iframe and seven canvases, but screenshot
inspection still showed the loading animation. That run's raw `ui_ready` result
is too weak to establish a rendered chart. The final observation therefore
waited for native `activeChart().dataReady()` and subsequent paint frames, then
inspected a screenshot showing USUSDT candles, moving averages, volume bars and
the populated orderbook. The captured library's no-callback `dataReady()` checks
for nonempty main-series data and does not initiate storage operations.

In this final run the module was captured at 2,184.1 ms, before the first chart
instance at 3,008.7 ms. At 7,429.2 ms there was one TradingView iframe, twelve
canvases and `dataReady() === true`; no page errors were observed. Twenty futures
instances and zero delivery instances were observed before stop. This establishes
the capture ordering and one successfully rendered anonymous page. All temporary
browsers were closed, and the final observer reported `active=false` with no
failure. Results and the inspected screenshot are retained in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-storage-preflight-chart-ready-1nRAMB/`.

At that stage, production blockers remained. The actual source creates and retains localForage
instances during React rendering, and Basic charts share these databases with
TradingView. The adapter's then-current stop drained accepted work but rejected later
calls through retained facades, so restoring the factory alone cannot safely
disable it in an already mounted page. Real changed snapshots, Basic settings
and clear operations, capacity and connection behavior, native layout
read/modify/write and cross-database mirroring need integration coverage. Batch
rollback and read completion timing still differ from native behavior.

The anonymous injection does not verify Tampermonkey document-start/page-world
timing, an affected logged-in profile, sustained trading load or blank-page
recovery. No production userscript source or install artifact changed; no adapter
was installed in Binance and no existing trading tab was refreshed by this
follow-up. The storage-layer experiment demonstrates reduced transaction and
unchanged-write work, not a deployed repair.

### Historical facade lifecycle and original host workflows: 2026-10-06

The next implementation stage addressed the specific stop incompatibility above.
Six failing browser regressions first reproduced rejected retained-facade calls,
premature native-factory restoration and incomplete descriptor cleanup. The
adapter now closes optimized admission, drains the finite accepted queue and
only then restores the original factory descriptor. Calls through retained or
newly created managed instances during drain wait for that boundary and resume
through the original native methods afterwards. Full arguments, native receivers
and method-specific callback signatures are preserved. Reinstallation on the
same export is prohibited until a fresh page lifecycle, preventing old facades
from bypassing a second installation's queue.

The nine lifecycle scenarios include a real write lock, a version-one connection
blocking the library's version-two database initialization, abort completion,
callback reentry, native Blob and API use after stop, ownership changes and
descriptor restoration. A review also identified value-inspection reentry:
a transparent Proxy could call stop during JSON validation before admission.
That failing regression is fixed by rechecking the active phase immediately
before enqueue. An ownership change during drain rejects stop and preserves
the external factory instead of overwriting it. No queued operation is retried.

An independent native-library comparison established that simultaneous native
`setItem` and `getItem` calls can read the previous value: the captured set method
creates its transaction one Promise stage later. Post-stop tests now compare
against that actual native baseline, while separately proving final persistence
and the inability to overtake the accepted optimization queue. A stopped adapter
does not impose its stronger issue-order semantics on later native calls.

Compatibility tests also now execute the original host persistence functions,
rather than only a synthetic get/set workflow. The
[public host fixture](../test/fixtures/binance-chart-storage/host-persistence.md)
contains 273 exact original source fragments and 203 original dependency factories
from seven public bundles. An independent reviewer verified full source hashes,
byte counts and every original UTF-16 range. The fixture retains the original
TradingView save/load functions, save callback and cross-database mirror, together
with Basic storage, annotation conversion and old-key migration. It supplies only
the documented storage/widget/reference context and runs through the captured
Rspack runtime and real localForage. Upstream Basic React subscriptions, debounce,
JSON serialization and actual chart rendering remain outside these fixtures.

Fourteen host-workflow scenarios run the same workflows against native storage
and the adapter. They verify drawing removal without resurrection, layout
retention, both databases' mirror contents, all six Basic storage categories,
old-key migration and shared-store clear. Four saves with revisions `[1,1,2,2]`
used 64 transactions and 36 puts natively, versus 28 transactions and 11 puts
through the adapter. The expected data matched in both databases.

A bounded load then seeded 290 identical historical records in each database
and executed eight rounds of four concurrent original save/mirror chains.
Each round changed the current snapshot and drawing. All 32 chains completed;
both databases' 293 keys, all 580 historical values and final snapshot, layout,
drawing and native load results matched expectations.
The four chains within a round use the same revision, and rounds are awaited
sequentially; this does not test competing different revisions.

| Isolated 32-chain workload | Transactions | Puts | Gets |
| --- | ---: | ---: | ---: |
| Native | 18,912 | 9,472 | 9,408 |
| Adapter | 112 | 32 | 18,880 |

The adapter skipped 9,440 unchanged writes; its 112 transactions include 32 native
barriers. Failure, rejection, abort and pending-operation counts were zero.
Setup and final verification I/O are excluded. The measured installation-lifetime
peak was 1,172 operations and 181,767 bytes; workload counters and lifetime peaks
are labeled separately in the attachments. Individual lab elapsed-time samples
are not evidence of sustained production latency or CPU improvement.
The complete load report and extracted measurements are retained as
`/tmp/chart-storage-load-retained-20261006.json` and
`/tmp/chart-storage-load-measurements-20261006.json`.

The tests deliberately retain a further compatibility difference. Concurrent
native sets can create transactions after a later-invoked Basic clear, leaving
those new records present; the adapter enforces issue order and removes them.
The normal shared-clear path awaits completed saves first and matches in both
implementations. Separate assertions expose the concurrent difference instead
of hiding it behind an equivalence claim.

All 68 Chromium scenarios (31 prototype, 14 startup integration, nine lifecycle
and 14 original host workflows) and eight origin/path/frame Node cases passed.
Full test-policy lint, syntax checks and independent code review passed. This
stage corrected the experiment's stop behavior and broadened its compatibility
evidence. It still does not establish Tampermonkey page-world timing, real saved
data compatibility, long-running stability, mounted live UI behavior or recovery
of the affected profile. No production userscript, installed script, user database
or trading action was modified by the experiment.

### Current module-scoped mirror candidate: 2026-10-06

The global facade above is historical research, not the production candidate.
Its issue-order queue changes the captured native driver's ordering between
`setItem` and `getItem`, `removeItem` or `clear`. In particular, native set-value
preparation can defer its transaction until after a later Basic clear; the facade
orders that set before clear. Preserving each implementation's own expected
result does not make them equivalent. Native storage methods must remain native.

The new experiment replaces only the destination-write `Wr=fr.map(...)` RHS in
public module `70940` of `TradingView.99bc5074.js`. Acorn identifies a unique
expression at `[33783,34025)` within the complete method at `[6665,36819)`.
The method's SHA-256 is
`37d249d1ceec4a41b54a959c1ab2c4b52b3061e504cf8cd81a824962af8c6c88`.
Generation pins the full public source and method, rejects a colliding service
identifier and verifies that undoing the one insertion reproduces the whole
original method byte for byte. It emits static JavaScript without runtime
`eval` or `new Function`:

```js
Wr = __dispatchChartMirror(Sr, fr, () => ORIGINAL_FR_MAP_EXPRESSION)
```

Registration compares the exact full `Function.prototype.toString` result before
replacing the factory. The bootstrap selects `70940` only with the explicit
replacement callback; default `43917` observation is unchanged. Mismatch rejects
observation while preserving native module execution and cache behavior. A
review found that a replacement callback could synchronously stop its observer
yet still return a candidate that was installed. Both runtime orders reproduced
that failure before a post-callback active-state check fixed it. Stop now retains
the original registration in that case; ordinary cleanup restores queue and
factory slots while preserving already executed cached exports.

Source `keys()` and every source `getItem()` remain unchanged, as do the original
mirror guards, catch and target exclusion. The ordinary TradingView save, Basic
settings and reset paths are outside the replacement. The dedicated writer never
hooks `createInstance`, `setItem`, `getItem`, `removeItem` or `clear`. It uses one
real destination transaction to read current values and write changed or missing
records; null and missing are distinguished. The tests execute the original
callback fragments and dependencies rather than rewriting the host save logic.
See the [scoped fixture](../test/fixtures/binance-chart-storage/mirror-scoped.md)
and [current experiment contract](../experiments/binance-chart-storage/README.md).

The writer defaults to `scope: 'lab'`, restricted to `https://chart-storage.test`.
An explicit `isolated-ususdt-probe` scope permits only the exact top-level
`https://www.binance.com/zh-CN/futures/USUSDT` page. Origin/path/frame checks cannot
prove anonymity; a dedicated harness must own a fresh Chrome process/profile
without login or extensions. Default production-origin refusal is unchanged.
Both scopes require the native IndexedDB `keyvaluepairs` stores in `chart_futures`
and `chart_delivery`. The writer
validates/copies JSON and bounds entries, input bytes, stored-read bytes and
pending work. Empty input performs no initialization or transaction. A failed
batch rolls back completely and is never replayed. Stop drains only the finite
accepted set; later mirror calls wait for that fence and evaluate the retained
original async per-key map, while ordinary native operations remain independent.

This narrowing preserves ordinary API behavior but deliberately changes mirror
atomicity and interleaving. Native per-key mirror writes can partly commit;
the new destination batch commits or aborts as a whole and can interleave
differently with native clear or another tab. Limits add explicit rejection
conditions. The original outer catch still owns reporting. Source reads remain
non-atomic, separate databases remain independent, and application read/modify/
write races remain outside the fix.

The new suites contain 19 scoped-integration scenarios and 18 writer scenarios.
They cover exact source identity, native set/get/remove/clear results and callback
order, method identity, original guards and save chains, null/empty data,
registration/cache cleanup, reentrant stop, real abort/quota rollback, limits,
blocked initialization, clear interleaving and another tab's changed data.
Before the explicit page-probe scope, the combined experiment run passed 105 Chromium scenarios, eight Node
origin/path/frame cases and the full test-policy lint. These include the retained
historical suites; that count does not turn the facade into the current candidate.
After the explicit scope was added, three new origin/scope regressions first
failed, then the expanded Node suite passed all 18 cases. The 37 scoped/writer
browser scenarios and full test-policy lint also passed. Scope permission and
anonymous-profile isolation are distinct contracts.

The current bounded workload again starts with 290 historical keys per database
and completes eight rounds of four concurrent original save/mirror chains. Each
round uses one changed revision, and later rounds await the preceding round.
Every historical value, both databases' 293 keys and final saved drawing data
match. Setup and final verification I/O are excluded.

| Current 32-chain workload | Transactions | Puts | Gets |
| --- | ---: | ---: | ---: |
| Native | 18,912 | 9,472 | 9,408 |
| Scoped mirror writer | 9,568 | 112 | 18,784 |

The 112 puts comprise 96 ordinary source writes and 16 changed
destination writes. All native source reads remain; comparing 293 destination
keys in each of 32 mirrors adds 9,376 gets. Both workloads finish with zero
pending or aborted transactions. Counts are verified in
`/tmp/chart-storage-final-20261006.json` and the extracted
`/tmp/chart-storage-mirror-measurements-20261006.json`. They demonstrate less
transaction/write work, not fewer reads, sustained CPU/latency improvement or
recovery of the affected profile.

A separate anonymous Chrome `154.0.8037.98` run used a temporary profile without
extensions or login and injected the full static `70940` replacement before
registration. Its service would execute only the exact original native thunk;
the lab writer was not installed. Strict pin validation attempted once, matched
once, and the replaced full module executed once, with capture at 5,975.4 ms.
At 10,015.6 ms the native chart reported `dataReady() === true`. The inspected
screenshot showed USUSDT candles, moving averages, volume and a populated
orderbook. There were no page errors; observation stopped and the browser closed.
Results and the screenshot are retained in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-native-preflight-HeCAar/`.

That run recorded **zero mirror dispatches**. It verifies complete module startup
and rendered readiness with a native-only service, but neither invokes the
replaced mirror branch nor proves real batched writes.

A subsequent independent anonymous Chrome `154.0.8037.98` shape probe exercised
the original native mirror. During the explicitly bounded native interval change
from `60` to `15`, its completed count advanced from 6 to 7. The earlier mirrors
are not all attributed to one click. Final totals were seven native completions,
all targeting `chart_delivery` with IndexedDB, zero failures and zero JSON-shape
failures. The observed maximum was four entries, 49,003 batch bytes and 24,504
bytes for one record. This sample fits the current JSON and size contracts; it
does not establish compatibility for every user's saved layouts or drawings.
The final chart remained data-ready at resolution `15`; the inspected screenshot
showed the chart and populated orderbook. Observation stopped and the temporary
browser closed. Evidence is retained in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-shape-probe-yDfadK/`.
This is real native mirror invocation and data-shape evidence, not real-page
bulk-writer validation.

### Anonymous bulk and native-only preflight: 2026-10-07 (Beijing)

A later independent anonymous Chrome `154.0.8037.98` run enabled the actual batch
writer through the explicit USUSDT probe scope. Its report begins at
`2026-10-06T16:24:24.572Z`, October 7 in Beijing. The pinned factory matched and
executed once. Five accepted batches committed five transactions, with eight
committed record writes and eleven unchanged writes skipped. Failed, rejected, aborted
and pending counts were zero; peaks were two pending batches and 98,006 bytes.
The one-hour chart stage observed four completed mirrors; the bounded `60` to
`15` transition then advanced completions from 4 to 5. The first four are not
all attributed to one click.

After `writer.stop()`, selecting the four-hour interval advanced completed
mirrors from 5 to 6 and `nativeCalls` from zero to one. The complete writer
statistics remained unchanged. Each of the three stages read back four target
records and matched them to its captured dispatch snapshot. The runner required
native chart data readiness; the inspected final screenshot showed four-hour
USUSDT candles, moving averages, volume and the populated orderbook. There were
no page errors, observation stopped, and the temporary browser closed. The report
and screenshot are retained in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-bulk-probe-3YcdXL/`.
This proves bounded real-page batch execution and native continuation through
the mounted callback in an independent anonymous browser. It does not enable
the writer in the user's logged-in profile or establish blank-page recovery.

Three earlier attempts stopped at the anonymous-page UI check before matching
the factory or dispatching a mirror. Registration text selected both a button
and a link; selecting the unique accessible button corrected that check. Those
attempts provide no evidence of a storage failure. The checked-in anonymous
runner, entry and contract now make the workflow independently repeatable,
with a fresh Chrome context, fixed-URL navigation/runtime guards, explicit failure
accounting and browser cleanup. The standalone command is documented in the
[experiment README](../experiments/binance-chart-storage/README.md).

The origin/scope suite has 18 Node cases, the anonymous-probe contract adds four,
and native-only preflight adds 18: all 40 passed. The 37 mirror browser scenarios
also passed. These counts identify the later validation scope separately from
the earlier 105-browser/eight-Node experiment run.

Tampermonkey delivery needs its own native-only acceptance on an authorized test page.
The official [Content Script API documentation](https://www.tampermonkey.net/documentation.php?q=content_script_api)
states that default **Content Script** mode has no real `document-start` support;
on Chrome, ordinary **UserScripts API** has the same restriction. **UserScripts
API Dynamic** injects both wrapper and script immediately and supports it. The
official [`@sandbox` documentation](https://www.tampermonkey.net/documentation.php?q=sandbox)
describes `raw` as requesting `MAIN_WORLD`, but permits another enabled sandbox
when injection there is unavailable, such as under CSP. Metadata alone therefore
cannot prove either document-start timing or MAIN_WORLD access to the native
queue. The extension must independently demonstrate both, strict pin before
first factory execution, native mirror completion and clean stop before an
optimized entrypoint can be considered. Missing evidence must reject replacement.

The independently reviewed `native-preflight-core.js`, userscript entry and
build now generate `native-preflight.user.js` as a self-contained review artifact.
Its build asserts a four-source dependency graph with no writer or runtime loader.
For 30 seconds the core records bounded in-memory diagnostics and synchronously
returns the exact original native thunk result, retaining its array and error
identities. It does not inspect persisted values or add storage calls. Manual
stop, pagehide, scope changes and the deadline retire observation. The artifact
was neither installed nor published at that stage; its metadata and offline
tests did not establish Tampermonkey acceptance.

The generated native-only artifact was then run through `addInitScript` in a
fresh anonymous Chrome `154.0.8037.98` context, beginning at
`2026-10-06T16:30:27.651Z` (October 7 Beijing time). It recorded one attempt,
one exact match and one factory execution, with module capture completed, four
native thunk dispatches and 15 counted entries. Failure was null and page errors
were zero. Manual stop set `active=false`, and the temporary browser closed.
The inspected screenshot showed the chart, moving averages, volume and orderbook.
Evidence is retained in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-native-artifact-probe-JSBjWC/`.
The preflight's `completed` field describes factory capture, and its dispatch
count is not an asynchronous write-commit count. This is actual built-artifact
execution through Chrome initialization-script injection, not Tampermonkey
injection or installation. The artifact was still unpublished and uninstalled
at the end of that anonymous run.

Remaining production boundaries include verified Tampermonkey timing/MAIN_WORLD,
the user's logged-in profile and broader saved-data shapes/limits, long-running
concurrent revisions and native clear interleaving, and the blank-page root cause
and affected-profile recovery. The anonymous mounted stop case is one bounded
sample. Default scope still rejects production origins;
the explicit exact-page probe scope relies on its harness for profile isolation.
No production userscript or public install artifact imports the experiment.
The anonymous runs did not change installed scripts or extension settings.

### Tampermonkey native-only acceptance: 2026-10-07 (Beijing)

With explicit installation and new-tab test authorization, the native-only
`Binance Chart Mirror Native Preflight (Experiment)` version `0.0.1` was installed
under UUID `d0601269-eb03-446c-8c9a-a9836e343cb2`. The Editors create operation
returned HTTP 405 and a subsequent list showed no installation. The native
installer path then produced the unique script in the authoritative list.
Fresh MCP source readback, parsed with the repository transport parser, matched
the complete 86,589-byte artifact with SHA-256
`7aff1d564a8cf9f21bbdb4a039db034c7a593dd846c23616d50bf40d3d856e1e`.

A new test tab navigated to the exact USUSDT URL at `2026-10-06T18:39:55.733Z`
(02:39:55 Beijing time). Before navigation, a target-local network block was
set for the orderbook script's `adjustLeverage` endpoint because its initial
flat-account observation can otherwise change leverage. Existing user tabs were
not refreshed, and no financial control or chart interval control was clicked.

| Observation | Result |
| --- | --- |
| First sample, page age 1,234.6 ms | Main-world diagnostic present, active and waiting |
| Page age 18,705.7 ms | One attempt, exact source match and factory execution; capture complete; chart data ready |
| Page age 45,083.2 ms | Stopped by deadline; three native dispatches, 885 total entries; no diagnostic failure |
| Page age 94,216.8 ms | Same stopped counters; chart data ready at resolution `15` |
| Queue restoration | `push` is a data property, with no accessor getter |

The actual loaded Tampermonkey wrapper contained exactly one byte-identical
copy of the artifact. Its execution context was the top-level Binance default
world (`isDefault: true`), establishing MAIN_WORLD execution for this navigation.
The initial event buffer was truncated; a fresh Debugger enumeration on the
same loaded page recovered the script source without truncation or navigation.
The source proof therefore does not rely on a complete initial event timeline.
No extension injection setting was inspected or changed, and this single
successful early injection is not a guarantee for every future navigation.

The inspected chart crop showed candles, indicators, annotations and volume.
Manual stop returned the already retired state. Both test-owned tabs were
closed, disposing the temporary endpoint block and CDP attachment. The separate
statistics script remains installed, restricted to the exact USUSDT page; a
fresh matching page can start another observation. Its 30-second timer is a
target duration, not a hard wall-clock cutoff under browser scheduling delays.
No batch writer was enabled in the user's profile and nothing was published.

This passes the bounded installed-source, loaded-source, MAIN_WORLD, exact
factory capture, native dispatch and diagnostic-retirement checks. `completed`
still means module capture, while `dispatches` counts thunk entry, not resolved
native writes or committed transactions. Asynchronous completion, long-running
concurrent writes, affected-profile blank-page recovery and reliable injection
across navigations remain unverified. The evidence is retained in
`/tmp/binance-tampermonkey-native-preflight-hlIxL9/report.json`, alongside the
loaded experimental source and the inspected `chart-candles.png` crop.

### Production successor acceptance: 2026-10-07 (Beijing)

The user then authorized continuing through publication. The initial production
candidate used `src/binance-chart-storage/`, generated as
`scripts/binance-chart-storage.user.js` version `0.1.0`. This separate installer
was superseded by the orderbook integration below before publication.
It imports no experiment implementation. Review identified and
fixed signed-zero/key-order comparison, shared-reference cloning, unsupported
old values and transaction-creation failure handling. Unsupported work returns
to the original map only before transaction creation; genuine transaction failure
never replays. See the [production contract](binance-chart-storage-development.md)
for its atomicity and lifecycle limits.

Validation passed all 2,145 Node/DOM tests, 126 chart-storage browser scenarios
(including 18 production writer and three production concurrency scenarios),
full test lint and affected build/syntax checks. The prior coverage inventory
test failed because its explicit installer list lacked the new artifact; the
list was extended and the entire Node/DOM suite then passed. Five production
value/connection regressions first failed against the historical writer.

The actual generated artifact was tested in a fresh anonymous Chrome profile:
five optimized transactions committed six writes and skipped thirteen unchanged
writes, with no failure, abort or remaining work. After stop, a native interval
change produced four native destination commits while all optimizer counters
remained frozen. The inspected screenshot showed the TradingView chart. The
report is `/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-chart-storage-smoke-kwTGVT/result.json`.
An earlier smoke stopped on an HTTP 202 assertion; the corrected runner records
status and waits for semantic readiness. Its successful navigation sequence was
202 then 200. HTTP status alone remains insufficient UI evidence.

The local Tampermonkey statistics installation was replaced in place by the
production artifact. Installed source matched all 99,037 bytes and SHA-256
`8fc21dda5322c0465d4bf6dc5149bfd4b50ec02e885ca7134ad047d617cb0501`.
A new USUSDT test tab started at `2026-10-07T01:08:16.254Z`, with a target-local
leverage-endpoint block set before navigation. Its actual loaded wrapper
contained one identical artifact in the top-level Binance MAIN_WORLD. At page
age 198,760.1 ms, six optimized transactions had committed six writes and skipped
1,764 unchanged writes. Failed, rejected, aborted and pending counters were zero;
peak copied pending input was 3,605,478 bytes. Native chart data readiness was
true at resolution `15`, and the inspected crop showed candles and annotations.

The test tab closed, disposing its temporary block. Existing user pages were not
refreshed, and no financial control was clicked. The final explicit stop diagnostic
contained a JavaScript syntax error before invocation, so this local run does not
claim manual-stop completion; that path passed independently in the anonymous
artifact test. Its last observed pending count was zero. The local report, loaded
source and chart crops are in `/tmp/binance-chart-storage-release-live-wLHfqz/`.
Neither live run read back saved keys or values. Persistent contents, competing
revision integrity and reload are covered by the isolated real-IDB tests.
These are bounded acceptance results, not a universal white-screen recovery or
long-running stability claim.

### Orderbook integration acceptance: 2026-10-07 (Beijing)

The final implementation lives in `src/binance-orderbook-trade/chart-storage/`
and ships only through the existing orderbook installer, version `2.7.218`.
The standalone production entry and build target were removed. This optimizes
the current matching Binance page's pinned TradingView mirror destination
writes; it is neither a Chrome-wide userscript optimization nor limited to
orders submitted by the orderbook. The destination database is shared by
same-origin Binance pages and may contain historical symbol records.

The storage installer runs before orderbook business initialization. During
anonymous early-injection validation, the complete artifact exposed an existing
startup assumption: both `document.head` and `document.documentElement` could
still be absent when disabled-control styles were inserted. A regression first
reproduced the `null.appendChild` failure. The initializer now observes creation
of the HTML root, disconnects and initializes once; storage interception still
starts immediately. The original iframe and SPA orderbook behavior is retained.

The final artifact has 661,567 bytes and SHA-256
`f281dd8c7b5f384e6f05ef1f7e837201923a0194d7fcdebd135997ee8e766f64`.
All 2,143 Node/DOM tests, 132 chart-storage browser scenarios, test lint,
build/syntax and final independent read-only review passed. The six integration
scenarios include missing-root startup, source rejection, late injection,
home-to-trading navigation and a real iframe.

The anonymous Chrome smoke executed this complete artifact with both HTML root
and head absent at injection. The orderbook initialized with exactly one panel
and one style element and zero page errors. The anonymous host lacked its
open/close mode anchor, so the panel remained hidden under its existing
placement contract. The inspected screenshot showed candles and the depth
overlay. Two interval changes committed five optimized transactions, six writes
and thirteen skipped writes, with no failed, rejected, aborted or pending work.
After stop, another interval change committed four native transactions and four
writes while optimizer statistics stayed frozen. Chart data readiness was true
throughout all three stages. The browser was closed. Evidence is retained in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-chart-storage-smoke-30Xntg/`.

### Deleted drawings restored by other symbols: 2026-10-07 (Beijing)

After v2.7.218, the user reported that removing all 20 MUBARAKUSDT drawings and
waiting one, five or more than ten minutes still restored them after reload.
Other trading tabs were open, each on a different symbol. Read-only inspection
found 20 matching MUBARAK records in both chart databases. The MUBARAK serializer
contained 893 drawings across 99 symbols; the GRIFFAIN serializer retained the
same 20 MUBARAK drawing IDs as hidden sources, with shared ownerSource `ZmamTt`.
The current page's two stored symbol keys and drawing symbols were uppercase,
ruling out the separately reproduced mixed-case-key candidate for this incident.
No user drawing was deleted and no user page was refreshed during diagnosis.
The aggregate evidence is `/tmp/binance-drawing-ownership-VuHzpW/incident.json`.

Native `zt` loads all historical symbol groups by ownerSource. Native `kt` then
extracts all LineTool sources, including other symbols' invisible copies, and
`xt` writes every group. Consequently, a different-symbol tab can overwrite an
already committed deletion during its next save. Exact host callbacks and real
IndexedDB reproduced 20 -> 0 -> 20 with both native and v2.7.218 writers. No
interrupted save, duplicate-symbol tab or mirror-transaction failure was needed.

Version 2.7.219 scopes the input of the native `kt` extractor to each chart's
current MainSeries symbols, before global drawing-ID deduplication. Indicator
panes inherit their own chart's symbols. The original extractor still writes an
empty active-symbol array after deletion and preserves other symbols' database
records. The complete pinned 76535 factory differs only at that input expression;
its event handlers, source persistence sequence and load path remain native.
Drawing protection has its own capture status and remains active after mirror
optimization stops. Existing old-version tabs retain their old write behavior
until they load the new version.

The repaired real-IDB scenario stays at 20 -> 0 -> 0. Eleven deletion scenarios
also cover multi-chart ownership before deduplication, indicator-pane drawings,
current empty arrays, preservation of a newer unrelated-symbol record and invalid
whole-chart ownership rejection before writes. A separate source-only cross-db
interruption still permits native stale overwrite and is explicitly not this
incident's root cause. All 2,167 Node/DOM and 143 chart-storage browser tests, test
lint, build, syntax checks and independent source review passed.

The complete v2.7.219 artifact passed anonymous Chrome verification with zero
page errors, ready charts, five optimized transactions and four native commits
after stop. Drawing protection remained active throughout. Screenshots were
inspected and the anonymous browser was closed. This smoke did not create/delete
drawings; deletion and reload integrity were exercised by the exact host/IDB
scenarios. Its report is in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-chart-storage-smoke-R0V9Km/`.
