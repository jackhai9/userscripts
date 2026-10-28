import {
  BEARISH_BOLLINGER_PATTERN,
  calculateBearishBollingerIndicatorBars,
  detectBollingerSignals,
  detectBollingerSignalsFromIndicatorBars,
} from './bearish-bollinger-pattern.js';

const PATTERN = BEARISH_BOLLINGER_PATTERN;
// The pinned detector scans setups from this index and reads indicator bars back to setup - preCrossBars.
const FIRST_SETUP_INDEX = Math.max(
  PATTERN.maPeriod,
  PATTERN.maPeriod - 1 + PATTERN.preCrossBars,
  PATTERN.trendLookbackBars,
);
// A setup's warning and confirmation follow within postCrossBars; its reversal within reversalFollowBars after that.
const SETUP_SIGNAL_SPAN = PATTERN.postCrossBars + PATTERN.reversalFollowBars;
const INDICATOR_LOOKBACK = PATTERN.maPeriod - 1;
const BAR_FIELDS = ['time', 'open', 'high', 'low', 'close'];
const FIELD_COUNT = BAR_FIELDS.length;

/** Closed-bar values in a growable buffer; only bars from the first change are rewritten. */
function writeBarSnapshot(snapshot, bars, fromIndex) {
  let { values } = snapshot;
  if (values.length < bars.length * FIELD_COUNT) {
    const grown = new Float64Array(Math.max(bars.length * FIELD_COUNT, values.length * 2));
    grown.set(values.subarray(0, fromIndex * FIELD_COUNT));
    values = grown;
  }
  for (let index = fromIndex; index < bars.length; index += 1) {
    for (let field = 0; field < FIELD_COUNT; field += 1) {
      values[index * FIELD_COUNT + field] = bars[index][BAR_FIELDS[field]];
    }
  }
  return { values, length: bars.length };
}

function firstChangedBarIndex(snapshot, bars) {
  const sharedLength = Math.min(bars.length, snapshot.length);
  const { values } = snapshot;
  for (let index = 0; index < sharedLength; index += 1) {
    const bar = bars[index];
    if (!bar || typeof bar !== 'object') return index;
    for (let field = 0; field < FIELD_COUNT; field += 1) {
      if (!Object.is(values[index * FIELD_COUNT + field], bar[BAR_FIELDS[field]])) return index;
    }
  }
  return sharedLength;
}

/**
 * Returns exactly `detectBollingerSignals(bars)` while analyzing only the bars a
 * change can affect. Truncating history at bar k leaves every signal before k
 * unchanged, because each setup scans forward and the newest setup owning a shared
 * reversal starts before it. Signals at or after k come from setups starting no
 * earlier than k - SETUP_SIGNAL_SPAN, which the pinned detector rescans on a window
 * whose indicators include their full moving-average lookback. The detector bytes
 * stay pinned for remote parity; only its exported entry points are called here.
 * Validation errors inside the window name window-relative indexes.
 */
export function createIncrementalBollingerSignalDetector() {
  let previous = null;
  let lastAnalyzedBarCount = null;

  function detect(bars) {
    if (!Array.isArray(bars)) throw new Error('Bollinger bars must be an array');
    const changedIndex = previous ? firstChangedBarIndex(previous.snapshot, bars) : 0;
    let signals;
    let analyzedBarCount;
    if (previous && changedIndex === bars.length && previous.snapshot.length === bars.length) {
      signals = previous.signals;
      analyzedBarCount = 0;
    } else {
      const windowStart = changedIndex >= bars.length ? 0 : Math.max(0, changedIndex - SETUP_SIGNAL_SPAN - FIRST_SETUP_INDEX);
      if (windowStart === 0) {
        signals = detectBollingerSignals(bars);
        analyzedBarCount = bars.length;
      } else {
        const indicatorStart = Math.max(0, windowStart - INDICATOR_LOOKBACK);
        const indicatorBars = calculateBearishBollingerIndicatorBars(bars.slice(indicatorStart));
        const windowSignals = detectBollingerSignalsFromIndicatorBars(indicatorBars.slice(windowStart - indicatorStart));
        const boundaryTime = bars[changedIndex].time;
        // Both lists keep detector order and are split by time, so concatenation is already sorted.
        signals = [
          ...previous.signals.filter(signal => signal.time < boundaryTime),
          ...windowSignals.filter(signal => signal.time >= boundaryTime),
        ];
        analyzedBarCount = bars.length - indicatorStart;
      }
    }
    // Commit only after detection succeeds so a rejected snapshot leaves the cache intact.
    const snapshot = writeBarSnapshot(
      previous?.snapshot || { values: new Float64Array(0), length: 0 },
      bars,
      Math.min(changedIndex, bars.length),
    );
    previous = { snapshot, signals };
    lastAnalyzedBarCount = analyzedBarCount;
    return signals;
  }

  return Object.freeze({
    detect,
    get lastAnalyzedBarCount() { return lastAnalyzedBarCount; },
  });
}
