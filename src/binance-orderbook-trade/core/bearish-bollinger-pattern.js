const BOLLINGER_PATTERN = Object.freeze({
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  maPeriod: 60,
  preCrossBars: 8,
  minPreCrossChannelCloses: 4,
  maxPreCrossAboveMiddleCloses: 1,
  maxPreCrossBelowLowerCloses: 3,
  trendLookbackBars: 3,
  minMiddleDeclineBandFraction: 0.01,
  postCrossBars: 20,
  middleApproachBandFraction: 0.12,
  maxPostCrossCloseAboveMiddleBandFraction: 0.05,
  lowerTouchBandFraction: 0.05,
  reversalFollowBars: 60,
});

export const BEARISH_BOLLINGER_PATTERN = BOLLINGER_PATTERN;
export const BULLISH_BOLLINGER_PATTERN = BOLLINGER_PATTERN;

export class TradingViewBarSnapshotInconsistentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TradingViewBarSnapshotInconsistentError';
  }
}

export function isTradingViewBarSnapshotInconsistentError(error) {
  return error instanceof TradingViewBarSnapshotInconsistentError;
}

/**
 * Applies the monitor's task-failure state transition. Snapshot races are
 * expected feed-update boundaries and must leave a context retryable; every
 * other error is a terminal contract failure and schedules layer cleanup.
 */
export function applyBollingerAlertTaskFailure(context, error) {
  if (
    !context
    || typeof context !== 'object'
    || typeof context.failed !== 'boolean'
    || typeof context.cleanupPending !== 'boolean'
  ) {
    throw new Error('Bollinger alert task context is invalid');
  }
  if (isTradingViewBarSnapshotInconsistentError(error)) return 'retry';
  context.failed = true;
  context.cleanupPending = true;
  return 'fatal';
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} is invalid`);
}

function assertBars(bars, directionLabel) {
  if (!Array.isArray(bars)) throw new Error(`${directionLabel} Bollinger bars must be an array`);
  let previousTime = -Infinity;
  for (const [index, bar] of bars.entries()) {
    if (!bar || typeof bar !== 'object') {
      throw new Error(`${directionLabel} Bollinger bar ${index} is invalid`);
    }
    if (!Number.isInteger(bar.time)) {
      throw new Error(`${directionLabel} Bollinger bar time ${index} is invalid`);
    }
    if (bar.time <= previousTime) {
      throw new TradingViewBarSnapshotInconsistentError(
        `${directionLabel} Bollinger bar time ${index} is invalid`,
      );
    }
    for (const field of ['open', 'high', 'low', 'close']) {
      assertFiniteNumber(bar[field], `${directionLabel} Bollinger bar ${index} ${field}`);
    }
    if (
      bar.high < bar.low
      || bar.high < Math.max(bar.open, bar.close)
      || bar.low > Math.min(bar.open, bar.close)
    ) {
      throw new TradingViewBarSnapshotInconsistentError(
        `${directionLabel} Bollinger bar ${index} OHLC range is invalid`,
      );
    }
    previousTime = bar.time;
  }
}

function assertIndicatorBars(indicatorBars, directionLabel) {
  if (!Array.isArray(indicatorBars)) {
    throw new Error(`${directionLabel} Bollinger indicator bars must be an array`);
  }
  assertBars(indicatorBars, directionLabel);
  for (const [index, bar] of indicatorBars.entries()) {
    const fields = ['middle', 'upper', 'lower', 'ma60'];
    const nullFields = fields.filter((field) => bar[field] === null);
    if (nullFields.length !== 0 && nullFields.length !== fields.length) {
      throw new Error(`${directionLabel} Bollinger indicator bar ${index} is incomplete`);
    }
    for (const field of fields) {
      if (bar[field] !== null) {
        assertFiniteNumber(
          bar[field],
          `${directionLabel} Bollinger indicator bar ${index} ${field}`,
        );
      }
    }
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculatePopulationStdDev(values, mean) {
  return Math.sqrt(
    values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length,
  );
}

function calculateBollingerIndicatorBars(bars, directionLabel) {
  assertBars(bars, directionLabel);
  const config = BOLLINGER_PATTERN;
  return bars.map((bar, index) => {
    if (index < config.maPeriod - 1) {
      return { ...bar, middle: null, upper: null, lower: null, ma60: null };
    }
    const bollingerCloses = bars
      .slice(index - config.bollingerPeriod + 1, index + 1)
      .map((item) => item.close);
    const maCloses = bars
      .slice(index - config.maPeriod + 1, index + 1)
      .map((item) => item.close);
    const middle = average(bollingerCloses);
    const deviation = calculatePopulationStdDev(bollingerCloses, middle)
      * config.bollingerStdDev;
    return {
      ...bar,
      middle,
      upper: middle + deviation,
      lower: middle - deviation,
      ma60: average(maCloses),
    };
  });
}

export function calculateBearishBollingerIndicatorBars(bars) {
  return calculateBollingerIndicatorBars(bars, 'Bearish');
}

export function calculateBullishBollingerIndicatorBars(bars) {
  return calculateBollingerIndicatorBars(bars, 'Bullish');
}

function bandWidth(bar) {
  const width = bar.upper - bar.lower;
  if (!(width > 0)) throw new Error(`Bollinger band width is invalid at ${bar.time}`);
  return width;
}

function hasDownwardBandCenter(indicatorBars, index) {
  const { trendLookbackBars, minMiddleDeclineBandFraction } = BOLLINGER_PATTERN;
  const current = indicatorBars[index];
  const earlier = indicatorBars[index - trendLookbackBars];
  const averageWidth = (bandWidth(current) + bandWidth(earlier)) / 2;
  return (earlier.middle - current.middle) / averageWidth >= minMiddleDeclineBandFraction;
}

function isRejectedAboveMiddleClose(indicatorBars, index) {
  const next = indicatorBars[index + 1];
  return next.close < next.middle && next.close < next.open;
}

function matchesPreCrossCompression(indicatorBars, crossIndex) {
  const config = BOLLINGER_PATTERN;
  const start = crossIndex - config.preCrossBars;
  const preCross = indicatorBars.slice(start, crossIndex);
  const channelCloses = preCross.filter(
    (bar) => bar.close >= bar.lower && bar.close <= bar.middle,
  ).length;
  const aboveMiddleIndexes = [];
  let belowLowerCloses = 0;
  for (let offset = 0; offset < preCross.length; offset += 1) {
    const bar = preCross[offset];
    if (bar.close > bar.middle) aboveMiddleIndexes.push(start + offset);
    if (bar.close < bar.lower) belowLowerCloses += 1;
  }
  return (
    channelCloses >= config.minPreCrossChannelCloses
    && aboveMiddleIndexes.length <= config.maxPreCrossAboveMiddleCloses
    && belowLowerCloses <= config.maxPreCrossBelowLowerCloses
    && aboveMiddleIndexes.every((index) => isRejectedAboveMiddleClose(indicatorBars, index))
  );
}

function isDownwardCross(previous, current) {
  return previous.middle >= previous.ma60 && current.middle < current.ma60;
}

function buildSignal(type, setup, bar) {
  const width = bandWidth(bar);
  const markerGapFraction = type === 'warning' ? 0.06 : 0.1;
  return Object.freeze({
    id: `${setup.time}:${type}`,
    type,
    setupTime: setup.time,
    time: bar.time,
    markerPrice: type === 'reversal'
      ? bar.low - (width * markerGapFraction)
      : bar.high + (width * markerGapFraction),
  });
}

function detectReversalSignal(indicatorBars, setup, warningIndex) {
  const { reversalFollowBars } = BOLLINGER_PATTERN;
  const warning = indicatorBars[warningIndex];
  const endIndex = Math.min(
    indicatorBars.length - 1,
    warningIndex + reversalFollowBars,
  );
  for (let index = warningIndex + 1; index <= endIndex; index += 1) {
    const bar = indicatorBars[index];
    if (bar.close > warning.high) return buildSignal('reversal', setup, bar);
  }
  return null;
}

function detectSetupSignals(indicatorBars, crossIndex) {
  const config = BOLLINGER_PATTERN;
  const setup = indicatorBars[crossIndex];
  const signals = [];
  let warningIndex = null;
  let pendingMiddleRejection = false;
  let aboveMiddleCloseCount = 0;
  const endIndex = Math.min(
    indicatorBars.length - 1,
    crossIndex + config.postCrossBars,
  );

  for (let index = crossIndex + 1; index <= endIndex; index += 1) {
    const bar = indicatorBars[index];
    const width = bandWidth(bar);

    if (pendingMiddleRejection) {
      if (!(bar.close < bar.middle && bar.close < bar.open)) break;
      pendingMiddleRejection = false;
    }

    if (bar.close > bar.middle) {
      aboveMiddleCloseCount += 1;
      if (
        aboveMiddleCloseCount > 1
        || bar.close > bar.middle + (width * config.maxPostCrossCloseAboveMiddleBandFraction)
        || bar.close > bar.upper
      ) break;
      pendingMiddleRejection = true;
      continue;
    }

    const bandStillDown = bar.middle < setup.middle
      && hasDownwardBandCenter(indicatorBars, index);
    if (!bandStillDown) continue;

    if (
      warningIndex === null
      && bar.high >= bar.middle - (width * config.middleApproachBandFraction)
    ) {
      warningIndex = index;
      signals.push(buildSignal('warning', setup, bar));
      continue;
    }

    if (
      warningIndex !== null
      && index > warningIndex
      && bar.close < bar.open
      && bar.low <= bar.lower + (width * config.lowerTouchBandFraction)
    ) {
      signals.push(buildSignal('confirmed', setup, bar));
      break;
    }
  }

  if (warningIndex !== null) {
    const reversal = detectReversalSignal(indicatorBars, setup, warningIndex);
    if (reversal) signals.push(reversal);
  }

  return signals;
}

function appendSetupSignals(signals, setupSignals) {
  for (const signal of setupSignals) {
    if (signal.type !== 'reversal') {
      signals.push(signal);
      continue;
    }
    const duplicateIndex = signals.findIndex(
      (existing) => existing.type === 'reversal' && existing.time === signal.time,
    );
    if (duplicateIndex === -1) {
      signals.push(signal);
      continue;
    }
    // One breakout candle gets one visual arrow; the newest setup owns that shared reversal.
    if (signal.setupTime > signals[duplicateIndex].setupTime) {
      signals[duplicateIndex] = signal;
    }
  }
}

function detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars) {
  const config = BOLLINGER_PATTERN;
  const firstCrossIndex = Math.max(
    config.maPeriod,
    config.maPeriod - 1 + config.preCrossBars,
    config.trendLookbackBars,
  );
  const signals = [];
  for (let index = firstCrossIndex; index < indicatorBars.length; index += 1) {
    const previous = indicatorBars[index - 1];
    const current = indicatorBars[index];
    if (!isDownwardCross(previous, current)) continue;
    if (!hasDownwardBandCenter(indicatorBars, index)) continue;
    if (!matchesPreCrossCompression(indicatorBars, index)) continue;
    appendSetupSignals(signals, detectSetupSignals(indicatorBars, index));
  }
  const typeOrder = { warning: 0, confirmed: 1, reversal: 2 };
  return signals.sort(
    (left, right) => left.time - right.time || typeOrder[left.type] - typeOrder[right.type],
  );
}

export function detectBearishBollingerSignalsFromIndicatorBars(indicatorBars) {
  assertIndicatorBars(indicatorBars, 'Bearish');
  return detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars);
}

export function detectBearishBollingerSignals(bars) {
  return detectBearishBollingerSignalsFromIndicatorBars(
    calculateBearishBollingerIndicatorBars(bars),
  );
}

function mirrorIndicatorBar(bar) {
  return {
    ...bar,
    open: -bar.open,
    high: -bar.low,
    low: -bar.high,
    close: -bar.close,
    middle: bar.middle === null ? null : -bar.middle,
    upper: bar.upper === null ? null : -bar.lower,
    lower: bar.lower === null ? null : -bar.upper,
    ma60: bar.ma60 === null ? null : -bar.ma60,
  };
}

function mapMirroredBullishSignal(signal) {
  return Object.freeze({
    ...signal,
    id: `${signal.setupTime}:bullish:${signal.type}`,
    direction: 'bullish',
    markerPrice: -signal.markerPrice,
  });
}

function detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars) {
  return detectBearishBollingerSignalsFromIndicatorBarsInternal(
    indicatorBars.map(mirrorIndicatorBar),
  ).map(mapMirroredBullishSignal);
}

export function detectBullishBollingerSignalsFromIndicatorBars(indicatorBars) {
  assertIndicatorBars(indicatorBars, 'Bullish');
  return detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars);
}

export function detectBullishBollingerSignals(bars) {
  return detectBullishBollingerSignalsFromIndicatorBars(
    calculateBullishBollingerIndicatorBars(bars),
  );
}

function compareBollingerSignals(left, right) {
  const directionOrder = { bearish: 0, bullish: 1 };
  const typeOrder = { warning: 0, confirmed: 1, reversal: 2 };
  const leftDirectionOrder = directionOrder[left.direction];
  const rightDirectionOrder = directionOrder[right.direction];
  if (leftDirectionOrder === undefined || rightDirectionOrder === undefined) {
    throw new Error('Bollinger signal direction is invalid');
  }
  return (
    left.time - right.time
    || (leftDirectionOrder - rightDirectionOrder)
    || (typeOrder[left.type] - typeOrder[right.type])
  );
}

export function detectBollingerSignalsFromIndicatorBars(indicatorBars) {
  assertIndicatorBars(indicatorBars, 'Bollinger');
  const bearishSignals = detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars)
    .map((signal) => Object.freeze({ ...signal, direction: 'bearish' }));
  const bullishSignals = detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars);
  return [...bearishSignals, ...bullishSignals].sort(compareBollingerSignals);
}

export function detectBollingerSignals(bars) {
  return detectBollingerSignalsFromIndicatorBars(
    calculateBollingerIndicatorBars(bars, 'Bollinger'),
  );
}

export function isBollingerDrawingMutationBlocked(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('Bollinger drawing state is invalid');
  }
  return [
    state.ladderTask,
    state.continuousLadderTask,
    state.singleOrderTask,
    state.cancelCurrentSymbolOpenOrdersTask,
    state.chartOrdersRecoveryTask,
    state.continuousChartSaveController,
  ].some((value) => value !== null);
}

export const isBearishBollingerDrawingMutationBlocked = isBollingerDrawingMutationBlocked;
