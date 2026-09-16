import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

import config from '../../eslint.config.js';
import plugin from '../../scripts/test-policy/eslint-plugin.js';
import { contractCallAllowances, legacyBehaviorFiles, legacyBehaviorGroups, legacyCallAllowances } from '../../scripts/test-policy/migration-inventory.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

function lint(code, rule, options = []) {
  return new Linter().verify(code, {
    plugins: { 'test-policy': plugin },
    rules: { [`test-policy/${rule}`]: ['error', ...options] },
  });
}

function lintConfigured(code, filename) {
  return new Linter({ cwd: projectRoot }).verify(code, config, { filename });
}

function messages(result) {
  return result.map(({ ruleId, messageId, severity }) => ({ ruleId, messageId, severity }));
}

function ids(result) {
  return result.map(({ messageId }) => messageId);
}

const commentBehavior = `test('user sees a submitted order', () => {
  // Given the panel has a valid order quantity
  const panel = createPanel({ quantity: 2 });
  // When the user submits the order
  panel.submit();
  // Then the status confirms the accepted quantity
  assert.equal(panel.status, 'Submitted 2');
});`;

test('user accepts concrete behavior comments around executable phases', () => {
  // Given a behavior test with setup, action, and an observable status assertion
  const code = commentBehavior;
  // When the policy checks the scenario
  const result = lint(code, 'behavior-contract');
  // Then the behavior contract accepts every phase
  assert.deepEqual(result, []);
});

test('user accepts awaited steps and additional action-result pairs', () => {
  // Given a browser scenario that submits an order and then closes its panel
  const code = `test('user sees confirmation before closing the panel', async () => {
    let panel;
    await test.step('Given the order panel is ready', async () => { panel = await openPanel(); });
    await test.step('When the user submits the order', async () => { await panel.submit(); });
    await test.step('Then the accepted quantity is visible', async () => { expect(panel.quantity).toBe(2); });
    await test.step('When the user closes the panel', async () => { await panel.close(); });
    return test.step('Then the panel is absent from the page', async () => { expect(panel.visible).toBe(false); });
  });`;
  // When the policy checks the ordered steps
  const result = lint(code, 'behavior-contract');
  // Then both observable result stages satisfy the contract
  assert.deepEqual(result, []);
});

test('user accepts parameterized titles whose visible prefix remains user', () => {
  // Given a scenario matrix registered through an imported test alias
  const code = "import { test as scenario } from 'node:test';\n"
    + commentBehavior.replace("test('user sees a submitted order'", 'scenario(`user sees ${quantity} accepted orders`');
  // When the policy checks the parameterized registration
  const result = lint(code, 'behavior-contract');
  // Then a dynamic quantity does not hide the behavioral title prefix
  assert.deepEqual(result, []);
});

for (const [reason, code, expected] of [
  ['an implementation title', commentBehavior.replace('user sees a submitted order', 'submitOrder calls the API'), ['title']],
  ['a computed title without a stable prefix', commentBehavior.replace("'user sees a submitted order'", "name + ' user submits'"), ['title']],
  ['bare stage keywords', `test('user sees an order', () => {
    // Given
    const panel = createPanel();
    // When
    panel.submit();
    // Then
    assert.equal(panel.count, 1);
  });`, ['description', 'description', 'description']],
  ['placeholder stage descriptions', `test('user sees an order', () => {
    // Given the setup
    const panel = createPanel();
    // When the action
    panel.submit();
    // Then expected result
    assert.equal(panel.count, 1);
  });`, ['description', 'description', 'description']],
  ['empty setup and action phases', `test('user sees an order', () => {
    // Given the order panel is ready
    // When the user submits the order
    // Then the order appears in current orders
    assert.equal(readOrderCount(), 1);
  });`, ['emptyStage', 'emptyStage']],
  ['a result stage before the action', `test('user sees an order', () => {
    // Given the order panel is ready
    const panel = createPanel();
    // Then the order appears in current orders
    assert.equal(panel.count, 1);
    // When the user submits the order
    panel.submit();
  });`, ['stages']],
  ['phase comments hidden in an unused function', `test('user sees an order', () => {
    function unused() {
      // Given the order panel is ready
      const panel = createPanel();
      // When the user submits the order
      panel.submit();
      // Then the order appears in current orders
      assert.equal(panel.count, 1);
    }
    assert.equal(readOrderCount(), 1);
  });`, ['stages']],
  ['stage labels hidden in strings', `test('user sees an order', () => {
    const unused = 'Given the panel When user submits Then order appears';
    assert.equal(readOrderCount(), 1);
  });`, ['stages']],
  ['phase comments hidden behind a condition', `test('user sees an order', () => {
    if (false) {
      // Given the order panel is ready
      const panel = createPanel();
      // When the user submits the order
      panel.submit();
      // Then the order appears in current orders
      assert.equal(panel.count, 1);
    }
    assert.equal(readOrderCount(), 1);
  });`, ['stages']],
  ['an external callback that conceals the stages', "test('user sees an order', sharedCallback);", ['callback']],
]) {
  test(`user rejects ${reason} instead of accepting superficial BDD labels`, () => {
    // Given a source example with a specific missing behavioral contract
    const example = code;
    // When ESLint parses the source and applies the behavior rule
    const result = lint(example, 'behavior-contract');
    // Then the policy reports the exact violated contract
    assert.deepEqual(ids(result), expected);
  });
}

test('user rejects unawaited and empty browser steps', () => {
  // Given a setup step that is empty and an action step that can race assertions
  const code = `test('user sees a submitted order', async () => {
    await test.step('Given the order panel is ready', async () => {});
    test.step('When the user submits the order', async () => { await submit(); });
    await test.step('Then the accepted order is visible', async () => { expect(orderCount()).toBe(1); });
  });`;
  // When the policy checks the steps
  const result = lint(code, 'behavior-contract');
  // Then both the missing setup and the sequencing race are rejected
  assert.deepEqual(ids(result).sort(), ['awaitedStep', 'emptyStage']);
});

for (const [code, expectedCount = 1] of [
  ["test.only('case', () => assert.equal(readCount(), 1));"],
  ["test['skip']('case', () => assert.equal(readCount(), 1));"],
  ["test.describe.only('suite', () => {});"],
  ["import { test as scenario } from 'node:test'; scenario.skip('case', () => {});"],
  ["import * as scenarios from '@playwright/test'; scenarios.test.only('case', () => {});"],
  ["import * as scenarios from '../test.js'; scenarios.test.skip('case', () => {});"],
  ["test('case', context => { context.skip('temporarily disabled'); });"],
  ["const { only: exclusive } = test; exclusive('case', () => {});"],
  ["const scenario = test; scenario[`skip`]('case', () => {});"],
  ["const scenario = test.only.bind(test); scenario('case', () => {});", 2],
  ["test['s' + 'kip']('case', () => {});"],
  ["test('case', { skip: true }, () => {});"],
  ["describe('suite', { only: true }, () => {});"],
  ["test('case', { todo: 'later' }, () => {});"],
  ["test.fixme(true, 'broken behavior');"],
]) {
  test(`user rejects a focused or omitted scenario registered as ${code}`, () => {
    // Given a runner call that would focus, omit, or defer a scenario
    const example = code;
    // When the policy checks the actual JavaScript syntax
    const result = lint(example, 'no-focused-tests');
    // Then the runner cannot silently drop coverage through that call
    assert.deepEqual(ids(result), Array(expectedCount).fill('forbidden'));
  });
}

test('user keeps ordinary runner options and unrelated only fields valid', () => {
  // Given a fully enabled scenario and an unrelated media selection object
  const code = "test('case', { only: false, skip: false }, () => {}); const asset = { only: 'video' }; test.setTimeout(30000);";
  // When the focus rule checks the source
  const result = lint(code, 'no-focused-tests');
  // Then ordinary data fields and runner deadlines remain valid
  assert.deepEqual(result, []);
});

for (const code of [
  "t.mock.method(Date, 'now', () => 42);",
  't["mock"]["fn"](() => 42);',
  "import { mock as tracker } from 'node:test'; tracker.method(transport, 'send', send);",
  "const { method: replace } = t.mock; replace(transport, 'send', send);",
  "const spy = t.mock.fn.bind(t.mock); spy(() => 42);",
  "t.mock[method](transport, 'send', send);",
]) {
  test(`user rejects an ad hoc mock introduced as ${code}`, () => {
    // Given a direct or aliased method replacement without a boundary contract
    const example = code;
    // When the mock policy checks the source
    const result = lint(example, 'no-uncontracted-mocks');
    // Then the replacement requires a tested fake or virtual clock
    assert.deepEqual(ids(result), ['forbidden']);
  });
}

test('user allows the built-in virtual clock and an explicit fake factory', () => {
  // Given a deterministic clock and a named transport fake
  const code = "t.mock.timers.enable({ apis: ['Date', 'setTimeout'] }); t.mock.timers.tick(1000); const transport = createContractTestedTransport();";
  // When the mock rule checks these boundary choices
  const result = lint(code, 'no-uncontracted-mocks');
  // Then time control is not confused with ad hoc method replacement
  assert.deepEqual(result, []);
});

for (const code of [
  'await page.waitForTimeout(500);',
  "const pause = page['waitForTimeout'].bind(page); await pause(500);",
  'await new Promise(resolve => setTimeout(resolve, 500));',
  'await new Promise(resolve => window.setTimeout(() => resolve(), 0));',
  'await new Promise(resolve => { const finish = resolve; setTimeout(finish, 500); });',
  "import { setTimeout as pause } from 'node:timers/promises'; await pause(500);",
  "import * as timers from 'node:timers/promises'; await timers.setTimeout(500);",
  "import { scheduler } from 'node:timers/promises'; await scheduler.wait(500);",
  'await sleep(1000);',
  'await delay(duration);',
]) {
  test(`user rejects a fixed wait expressed as ${code}`, () => {
    // Given a real elapsed-time wait that could hide a race or slow a test
    const example = code;
    // When the wait policy checks the parsed call
    const result = lint(example, 'no-fixed-waits');
    // Then the wait must become an observed condition or clock advance
    assert.deepEqual(ids(result), ['forbidden']);
  });
}

test('user preserves modeled host events and bounded failure deadlines', () => {
  // Given timer callbacks that emit modeled events or reject a deadline
  const code = `setTimeout(() => host.emit('accepted'), 20);
    const result = new Promise((resolve, reject) => setTimeout(() => reject(new Error('deadline')), 1000));
    test.setTimeout(30000);
    await page.clock.runFor(1000);
    await expect.poll(readStatus).toBe('ready');`;
  // When the fixed-wait rule checks those scheduling contracts
  const result = lint(code, 'no-fixed-waits');
  // Then scheduling a modeled event is not treated as sleeping before assertions
  assert.deepEqual(result, []);
});

test('user can retain only the recorded number of legacy mock targets', () => {
  // Given one explicitly documented Date.now replacement in a legacy file
  const code = "t.mock.method(Date, 'now', () => 42);";
  const options = [{ allow: [{ target: 'method:Date:now', count: 1, reason: 'Legacy footer clock awaits migration to mock.timers.' }] }];
  // When the same call is checked once and then duplicated
  const accepted = lint(code, 'no-uncontracted-mocks', options);
  const duplicated = lint(`${code}\n${code}`, 'no-uncontracted-mocks', options);
  // Then the inventory allows the old call and rejects any growth
  assert.deepEqual(accepted, []);
  assert.deepEqual(ids(duplicated), ['forbidden']);
});

test('user must remove stale wait allowances when a legacy wait is migrated', () => {
  // Given one recorded legacy timer target
  const options = [{ allow: [{ target: 'setTimeout(20)', count: 1, reason: 'Legacy export settling awaits a completion-event migration.' }] }];
  // When the old wait is retained, removed, or replaced with a longer sleep
  const retained = lint('await new Promise(resolve => setTimeout(resolve, 20));', 'no-fixed-waits', options);
  const migrated = lint('await exportFinished;', 'no-fixed-waits', options);
  const changed = lint('await new Promise(resolve => setTimeout(resolve, 100));', 'no-fixed-waits', options);
  // Then only the exact retained target matches the shrinking inventory
  assert.deepEqual(retained, []);
  assert.deepEqual(ids(migrated), ['staleAllowance']);
  assert.deepEqual(ids(changed), ['staleAllowance', 'forbidden']);
});

test('user permits only the performance-tail task boundary in its owning helper', () => {
  // Given the single real browser task used to collect PerformanceObserver entries
  const file = 'e2e/binance-orderbook/helpers/live-performance-probe.js';
  const boundary = 'window.setTimeout(resolve, 0);';
  const code = `const probe = { finishAfterPerformanceTail() {
    return new Promise(resolve => { ${boundary} });
  } };`;
  // When another wait is added inside or outside the approved method
  const accepted = lintConfigured(code, file);
  const duplicate = lintConfigured(code.replace(boundary, `${boundary} ${boundary}`), file);
  const businessWait = lintConfigured(`${code}\nawait new Promise(resolve => window.setTimeout(resolve, 0));`, file);
  // Then the exact host boundary is retained and both growth paths fail
  assert.deepEqual(accepted, []);
  assert.deepEqual(ids(duplicate), ['forbidden']);
  assert.deepEqual(ids(businessWait), ['forbidden']);
});

for (const [reason, code, expected] of [
  ['an empty callback', "test('case', () => {});", 'empty'],
  ['a pending callback', "test('case');", 'empty'],
  ['constant arithmetic', "test('case', () => { assert.equal(1 + 1, 2); });", 'constant'],
  ['constant browser assertions', "test('case', () => { expect(true).toBe(true); });", 'constant'],
  ['a value compared with itself', "test('case', () => { const result = readState(); assert.equal(result, result); });", 'constant'],
]) {
  test(`user rejects ${reason} as evidence of tested behavior`, () => {
    // Given a test that cannot detect a behavioral regression
    const example = code;
    // When the policy examines its executable body and assertions
    const result = lint(example, 'no-vacuous-tests');
    // Then the test is rejected for its specific missing evidence
    assert.deepEqual(ids(result), [expected]);
  });
}

test('user retains meaningful source contracts and exception assertions', () => {
  // Given metadata, runtime-result, and invalid-input assertions
  const code = `test('metadata has install URLs', () => assert.match(source, /@downloadURL/));
    test('accepted count', () => assert.equal(readCount(), 2));
    test('invalid quantity', () => assert.throws(() => submit(-1), /quantity/));`;
  // When the policy checks the assertion inputs
  const result = lint(code, 'no-vacuous-tests');
  // Then useful string contracts and runtime behavior remain covered
  assert.deepEqual(result, []);
});

test('user can call a regular expression test method without registering a test case', () => {
  // Given a validation predicate that uses the standard RegExp method
  const code = "const matches = /ready/.test(status); const expression = /ready/; expression.test(status);";
  // When test registration rules inspect those calls
  const results = ['behavior-contract', 'no-vacuous-tests'].map((rule) => lint(code, rule));
  // Then neither call is mistaken for a Node or Playwright test registration
  assert.deepEqual(results, [[], []]);
});

test('user resolves test aliases in their lexical scope without confusing local data', () => {
  // Given a runner alias beside a helper parameter with the same name
  const code = `import { test as scenario } from 'node:test';
    function inspect(scenario) { scenario.skip('ordinary object method'); }
    scenario.only('case', () => assert.equal(readCount(), 1));`;
  // When the policy resolves each reference through the ESLint scope model
  const result = lint(code, 'no-focused-tests');
  // Then only the imported runner can focus a test
  assert.deepEqual(ids(result), ['forbidden']);
  assert.equal(result[0].line, 3);
});

test('user applies full behavior rules to every new test file and migrated suite', () => {
  // Given one implementation-named case in new, migrated, and browser test paths
  const code = "test('internal helper works', () => assert.equal(readCount(), 2));";
  const files = [
    'test/unit/new-behavior.test.js',
    'test/unit/binance-orderbook-trade/quantity.test.js',
    'test/unit/test-policy.test.js',
    'test/unit/binance-fixture-contract.test.js',
    'test/unit/coverage-report.test.js',
    'test/unit/test-selection.test.js',
    'e2e/binance-orderbook/specs/new-behavior.pw.js',
  ];
  // When ESLint uses the repository configuration for every path
  const results = files.map((filename) => ids(lintConfigured(code, filename)));
  // Then each path requires the user title and concrete behavior stages
  assert.deepEqual(results, files.map(() => ['title', 'stages']));
});

test('user keeps legacy behavioral debt visible without disabling universal rules', () => {
  // Given an explicitly inventoried source-regression suite
  const file = 'test/unit/binance-orderbook-trade/source-regressions.test.js';
  // When its useful source assertion and a newly skipped case are linted
  const accepted = lintConfigured("test('metadata', () => assert.match(source, /@version/));", file);
  const skipped = lintConfigured("test.skip('metadata', () => assert.match(source, /@version/));", file);
  // Then only the staged BDD organization is deferred
  assert.deepEqual(accepted, []);
  assert.deepEqual(messages(skipped), [{ ruleId: 'test-policy/no-focused-tests', messageId: 'forbidden', severity: 2 }]);
});

test('user cannot hide test-policy failures with an inline ESLint disable', () => {
  // Given a local disable directive attached to a test without behavior stages
  const code = "/* eslint-disable test-policy/behavior-contract */\ntest('user sees an order', () => assert.equal(readCount(), 1));";
  // When the repository configuration checks the source
  const result = lintConfigured(code, 'test/unit/new-behavior.test.js');
  // Then the directive has no effect and the missing stages still fail lint
  assert.deepEqual(messages(result), [
    { ruleId: null, messageId: undefined, severity: 1 },
    { ruleId: 'test-policy/behavior-contract', messageId: 'stages', severity: 2 },
  ]);
});

test('user inventories only existing exact paths with an explicit migration reason', () => {
  // Given the repository migration inventory
  const files = [...legacyBehaviorFiles, ...legacyCallAllowances.map(({ file }) => file), ...contractCallAllowances.map(({ file }) => file)];
  // When inventory paths and explanatory scope are inspected
  const invalidFiles = files.filter((file) => /[*?{}]/.test(file) || !existsSync(new URL(file, new URL('../../', import.meta.url))));
  const missingReasons = legacyBehaviorGroups.filter(({ reason }) => reason.trim().length < 20);
  const duplicateBehaviorFiles = legacyBehaviorFiles.length - new Set(legacyBehaviorFiles).size;
  // Then no directory-wide allowance or silent unexplained debt exists
  assert.deepEqual(invalidFiles, []);
  assert.deepEqual(missingReasons, []);
  assert.equal(duplicateBehaviorFiles, 0);
});

test('user keeps nested browser scenarios subject to the same behavior policy', () => {
  // Given a nested browser spec has real phases but a title without the required prefix.
  const code = commentBehavior.replace('user sees a submitted order', 'nested order scenario');

  // When the actual repository configuration checks the nested spec path.
  const result = lintConfigured(code, 'e2e/binance-orderbook/specs/nested/order.pw.js');

  // Then nesting cannot bypass the behavior title rule.
  assert.deepEqual(messages(result), [
    { ruleId: 'test-policy/behavior-contract', messageId: 'title', severity: 2 },
  ]);
});
