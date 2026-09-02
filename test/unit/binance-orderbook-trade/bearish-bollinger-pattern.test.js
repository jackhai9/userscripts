import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateBearishBollingerIndicatorBars,
  detectBearishBollingerSignalsFromIndicatorBars,
  isBearishBollingerDrawingMutationBlocked,
} from '../../../src/binance-orderbook-trade/core/bearish-bollinger-pattern.js';

function createOhlcBars(count, secondsPerBar = 60) {
  return Array.from({ length: count }, (_, index) => {
    const close = index + 1;
    return {
      time: (index + 1) * secondsPerBar,
      open: close - 0.25,
      high: close + 0.5,
      low: close - 0.5,
      close,
    };
  });
}

function createIndicatorPattern(secondsPerBar = 60) {
  const crossIndex = 72;
  const warningIndex = 74;
  const confirmationIndex = 77;
  const bars = Array.from({ length: 90 }, (_, index) => {
    const middle = 110 - (index * 0.1);
    const close = middle - 2;
    return {
      time: (index + 1) * secondsPerBar,
      open: close + 0.4,
      high: close + 0.5,
      low: close - 0.8,
      close,
      middle,
      upper: middle + 5,
      lower: middle - 5,
      ma60: index < crossIndex ? middle - 0.5 : middle + 0.5,
    };
  });
  bars[warningIndex] = {
    ...bars[warningIndex],
    open: bars[warningIndex].middle - 1.2,
    high: bars[warningIndex].middle - 0.5,
    low: bars[warningIndex].middle - 2.5,
    close: bars[warningIndex].middle - 2,
  };
  bars[confirmationIndex] = {
    ...bars[confirmationIndex],
    open: bars[confirmationIndex].middle - 1,
    high: bars[confirmationIndex].middle - 0.5,
    low: bars[confirmationIndex].lower - 0.1,
    close: bars[confirmationIndex].middle - 2,
  };
  return { bars, crossIndex, warningIndex, confirmationIndex };
}

test('calculates SMA20 Bollinger 2σ and SMA60 from closes through the current bar only', () => {
  const indicatorBars = calculateBearishBollingerIndicatorBars(createOhlcBars(60));
  const last = indicatorBars[59];

  assert.equal(last.middle, 50.5);
  assert.equal(last.ma60, 30.5);
  assert.equal(Number(last.upper.toFixed(12)), 62.032562594671);
  assert.equal(Number(last.lower.toFixed(12)), 38.967437405329);
});

test('emits one warning and one later bearish lower-band confirmation', () => {
  const { bars, crossIndex, warningIndex, confirmationIndex } = createIndicatorPattern();
  const signals = detectBearishBollingerSignalsFromIndicatorBars(bars);

  assert.deepEqual(signals.map(({ id, type, setupTime, time }) => ({ id, type, setupTime, time })), [
    {
      id: `${bars[crossIndex].time}:warning`,
      type: 'warning',
      setupTime: bars[crossIndex].time,
      time: bars[warningIndex].time,
    },
    {
      id: `${bars[crossIndex].time}:confirmed`,
      type: 'confirmed',
      setupTime: bars[crossIndex].time,
      time: bars[confirmationIndex].time,
    },
  ]);
});

test('uses bar counts rather than wall-clock duration across one-minute and one-hour charts', () => {
  const minute = createIndicatorPattern(60);
  const hour = createIndicatorPattern(60 * 60);

  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(minute.bars).map((signal) => signal.type),
    ['warning', 'confirmed'],
  );
  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(hour.bars).map((signal) => signal.type),
    ['warning', 'confirmed'],
  );
});

test('allows one middle close only when the next bar rejects it bearishly', () => {
  const accepted = createIndicatorPattern();
  const breachIndex = accepted.warningIndex + 1;
  accepted.bars[breachIndex] = {
    ...accepted.bars[breachIndex],
    open: accepted.bars[breachIndex].middle - 0.2,
    high: accepted.bars[breachIndex].middle + 0.2,
    close: accepted.bars[breachIndex].middle + 0.1,
  };
  accepted.bars[breachIndex + 1] = {
    ...accepted.bars[breachIndex + 1],
    open: accepted.bars[breachIndex + 1].middle + 0.2,
    high: accepted.bars[breachIndex + 1].middle + 0.3,
    close: accepted.bars[breachIndex + 1].middle - 1,
  };
  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(accepted.bars).map((signal) => signal.type),
    ['warning', 'confirmed'],
  );

  const rejected = createIndicatorPattern();
  rejected.bars[breachIndex] = { ...accepted.bars[breachIndex] };
  rejected.bars[breachIndex + 1] = {
    ...rejected.bars[breachIndex + 1],
    open: rejected.bars[breachIndex + 1].middle - 0.2,
    high: rejected.bars[breachIndex + 1].middle + 0.4,
    close: rejected.bars[breachIndex + 1].middle + 0.2,
  };
  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(rejected.bars).map((signal) => signal.type),
    ['warning'],
  );
});

test('requires the one allowed pre-cross middle close to be rejected by the next bar', () => {
  const accepted = createIndicatorPattern();
  const aboveIndex = accepted.crossIndex - 3;
  accepted.bars[aboveIndex] = {
    ...accepted.bars[aboveIndex],
    open: accepted.bars[aboveIndex].middle - 0.2,
    high: accepted.bars[aboveIndex].middle + 0.3,
    close: accepted.bars[aboveIndex].middle + 0.1,
  };
  accepted.bars[aboveIndex + 1] = {
    ...accepted.bars[aboveIndex + 1],
    open: accepted.bars[aboveIndex + 1].middle + 0.2,
    high: accepted.bars[aboveIndex + 1].middle + 0.3,
    close: accepted.bars[aboveIndex + 1].middle - 1,
  };
  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(accepted.bars).map((signal) => signal.type),
    ['warning', 'confirmed'],
  );

  const notRejected = createIndicatorPattern();
  notRejected.bars[aboveIndex] = { ...accepted.bars[aboveIndex] };
  notRejected.bars[aboveIndex + 1] = {
    ...notRejected.bars[aboveIndex + 1],
    open: notRejected.bars[aboveIndex + 1].middle - 0.2,
    high: notRejected.bars[aboveIndex + 1].middle + 0.4,
    close: notRejected.bars[aboveIndex + 1].middle + 0.2,
  };
  assert.deepEqual(detectBearishBollingerSignalsFromIndicatorBars(notRejected.bars), []);
});

test('accepts four channel closes when the remaining pre-cross bars stay within explicit bounds', () => {
  const pattern = createIndicatorPattern();
  const start = pattern.crossIndex - 8;
  pattern.bars[start] = {
    ...pattern.bars[start],
    open: pattern.bars[start].middle - 0.2,
    high: pattern.bars[start].middle + 0.3,
    close: pattern.bars[start].middle + 0.1,
  };
  for (const index of [start + 1, start + 2, start + 3]) {
    pattern.bars[index] = {
      ...pattern.bars[index],
      open: pattern.bars[index].lower + 0.2,
      high: pattern.bars[index].lower + 0.4,
      low: pattern.bars[index].lower - 0.3,
      close: pattern.bars[index].lower - 0.1,
    };
  }

  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(pattern.bars).map((signal) => signal.type),
    ['warning', 'confirmed'],
  );
});

test('later bars cannot rewrite an already confirmed setup', () => {
  const pattern = createIndicatorPattern();
  const throughConfirmation = pattern.bars.slice(0, pattern.confirmationIndex + 1);
  const original = detectBearishBollingerSignalsFromIndicatorBars(throughConfirmation);
  const laterBars = pattern.bars.slice(pattern.confirmationIndex + 1).map((bar) => ({
    ...bar,
    open: bar.middle + 4,
    high: bar.middle + 6,
    low: bar.middle + 3,
    close: bar.middle + 5,
  }));

  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars([...throughConfirmation, ...laterBars]),
    original,
  );
});

test('defers marker mutation for every existing TradingView save owner', () => {
  const idle = {
    ladderTask: null,
    continuousLadderTask: null,
    singleOrderTask: null,
    cancelCurrentSymbolOpenOrdersTask: null,
    chartOrdersRecoveryTask: null,
    continuousChartSaveController: null,
  };
  assert.equal(isBearishBollingerDrawingMutationBlocked(idle), false);

  for (const key of Object.keys(idle)) {
    assert.equal(
      isBearishBollingerDrawingMutationBlocked({ ...idle, [key]: {} }),
      true,
      key,
    );
  }
});
