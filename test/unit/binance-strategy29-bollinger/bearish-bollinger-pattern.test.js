import assert from 'node:assert/strict';
import test from 'node:test';
import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';

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
} from '../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';

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

test('user calculates SMA20 Bollinger 2σ and SMA60 from closes through the current bar only', () => {
  // Given sixty increasing closes with independently calculable rolling averages
  const bars = createOhlcBars(60);
  // When the real detector calculates its twenty- and sixty-bar indicators
  const indicatorBars = calculateBearishBollingerIndicatorBars(bars);
  const last = indicatorBars[59];
  // Then the exact SMA and population-variance Bollinger values are retained
  assert.equal(last.middle, 50.5);
  assert.equal(last.ma60, 30.5);
  assert.equal(Number(last.upper.toFixed(12)), 62.032562594671);
  assert.equal(Number(last.lower.toFixed(12)), 38.967437405329);
});

test('user keeps bullish indicator values on the original price axis', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const bars = createOhlcBars(60);
  // When calculateBullishBollingerIndicatorBars processes the configured inputs
  const observedResult = calculateBullishBollingerIndicatorBars(bars);
  // Then user keeps bullish indicator values on the original price axis
  assert.deepEqual(
    observedResult,
    calculateBearishBollingerIndicatorBars(bars),
  );
});

for (const scale of [0.000001, 1, 100000000]) {
  test(`user preserves exact indicator arithmetic without allocating sliced close windows (scale=${JSON.stringify(scale)})`, () => {
    // Given the loaded OHLC bars and Bollinger detector inputs
    const bars = createOhlcBars(512).map((bar, index) => {
      const close = scale * (3 + Math.sin(index / 7) + Math.cos(index / 31));
      return { ...bar, open: close, high: close + scale, low: close - scale, close };
    });
    // When bars.map processes the configured inputs
    const expected = bars.map((bar, index) => {
      if (index < 59) return { ...bar, middle: null, upper: null, lower: null, ma60: null };
      const closes = bars.slice(index - 19, index + 1).map(item => item.close);
      const maCloses = bars.slice(index - 59, index + 1).map(item => item.close);
      const middle = closes.reduce((sum, close) => sum + close, 0) / 20;
      const deviation = Math.sqrt(closes.reduce((sum, close) => sum + ((close - middle) ** 2), 0) / 20) * 2;
      return { ...bar, middle, upper: middle + deviation, lower: middle - deviation, ma60: maCloses.reduce((sum, close) => sum + close, 0) / 60 };
    });
    let slices = 0;
    bars.slice = (...args) => { slices += 1; return Array.prototype.slice.apply(bars, args); };
    // Then user preserves exact indicator arithmetic without allocating sliced close windows (scale=the selected case)
    assert.deepEqual(calculateBearishBollingerIndicatorBars(bars), expected);
    assert.equal(slices, 0);

  });
}

test('user sees bullish detection mirror bearish detection across the price axis', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const bearishPattern = createIndicatorPattern();
  // When mirrorIndicatorBars processes the configured inputs
  const bullishBars = mirrorIndicatorBars(bearishPattern.bars);
  const originalBullishBars = structuredClone(bullishBars);
  const bearishSignals = detectBearishBollingerSignalsFromIndicatorBars(bearishPattern.bars);
  const bullishSignals = detectBullishBollingerSignalsFromIndicatorBars(bullishBars);

  // Then user sees bullish detection mirror bearish detection across the price axis
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

test('user observes that combined detection keeps opposite-direction setups and distinct signal IDs', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const bearishPattern = createIndicatorPattern();
  const secondPattern = createIndicatorPattern();
  // When mirrorIndicatorBars(secondPattern.bars).map processes the configured inputs
  const bullishBars = mirrorIndicatorBars(secondPattern.bars).map((bar) => ({
    ...bar,
    time: bar.time + (200 * 60),
  }));
  const signals = detectBollingerSignalsFromIndicatorBars([
    ...bearishPattern.bars,
    ...bullishBars,
  ]);

  // Then user observes that combined detection keeps opposite-direction setups and distinct signal IDs
  assert.deepEqual(new Set(signals.map((signal) => signal.direction)), new Set(['bearish', 'bullish']));
  assert.equal(new Set(signals.map((signal) => signal.id)).size, signals.length);
  assert.ok(signals.some((signal) => signal.direction === 'bearish'));
  assert.ok(signals.some((signal) => signal.direction === 'bullish'));
});

test('user classifies only snapshot ordering and OHLC range races as recoverable', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const scenarioInput = new TradingViewBarSnapshotInconsistentError('race');
  // When isTradingViewBarSnapshotInconsistentError processes the configured inputs
  const observedResult = isTradingViewBarSnapshotInconsistentError(
      scenarioInput,
    );
  // Then user classifies only snapshot ordering and OHLC range races as recoverable
  assert.equal(
    observedResult,
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

test('user rejects incomplete indicator bars instead of mirroring undefined values', () => {
  // Given a bullish detector input missing a required upper band
  const bars = createIndicatorPattern().bars;
  bars[80] = { ...bars[80], upper: undefined };
  // When the mirrored detector validates its input indicators
  const failure = captureStrategyError(() => detectBullishBollingerSignalsFromIndicatorBars(bars));
  // Then the missing band is rejected at the exact offending bar
  assert.match(failure.message, /indicator bar 80 upper is invalid/);
});

test('user keeps snapshot task failures retryable and marks contract failures fatal', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const context = { failed: false, cleanupPending: false };
  // When applyBollingerAlertTaskFailure processes the configured inputs
  const observedResult = applyBollingerAlertTaskFailure(
      context,
      new TradingViewBarSnapshotInconsistentError('race'),
    );
  // Then user keeps snapshot task failures retryable and marks contract failures fatal
  assert.equal(
    observedResult,
    'retry',
  );
  assert.deepEqual(context, { failed: false, cleanupPending: false });

  assert.equal(applyBollingerAlertTaskFailure(context, new Error('schema')), 'fatal');
  assert.deepEqual(context, { failed: true, cleanupPending: true });
});

test('user emits one warning and one later bearish lower-band confirmation', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const { bars, crossIndex, warningIndex, confirmationIndex } = createIndicatorPattern();
  // When detectBearishBollingerSignalsFromIndicatorBars processes the configured inputs
  const signals = detectBearishBollingerSignalsFromIndicatorBars(bars);

  // Then user emits one warning and one later bearish lower-band confirmation
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

test('user uses bar counts rather than wall-clock duration across one-minute and one-hour charts', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const minute = createIndicatorPattern(60);
  const hour = createIndicatorPattern(60 * 60);

  // When detectBearishBollingerSignalsFromIndicatorBars(minute.bars).map processes the configured inputs
  const observedResult = detectBearishBollingerSignalsFromIndicatorBars(minute.bars).map((signal) => signal.type);
  // Then user uses bar counts rather than wall-clock duration across one-minute and one-hour charts
  assert.deepEqual(
    observedResult,
    ['warning', 'confirmed'],
  );
  assert.deepEqual(
    detectBearishBollingerSignalsFromIndicatorBars(hour.bars).map((signal) => signal.type),
    ['warning', 'confirmed'],
  );
});

test('user allows one middle close only when the next bar rejects it bearishly', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
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
  // When detectBearishBollingerSignalsFromIndicatorBars(accepted.bars).map processes the configured inputs
  const observedResult = detectBearishBollingerSignalsFromIndicatorBars(accepted.bars).map((signal) => signal.type);
  // Then user allows one middle close only when the next bar rejects it bearishly
  assert.deepEqual(
    observedResult,
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

test('user requires the one allowed pre-cross middle close to be rejected by the next bar', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
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
  // When detectBearishBollingerSignalsFromIndicatorBars(accepted.bars).map processes the configured inputs
  const observedResult = detectBearishBollingerSignalsFromIndicatorBars(accepted.bars).map((signal) => signal.type);
  // Then user requires the one allowed pre-cross middle close to be rejected by the next bar
  assert.deepEqual(
    observedResult,
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

test('user accepts four channel closes when the remaining pre-cross bars stay within explicit bounds', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
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

  // When detectBearishBollingerSignalsFromIndicatorBars(pattern.bars).map processes the configured inputs
  const observedResult = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars).map((signal) => signal.type);
  // Then user accepts four channel closes when the remaining pre-cross bars stay within explicit bounds
  assert.deepEqual(
    observedResult,
    ['warning', 'confirmed'],
  );
});

test('user sees the first strict reversal breakout added after confirmation without rewriting prior signals', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const pattern = createIndicatorPattern();
  // When pattern.bars.slice processes the configured inputs
  const throughConfirmation = pattern.bars.slice(0, pattern.confirmationIndex + 1);
  const original = detectBearishBollingerSignalsFromIndicatorBars(throughConfirmation);
  const reversalIndex = pattern.warningIndex + 30;
  setReversalBreakout(pattern, reversalIndex);
  const updated = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars);

  // Then user sees the first strict reversal breakout added after confirmation without rewriting prior signals
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

test('user requires a close strictly above the warning candle high', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const pattern = createIndicatorPattern();
  const equalIndex = pattern.warningIndex + 5;
  const breakoutIndex = equalIndex + 1;
  // When setReversalBreakout processes the configured inputs
  setReversalBreakout(pattern, equalIndex, pattern.bars[pattern.warningIndex].high);
  setReversalBreakout(pattern, breakoutIndex);

  const reversal = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars)
    .find((signal) => signal.type === 'reversal');
  // Then user requires a close strictly above the warning candle high
  assert.equal(reversal.time, pattern.bars[breakoutIndex].time);
});

test('user receives signals through the sixtieth closed bar after warning and excludes the sixty-first', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const included = createIndicatorPattern();
  const includedIndex = included.warningIndex + 60;
  // When setReversalBreakout processes the configured inputs
  setReversalBreakout(included, includedIndex);
  // Then user receives signals through the sixtieth closed bar after warning and excludes the sixty-first
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

test('user deduplicates one shared reversal candle in favor of the newest overlapping setup', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
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
  // When setReversalBreakout processes the configured inputs
  setReversalBreakout(
    pattern,
    sharedBreakoutIndex,
    pattern.bars[pattern.warningIndex].high + 0.1,
  );

  const signals = detectBearishBollingerSignalsFromIndicatorBars(pattern.bars);
  const sharedReversals = signals
    .filter((signal) => signal.type === 'reversal' && signal.time === pattern.bars[sharedBreakoutIndex].time);
  // Then user deduplicates one shared reversal candle in favor of the newest overlapping setup
  assert.equal(sharedReversals.length, 1);
  assert.equal(sharedReversals[0].setupTime, pattern.bars[secondCrossIndex].time);
  assert.deepEqual(
    signals.map((signal) => signal.time),
    signals.map((signal) => signal.time).toSorted((left, right) => left - right),
  );
});

test('user defers marker mutation for every existing TradingView save owner', () => {
  // Given the loaded OHLC bars and Bollinger detector inputs
  const idle = {
    ladderTask: null,
    continuousLadderTask: null,
    singleOrderTask: null,
    cancelCurrentSymbolOpenOrdersTask: null,
    chartOrdersRecoveryTask: null,
    continuousChartSaveController: null,
  };
  // When isBearishBollingerDrawingMutationBlocked processes the configured inputs
  const observedResult = isBearishBollingerDrawingMutationBlocked(idle);
  // Then user defers marker mutation for every existing TradingView save owner
  assert.equal(observedResult, false);

  for (const key of Object.keys(idle)) {
    assert.equal(
      isBearishBollingerDrawingMutationBlocked({ ...idle, [key]: {} }),
      true,
      key,
    );
  }
});
