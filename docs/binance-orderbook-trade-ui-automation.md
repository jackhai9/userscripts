# Binance Orderbook Userscript UI Automation

## Goal

Build a repeatable UI verification system for `binance-orderbook-trade` that covers
business correctness, host-page integration, user feedback, layout stability, and
interaction performance without making every regression test depend on a live
Binance account.

The generated userscript remains the system under test. Browser tests must inject
`scripts/binance-orderbook-trade.user.js`; they must not reimplement the production
workflow in a test-only controller.

## Test Layers

| Layer | Runtime | Contract |
| --- | --- | --- |
| L0 | Node.js | Pure calculations and state machines |
| L1 | jsdom | Binance DOM contracts, semantic lookup, and mutation waits |
| L2 | Playwright with a deterministic Binance fixture | Real browser clicks, rendering, React-style replacement, dialog lifecycle, layout, and performance |
| L3 | Chrome with Tampermonkey | Metadata, injection timing, installed-source version, and extension runtime |
| L4 | Logged-in Binance Chrome page with raw CDP | Current production DOM, real host performance, and minimal live behavior paths |

L0 and L1 remain fast PR gates. L2 owns the full scenario matrix. L3 and L4 are
smaller integration and release gates because extension state, network timing, and
market state are not deterministic enough for the full matrix.

## Scenario Model

Scenarios are data, not copied test procedures. Each scenario declares these axes:

- positions: none, current symbol, other symbol, or both;
- orders: none, current symbol, other symbol, or both;
- order scale: 1, 20, 40, 120, and a separately verified live boundary;
- initial account tab and open-order sub-tab;
- initial `Hide Other Symbols` state;
- initial TradingView `showOrders` state;
- trade mode, chart mode, locale, and panel expansion;
- dialog outcome: confirm, cancel, Escape, backdrop, page lifecycle abort, or no decision;
- host behavior: synchronous commit, delayed commit, React root replacement, or symbol change;
- upstream outcome: success, delayed success, rejection, or incomplete clearing.

Do not generate the Cartesian product. Maintain a mandatory risk-core matrix for
business invariants, then generate pairwise or three-way covering combinations for
the remaining axes. Production regressions become permanent named scenarios.

## Required Invariants

Every cancel-current-symbol scenario must assert all applicable invariants:

1. Other-symbol orders are never cancelled.
2. Cancelling the native dialog does not mutate orders.
3. Confirming clears only the captured current symbol.
4. The original account tab, sub-tab, symbol filter, and TradingView order-line
   visibility are restored exactly unless page navigation invalidates the workflow.
5. Every state-changing host click is followed by semantic DOM reacquisition.
6. The workflow is single-flight; repeated clicks do not open multiple dialogs.
7. Unrelated ladder controls do not flash, move, or change enabled state.
8. The action provides prompt feedback and finishes in a stable final state.
9. No uncaught userscript error, leaked observer, or residual test-owned order remains.
10. The loaded userscript version and source hash match the generated artifact.

## Performance Contract

Deterministic L2 tests use hard local budgets:

- click-to-first-feedback: at most 100 ms;
- no userscript-attributable long task above 50 ms;
- no unexpected movement of unrelated action controls;
- no repeated DOM writes after the scenario reaches its final state.

L4 records wall-clock segments instead of using a single brittle total timeout:

1. click to first feedback;
2. preflight and current-symbol filtering;
3. TradingView order-line hide;
4. native dialog discovery and user decision;
5. current-symbol clearing observation;
6. chart, tab, and filter restoration;
7. final button readiness.

Live results are compared with checked-in median and p95 baselines. Network-dependent
wall-clock duration is not a deterministic PR assertion. Raw CDP tracing is required
when a regression must be attributed to Binance, TradingView, rendering, or the
userscript.

## Artifacts

Failed L2 tests retain:

- Playwright trace with DOM snapshots, network, console, and screenshots;
- scenario input and random seed;
- userscript version and source hash;
- interaction timing and long-task JSON;
- before/after control geometry;
- final fixture state and event ledger.

Live tests additionally retain a test-owned order ledger keyed by symbol, side,
price, quantity, and creation time. Concurrent user orders are not inferred to be
test orders from count changes alone.

## Delivery Stages

### Stage 1: Deterministic Browser Foundation

- Add Playwright Test and repository scripts.
- Inject the generated userscript during head parsing, before the fixture body is
  available. Stage 3 separately verifies Tampermonkey's exact `document-start`
  lifecycle.
- Add a deterministic Binance Futures fixture with React-style subtree replacement.
- Add scenario data, interaction probes, and the core cancel-current-symbol matrix.
- Run L2 in the PR gate.

### Stage 2: Expanded Host and Fault Matrix

- Cover backdrop, Escape, navigation, symbol change, delayed DOM commits, malformed
  contracts, and error outcomes.
- Add open/close switching, orderbook precision, ladder start/stop, and leverage flows.
- Add pairwise/three-way scenario generation and stable visual snapshots.

### Stage 3: Tampermonkey Integration

- Sync the generated artifact through the existing Tampermonkey MCP path.
- Read back installed source and version.
- Verify injection timing and the minimum critical paths in an isolated Chrome profile.

### Stage 4: Live Binance Acceptance and Baselines

- Hard reload the logged-in page and verify the loaded source through raw CDP.
- Run no-order, dialog-cancel, and explicitly authorized dialog-confirm paths.
- Run 1/20/40/120 order-scale performance samples without exceeding the current live
  exchange limit minus one.
- Verify no fills, no residual test-owned orders, and restored page state after each run.

## Change Workflow

1. Convert a defect into a failing scenario or invariant assertion.
2. Fix the source and rebuild the generated userscript.
3. Run L0, L1, and the affected L2 matrix.
4. Review retained trace and performance artifacts for failures.
5. Merge through a PR.
6. Complete L3 and the affected L4 release path.
7. Store any production regression as a permanent named scenario.

Retries must not turn a failing scenario green. A retry may diagnose flakiness, but a
flaky result remains a release finding until its source is understood.
