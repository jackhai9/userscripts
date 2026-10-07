# Binance chart-storage experiment

The reviewed production successor is now maintained independently in
[`src/binance-orderbook-trade/chart-storage/`](../../src/binance-orderbook-trade/chart-storage/), with its
[current contract](../../docs/binance-chart-storage-development.md). The files
below retain the historical experiments and native baselines; their former
production restrictions and remaining-work lists describe those experiments.

This directory contains isolated experiments and an unpublished native-only
preflight review artifact. No production userscript imports this code. The current
candidate changes only a pinned mirror-write expression in module `70940`.
The earlier global localForage facade is retained as historical research: it
changes native mixed-operation ordering and is not the production candidate.
The mirror writer defaults to `scope: 'lab'`, which rejects every origin except
`https://chart-storage.test`. Its explicit `isolated-ususdt-probe` scope permits
only the exact top-level `https://www.binance.com/zh-CN/futures/USUSDT` page.
That guard cannot establish an anonymous profile: the separate probe harness
must own a fresh Chrome process/profile with no login or extensions. The
historical adapter and original capture remain lab-only. Bootstrap and passive
preflight also permit the exact top-level USUSDT page; neither enables a writer
by itself. No production entrypoint imports this experiment.

## Current candidate: one mirror destination batch

The global facade orders calls before waiting for localForage initialization.
The captured native `setItem` prepares its value in an additional Promise stage,
so an immediately following `getItem`, `removeItem` or `clear` can create its
transaction first. The facade's stronger issue order changes returned values,
callback order and final records. The original Basic clear workflow reproduces
this difference. That is a compatibility failure for a transparent storage
replacement, even when both implementations preserve their own intended order.

`generate-mirror-module.js` instead generates a static replacement for the exact
public `70940` method in `TradingView.99bc5074.js`. Acorn identifies exactly one
mirror destination expression, and generation verifies the complete source hash,
factory hash, UTF-16 ranges and absence of a colliding dispatch identifier. The
only change replaces the original `Wr=fr.map(...)` RHS with:

```js
__dispatchChartMirror(Sr,fr,()=>ORIGINAL_FR_MAP_EXPRESSION)
```

The complete original method occupies `[6665,36819)` and has SHA-256
`37d249d1ceec4a41b54a959c1ab2c4b52b3061e504cf8cd81a824962af8c6c88`.
The replaced RHS occupies `[33783,34025)`. Reversing that insertion must reproduce
the complete original method byte for byte. There is no `eval` or `new Function`.
`replaceChartMirrorFactory` synchronously compares the full original
`Function.prototype.toString` result before returning the static candidate.
See the [scoped fixture provenance](../../test/fixtures/binance-chart-storage/mirror-scoped.md).

`bootstrap.js` selects `70940` only when an explicit `replaceMirrorFactory`
callback is supplied; its default `43917` capture remains unchanged. Rejection
leaves the original module executable and does not poison its cache. A callback
that synchronously stops observation must also leave the original registration
untouched. Both loading orders first failed that regression; rechecking the
active state immediately after the callback now makes them pass. Cleanup restores
queue and factory slots. Already executed exports remain cached normally.

The unchanged host code still owns its guards and catch, source `keys()` and
per-key `getItem()` calls, target namespace exclusion, ordinary TradingView save,
Basic settings and reset/clear paths. The writer never replaces localForage's
`createInstance` or instance methods. It reuses only the JSON utility exports
from `adapter.js`; importing those exports does not install the historical facade.

`mirror-writer.js` accepts one explicit destination batch and compares current
values inside one IndexedDB read/write transaction, putting only changed or
missing records. Stored null is distinguished from a missing key. Empty entries
perform no initialization or transaction. Values are copied as validated JSON
before admission. Defaults bound each batch to 512 entries and 4 MiB of input,
with a separate 4 MiB stored-read budget; pending work is limited to 16 batches
and 64 MiB. Count/input limits reject before any entry is written; a read-budget
failure aborts the whole destination transaction.
The explicit page-probe scope changes only origin/path/frame admission; it does
not broaden the database, driver, key, JSON or resource-limit contracts.

Stop closes admission and drains the finite set of accepted batches. A later
mirror dispatch during drain waits for that fence, then evaluates its retained
original async per-key map; after stop it invokes that native thunk directly.
Later calls do not extend the optimized queue. Ordinary native save, Basic and
clear calls are not intercepted or placed behind this mirror fence. Accepted
failures are not replayed, and neither cleanup nor stop closes shared library
connections.

This is deliberately not native mirror transaction equivalence. The original
per-key writes can partially commit; the candidate commits or aborts the entire
destination batch and changes interleaving with concurrent native transactions.
Limits introduce explicit rejection conditions. The outer native catch remains
unchanged. Source reads are still a non-atomic sequence, and two databases cannot
share this transaction. Neither lost-update protection nor blank-page recovery
follows from this change.

## Current scoped evidence

The scoped suite contains 19 scenarios and the dedicated writer suite contains
18. They cover exact source identity and inverse replacement, the original save
and mirror callbacks, guards, empty/null records, native API identity and the
same-stack set/get/remove/clear matrix, strict registration refusal, both runtime
orders, stop and callback reentry, real abort/quota rollback, limits, blocked
initialization, concurrent native clear and another tab's changed target values.
The scoped and existing startup-integration suites first passed a targeted
33-scenario run after the reentrant-stop fix. Before the explicit page-probe
scope was added, the combined experiment run passed all 105 Chromium scenarios,
all eight Node origin/path/frame cases and the complete test-policy lint. The browser report is
`/tmp/chart-storage-final-20261006.json`.
The scope change then expanded the Node suite to 18 cases: three new cases first
failed, then all 18 passed. Both mirror browser suites passed all 37 scenarios,
and the full test-policy lint passed again. Default production-origin refusal
and the explicit scope's exact origin/path/top-frame boundaries are separate
assertions.
The reusable anonymous-probe contract and native-only preflight then added four
and 18 Node scenarios respectively. Together with the 18 scope/origin cases,
all 40 Node cases passed; the 37 mirror browser scenarios also passed. The
preflight build and its dependency boundary were independently reviewed.

For the current 32-chain workload, each database starts with 290 historical
drawing records. Eight sequential rounds each complete four concurrent original
save/mirror chains with the same changed revision. Both databases retain all
293 expected keys, historical values and the final chart/drawing data.

| Current 32-chain workload | Transactions | Puts | Gets |
| --- | ---: | ---: | ---: |
| Native localForage | 18,912 | 9,472 | 9,408 |
| Scoped mirror writer | 9,568 | 112 | 18,784 |

Setup and final verification I/O are excluded. The scoped path retains the
source save/read work: its 112 puts comprise 96 ordinary source writes and 16
changed destination writes. Target comparisons add 9,376 gets. The two measured
workloads ended with zero pending or aborted transactions and all 32 chains
complete. The final extracted metrics are
`/tmp/chart-storage-mirror-measurements-20261006.json`; a separate fresh two-case
measurement in `/tmp/chart-storage-mirror-scoped-doc-metrics.json` confirmed the
same counts. These counts do not measure
sustained production CPU, latency, competing revisions or blank-page recovery.

The offline evidence separates full-module static identity, exact callback
execution with original dependencies and real IndexedDB, and synthetic module
lifecycle in the actual captured runtime. Offline callback fixtures do not
execute the complete public React module or establish rendered chart readiness.

A separate anonymous Chrome `154.0.8037.98` run then injected the complete static
`70940` candidate before registration in a temporary profile with no login or
extensions. The dispatch service was native-only: it would evaluate the exact
original thunk, and the lab writer was not installed. Strict validation attempted
once, matched once and executed the replaced module once. Capture occurred at
5,975.4 ms. At 10,015.6 ms, `activeChart().dataReady()` was true, and the inspected
screenshot showed USUSDT candles, moving averages, volume and a populated orderbook.
The observer stopped, no page errors were reported, and the browser was closed.

That run recorded `dispatches: 0`: anonymous startup did not trigger the mirror.
It proves full-module registration/execution and rendered startup with the
native-only service, not execution of the injected mirror branch, real batched
writes, production compatibility or blank-page recovery. The result, injection
and screenshot are in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-native-preflight-HeCAar/`.
The earlier anonymous `43917` observation below remains a separate historical
result.

A later, independent anonymous Chrome `154.0.8037.98` shape probe exercised the
real mirror using only its original native thunk. In the bounded interval-change
stage, switching the native interval from `60` to `15` advanced completed mirrors
from 6 to 7. Earlier activity had already produced mirrors; the final total of
seven is not attributed to that one action. All seven completed destinations
were `chart_delivery` using IndexedDB, with zero mirror or JSON-shape failures.
Observed maxima were four entries, 49,003 encoded batch bytes and 24,504 bytes
for one record. These values establish this anonymous sample's compatibility
with the JSON and size contracts, not every saved chart's compatibility.

The native chart remained data-ready at resolution `15`, and the inspected
screenshot showed the chart and populated orderbook. Observation stopped and
the temporary browser closed. Evidence is in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-shape-probe-yDfadK/`.
This supplies real native mirror invocation and shape evidence beyond the
earlier zero-dispatch startup. It does not establish real-page bulk execution.

## Anonymous bulk execution: 2026-10-07 Beijing time

An independently launched anonymous Chrome `154.0.8037.98` then enabled the real
batch writer through the explicit USUSDT probe scope. The retained report starts
at `2026-10-06T16:24:24.572Z`, which is October 7 in Beijing. The exact factory
matched and executed once. Five accepted batches committed in five destination
transactions, with eight writes and eleven unchanged writes skipped. Rejected,
failed, aborted and pending counts were zero; peak admission was two batches and
98,006 bytes.

| Verified stage | Completed mirror calls | Bulk commits | Readback |
| --- | ---: | ---: | --- |
| One-hour chart interval stage | 0 → 4 | 4 | Four captured entries matched |
| One hour → fifteen minutes | 4 → 5 | 5 total | Four captured entries matched |
| After writer stop, four-hour interval | 5 → 6 | Still 5 | Four captured entries matched |

The first stage's four calls include the activity observed during that interval
stage and are not four saves attributed to one click. Each readback compares
destination records with the corresponding captured dispatch snapshot. After
`writer.stop()`, the four-hour stage increased `nativeCalls` from zero to one;
the complete writer statistics remained unchanged. This verifies native thunk
continuation through an already mounted transformed callback.

The runner required native chart data readiness for every completed interval
stage. The inspected final screenshot showed four-hour USUSDT candles, moving
averages, volume and a populated orderbook. There were no page errors, observation
stopped, and the temporary browser closed. The report and screenshot are in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-mirror-bulk-probe-3YcdXL/`.
This is actual batch execution in an independent anonymous browser. It is not
enablement in the user's logged-in profile or proof of long-running stability,
Tampermonkey delivery or blank-page recovery.

Three earlier attempts stopped at the anonymous-UI check before any factory
match or mirror dispatch. The registration text matched both a button and a
link; selecting the unique button by its accessible role fixed that diagnostic
premise. Those attempts are not storage failures.

The independently runnable `run-anonymous-probe.js`, `anonymous-probe-entry.js`
and `anonymous-probe-contract.js` retain this bounded workflow. The runner owns
the fresh Chrome context, rejects navigation away from the fixed URL, checks
the anonymous page, records failure counts and closes its browser. The entry
also checks the exact runtime URL and top frame when capturing each batch;
diagnostic rejection is counted even when the host's original catch resolves.
For an authorized isolated live probe, run:

```sh
node experiments/binance-chart-storage/run-anonymous-probe.js
```

## Tampermonkey acceptance conditions

Tampermonkey's official [Content Script API documentation](https://www.tampermonkey.net/documentation.php?q=content_script_api)
says the default **Content Script** mode has no real `document-start` support.
On Chrome, ordinary **UserScripts API** mode also retrieves scripts through
background messaging and has no real `document-start` support. **UserScripts API
Dynamic** injects the wrapper and script together and supports `document-start`.
The ordinary UserScripts API statement differs on Firefox; this experiment
targets Chrome.

The official [`@sandbox` documentation](https://www.tampermonkey.net/documentation.php?q=sandbox)
states that `raw` requests page `MAIN_WORLD` access, but injection can move to
another enabled sandbox when MAIN_WORLD injection is unavailable, for example
because of CSP. Therefore `@run-at document-start` and `@sandbox raw` metadata
alone do not prove timely access to the actual page queue.

A future Tampermonkey entrypoint must first pass a separate native-only probe on
an authorized test page: verify the effective injection mode, actual MAIN_WORLD
execution, exact source pin before first module execution, real native mirror
completion and clean stop. Unverified timing/world/source must refuse
replacement. Chrome `addInitScript` evidence does not satisfy this extension
gate. The anonymous runs changed no installed script or extension setting.

`native-preflight-core.js`, `native-preflight-entry.user.js` and
`build-native-preflight.js` now produce the self-contained
`native-preflight.user.js` review artifact. Its verified build input graph contains
only the bootstrap, pinned module, native-only core and entry; no writer or
runtime loader is included. The core keeps bounded in-memory statistics for
30 seconds and forwards the original thunk synchronously, preserving its returned
array and thrown error identities without inspecting stored values or adding
storage calls. Manual stop, pagehide, scope change and the deadline retire
observation. The entry exposes only snapshot and stop. Its metadata alone does
not establish Tampermonkey injection timing or MAIN_WORLD behavior. It remains
unpublished; the authorized local installation is recorded below.

```sh
node experiments/binance-chart-storage/build-native-preflight.js
```

On October 7 Beijing time, the generated artifact itself was then executed with
`addInitScript` in a fresh anonymous Chrome `154.0.8037.98` context. The report
started at `2026-10-06T16:30:27.651Z`: attempts, source matches and factory
executions were each one; factory capture completed, and four dispatches counted
15 entries. There was no diagnostic failure or page error. Manual stop changed
`active` to false, and the temporary browser closed. The inspected screenshot
showed candles, moving averages, volume and the populated orderbook. Evidence is
in `/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-native-artifact-probe-JSBjWC/`.
Here `completed: true` means module capture completed; `dispatches` counts native
thunk invocation, not asynchronous write commits. This validates the built
artifact through Chrome initialization-script injection, not Tampermonkey
delivery. The artifact was still unpublished and uninstalled at that stage.

The subsequent authorized Tampermonkey test began at
`2026-10-06T18:39:55.733Z` (October 7 Beijing time) in a new USUSDT tab. Installed
source matched all 86,589 artifact bytes; the loaded extension wrapper contained
one identical copy in the top-level Binance default execution world. The
preflight observed one exact factory match and execution, then three native
dispatches counting 885 entries. At page ages 45.1 and 94.2 seconds it was retired
with the same counters, `stopReason: 'deadline'` and no diagnostic failure.
The queue accessor was restored. Native chart data readiness and the inspected
candle crop confirmed a rendered 15-minute chart.

Only the statistics script was installed. It remains restricted to the exact
USUSDT page and starts a new observation on a fresh matching load. The test and
installer tabs closed; the target-local leverage-endpoint block was disposed
with the test tab. Existing user tabs and extension settings were unchanged.
No bulk writer was enabled or published. Native asynchronous commit completion,
repeatable injection timing, long-running concurrency and blank-page recovery
remain unverified. See the [diagnosis record](../../docs/binance-futures-blank-page-diagnosis.md#tampermonkey-native-only-acceptance-2026-10-07-beijing)
for the sampling limits and `/tmp/binance-tampermonkey-native-preflight-hlIxL9/`
for the report, loaded source and inspected chart crop.

## Historical global-facade research

The following sections preserve earlier results for `adapter.js`, including its
different scheduling contract. Their transaction counts, installation lifecycle
and API restrictions do not describe the current scoped mirror candidate.

### Original question and acceptance

Can the actual Binance localForage export be observed at first module execution,
and can a narrowly scoped adapter reduce the transaction and unchanged-write
amplification without dropping accepted calls?

The browser tests use a fresh Chromium context, intercepted `.test` routes, the
captured Binance runtime and localForage module, and real IndexedDB. No Binance
login, existing profile, production database or trading action is used. See the
[fixture provenance](../../test/fixtures/binance-chart-storage/README.md).

Acceptance covers 290 historical keys and repeated saves, callback delivery,
initialization, ordered mixed operations, null versus missing records, barriers,
two pages, persistence after reload, transaction rollback, limits and cleanup.
The native workflow must first fail the optimized transaction/write assertions.

### Historical facade restrictions

- Only newly wrapped instances for `chart_futures` and `chart_delivery`, using
  `keyvaluepairs`, are managed. Only `#TV_SYMBOL-` and `myTradingView` keys are
  optimized. Other operations pass through ordered native barriers.
- Managed values are JSON values. They are validated and copied when accepted.
  Invalid data and exceeded limits are explicit errors, not silent truncation.
- Queued and running operations share count and byte budgets. A batch has its
  own operation and byte limits. Read results have a separate maximum size.
- Operations are ordered before waiting for localForage initialization. A
  transaction advances only through native request events. Its promises settle
  after commit or abort, and equal values are compared inside the transaction.
- Optimized batch failure rolls back the whole batch. Reads also wait for commit.
  Optimized batches do not retry connection errors. Native barriers retain
  localForage's independent transactions and one-time connection recovery; they
  are not covered by optimized-batch rollback or transaction counters.
- Connections are obtained from the initialized instance for every batch. The
  experiment never closes the library's shared connections during cleanup.
- Stop closes optimized admission, drains accepted work and then restores the
  exact original factory descriptor. Retained facades and factories resume native
  behavior. Calls arriving during drain wait behind its finite completion fence;
  they cannot overtake accepted writes or extend the optimized drain queue.
- Each export permits one installation per page lifecycle. After stop, reload is
  required before another installation can own a new queue.
- While active, `config()` returns a copy; configuration changes, driver changes, database
  removal and iteration are explicitly unsupported on managed facades. Managed
  non-chart values are also restricted to JSON, even when passed to a barrier.
  After stop, the original native API and value types apply. Synchronous config
  changes remain prohibited while accepted work drains.

### Historical facade evidence boundaries

The original capture entrypoint's first-registration interception and cache
identity are tested only in isolation. The later bootstrap also has the anonymous
startup observation described below. The runtime does not expose its module
cache. Requiring a registered module is
not proof that its factory was already executed. Empty chunk-ID arrays do not
execute a runtime callback in this captured runtime; the host uses a unique
test-owned chunk ID.

`observeChartStorageModule(queue, { onCapture })` observes module `43917` and
calls `onCapture` synchronously after its factory finishes, before the host's
`require` returns. A Promise-only consumer is too late to intercept instances
created in that same host call stack. Both success and failure restore the
observer's factory and chunk-queue changes. Starting after registration is an
explicit error; it never probes the private cache by executing the factory.
If another owner replaces the queue hook, capture rejects and preserves that
owner's hook while restoring its own module registration. It does not claim
that an external wrapper containing the observer can be removed safely.

The adapter is not a transparent replacement for the complete localForage API.
Batch atomicity, read completion timing, capacity errors and connection failure
behavior differ. Tests do not establish safety for production installation.
Two-page tests do not establish atomic synchronization across two databases or
fix an application's separate `getItem` then `setItem` lost-update race.

No real trading page adapter is installed by this experiment. Existing queued
transactions are not drained, cancelled or repaired by running these tests.

### Historical validation

Use the repository Node version and run:

```sh
npm run test:ui -- e2e/binance-orderbook/specs/chart-storage-*.pw.js
node --test test/unit/binance-chart-storage-origin.test.js
npm run lint:tests
```

Earlier-stage validation on 2026-10-06: all 68 real Chromium scenarios and all eight
origin/path/frame-guard Node tests passed. The complete test-policy lint, experiment syntax
checks and `git diff --check` passed. Fixture file hashes match their manifest.
The native baseline was rerun in a separate output directory and failed the
bounded-transaction assertion as intended (`4,640 > 32`).

The quota scenario sets a 64-KiB CDP quota before the first library execution or
database write. A one-MiB incompressible JSON value triggers the real
`QuotaExceededError`; both writes and the read in its batch reject, all callbacks
complete, and prior values remain unchanged. Setting the override after seed
writes did not trigger this failure: the matching
[Chromium bucket implementation](https://github.com/chromium/chromium/blob/151.0.7922.34/content/browser/indexed_db/instance/bucket_context.cc#L463-L523)
can use an already allotted space budget before asking the quota manager again.
An active reported override alone does not prove write-time enforcement.

### Historical synthetic transaction work

The controlled workload prepopulates 290 synthetic JSON chart records, then
performs eight rounds of `getItem` followed by an unchanged `setItem`. Setup and
final verification reads are excluded from the counters. All 4,640 Promise
results and all 4,640 distinct callbacks are verified against expected values.

| Workload | Native transactions | Native puts | Native gets |
| --- | ---: | ---: | ---: |
| Native localForage, eight sequential rounds | 4,640 | 2,320 | 2,320 |
| Prototype, eight sequential rounds | 16 | 0 | 4,640 |
| Prototype, eight simultaneous rounds | 10 | 0 | 4,640 |

The native baseline fails the same bounded-transaction assertion as intended.
The sequential comparison reduces transaction creation by about 99.66% and
skips all 2,320 unchanged writes. It adds comparison reads inside transactions;
it does not reduce the number of read requests. The concurrent test has at most
2,320 outstanding operations and finishes with zero pending operations/bytes.
These are work counts, not a browser CPU, latency or blank-page recovery
benchmark. Changed values are still written and checked by separate scenarios.

The browser runtime was Playwright Chromium `151.0.7922.34`, verified by launching
the same bundled browser and reading `browser.version()`. This is not the
user's Chrome `154.0.8037.98` profile. The rendered lab report was inspected;
the later anonymous Chrome observation is described separately below.

### Historical integration follow-up

Two additional regressions were reproduced before the integration changes:

- Installing the original capture before the real runtime produced one factory
  execution but zero capture callbacks. Rspack saves the prior `push` as a parent
  append callback, invoked after registration and synchronous host execution.
- A real same-origin iframe's `JSON.parse` chart object was rejected by the
  adapter's same-realm prototype identity check. The native TradingView iframe
  produces its save callback's JSON in precisely that separate realm.

`bootstrap.js` observes the runtime's first `push` assignment. The pre-runtime
parent callback becomes permanently append-only after takeover or stop. Queue,
factory and cache behavior are tested across both script orders, late entry,
stopping, diagnostic exceptions and host registrations that the observer refuses.
An in-flight append cannot lose its newly created global queue during cleanup.
Diagnostic callback failure rejects observation without poisoning a successful
host module's cached export. Original factory failures keep their host behavior.

The JSON validator now recognizes native plain-object prototypes across realms
by constructor and constructor.prototype identity. It still rejects class
instances, Date, Map, forged/null prototypes, symbols and accessor properties.
Snapshots retain nested data and own `__proto__` keys without mutating the input.

`preflight.js` wraps only the actual export's `createInstance`, returning each
original instance. It records up to sixteen chart-instance creation timestamps
and fixed DB/default-store metadata. It never wraps instance methods, calls
ready/config/get/set, records keys/values or starts the adapter. Stop, pagehide
and a 30-second deadline restore the original factory descriptor; an inherited
factory is restored by removing the observer's own property. Retained wrappers
then forward without observation. Tests establish zero added opens, transactions,
gets or puts during passive observation. Dedicated scenarios verify manual stop
and the deadline; they do not separately exercise pagehide, changed factory
ownership, metadata failure or the sixteen-entry recording limit.

The current user-page module factory was read without requiring it. Its SHA-256
was `f33d0f78c185ff592f1f0781e21baab63e7db937054866c37afdfda028e9e647`, matching the
fixture's complete module property. The existing page was not refreshed or
modified by the observation.

An independently launched, anonymous Chrome `154.0.8037.98` with a temporary
profile, no extensions and no login loaded the real USUSDT page. Synchronous
`addInitScript` injection captured the actual module at about 3,236.9 ms and the
first `chart_futures` / `keyvaluepairs` instance at 4,400.5 ms. The observer was
stopped (`active=false`, no failure), and the temporary browser was closed.
This first capture stopped before the business UI mounted and establishes only
the ordering. Its evidence is in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-storage-preflight-b4mWbr/`.

Further anonymous observations separated module capture from rendered readiness:

- Waiting for a TradingView iframe on the default Basic chart timed out. The
  inspected screenshot showed a working Basic chart and populated orderbook;
  it was not a blank-page reproduction.
- The first mode-selection attempt used `TradingView`, but the native label is
  `Trading View`. That selector timeout did not click the control or establish
  a chart failure.
- After using the correct label, a visible iframe and seven canvases appeared
  at about 6.8 seconds. The screenshot still showed the loading animation. That
  run's raw `outcome: ui_ready` field is an inadequate machine criterion and
  must not be interpreted as rendered chart readiness. Its evidence is in
  `/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-storage-preflight-tv-verified-CrQy6W/`.
- The final observation waited for the native `activeChart().dataReady()` and
  then two animation frames. The inspected screenshot showed USUSDT candles,
  moving averages, volume bars and the orderbook. The captured library defines
  `dataReady()` without a callback as a read-only check for a model and nonempty
  main-series data; the screenshot supplies the separate rendering evidence.

In that final Chrome `154.0.8037.98` run, capture occurred at 2,184.1 ms and the
first chart instance at 3,008.7 ms. At 7,429.2 ms the page had a populated
orderbook, one TradingView iframe, twelve canvases and `nativeChartDataReady:
true`. Twenty `chart_futures` instances were observed (only the first sixteen
timestamps retained), with no `chart_delivery` instance and no page errors.
The observer was stopped (`active=false`, `failure=null`) and the temporary
browser was closed. Structured results and the inspected screenshot are in
`/var/folders/99/d7dxx5j94_x8n09snmknq0x80000gn/T/binance-storage-preflight-chart-ready-1nRAMB/`.
All anonymous probes used separate temporary profiles and closed their browsers.
They did not enable the adapter. Successful `addInitScript` observation does not
validate Tampermonkey document-start/page-world injection or the affected user's
logged-in profile, and does not establish blank-page recovery.

The actual source contract is broader than the initial historical-key workload:
module `76535` in [chunk 36648](https://bin.bnbstatic.com/static/chunks/36648.dd8ae7dc.js)
creates instances during component rendering and retains them. Its main save,
layout read/modify/write, drawing saves and cross-database mirror are separate
stages. Module `15426` in
[chunk 28928](https://bin.bnbstatic.com/static/chunks/28928.9aeec892.js) also uses
the same databases for Basic candlestick settings, including `clear()`. Those
non-TradingView calls are affected by the prototype's native-barrier restrictions.
Those retained references motivated the stop lifecycle correction described below;
restoring only the factory cannot update an already mounted component's instance.

### Historical facade continuation after stop

The initial stop implementation rejected all retained-facade requests and exposed
the native factory before accepted work drained. Six new regressions reproduced
these failures before the lifecycle change. The adapter now moves from active to
draining to stopped. While draining, its factory still returns managed facades;
their later calls wait for the finite set of accepted operations to complete.
Afterwards it restores the original descriptor and forwards retained calls with
their complete arguments and native receiver. Native callbacks retain their
method-specific signatures. Failed accepted transactions are reported once and
are not retried; they do not prevent a later native operation after stop.

The nine lifecycle scenarios cover a real write lock, a real blocked database
version upgrade, callback reentry, abort delivery, native Blob/API usage, factory
ownership changes, exact descriptor restoration and repeated stop/install calls.
JSON validation can execute Proxy traps; a separate failing regression showed a
trap could stop the adapter before the request was accepted. Admission now checks
the lifecycle again after validation, so that request rejects without entering a
queue or starting a transaction. An external factory replacement during drain
causes stop to reject explicitly and preserves the replacement.

Concurrent native `setItem` and `getItem` do not guarantee read-your-write. The
captured driver's set operation prepares the value in an additional Promise
stage before creating its transaction. An independent native baseline therefore
owns the post-stop ordering assertions; reading the prior value before that
concurrent write commits is not data loss. The final persisted value is checked
separately. Stop does not promise to complete while accepted native storage work
itself remains blocked, and its drain statistics do not include subsequent native
calls. These are isolated lifecycle proofs, not a live stop of mounted Binance UI.

### Historical original-host persistence workflows

The [host fixture](../../test/fixtures/binance-chart-storage/host-persistence.md)
preserves 273 exact source fragments from seven public bundles, including 203
original dependency factories. It executes the actual TradingView save/load
functions and mirror callback, and the actual Basic storage functions and old-key
migration. Source byte hashes and UTF-16 ranges were independently checked.
Only the documented storage, widget and enabled-state references are supplied by
the harness; the business algorithms are not reimplemented.

The same scenarios run through native localForage and the adapter. They check
layout retention, drawing restoration and deletion, cross-database mirror contents,
all six Basic storage categories, original key migration and shared-store clear.
The Basic React subscriptions, debounce and upstream JSON serialization are not
executed; their storage boundary receives synthetic JSON values. Default `{name}`
instances select the IndexedDB driver in these browser tests.

Four original save/mirror calls with revisions `[1, 1, 2, 2]` produced 64 native
transactions and 36 puts, compared with 28 transactions and 11 puts through the
adapter. Both retained the expected source and destination records. Setup and
final verification are excluded. This small workload includes changed values;
its reduction is different from the unchanged 290-record benchmark above.

A bounded load scenario prepopulates both databases with the same 290 historical
drawing records, then completes eight rounds of four concurrent original save
and mirror callbacks. Every round changes the current snapshot and drawing.
All 32 callbacks, both databases' 293 keys, all 580 historical values and final
snapshot/layout/drawing/load results are checked. No failures, rejections,
aborted transactions or pending operations remained.

| Thirty-two original save/mirror chains | Transactions | Puts | Gets |
| --- | ---: | ---: | ---: |
| Native localForage | 18,912 | 9,472 | 9,408 |
| Adapter | 112 | 32 | 18,880 |

The adapter count comprises 80 optimized transactions and 32 native barriers;
9,440 unchanged writes were skipped. Setup and final verification I/O are
excluded. Controller workload counters use before/after differences; peak gauges
are separately labeled as installation-lifetime measurements. The measured peak
was 1,172 pending operations and 181,767 pending bytes, within configured limits.
Recorded elapsed times are individual lab samples, not a sustained production
latency or CPU benchmark. The increased reads are the cost of comparing values
inside transactions, and this bounded workload does not prove long-term stability.
The four concurrent chains within each round share one revision, with rounds
awaited in sequence; competing different revisions are not covered. The retained
JSON report and extracted measurements are `/tmp/chart-storage-load-retained-20261006.json`
and `/tmp/chart-storage-load-measurements-20261006.json`.

An additional native/adapter comparison exposes a real ordering difference:
concurrent native sets can create their transactions after a later-invoked Basic
`clear()`, whereas the adapter's barriers enforce issue order and clear those
earlier writes. Both delete records that were already committed. The separate
shared-clear conformance scenario awaits completed saves before clearing; the
concurrent difference has its own explicit assertions. Stronger issue order is
not transparent emulation of native scheduling and remains a production contract
decision, alongside whole-batch rollback and delayed read completion.

## Current remaining production boundary

- Validate Tampermonkey delivery under the conditions above. Keep the earlier
  zero-dispatch startup, later 6-to-7 native mirror and October 7 actual anonymous
  bulk/stop-continuation evidence distinct; none proves extension delivery.
  Exact source mismatch must refuse
  replacement and preserve native operation; the captured build is not a stable API.
- Validate the real mirror's saved JSON shapes, destination driver/configuration,
  limits and the user's logged-in mounted caller lifecycle. The anonymous probe
  demonstrated one mounted stop continuation only. Default scope still rejects production
  origins; the explicit exact-page scope depends on the harness for profile
  isolation. Ordinary native APIs remain outside its control.
- Decide whether destination-wide rollback, read-comparison cost, capacity or
  connection failures and changed interleaving with native clear/other tabs are
  acceptable. A stopped writer restores the retained native mirror expression;
  stopping the bootstrap alone does not alter an already cached module export.
- Measure sustained changed snapshots and concurrent different revisions. Source
  reads and layout read/modify/write remain native and non-atomic across calls;
  cross-database atomicity and previously queued transaction repair remain absent.
- Validate actual blank-page recovery and long-running stability on the affected
  Chrome version. Passing this experiment does not establish a deployed fix.

Neither historical storage optimization is imported by production entrypoints.
The native-only preflight was installed for the separate acceptance above and
subsequently replaced locally by the production successor. The historical global
facade is not the production candidate.
