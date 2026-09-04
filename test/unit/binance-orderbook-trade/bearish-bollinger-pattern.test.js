import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyBollingerAlertTaskFailure,
  calculateBullishBollingerIndicatorBars,
  calculateBearishBollingerIndicatorBars,
  detectBollingerSignalsFromIndicatorBars,
  detectBullishBollingerSignalsFromIndicatorBars,
  detectBearishBollingerSignalsFromIndicatorBars,
  isTradingViewBarSnapshotInconsistentError,
  isBearishBollingerDrawingMutationBlocked,
  TradingViewBarSnapshotInconsistentError,
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
  const bars = Array.from({ length: 145 }, (_, index) => {
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

function setReversalBreakout(pattern, index, close = null) {
  const warningHigh = pattern.bars[pattern.warningIndex].high;
  const breakoutClose = close ?? warningHigh + 0.1;
  pattern.bars[index] = {
    ...pattern.bars[index],
    open: breakoutClose - 0.3,
    high: breakoutClose + 0.2,
    low: breakoutClose - 0.6,
    close: breakoutClose,
  };
}

function mirrorIndicatorBars(indicatorBars) {
  return indicatorBars.map((bar) => ({
    ...bar,
    open: -bar.open,
    high: -bar.low,
    low: -bar.high,
    close: -bar.close,
    middle: bar.middle === null ? null : -bar.middle,
    upper: bar.upper === null ? null : -bar.lower,
    lower: bar.lower === null ? null : -bar.upper,
    ma60: bar.ma60 === null ? null : -bar.ma60,
  }));
}

test('calculates SMA20 Bollinger 2σ and SMA60 from closes through the current bar only', () => {
  const indicatorBars = calculateBearishBollingerIndicatorBars(createOhlcBars(60));
  const last = indicatorBars[59];

  assert.equal(last.middle, 50.5);
  assert.equal(last.ma60, 30.5);
  assert.equal(Number(last.upper.toFixed(12)), 62.032562594671);
  assert.equal(Number(last.lower.toFixed(12)), 38.967437405329);
});

test('keeps bullish indicator values on the original price axis', () => {
  const bars = createOhlcBars(60);
  assert.deepEqual(
    calculateBullishBollingerIndicatorBars(bars),
    calculateBearishBollingerIndicatorBars(bars),
  );
});

test('implements bullish detection as the strict price-axis mirror of bearish detection', () => {
  const bearishPattern = createIndicatorPattern();
  const bullishBars = mirrorIndicatorBars(bearishPattern.bars);
  const originalBullishBars = structuredClone(bullishBars);
  const bearishSignals = detectBearishBollingerSignalsFromIndicatorBars(bearishPattern.bars);
  const bullishSignals = detectBullishBollingerSignalsFromIndicatorBars(bullishBars);

  assert.deepEqual(
    bullishSignals.map(({ type, setupTime, time, markerPrice, direction }) => ({
      type,
      setupTime,
      time,
      markerPrice,
      direction,
    })),
    bearishSignals.map((signal) => ({
      type: signal.type,
      setupTime: signal.setupTime,
      time: signal.time,
      markerPrice: -signal.markerPrice,
      direction: 'bullish',
    })),
  );
  assert.deepEqual(
    bullishSignals.map((signal) => signal.id),
    bearishSignals.map((signal) => `${signal.setupTime}:bullish:${signal.type}`),
  );
  const bearishWarning = bearishSignals.find((signal) => signal.type === 'warning');
  const bullishWarning = bullishSignals.find((signal) => signal.type === 'warning');
  assert.ok(bearishWarning.markerPrice > bearishPattern.bars[bearishPattern.warningIndex].high);
  assert.ok(bullishWarning.markerPrice < bullishBars[bearishPattern.warningIndex].low);
  assert.deepEqual(bullishBars, originalBullishBars);
});

test('combined detection keeps opposite-direction setups and distinct signal IDs', () => {
  const bearishPattern = createIndicatorPattern();
  const secondPattern = createIndicatorPattern();
  const bullishBars = mirrorIndicatorBars(secondPattern.bars).map((bar) => ({
    ...bar,
    time: bar.time + (200 * 60),
  }));
  const signals = detectBollingerSignalsFromIndicatorBars([
    ...bearishPattern.bars,
    ...bullishBars,
  ]);

  assert.deepEqual(new Set(signals.map((signal) => signal.direction)), new Set(['bearish', 'bullish']));
  assert.equal(new Set(signals.map((signal) => signal.id)).size, signals.length);
  assert.ok(signals.some((signal) => signal.direction === 'bearish'));
  assert.ok(signals.some((signal) => signal.direction === 'bullish'));
});

test('classifies only snapshot ordering and OHLC range races as recoverable', () => {
  assert.equal(
    isTradingViewBarSnapshotInconsistentError(
      new TradingViewBarSnapshotInconsistentError('race'),
    ),
    true,
  );
  assert.equal(isTradingViewBarSnapshotInconsistentError(new Error('race')), false);

  const invalidRange = createOhlcBars(1);
  invalidRange[0] = { ...invalidRange[0], high: invalidRange[0].close - 1 };
  assert.throws(
    () => calculateBearishBollingerIndicatorBars(invalidRange),
    (error) => isTradingViewBarSnapshotInconsistentError(error),
  );

  const invalidTime = createOhlcBars(1);
  invalidTime[0] = { ...invalidTime[0], time: 1.5 };
  assert.throws(
    () => calculateBearishBollingerIndicatorBars(invalidTime),
    (error) => !isTradingViewBarSnapshotInconsistentError(error),
  );
});

test('rejects incomplete indicator bars instead of mirroring undefined values', () => {
  const bars = createIndicatorPattern().bars;
  bars[80] = { ...bars[80], upper: undefined };
  assert.throws(
    () => detectBullishBollingerSignalsFromIndicatorBars(bars),
    /indicator bar 80 upper is invalid/,
  );
});

test('keeps snapshot task failures retryable and marks contract failures fatal', () => {
  const context = { failed: false, cleanupPending: false };
  assert.equal(
    applyBollingerAlertTaskFailure(
      context,
      new TradingViewBarSnapshotInconsistentError('race'),
    ),
    'retry',
  );
  assert.deepEqual(context, { failed: false, cleanupPending: false });

  assert.equal(applyBollingerAlertTaskFailure(context, new Error('schema')), 'fatal');
  assert.deepEqual(context, { failed: true, cleanupPending: true });
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
  const breachIndex = accepted.crossIndex + 1;
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
    [],
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

test('adds the first strict reversal breakout after confirmation without rewriting prior signals', () => {
  const pattern = createIndicatorPattern();
  const throughConfirmation = pattern.bars.slice(0, pattern.confirmationIndex + 1);
  const original = detectBearishBollingerSignalsFromIndicatorBars(throughConfirmation);
  const reversalIndex = pattern.warningIndex + 30;
  setReversalBreakout(pattern, reversalIndex);
  const updated = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars);

  assert.deepEqual(updated.slice(0, 2), original);
  assert.deepEqual(
    updated.map(({ id, type, setupTime, time }) => ({ id, type, setupTime, time })),
    [
      {
        id: `${pattern.bars[pattern.crossIndex].time}:warning`,
        type: 'warning',
        setupTime: pattern.bars[pattern.crossIndex].time,
        time: pattern.bars[pattern.warningIndex].time,
      },
      {
        id: `${pattern.bars[pattern.crossIndex].time}:confirmed`,
        type: 'confirmed',
        setupTime: pattern.bars[pattern.crossIndex].time,
        time: pattern.bars[pattern.confirmationIndex].time,
      },
      {
        id: `${pattern.bars[pattern.crossIndex].time}:reversal`,
        type: 'reversal',
        setupTime: pattern.bars[pattern.crossIndex].time,
        time: pattern.bars[reversalIndex].time,
      },
    ],
  );
  assert.ok(updated[2].markerPrice < pattern.bars[reversalIndex].low);
});

test('requires a close strictly above the warning candle high', () => {
  const pattern = createIndicatorPattern();
  const equalIndex = pattern.warningIndex + 5;
  const breakoutIndex = equalIndex + 1;
  setReversalBreakout(pattern, equalIndex, pattern.bars[pattern.warningIndex].high);
  setReversalBreakout(pattern, breakoutIndex);

  const reversal = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars)
    .find((signal) => signal.type === 'reversal');
  assert.equal(reversal.time, pattern.bars[breakoutIndex].time);
});

test('includes the sixtieth closed bar after warning and excludes the sixty-first', () => {
  const included = createIndicatorPattern();
  const includedIndex = included.warningIndex + 60;
  setReversalBreakout(included, includedIndex);
  assert.equal(
    detectBearishBollingerSignalsFromIndicatorBars(included.bars)
      .find((signal) => signal.type === 'reversal')?.time,
    included.bars[includedIndex].time,
  );

  const excluded = createIndicatorPattern();
  const excludedIndex = excluded.warningIndex + 61;
  setReversalBreakout(excluded, excludedIndex);
  assert.equal(
    detectBearishBollingerSignalsFromIndicatorBars(excluded.bars)
      .find((signal) => signal.type === 'reversal'),
    undefined,
  );
});

test('deduplicates one shared reversal candle in favor of the newest overlapping setup', () => {
  const pattern = createIndicatorPattern();
  const secondCrossIndex = 90;
  const secondWarningIndex = 92;
  pattern.bars[secondCrossIndex - 1] = {
    ...pattern.bars[secondCrossIndex - 1],
    ma60: pattern.bars[secondCrossIndex - 1].middle - 0.5,
  };
  pattern.bars[secondCrossIndex] = {
    ...pattern.bars[secondCrossIndex],
    ma60: pattern.bars[secondCrossIndex].middle + 0.5,
  };
  pattern.bars[secondWarningIndex] = {
    ...pattern.bars[secondWarningIndex],
    open: pattern.bars[secondWarningIndex].middle - 1.2,
    high: pattern.bars[secondWarningIndex].middle - 0.5,
    low: pattern.bars[secondWarningIndex].middle - 2.5,
    close: pattern.bars[secondWarningIndex].middle - 2,
  };
  const sharedBreakoutIndex = secondWarningIndex + 5;
  setReversalBreakout(
    pattern,
    sharedBreakoutIndex,
    pattern.bars[pattern.warningIndex].high + 0.1,
  );

  const signals = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars);
  const sharedReversals = signals
    .filter((signal) => signal.type === 'reversal' && signal.time === pattern.bars[sharedBreakoutIndex].time);
  assert.equal(sharedReversals.length, 1);
  assert.equal(sharedReversals[0].setupTime, pattern.bars[secondCrossIndex].time);
  assert.deepEqual(
    signals.map((signal) => signal.time),
    signals.map((signal) => signal.time).toSorted((left, right) => left - right),
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
