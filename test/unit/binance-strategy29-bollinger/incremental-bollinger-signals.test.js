import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectBollingerSignals,
  TradingViewBarSnapshotInconsistentError,
} from '../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';
import { createIncrementalBollingerSignalDetector } from '../../../src/binance-strategy29-bollinger/core/incremental-bollinger-signals.js';

function createBarSource(seed) {
  let state = seed;
  const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return {
    random,
    bar(time, previousClose) {
      const close = 100 + (8 + 6 * Math.sin(time / 700)) * Math.sin(time * 2 * Math.PI / 80) + (random() - 0.5) * 6;
      return {
        time, open: previousClose,
        high: Math.max(previousClose, close) + random() * 2,
        low: Math.min(previousClose, close) - random() * 2,
        close,
      };
    },
    series(count, startTime) {
      const bars = [];
      let close = 100;
      for (let index = 0; index < count; index += 1) {
        const bar = this.bar(startTime + index, close);
        bars.push(bar);
        close = bar.close;
      }
      return bars;
    },
  };
}

test('user receives exactly the full-history signals while bars close, revise and extend history', () => {
  // Given a detector following a live closed-bar feed
  const source = createBarSource(29);
  const detector = createIncrementalBollingerSignalDetector();
  let bars = source.series(500, 100_000);
  const kinds = new Set();
  let boundedSteps = 0;

  // When bars close, recent and old bars are revised, history is prepended and the tail shrinks
  const steps = [];
  for (let step = 0; step < 700; step += 1) {
    const roll = source.random();
    if (roll < 0.8) bars = [...bars, source.bar(bars.at(-1).time + 1, bars.at(-1).close)];
    else if (roll < 0.88) {
      const revised = bars.length - 1 - Math.floor(source.random() * 5);
      bars = bars.map((bar, index) => (index === revised
        ? { ...bar, close: Math.min(bar.high, Math.max(bar.low, bar.close + source.random() - 0.5)) } : bar));
    } else if (roll < 0.93) {
      const revised = Math.floor(source.random() * bars.length);
      bars = bars.map((bar, index) => (index === revised ? { ...bar, high: bar.high + 1 } : bar));
    } else if (roll < 0.96) bars = [...source.series(30, bars[0].time - 30), ...bars];
    else if (roll < 0.98) bars = bars.slice(0, bars.length - 1 - Math.floor(source.random() * 3));
    else bars = bars.slice();
    steps.push({ actual: detector.detect(bars), expected: detectBollingerSignals(bars), bounded: detector.lastAnalyzedBarCount < bars.length });
  }

  // Then every step matches full detection, including both directions and every signal type
  for (const { actual, expected, bounded } of steps) {
    assert.deepStrictEqual(actual, expected);
    if (bounded) boundedSteps += 1;
    for (const signal of expected) kinds.add(`${signal.direction}:${signal.type}`);
  }
  assert.equal(kinds.size, 6);
  assert.ok(boundedSteps > 600, `bounded steps: ${boundedSteps}`);
});

test('user analyzes only the affected tail when one bar closes on long history', () => {
  // Given a detector that has analyzed five thousand closed bars
  const bars = createBarSource(7).series(5001, 1_000_000);
  const detector = createIncrementalBollingerSignalDetector();
  detector.detect(bars.slice(0, 5000));
  assert.equal(detector.lastAnalyzedBarCount, 5000);

  // When the next bar closes
  const signals = detector.detect(bars);

  // Then the setup span and moving-average lookback bound the analyzed bars
  assert.equal(detector.lastAnalyzedBarCount, 207);
  assert.ok(signals.length > 20, `signals: ${signals.length}`);
  assert.deepStrictEqual(signals, detectBollingerSignals(bars));
});

test('user keeps the last accepted analysis when a revised bar is rejected', () => {
  // Given a detector with an accepted closed-bar window
  const bars = createBarSource(3).series(1002, 2_000_000);
  const detector = createIncrementalBollingerSignalDetector();
  detector.detect(bars.slice(0, 1000));

  // When a snapshot arrives with an inconsistent OHLC range
  const invalid = [...bars.slice(0, 1000), { ...bars[1000], high: bars[1000].low - 1 }];
  const rejected = () => detector.detect(invalid);

  // Then it is rejected as a retryable snapshot and the next valid window still matches full detection
  assert.throws(rejected, TradingViewBarSnapshotInconsistentError);
  assert.deepStrictEqual(detector.detect(bars), detectBollingerSignals(bars));
});
