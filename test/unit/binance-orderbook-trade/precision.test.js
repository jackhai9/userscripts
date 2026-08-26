import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectNonZeroPriceMoves,
  collectPriceMovesWithExpandingWindow,
  formatOrderbookPrecisionShortcutLabel,
  getOrderbookPrecisionDecadeTarget,
  getOrderbookPrecisionShortcutOptions,
  recommendOrderbookPrecision,
} from '../../../src/binance-orderbook-trade/core/precision.js';

test('keeps only the four smallest exact native precision shortcuts', () => {
  assert.deepEqual(
    getOrderbookPrecisionShortcutOptions(['100', '0.1', '10', '1', '1000', '0.10']),
    ['0.1', '1', '10', '100']
  );
  assert.deepEqual(
    getOrderbookPrecisionShortcutOptions(['0.001', '0.01', '0.1']),
    ['0.001', '0.01', '0.1']
  );
});

test('compacts long precision labels without changing the selected native value', () => {
  assert.equal(formatOrderbookPrecisionShortcutLabel('0.00000001'), '1e-8');
  assert.equal(formatOrderbookPrecisionShortcutLabel('0.00001'), '1e-5');
  assert.equal(formatOrderbookPrecisionShortcutLabel('0.001'), '0.001');
  assert.equal(formatOrderbookPrecisionShortcutLabel('1000'), '1000');
});

test('selects only an exact native decade precision target', () => {
  const options = ['1.0', '0.0010', '0.1', '0.010', '0.01'];
  assert.equal(getOrderbookPrecisionDecadeTarget(options, '0.01', 'DECREASE'), '0.001');
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

test('rejects unsupported precision adjustment directions', () => {
  assert.throws(
    () => getOrderbookPrecisionDecadeTarget(['0.01', '0.1'], '0.01', 'NEXT'),
    /Unsupported orderbook precision direction/,
  );
});

test('collects only non-zero price moves from consecutive observations', () => {
  assert.deepEqual(
    collectNonZeroPriceMoves(['18.1927', '18.1927', '18.1866', '18.2704']),
    ['0.0061', '0.0838']
  );
});

test('recommends precision from the latest effective price movement instead of tick size', () => {
  assert.equal(recommendOrderbookPrecision({
    samples: ['0.0001', '0.0061', '0.0107', '0.0089', '0.0112', '0.0075'],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }), '0.01');
});

test('prefers the lower effective movement over larger trade jumps', () => {
  assert.equal(recommendOrderbookPrecision({
    samples: [
      '0.0061', '0.0075', '0.0089', '0.0107', '0.0112',
      '0.036', '0.0393', '0.041', '0.052', '0.0838',
    ],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }), '0.01');
});

test('uses the dominant precision bucket instead of the smallest observed move', () => {
  assert.equal(recommendOrderbookPrecision({
    samples: [
      '0.0001', '0.0001', '0.0002',
      '0.0061', '0.0075', '0.0089', '0.0107', '0.0112', '0.0123', '0.014',
      '0.036', '0.052',
    ],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }), '0.01');
});

test('does not recommend precision until enough multi-sample evidence exists', () => {
  assert.equal(recommendOrderbookPrecision({
    samples: ['0.0107', '0.0061'],
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }), null);
});

test('does not treat display precision fallback as a recommendation', () => {
  assert.equal(recommendOrderbookPrecision({
    samples: [],
    fallbackMovement: '0.0061',
    options: ['0.0001', '0.001', '0.01', '0.1', '1'],
  }), null);
});

test('ten latest trade rows provide enough movement evidence when eight do not', () => {
  const prices = [
    '80.757', '80.757', '80.756', '80.756', '80.756',
    '80.757', '80.756', '80.755', '80.783', '80.781',
  ];
  const options = ['0.0001', '0.001', '0.01', '0.1', '1'];

  assert.equal(collectNonZeroPriceMoves(prices.slice(0, 8)).length, 4);
  assert.equal(recommendOrderbookPrecision({
    samples: collectNonZeroPriceMoves(prices.slice(0, 8)),
    options,
  }), null);
  assert.equal(recommendOrderbookPrecision({
    samples: collectNonZeroPriceMoves(prices),
    options,
  }), '0.001');
});

test('expands the latest-trade window only until enough effective price moves exist', () => {
  const prices = [
    '80.757', '80.757', '80.756', '80.756', '80.756',
    '80.757', '80.756', '80.755', '80.755', '80.755',
    '80.755', '80.754', '80.753', '80.752', '80.751',
    '80.750', '80.749', '80.748', '80.747', '80.746',
    '80.700',
  ];

  const result = collectPriceMovesWithExpandingWindow(prices);
  assert.equal(result.usedCount, 20);
  assert.equal(result.samples.length, 13);
  assert.deepEqual([...new Set(result.samples)], ['0.001']);
});

test('returns the complete visible snapshot when price changes remain insufficient', () => {
  assert.deepEqual(collectPriceMovesWithExpandingWindow([
    '80.7', '80.7', '80.7', '80.7', '80.7', '80.7',
  ]), {
    samples: [],
    usedCount: 6,
  });
});
