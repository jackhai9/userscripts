import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectNonZeroPriceMoves,
  formatOrderbookPrecisionShortcutLabel,
  getOrderbookPrecisionDecadeTarget,
  getOrderbookPrecisionShortcutOptions,
  recommendOrderbookPrecision,
  recommendOrderbookPrecisionWithExpandingWindow,
} from '../../../src/binance-orderbook-trade/core/precision.js';

test("user keeps only the four smallest exact native precision shortcuts", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [['100', '0.1', '10', '1', '1000', '0.10']];

  // When the requested precision decision is calculated
  const observed = getOrderbookPrecisionShortcutOptions(...scenarioInputs);

  // Then keeps only the four smallest exact native precision shortcuts
  assert.deepEqual(
    observed,
    ['0.1', '1', '10', '100']
  );
  assert.deepEqual(
    getOrderbookPrecisionShortcutOptions(['0.001', '0.01', '0.1']),
    ['0.001', '0.01', '0.1']
  );
});

test("user compacts long precision labels without changing the selected native value", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = ['0.00000001'];

  // When the requested precision decision is calculated
  const observed = formatOrderbookPrecisionShortcutLabel(...scenarioInputs);

  // Then compacts long precision labels without changing the selected native value
  assert.equal(observed, '1e-8');
  assert.equal(formatOrderbookPrecisionShortcutLabel('0.00001'), '1e-5');
  assert.equal(formatOrderbookPrecisionShortcutLabel('0.001'), '0.001');
  assert.equal(formatOrderbookPrecisionShortcutLabel('1000'), '1000');
});

test("user selects only an exact native decade precision target", () => {
  // Given native precision options and recent price observations are available
  const options = ['1.0', '0.0010', '0.1', '0.010', '0.01'];
  // When the requested precision decision is calculated
  const observed = getOrderbookPrecisionDecadeTarget(options, '0.01', 'DECREASE');

  // Then selects only an exact native decade precision target
  assert.equal(observed, '0.001');
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '0.01', 'INCREASE'), '0.1');
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '0.1', 'INCREASE'), '1');
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '1', 'DECREASE'), '0.1');
  assert.equal(getOrderbookPrecisionDecadeTarget(['0.01', '1'], '0.01', 'INCREASE'), null);
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '0.0001', 'INCREASE'), null);
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '10', 'INCREASE'), null);
  assert.equal(getOrderbookPrecisionDecadeTarget(['0.1', '1', '10', '100', '1000'], '1000', 'INCREASE'), null);
  assert.equal(getOrderbookPrecisionDecadeTarget(['0.1', '1', '10', '100', '1000'], '0.1', 'DECREASE'), null);
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '0.0001', 'DECREASE'), null);
});

test("user rejects unsupported precision adjustment directions", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [['0.01', '0.1'], '0.01', 'NEXT'];

  // When the requested precision decision is calculated
  const observedFailure = captureThrownError(() => getOrderbookPrecisionDecadeTarget(...scenarioInputs));

  // Then rejects unsupported precision adjustment directions
  assert.match(observedFailure.message, /不支持的价格精度方向/);
});

test("user collects only non-zero price moves from consecutive observations", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [['18.1927', '18.1927', '18.1866', '18.2704']];

  // When the requested precision decision is calculated
  const observed = collectNonZeroPriceMoves(...scenarioInputs);

  // Then collects only non-zero price moves from consecutive observations
  assert.deepEqual(
    observed,
    ['0.0061', '0.0838']
  );
});

test("user recommends precision from the latest effective price movement instead of tick size", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [{
    samples: ['0.0001', '0.0061', '0.0107', '0.0089', '0.0112', '0.0075'],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }];

  // When the requested precision decision is calculated
  const observed = recommendOrderbookPrecision(...scenarioInputs);

  // Then recommends precision from the latest effective price movement instead of tick size
  assert.equal(observed, '0.01');
});

test("user prefers the lower effective movement over larger trade jumps", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [{
    samples: [
      '0.0061', '0.0075', '0.0089', '0.0107', '0.0112',
      '0.036', '0.0393', '0.041', '0.052', '0.0838',
    ],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }];

  // When the requested precision decision is calculated
  const observed = recommendOrderbookPrecision(...scenarioInputs);

  // Then prefers the lower effective movement over larger trade jumps
  assert.equal(observed, '0.01');
});

test("user uses the dominant precision bucket instead of the smallest observed move", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [{
    samples: [
      '0.0001', '0.0001', '0.0002',
      '0.0061', '0.0075', '0.0089', '0.0107', '0.0112', '0.0123', '0.014',
      '0.036', '0.052',
    ],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }];

  // When the requested precision decision is calculated
  const observed = recommendOrderbookPrecision(...scenarioInputs);

  // Then uses the dominant precision bucket instead of the smallest observed move
  assert.equal(observed, '0.01');
});

test("user does not recommend precision until enough multi-sample evidence exists", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [{
    samples: ['0.0107', '0.0061'],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }];

  // When the requested precision decision is calculated
  const observed = recommendOrderbookPrecision(...scenarioInputs);

  // Then does not recommend precision until enough multi-sample evidence exists
  assert.equal(observed, null);
});

test("user does not treat display precision fallback as a recommendation", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [{
    samples: [],
    fallbackMovement: '0.0061',
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }];

  // When the requested precision decision is calculated
  const observed = recommendOrderbookPrecision(...scenarioInputs);

  // Then does not treat display precision fallback as a recommendation
  assert.equal(observed, null);
});

test("user sees that ten latest trade rows provide enough movement evidence when eight do not", () => {
  // Given native precision options and recent price observations are available
  const prices = [
    '80.757', '80.757', '80.756', '80.756', '80.756',
    '80.757', '80.756', '80.755', '80.783', '80.781',
  ];
  const options = ['0.0001', '0.001', '0.01', '0.1', '1'];

  // When the requested precision decision is calculated
  const observed = collectNonZeroPriceMoves(prices.slice(0, 8)).length;

  // Then sees that ten latest trade rows provide enough movement evidence when eight do not
  assert.equal(observed, 4);
  assert.equal(recommendOrderbookPrecision({
    samples: collectNonZeroPriceMoves(prices.slice(0, 8)),
    options,
  }), null);
  assert.equal(recommendOrderbookPrecision({
    samples: collectNonZeroPriceMoves(prices),
    options,
  }), '0.001');
});

test("user expands the latest-trade window until it produces a recommendation", () => {
  // Given native precision options and recent price observations are available
  const prices = [
    '80.757', '80.757', '80.756', '80.756', '80.756',
    '80.757', '80.756', '80.755', '80.755', '80.755',
    '80.755', '80.754', '80.753', '80.752', '80.751',
    '80.750', '80.749', '80.748', '80.747', '80.746',
    '80.700',
  ];

  // When the requested precision decision is calculated
  const result = recommendOrderbookPrecisionWithExpandingWindow({
    prices,
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  });
  // Then expands the latest-trade window until it produces a recommendation
  assert.equal(result.usedCount, 20);
  assert.equal(result.samples.length, 13);
  assert.deepEqual([...new Set(result.samples)], ['0.001']);
  assert.equal(result.recommendation, '0.001');
});

test("user returns the complete visible snapshot when price changes remain insufficient", () => {
  // Given native precision options and recent price observations are available
  const scenarioInputs = [{
    prices: ['80.7', '80.7', '80.7', '80.7', '80.7', '80.7'],
    options: ['0.001', '0.01', '0.1', '1'],
  }];

  // When the requested precision decision is calculated
  const observed = recommendOrderbookPrecisionWithExpandingWindow(...scenarioInputs);

  // Then returns the complete visible snapshot when price changes remain insufficient
  assert.deepEqual(observed, {
    samples: [],
    usedCount: 6,
    recommendation: null,
  });
});

test("user keeps expanding when sample count is sufficient but no precision bucket is decisive", () => {
  // Given native precision options and recent price observations are available
  const prices = [
    '79.748', '79.747', '79.742', '79.742', '79.737',
    '79.731', '79.730', '79.730', '79.715', '79.748',
    '79.748', '79.746', '79.740', '79.727', '79.727',
    '79.746', '79.745', '79.745', '79.767', '79.767',
    '79.745', '79.738', '79.737',
  ];
  const options = ['0.0001', '0.001', '0.01', '0.1', '1'];
  // When the requested precision decision is calculated
  const firstWindowSamples = collectNonZeroPriceMoves(prices.slice(0, 10));

  // Then keeps expanding when sample count is sufficient but no precision bucket is decisive
  assert.equal(firstWindowSamples.length, 7);
  assert.equal(recommendOrderbookPrecision({ samples: firstWindowSamples, options }), null);
  const result = recommendOrderbookPrecisionWithExpandingWindow({ prices, options });
  assert.equal(result.usedCount, 20);
  assert.equal(result.recommendation, '0.01');
});

test('user sees only valid positive native precision options within the configured shortcut count', () => {
  // Given the native menu contains zero, unreadable, duplicated, and valid values
  const options = ['bad', '0', null, '0.0100', '0.01', '1', '0.1'];

  // When shortcut lists are requested with a smaller limit or before menu discovery
  const limited = getOrderbookPrecisionShortcutOptions(options, 2);
  const pending = getOrderbookPrecisionShortcutOptions(null);

  // Then invalid values never become shortcuts and pending discovery stays empty
  assert.deepEqual(limited, ['0.01', '0.1']);
  assert.deepEqual(pending, []);
});

test('user cannot configure a nonpositive or fractional precision shortcut count', () => {
  // Given saved shortcut counts are zero, negative, or fractional
  const limits = [0, -1, 1.5];

  // When the shortcut configuration is evaluated
  const failures = limits.map((limit) => captureThrownError(() => getOrderbookPrecisionShortcutOptions(['0.01'], limit)));

  // Then each invalid count produces the explicit configuration error
  assert.deepEqual(failures.map((error) => error.message), [
    '价格精度快捷项数量无效：0', '价格精度快捷项数量无效：-1', '价格精度快捷项数量无效：1.5',
  ]);
});

test('user cannot adjust precision until the current value exists in the native menu', () => {
  // Given unavailable, zero, and absent current selections
  const cases = [
    { options: ['0.01', '0.1'], current: null },
    { options: ['0.01', '0.1'], current: '0' },
    { options: null, current: '0.01' },
    { options: ['bad', '0', null, '0.1'], current: '0.01' },
  ];

  // When a tenfold precision increase is requested
  const targets = cases.map(({ options, current }) => getOrderbookPrecisionDecadeTarget(options, current, 'INCREASE'));

  // Then no synthetic native option is selected
  assert.deepEqual(targets, [null, null, null, null]);
});

test('user sees compact large precision labels and explicit errors for unusable labels', () => {
  // Given a large native tick and invalid displayed tick values
  const largeTick = '100000';
  const invalid = ['0', 'bad', null];

  // When shortcut labels are formatted
  const label = formatOrderbookPrecisionShortcutLabel(largeTick);
  const failures = invalid.map((value) => captureThrownError(() => formatOrderbookPrecisionShortcutLabel(value)));

  // Then exponent labels preserve the value and invalid ticks are rejected
  assert.equal(label, '1e5');
  assert.deepEqual(failures.map((error) => error.message), [
    '价格精度快捷值无效：0', '价格精度快捷值无效：bad', '价格精度快捷值无效：null',
  ]);
});

test('user ignores unreadable trade prices while retaining consecutive valid movement evidence', () => {
  // Given unreadable rows appear before and between valid trade prices
  const prices = [null, 'bad', '10', '', '10.2', '10.2', undefined, '10.1'];

  // When consecutive usable price changes are collected
  const movements = collectNonZeroPriceMoves(prices);

  // Then only actual positive changes between readable prices remain
  assert.deepEqual(movements, ['0.2', '0.1']);
});

test('user receives no precision recommendation before options or sufficient trades are available', () => {
  // Given pending native options or an empty recent-trade snapshot
  const samples = ['0.01', '0.01', '0.01', '0.01', '0.01'];
  const prices = [];

  // When the recommendation is requested during those loading states
  const pending = recommendOrderbookPrecision({ samples, options: null });
  const empty = recommendOrderbookPrecisionWithExpandingWindow({ prices, options: ['0.01'] });

  // Then neither state manufactures a precision recommendation
  assert.equal(pending, null);
  assert.deepEqual(empty, { samples: [], usedCount: 0, recommendation: null });
});

test('user rejects malformed trade snapshots and invalid expanding-window settings', () => {
  // Given saved sampling settings violate one explicit input contract at a time
  const cases = [
    { prices: null },
    { prices: [], initialLimit: 1 },
    { prices: [], expansionStep: 0 },
    { prices: [], minSamples: 0 },
  ];

  // When a recommendation is requested with each configuration
  const failures = cases.map((input) => captureThrownError(() => recommendOrderbookPrecisionWithExpandingWindow({ options: ['0.01'], ...input })));

  // Then each rejected setting reports the responsible contract
  assert.deepEqual(failures.map((error) => error.message), [
    '价格精度成交价样本必须为数组', '价格精度初始样本数无效：1',
    '价格精度样本扩展步长无效：0', '价格精度最小样本数无效：0',
  ]);
});

test('user keeps the smaller native precision when equally supported buckets tie', () => {
  // Given two valid precision buckets have equal independent movement support
  const samples = ['1', '1', '1', '1', '1', '10', '10', '10', '10', '10'];

  // When the recommendation evaluates the two native options
  const recommendation = recommendOrderbookPrecision({ samples, options: ['10', '1'] });

  // Then the smaller equally supported native precision wins deterministically
  assert.equal(recommendation, '1');
});
