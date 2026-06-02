import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectNonZeroPriceMoves,
  mergePrecisionSamples,
  recommendOrderbookPrecision,
} from '../../../src/binance-orderbook-trade/core/precision.js';

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
