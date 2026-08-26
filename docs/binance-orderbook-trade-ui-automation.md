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

The deterministic cancel matrix currently reduces 1,536 Cartesian combinations to
19 scenarios while proving complete pairwise coverage. The generator is stable and
seedless: the same ordered axes always produce the same named vectors. A unit test
fails if a future axis/value change leaves any required pair uncovered.

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

Deterministic L2 functional tests use hard user-facing budgets while retaining
lower-level performance signals for diagnosis:

- click-to-first-feedback: at most 200 ms;
- no observed long task or long animation frame above 200 ms;
- every task above 50 ms remains recorded as a diagnostic signal, but it is not
  attributed to the userscript without a supporting Long Animation Frame script
  entry or CDP trace;
- no unexpected movement of unrelated action controls;
- no repeated DOM writes after the scenario reaches its final state.

Dedicated performance runs use multiple isolated samples and compare median and
p95 values with the checked-in baseline. A single un-attributed task from a shared
headless browser is not a stable regression gate.

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

The Playwright auto fixture writes these JSON attachments only on failure. Visual
regression uses semantic layout/style snapshots for the canonical open-expanded,
close-expanded, and collapsed panels; this avoids platform font rasterization noise
while still detecting group movement, size changes, disabled styling, and state text.

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
- Verify injection timing and the minimum critical paths in the connected Chrome
  profile that owns the Tampermonkey installation.

The local artifact identity is produced with:

```bash
npm run inspect:binance-orderbook-trade
```

The JSON contract records the exact version, namespace, `@run-at`, install URLs,
matches, SHA-256, byte count, and character count. The MCP workflow must locate the
existing script by the exact `binance.orderbook.trade` namespace, patch that path,
read the same path back, and require an exact source match. A matching version alone
is insufficient because two different bundles can carry the same metadata version.

When a read-back source is available as a file, the same contract can compare it
without extension UI inspection:

```bash
node scripts/userscript-release-contract.mjs \
  scripts/binance-orderbook-trade.user.js \
  --compare /path/to/tampermonkey-readback.user.js
```

The current MCP text response appends a transport-only footer in this form:
`---` followed by `Last modified: <ISO timestamp>`. It is not part of the installed
userscript. Save the complete MCP response and use `--compare-mcp-readback` when the
response includes that footer. The parser removes only this exact, validated footer;
an unrecognized response shape fails instead of silently trimming source text.

The MCP write uses the last-read modification token when the server provides one.
A concurrent-edit error must stop the release check; it must not overwrite a newer
manual edit or create a second script with `put`.

L2 owns isolated and deterministic host-state coverage. L3 intentionally uses the
connected Chrome profile because that is where the MCP-managed Tampermonkey script
is installed. Its browser checks must therefore be non-financial, restore any UI
state they change, and avoid assertions that depend on account positions or orders.
The minimum L3 browser evidence is:

1. the exact Tampermonkey script id is present in a `Debugger.scriptParsed` URL;
2. that parse event precedes `Page.domContentEventFired` after a hard reload;
3. `Debugger.getScriptSource` contains the exact generated artifact;
4. the injected panel is visible; and
5. one reversible panel interaction changes state and restores the original state.

Enable only the CDP domains needed for this evidence. Disable them immediately after
collection when the browser bridge supports the corresponding command. A domain that
the bridge cannot disable remains scoped to the claimed tab session and must not be
used as a reason to retain event buffers or persistent probes.

### Stage 4: Live Binance Acceptance and Baselines

- Hard reload the logged-in page and verify the loaded source through raw CDP.
- Run no-order, dialog-cancel, and explicitly authorized dialog-confirm paths.
- Run 1/20/40/120 order-scale performance samples without exceeding the current live
  exchange limit minus one.
- Verify no fills, no residual test-owned orders, and restored page state after each run.

## Change Workflow

1. Convert a defect into a failing scenario or invariant assertion.
2. Fix the source and rebuild the generated userscript.
3. Run `npm run test:binance-orderbook-trade` and the affected L2 matrix.
4. Review retained trace and performance artifacts for failures.
5. Merge through a PR.
6. Complete L3 and the affected L4 release path.
7. Store any production regression as a permanent named scenario.

Retries must not turn a failing scenario green. A retry may diagnose flakiness, but a
flaky result remains a release finding until its source is understood.
