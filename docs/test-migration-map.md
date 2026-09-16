# Behavioral Test Migration Map

This records the second migration stage from `176d9ff`. Its 83 legacy Node
files, seven method-replacement allowances, and 31 fixed-wait allowances have
been removed from the executable inventory. Every existing and new executable
test file now uses the strict behavior policy. The separate real performance
observer tail remains an explicitly tested host contract.

The former orderbook source-regression file contained 71 top-level checks.
All 71 original titles are preserved below, in their original order, with named
current tests. Nine retained distribution, CSS, and component-boundary tests
cover ten original rows: 1, 2, 3, 6, 7, 23, 24, 25, 26, and 29. Rows 25 and 26
share one retained test. The other 61 rows point to runtime behavior.

This is a traceability map, not a branch-coverage result. All 71 rows have
identified replacement evidence without an outstanding contract gap recorded
here. No original title is missing from the map. A pure helper test is not a
substitute for verifying its entrypoint wiring.

## Completed verification

The complete run on 2026-09-16 passed **2,078 Node tests across 126 files** and
**364 Chromium scenarios** (357 production scenarios and seven collector
proofs), with no skipped or retried scenarios. All production captures completed.
Full-source branch coverage is **9,179 / 10,184 (90.13%)** across 82 files;
the aggregate 90% gate and each of the seven critical-module gates pass.
This percentage is a retained-evidence lower bound: coarse Chromium teardown
calls receive no additional branch credit.

The local [HTML report](../test-results/coverage/run-5M5oY5/report/index.html) and
[machine-readable summary](../test-results/coverage/run-5M5oY5/report/coverage-summary.json)
record the complete run and source identities. All 82 production source hashes
matched the workspace after collection. These generated artifacts are not
committed; [Source Coverage](test-coverage.md) records the measured critical
modules and explains how to reproduce the gate.

The strict repository-wide test lint and affected build and syntax checks
passed. Independent read-only reviews passed for the migrated contracts,
production regression fixes, and coverage collector. The final rule-response
and browser-frame synchronization follow-up also passed independent review:
cooldown assertions finish before the clock resumes, and the released response
must produce the exact quantity, formula, request count, and zero-order result.
No review finding remains unresolved.

## Targeted follow-up results

The additional scenarios below have completed their targeted runs. Counts are
per-file results, not a combined coverage or final-review verdict.

| Original rows | Dedicated runtime evidence | Targeted result |
| --- | --- | --- |
| 59, 60 | [Active context]: ordinary and continuous ladders retain confirmed work when native precision, ratio, order count, or gap changes; continuous recovery rebuilds after its full cooldown. | 8/8 passed. |
| 50, 66 | [Precision bootstrap]: wait for bid/ask/precision readiness; failed missing or malformed menus require explicit refresh; a late old-symbol portal cannot replace current shortcuts. | 6/6 passed. |
| 34, 40 | [Continuous chart saves]: accepted drawing bursts, one final round save, partial-round Stop, later rejection, and restoration of ordinary chart-saving ownership. | 4/4 passed. |
| 39, 40 | [Confirmed cancellation Stop]: the first and second row removals remain unconfirmed at 239 ms; at 240 ms the rendered confirmed count precedes a same-time Stop, with no next cancellation or recovery submission. | 2/2 passed. |
| 19, 32, 36 | [Quantity and reprice]: zero-balance feedback at 239/240 ms, missing or zero-with-funds quantity at 1,199/1,200 ms, and the fifth maker rejection's full 2,999/3,000 ms pause before repricing only unfinished orders. | 4/4 passed. |
| 9, 22, 53 | [Entry wiring]: an uncommitted native Post Only selection prevents field writes and submission; three watchdog cycles do not scan or measure 1,000 added book rows; the first confirmed close quantity renders before the pending 50 ms debounce. | 3/3 passed; three repeated runs passed 9/9. Host boundary contracts passed 4/4. |

These 27 targeted cases are no longer pending and are included in the completed
combined run above. Their file-level results are separate evidence; the complete
run establishes the aggregate coverage target.

## Completed entrypoint follow-ups

- **Row 9 — Post Only transition:** a native Limit selection remains active
  for 650 ms after the real ladder requests Post Only. No input write or
  submission occurs before the separate native commit. The exact three
  acknowledged quantities are 0.66, 0.66, and 0.68.
- **Row 22 — scan and geometry boundaries:** three actual watchdog cycles
  perform zero book scans, zero book geometry reads, and zero panel mutations.
  The panel and spacer each retain one necessary layout read per cycle.
- **Row 53 — immediate close-quantity observation:** native mode and button
  state settle first. A later native class mutation starts the generic
  debounce; quantity publication follows after 16 ms. The next frame updates
  the direction and ladder controls at 32 ms, before the 50 ms deadline,
  through the real observer without explicitly calling `renderPanel`.

## Orderbook source checks

Numbers preserve the original declaration order, and previous titles are
copied exactly from `176d9ff`. Current test titles below are exact executable
names, including expanded parameter values where one named example represents
a documented family. A row can retain a static contract alongside runtime
behavior. No partial replacement remains in this map.

| No. | Previous check | Replacement evidence |
| --- | --- | --- |
| 1 | source and generated userscript versions stay synchronized | `user installs the same version and update endpoints declared by the editable source` ([Source]). |
| 2 | route changes are event-driven with one low-frequency watchdog | `user receives an event-driven route integration with one declared watchdog` ([Source]); `user leaves a futures route while an order is pending without allowing a later ladder submission` ([Routes]). |
| 3 | permanent trade-mode observer is scoped to the trade tab root | `user receives permanent native observers scoped to their owning controls` ([Source]). |
| 4 | close snapshot validation refreshes button scope before checking close actions | `user reacquires a replaced native form root while retaining the same panel and multiplier` ([Panel]); `user cannot resolve a close action when native buttons and quantity labels are absent` ([Panel]). |
| 5 | fixed ladder panel avoids rebuilding unchanged body markup | `user keeps an unchanged panel free of DOM writes during repeated stable renders` ([Panel]). |
| 6 | panel primary values and ladder selections share the Binance emphasis standard | `user receives shared emphasis styles for numeric values and selected options` ([Source]); `user sees the fixed panel layout in open mode` ([Visual]). |
| 7 | panel buttons inherit one scoped disabled-state contract | `user receives disabled styles only for panel buttons and explicitly owned native controls` ([Source]); `user starts closing a short position while unavailable close-long controls stay disabled` ([Controls]). |
| 8 | route watcher owns non-trading page pause instead of business timers spinning forever | `user leaving futures stops readiness position polls and does not revive the continuous session on return` ([Routes]). |
| 9 | trade mode and Post Only switches wait for observed state instead of fixed sleeps | `user switches between native open and close modes without moving the direction controls` ([Controls]); `user waits for the native Post Only selection before the ladder can submit its exact orders` ([Entry wiring]). |
| 10 | ladder execution waits for the current semantic action button before every submit | `user completes a ladder only after each native submit control becomes ready again` ([Controls]); `user waits for a disabled close button and then receives a complete cooldown` ([Continuous]). |
| 11 | trade input synchronization confirms live controlled values instead of sleeping | `user confirms controlled trade inputs only after consecutive stable frames` ([Trade form]); `user rejects trade inputs that keep rolling back before their virtual deadline` ([Trade form]). |
| 12 | labeled quantity matching resets its global regexp for every DOM node | `user reads both open quantities from one shared label beside native buttons` ([Panel]) and its separate-direction label variant. |
| 13 | visible SVG controls do not require offset dimensions | `user must confirm each native row dialog before replacement can continue` ([Replacement]); the four-direction row-replacement family clicks the actual SVG controls. |
| 14 | ladder retries with restricted open-order replacement after supported feedback | `user replaces only the required current-symbol basic 开多 rows before completing the ladder` ([Replacement]) and its other three directions; `user keeps existing orders when replacement finds insufficient matching quantity` ([Replacement]). |
| 15 | only continuous close routes confirmed conflicts through position-based recovery | `user retains partial close progress through reduce-only rejections until the position is confirmed flat` ([Close recovery]); `user stops a close ladder on a conflicting reduce-only response without assuming the position was closed` ([Submit]). |
| 16 | continuous close recovers a confirmed max-open-orders rejection by freeing farthest slots | `user frees only the fifty farthest same-direction slots with a native row mount delay of 120 ms` ([Capacity]); `user does not cancel another capacity batch after a second confirmed rejection in the same round` ([Capacity]). |
| 17 | capacity recovery waits through an unrendered open-orders list instead of treating it as empty | `user waits for the native order list to mount before choosing capacity cancellations` ([Capacity]); `user finishes delayed scroll restoration with the original Conditional list after freeing capacity` ([Capacity]). |
| 18 | capacity recovery skips an unconfirmed row cancellation without claiming the slot was released | `user retains one confirmed released slot when the next native cancellation remains unconfirmed` ([Capacity]). |
| 19 | open and close ladders reprice only remaining orders after explicit maker conflicts | `user reprices only the three remaining OPEN_LONG orders after a native maker rejection` ([Submit]) and its other three directions; `user reprices only the three unfinished orders from the current book after the full fifth-rejection pause` ([Quantity and reprice]) checks 2,999/3,000 ms after the fifth rejection, success sequences `[1, 2, 8, 9, 10]`, and the refreshed remaining prices. |
| 20 | an in-flight order request receives a separate response deadline | `user sees one order remain pending until its matching Binance response succeeds` ([Controls]); `user advances an unconfirmed continuous order to a new round without counting a late success` ([Continuous]). |
| 21 | bapi headers wake leverage checks without startup or 500ms polling sleeps | `user wakes a pending leverage check when native headers arrive after 1000 milliseconds` ([Account lifecycle]) and the 5,500 ms variant. |
| 22 | stable panel renders avoid repeated orderbook scans and layout writes | `user keeps stable watchdog refreshes independent of orderbook size and limits panel layout checks` ([Entry wiring]); `user keeps an unchanged panel free of DOM writes during repeated stable renders` ([Panel]). |
| 23 | dynamic panel text keeps fixed single-line slots | `user receives fixed single-line layout slots for dynamic text and actions` ([Source]); `user sees the fixed panel layout in open mode` ([Visual]). |
| 24 | floating panel stays below Binance native portal overlays | `user receives a floating panel below the native Binance portal layer` ([Source]). |
| 25 | panel keeps controls in cohesive ordered semantic groups | `user receives semantic panel groups and multiplier controls in the declared visual order` ([Source]). |
| 26 | multiplier row reads as a labeled value followed by decrement and increment controls | `user receives semantic panel groups and multiplier controls in the declared visual order` ([Source]); `user decrements a multiplier only to one and repeated presses retain a single field identity` ([Panel]). |
| 27 | multiplier clicks use non-blocking local feedback without writing business status | `user increases the quantity multiplier with local feedback and unchanged operation status` ([Controls]). |
| 28 | multiplier calculation keeps the formula primary and separates the notional constraint visually | `user sanitizes multiplier typing and repairs an invalid value on blur` ([Panel]); `user sees the amount constraint separated from the formula only while an opening notional applies` ([Rules and form]); `user sees the fixed panel layout in open mode` ([Visual]). |
| 29 | direction selector is a compact mutually exclusive radio group | `user receives accessible two-direction radio markup with a shared boundary` ([Source]); `user changes open direction with arrow keys while preserving radio focus and symbol ownership` ([Panel]). |
| 30 | ladder feedback labels captured API codes without exposing bare numbers | `user can stop after five consecutive maker rejections during the declared reprice pause` ([Submit]); `user reprices only the three unfinished orders from the current book after the full fifth-rejection pause` ([Quantity and reprice]) assert labelled captured API codes. |
| 31 | ladder minimum quantity failure explains safe manual options | `user receives safe minimum-quantity guidance when OPEN_LONG cannot fit even one order` ([Plan]) and the `OPEN_SHORT`, `CLOSE_LONG`, and `CLOSE_SHORT` variants. |
| 32 | ladder actions keep only their final UI feedback visible for a minimum window | `user keeps an immediate failure pending until its feedback window is visible` ([Interaction feedback]); `user distinguishes confirmed zero balance after brief action feedback through the actual open-ladder entrypoint` ([Quantity and reprice]). |
| 33 | Option or Alt click continuously repeats close ladders only after readiness and cooldown | `user completes two close-short rounds with a full cooldown and exact cumulative progress` ([Continuous]); `user restarts the full cooldown when the close button becomes busy before it expires` ([Continuous]). |
| 34 | continuous close captures only owned order-line saves and restores the chart method | `user saves one complete chart per continuous round after every accepted order drawing settles` ([Continuous chart saves]); `user coalesces native order-removal saves while a continuous submit is pending` ([Continuous chart saves]); `user keeps another operation in control of chart saving` ([Chart saves]). |
| 35 | trade input frame synchronization reuses only its initially proven form root | `user sees that trade input resolver starts from a proven root without another document scan` ([Trade form]); `user sees that active trade inputs ignore hidden duplicate forms and remain one coherent pair` ([Trade form]). |
| 36 | open ladder stops immediately only for a confirmed zero available balance | `user distinguishes confirmed zero balance after brief action feedback through the actual open-ladder entrypoint` ([Quantity and reprice]); `user distinguishes temporarily missing quantity through the actual open-ladder entrypoint` ([Quantity and reprice]); `user distinguishes zero quantity with available balance through the actual open-ladder entrypoint` ([Quantity and reprice]). Zero balance keeps the 240 ms action-feedback minimum; missing quantity and zero quantity with funds wait the 1,200 ms quantity deadline. |
| 37 | user-facing trading failures preserve one precise reason and shared terminology | `user gets a precise refusal for a changed captured precision before a replacement plan can submit` ([Plan]); `user receives a concrete refusal when a native quantity input disappears before a price click` ([Submit]); `user keeps existing orders when replacement finds no basic orders` ([Replacement]). |
| 38 | ladder replacement cancels visible current-symbol same-direction rows up to planned quantity | `user replaces only the required current-symbol basic 开多 rows before completing the ladder` ([Replacement]) and its other three directions verify the exact cancelled IDs and preserved unrelated orders. |
| 39 | stopping a ladder aborts replacement waits before another cancel or submit click | `user can stop replacement while a native row decision is pending without another cancellation or submit` ([Replacement]); `user retains a confirmed cancellation count of 1 when Stop follows settlement before the next native row mounts` ([Confirmed cancellation Stop]). |
| 40 | stopping a ladder preserves confirmed submit and cancel progress | `user stopping inside a drawing burst preserves the partial round and restores ordinary native removal saves` ([Continuous chart saves]) preserves the second accepted submit while its drawing capture is pending; `user retains a confirmed cancellation count of 2 when Stop follows settlement before the next native row mounts` ([Confirmed cancellation Stop]) and the count-of-one variant preserve settled removals. `user stops a pending continuous order without counting its late acknowledgement` ([Continuous]) separately covers Stop before acknowledgement. |
| 41 | ladder task statuses name the active action and observed outcome | `user completes two close-short rounds with a full cooldown and exact cumulative progress` ([Continuous]); `user retains one confirmed released slot when the next native cancellation remains unconfirmed` ([Capacity]). |
| 42 | panel statuses omit the current full symbol and compact the retained interrupted symbol | `user sees that status symbols omit supported futures quote assets` ([Status symbol]); `user stops the original cancellation workflow by changing symbol during confirmation` ([Cancel]). |
| 43 | bulk cancel keeps chart orders visible and coalesces their removal saves after native confirmation | `user cancels seventy orders while chart drawings stay visible and save once at completion` ([Cancel]). |
| 44 | bulk cancel distinguishes native confirm from cancellation before clear polling | `user confirms cancellation for the current symbol while other-symbol orders survive` ([Cancel]); `user dismisses native cancellation with Escape and restores the original view` ([Cancel]); `user cannot continue cancellation through an invalid extraAction native dialog` ([Cancel]) and the backdrop/missing-primary variants. |
| 45 | chart Open Orders reload recovery remains pending until restoration succeeds | `user keeps a reload recovery record until the chart is ready and its final restored drawing is saved` ([Routes]); `user keeps the reload journal when native chart restoration cannot close its menu` ([Routes]). |
| 46 | Binance SPA locale changes rebuild only the userscript panel and preserve task state | `user preserves an active close ladder and exact round totals across SPA locale changes` ([Routes]). |
| 47 | cancel current-symbol open orders wait for confirmed clearing before restoring page state | `user sees cancellation progress while the current-symbol clear is delayed` ([Cancel]); `user receives an incomplete-cancellation result when confirmed orders never clear` ([Cancel]). |
| 48 | cancel current-symbol open orders are single-flight and follow the native dialog lifecycle | `user can click cancellation twice rapidly without opening duplicate dialogs` ([Cancel]); `user can resume a cancellation dialog after a BFCache pagehide` ([Cancel]); `user can dismiss cancellation after the host replaces the dialog subtree` ([Cancel]). |
| 49 | stable panel refreshes avoid writing unchanged text and state attributes | `user keeps an unchanged panel free of DOM writes during repeated stable renders` ([Panel]). |
| 50 | orderbook precision recommendation marks one shortcut without applying it automatically | `user sees every native precision shortcut without an automatic precision selection` ([Precision]); `user refreshes precision recommendations from the currently visible trades` ([Controls]); `user waits for bid quotes before reading a new symbol's precision menu` ([Precision bootstrap]) and the ask-quotes/precision-field variants. |
| 51 | close state is committed only for the currently observed symbol | `user replays only the latest symbol after a busy account position check` ([Account lifecycle]); `user refuses a stale ladder when symbol changes during awaited exchange-rule bootstrap` ([Routes]). |
| 52 | close execution and close-ladder sizing reject display cache | `user keeps cached close display while refusing execution until both native quantities return` ([Panel]); `user cannot submit from a cached close display after both native quantity labels disappear` ([Submit]). |
| 53 | confirmed close-quantity mutations bypass the generic trade UI debounce | `user receives the first confirmed close quantities before the generic trade-form debounce can expire` ([Entry wiring]); `user sees that recognizes only close-quantity mutations as a confirmed close snapshot` ([Trade form]). |
| 54 | pending close actions report position confirmation without starting execution | `user cannot resolve a close action when native buttons and quantity labels are absent` ([Panel]); `user cannot submit from a cached close display after both native quantity labels disappear` ([Submit]). |
| 55 | cancel flow rechecks the captured symbol before destructive click and cleanup | `user stops the original cancellation workflow by changing symbol during confirmation` ([Cancel]); `user keeps the new symbol scope when a route switch interrupts delayed scroll restoration` ([Capacity]); `user cannot cancel when a checked symbol filter still exposes another symbol row` ([Cancel boundaries]). |
| 56 | multiplier edits retain their captured symbol, mode, and orderbook precision | `user discards a stale multiplier input after a symbol transition` ([Panel]); `user discards an old multiplier input after native mode changes` ([Panel]); `user discards an old multiplier input after native precision changes` ([Panel]) and all three blur variants. |
| 57 | panel numeric options wait for a complete mode-symbol-precision context | `user cannot edit numeric panel controls while native precision is unknown` ([Panel]) and the unknown-mode variant; `user stops while price precision is missing and its return cannot revive the session` ([Continuous]). |
| 58 | precision changes invalidate edits and immediately rerender the panel | `user restores a new precision promptly and uses its profile after a complete cooldown` ([Continuous]); `user discards an old multiplier input after native precision changes` ([Panel]). |
| 59 | ladder plans fail closed when orderbook precision changes | `user stops an active ordinary ladder after native price precision changes and keeps confirmed progress` ([Active context]); `user rebuilds a continuous ladder after active native price precision changes without resuming old remaining levels` ([Active context]); `user refuses a stale ladder when precision changes during awaited exchange-rule bootstrap` ([Routes]). |
| 60 | continuous close ladders recover only from tagged pre-submit transients | `user retries only failures covered by the continuous-close recovery policy` ([Continuous core]); `user rebuilds a continuous ladder after active saved ratio changes without resuming old remaining levels` ([Active context]) and the saved-order-count/saved-price-gap variants retain the acknowledged old progress, then rebuild after the full cooldown. |
| 61 | continuous close ladders continue after an explicitly tagged unconfirmed submission | `user advances an unconfirmed continuous order to a new round without counting a late success` ([Continuous]); `user ends a single close round on an unknown submission even when a late success arrives` ([Controls]). |
| 62 | continuous close defers temporary startup, position, capacity, and open-order failures | `user waits for a disabled close button and then receives a complete cooldown` ([Continuous]); `user does not cancel another capacity batch after a second confirmed rejection in the same round` ([Capacity]); `user honors the temporary position-server recovery interval before rechecking a blocked close session` ([Continuous]). |
| 63 | continuous close backs off rate limits and unconfirmed server responses without swallowing fatal rejections | `user honors an explicit HTTP 429 retry interval before rechecking a blocked close session` ([Continuous]) with the HTTP 418, HTTP 503, explicit-zero, missing, and invalid Retry-After cases; `user gets a terminal failure for an expired authentication response while the close button is blocked` ([Continuous]) and the permanent-client-error/malformed-payload cases. |
| 64 | confirmed directional flat state ends close ladders without masking uncertain outcomes | `user can finish continuous close on confirmed flat even when the native button becomes disabled` ([Close recovery]); `user ends the session when the authoritative position has no current-symbol short quantity` ([Continuous]). |
| 65 | single-order sizing and submission retain the captured orderbook precision | `user rejects an in-flight single-order draft when its captured precision changes before native submission` ([Submit]). |
| 66 | precision shortcut selection and refresh do not commit after a symbol switch | `user keeps current-symbol shortcuts when the previous symbol portal arrives after a pending read` ([Precision bootstrap]); `user recovers a missing precision menu only by refreshing after the failed automatic attempt` ([Precision bootstrap]) and its malformed-menu variant; `user restores symbol-specific precision shortcuts after switching from A to B and back` ([Precision]). |
| 67 | busy leverage reset retains and replays the latest symbol request | `user replays only the latest symbol after a busy account position check` ([Account lifecycle]); `user replays only the latest reset after switching symbols during its final position read` ([Account lifecycle]). |
| 68 | auto leverage reset is authorized by a fresh current-symbol position response | `user requires a fresh flat position response immediately before adjusting leverage` ([Account lifecycle]). |
| 69 | account position count changes schedule symbol-specific API checks | `user refreshes current-symbol position evidence when an account position count changes` ([Account lifecycle]); `user does not repeat account HTTP checks while counts and symbol remain unchanged` ([Account lifecycle]). |
| 70 | USDT rebalance waits for global flat stability and requires zero open orders | `user qualifies for account rebalance only after the full three-second flat window and its API response` ([Account lifecycle]); `user restarts the full rebalance window when a native open order reappears` ([Account lifecycle]) and the native-position/stale-response cases. |
| 71 | USDT rebalance uses direct Binance BAPI only after one explicit plan confirmation | `user completes exactly two USDT transfers only after confirming the complete account plan` ([Rebalance]); `user stops account transfers when the authoritative position changes during confirmation` ([Rebalance]) and the changed-balance case. |

[Source]: ../test/unit/binance-orderbook-trade/source-regressions.test.js
[Routes]: ../e2e/binance-orderbook/specs/route-recovery-behavior.pw.js
[Panel]: ../e2e/binance-orderbook/specs/panel-lifecycle-behavior.pw.js
[Visual]: ../e2e/binance-orderbook/specs/panel-visual-contract.pw.js
[Controls]: ../e2e/binance-orderbook/specs/control-flows.pw.js
[Trade form]: ../test/unit/binance-orderbook-trade/trade-form.test.js
[Submit]: ../e2e/binance-orderbook/specs/order-submit-behavior.pw.js
[Replacement]: ../e2e/binance-orderbook/specs/ladder-replacement-behavior.pw.js
[Capacity]: ../e2e/binance-orderbook/specs/order-capacity-behavior.pw.js
[Close recovery]: ../e2e/binance-orderbook/specs/close-ladder-recovery.pw.js
[Continuous]: ../e2e/binance-orderbook/specs/continuous-readiness-behavior.pw.js
[Account lifecycle]: ../e2e/binance-orderbook/specs/account-lifecycle-behavior.pw.js
[Plan]: ../e2e/binance-orderbook/specs/ladder-plan-behavior.pw.js
[Interaction feedback]: ../test/unit/binance-orderbook-trade/interaction-feedback.test.js
[Chart saves]: ../test/unit/binance-orderbook-trade/chart-save-coalescer.test.js
[Cancel]: ../e2e/binance-orderbook/specs/cancel-current-symbol.pw.js
[Cancel boundaries]: ../e2e/binance-orderbook/specs/cancel-boundaries-behavior.pw.js
[Status symbol]: ../test/unit/binance-orderbook-trade/status-symbol.test.js
[Precision]: ../e2e/binance-orderbook/specs/precision-controls.pw.js
[Continuous core]: ../test/unit/binance-orderbook-trade/continuous-ladder.test.js
[Rebalance]: ../e2e/binance-orderbook/specs/account-rebalance-behavior.pw.js
[Active context]: ../e2e/binance-orderbook/specs/active-ladder-context-behavior.pw.js
[Precision bootstrap]: ../e2e/binance-orderbook/specs/precision-bootstrap-behavior.pw.js
[Continuous chart saves]: ../e2e/binance-orderbook/specs/continuous-chart-saves-behavior.pw.js
[Confirmed cancellation Stop]: ../e2e/binance-orderbook/specs/cancel-confirmed-stop-behavior.pw.js
[Quantity and reprice]: ../e2e/binance-orderbook/specs/quantity-and-reprice-boundaries.pw.js
[Entry wiring]: ../e2e/binance-orderbook/specs/order-entry-wiring-behavior.pw.js
[Rules and form]: ../e2e/binance-orderbook/specs/rules-and-form-boundaries.pw.js
[browser fixture]: ../e2e/binance-orderbook/fixtures/binance-futures.js

## Other migrated suites

- Orderbook pure logic and DOM suites execute real decimal, quantity, plan,
  recovery, cancellation, precision, depth and controlled-form behavior.
- Strategy 27 and 29 suites execute live-client, chart-layer, annotation,
  persistence and stale-response behavior through contract-tested external boundaries.
- Trading/CMC and media suites execute complete entrypoints for route/visibility
  lifecycle, network responses, download jobs and Brooks export state.

Clock advances, explicit response gates and observable mutation completion
replace elapsed real-time waits. Fake network, storage, crypto, chart, clipboard
and browser host behavior has independent contract tests.

## Evidence limits

All Binance, wallet, order and media operations in these suites use offline
fixtures. No test result certifies the current live site or grants financial
authorization.

The confirmed-cancellation Stop cases observe the real published release
status after stable confirmation and accounting. The delayed native list mount
leaves a genuine asynchronous boundary before the next row action. They do not
claim to insert Stop into the unobservable private microtask between the
confirmation helper returning and its caller recording the cancellation.
The drawing-burst Stop case separately checks a successful native submit
whose final drawing capture is still pending; the late-acknowledgement case
checks the opposite event order.

Complete source coverage and the passing branch gate are documented in
[Source Coverage](test-coverage.md). Migration verification and the required
independent reviews are complete; this mapping does not change coverage policy
or thresholds. Live-site and Tampermonkey validation remain separate from this
offline migration acceptance.
