import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectNonZeroPriceMoves,
  formatOrderbookPrecisionShortcutLabel,
  getOrderbookPrecisionDecadeTarget,
  getOrderbookPrecisionShortcutOptions,
  mergePrecisionSamples,
  recommendOrderbookPrecision,
  resolveOrderbookPrecisionSampleState,
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

test('keeps multiple sampling rounds bounded and newest samples last', () => {
  assert.deepEqual(
    mergePrecisionSamples(['0.001', '0.002', '0.003'], ['0.004', '0.005'], 4),
    ['0.002', '0.003', '0.004', '0.005']
  );
});

test('recommends precision from accumulated effective price movement instead of tick size', () => {
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

test('does not keep a stale sampling label busy after the sampler has stopped', () => {
  assert.deepEqual(resolveOrderbookPrecisionSampleState({
    sampling: false,
    scheduled: false,
    status: '采样中',
    recommendation: '0.00001',
  }), {
    busy: false,
    status: 'ready',
  });

  assert.deepEqual(resolveOrderbookPrecisionSampleState({
    sampling: false,
    scheduled: false,
    status: '采样中',
    recommendation: null,
  }), {
    busy: false,
    status: '数据不足',
  });
});

test('keeps precision controls busy only for an active or scheduled sample', () => {
  assert.deepEqual(resolveOrderbookPrecisionSampleState({
    sampling: true,
    scheduled: false,
    status: '采样中',
    recommendation: null,
  }), {
    busy: true,
    status: '采样中',
  });

  assert.deepEqual(resolveOrderbookPrecisionSampleState({
    sampling: false,
    scheduled: true,
    status: '刷新中',
    recommendation: '0.00001',
  }), {
    busy: true,
    status: '刷新中',
  });
});
