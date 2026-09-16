# Behavioral Test Policy

The repository keeps Node's `node:test` runner, JSDOM, and Playwright. Tests should
describe an observable outcome, execute the real behavior being checked, and fail
when that outcome changes. A new runner or a large mocking framework is not
required for this policy.

Use the Node version pinned by `.nvmrc`. The relevant commands are:

| Command | Evidence |
| --- | --- |
| `npm run lint:tests` | Test policy checks across `test/` and `e2e/`; zero warnings are allowed. |
| `npm run test:test-policy` | The ESLint rules accept valid programs and reject concrete invalid programs. |
| `npm test` | Existing Node unit and JSDOM integration tests. |
| `npm run test:ui` | Offline Playwright scenarios using the generated userscripts and controlled host fixtures. |
| `npm run test:affected` | The repository's affected-test selector; consult its selection output before interpreting the result. |
| `npm run test:coverage:node` | Production-source coverage from the Node layer. |
| `npm run test:coverage` | Complete Node and browser source coverage, with the 90% aggregate and critical-module gates. |

The specialized validation paths, builds, and any required live checks remain in
[Userscript Validation](userscript-validation.md) and the linked script manuals.
Browser fixture tests establish the controlled host contract. They do not prove
the current live Binance DOM or grant permission for financial actions.

## Behavior Names and Stages

All Node test files and `e2e/**/specs/**/*.pw.js` scenarios use a title beginning with
`user `. Describe the observable behavior in the rest of the title. A
parameterized title such as `` `user sees ${quantity} accepted orders` `` keeps a
static `user ` prefix.

Every test has concrete, ordered Given, When, and Then stages. Prefer awaited
`test.step` calls in Playwright when their scope fits the scenario:

```js
test('user sees confirmation after the order response is accepted', async ({ page }) => {
  await test.step('Given the order panel has a valid quantity', async () => {
    await openOrderPanel(page, { quantity: 2 });
  });
  await test.step('When the user submits the order', async () => {
    await page.getByRole('button', { name: 'Submit' }).click();
  });
  await test.step('Then the accepted quantity is shown in the status', async () => {
    await expect(page.getByRole('status')).toHaveText('Submitted 2');
  });
});
```

Node tests, and browser scenarios that share local state across stages, may use
comments directly around executable statements:

```js
test('user keeps existing orders when cancellation is declined', async () => {
  // Given the user has current-symbol and unrelated orders
  const exchange = createExchangeFixture({ orders: initialOrders });

  // When the user declines the native cancellation confirmation
  await exchange.requestCancellation({ confirmation: 'decline' });

  // Then every original order remains present
  assert.deepEqual(exchange.orders(), initialOrders);
});
```

Each stage needs its own executable setup, action, or assertion and a description
of at least two words. Bare keywords, generic placeholders, three adjacent empty
comments, labels inside strings, and labels inside unused functions do not
satisfy the rule. Put stage boundaries outside conditional branches and loops;
the behavior must have phases for every invocation. Setup and cleanup may use
`try`/`finally` blocks.

A completed Then stage may be followed by another When/Then pair. A new
Given/When/Then sequence is also allowed after a completed Then. Assertions about
preconditions may appear during Given; assertions are not mechanically restricted
to Then. `test.step` calls must be awaited or returned to preserve execution
order. Inline callbacks keep the stage contract locally inspectable.

## Boundaries, Clocks, and Assertions

Prefer real pure functions and real DOM adapters. When a test needs an external
boundary, give its fake explicit state and operations and test that fake's
contract independently. The browser host fixture has contract checks in
`test/unit/binance-fixture-contract.test.js`; changes to its supported DOM,
request/response, event, or cancellation behavior require corresponding checks.
Do not replace a business method just to force the branch under test.

New uses of `mock.method` and `mock.fn` are rejected, including ordinary imported,
destructured, computed-property, and bound aliases. `mock.timers` remains the
supported Node clock. For browser business timing, install and advance
Playwright's page clock. Negative timing assertions should check the state before
the deadline and after the explicit clock advance. A response gate can preserve
a pending request until the scenario deliberately releases it.

Do not wait a fixed number of real milliseconds before an assertion. The rule
rejects `waitForTimeout`, Promise-resolving `setTimeout` calls, promise-timer
imports, and calls named `sleep` or `delay`. Use a response gate, observable DOM
state, event completion, or virtual-clock advance. Timeouts that bound an
operation, reject a deadline, or configure the runner are valid. Host-fixture
timers that emit modeled upstream events are also valid; scenarios should control
them through the page clock when checking timing.

Real performance measurements must observe real browser execution. The one
approved performance task boundary is listed separately below. A virtual-clock
result must not be reported as a measured long-task duration or throughput.

The policy rejects focused, skipped, pending, or deferred cases (`only`, `skip`,
`todo`, and `fixme`), including Node test options and imperative context skips.
Unrelated data fields named `only` remain valid. No existing skipped-test
exception is recorded.

Empty callbacks and tests that only compare constants or a value with itself
are rejected. Useful metadata, generated-artifact, and architecture assertions
such as `assert.match(source, /@downloadURL/)` remain valid. Runtime behavior
should be checked through results and effects instead of merely searching for
its implementation text.

## Completed Inventory and Exact Host Contracts

The first migration inventory contained 83 existing Node files, seven method
replacement calls, and 31 fixed waits. Both legacy lists in
[`scripts/test-policy/migration-inventory.js`](../scripts/test-policy/migration-inventory.js)
are now empty. Every existing and new suite is subject to the same BDD, assertion,
mock, and wait rules; there is no legacy ESLint override. Policy tests require
the legacy lists to stay empty.

Runtime source-text assertions were replaced with executable behavior tests.
Source tests retain metadata, generated-artifact identity, module boundaries,
and explicit CSS/markup contracts. The [migration map](test-migration-map.md)
tracks each of the 71 original orderbook source-contract titles to its replacement
and records any remaining verification separately. An empty lint inventory does
not by itself prove behavioral equivalence.

One separate host contract allows exactly one `window.setTimeout(0)` inside
`finishAfterPerformanceTail` in
`e2e/binance-orderbook/helpers/live-performance-probe.js`. PerformanceObserver
entries arrive after the observed host task, so this boundary collects the real
performance tail before tearing down observers. It is not a business wait or a
measurement made with a virtual clock. The rule tests verify that a second call
inside that method or a new wait elsewhere in the same file is rejected.

Inline `eslint-disable` directives cannot turn off the policy. Historical
installation artifacts under `test/fixtures/` are excluded from lint because
they are test input source snapshots, not executable test definitions.

## Coverage Target and Evidence Limits

The repository target is **90% branch coverage**. The coverage collector reports
the complete production-source denominator, including unexecuted files, and
maps generated artifacts back to their source. The denominator and target live
in `scripts/test-coverage/config.mjs`.

The default complete run enforces **90% across all production sources** and
**90% for each of the seven critical modules**. The temporary 66.5% migration
floor is no longer active. The executable threshold and file list live in
[`branch-policy.json`](../scripts/test-coverage/branch-policy.json).

Inspect `gate`, `meetsBranchTarget`, the exact covered/total counts, and the
recorded layers in `coverage-summary.json`. The default command requires the
aggregate target; `--report-only` collects diagnostic evidence without enforcing
thresholds. `metricInterpretation` and `blockEvidenceUnavailable` distinguish
retained detailed evidence from coarse Chromium teardown calls. Those coarse
calls receive no additional branch credit, so the gate may use a conservative
lower bound rather than an exact count of every actual execution.
Node-only results must remain labeled Node-only and cannot satisfy the merged
gate. See [Source Coverage](test-coverage.md) for the measured baseline and
complete-source contract.

The enforced test policy, the completed migration inventory, and the
coverage target are different facts. Report each separately. Do not shrink the
coverage denominator or mark a legacy suite migrated merely to improve a number.

Static lint catches the documented syntax and ordinary aliases; it does not
prove that assertions express the correct domain contract or that arbitrary
dynamically generated JavaScript executes the intended phases. Review scenarios
and run them. A useful behavior test must fail when the behavior it protects is
removed or changed.
