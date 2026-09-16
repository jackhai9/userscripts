import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLivePerformanceCompletionExpression,
  createLivePerformanceCompletionPreparationExpression,
  createLivePerformanceCompletionResultExpression,
  createLivePerformanceProbeExpression,
  validateLivePerformanceProbeSnapshot,
} from '../../e2e/binance-orderbook/helpers/live-performance-probe.js';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: '3a2de615-8dc5-4a86-91ed-f13ca641e598',
    scenarioName: 'cancel-current-symbol-no-orders',
    capturedAt: '2026-08-26T08:30:11.000Z',
    timeOriginMs: 1_000,
    armedAtMonotonicMs: 10,
    startedAtMonotonicMs: 20,
    startedAtWallClock: '2026-08-26T08:30:11.020Z',
    finishedAtMonotonicMs: 700,
    performanceSupport: { longTask: true, longAnimationFrame: true },
    dropped: { events: 0, errors: 0, longTasks: 0, longAnimationFrames: 0 },
    events: [{ kind: 'cancel-click', atMs: 0, detail: null }],
    errors: [],
    longTasks: [],
    longAnimationFrames: [],
    clickSemanticSignature: '{}',
    lastSemanticSignature: '{}',
    lastSemanticState: {},
    firstFeedbackCaptured: true,
    ...overrides,
  };
}

test('user observes that live probe snapshot requires complete supported performance evidence', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = snapshot();
  // When the real operation processes that input
  const observed = validateLivePerformanceProbeSnapshot(scenarioInput).schemaVersion;
  // Then live probe snapshot requires complete supported performance evidence
  assert.equal(observed, 1);
  assert.throws(
    () => validateLivePerformanceProbeSnapshot(snapshot({
      performanceSupport: { longTask: false, longAnimationFrame: true },
    })),
    /requires longtask performance evidence/,
  );
  assert.throws(
    () => validateLivePerformanceProbeSnapshot(snapshot({
      performanceSupport: { longTask: true, longAnimationFrame: false },
    })),
    /requires long-animation-frame performance evidence/,
  );
  assert.throws(
    () => validateLivePerformanceProbeSnapshot(snapshot({ startedAtWallClock: null })),
    /startedAtWallClock must be an ISO timestamp/,
  );
});

test('user observes that live probe snapshot rejects every bounded-buffer overflow', () => {
  // Given each bounded evidence stream has a snapshot with one dropped entry
  const streams = ['events', 'errors', 'longTasks', 'longAnimationFrames'];
  const snapshots = streams.map(stream => {
    const dropped = { events: 0, errors: 0, longTasks: 0, longAnimationFrames: 0 };
    dropped[stream] = 1;
    return snapshot({ dropped });
  });
  // When each incomplete snapshot is validated
  const failures = snapshots.map(value => {
    try {
      validateLivePerformanceProbeSnapshot(value);
      return null;
    } catch (error) {
      return error;
    }
  });
  // Then every rejection identifies the stream that lost evidence
  for (const [index, stream] of streams.entries()) {
    assert.ok(failures[index] instanceof Error);
    assert.match(failures[index].message, new RegExp(`${stream} overflowed`));
  }
});

test('user observes that live probe Runtime.evaluate expression is self-contained', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = { eventLimit: 25 };
  // When the live probe Runtime.evaluate expression is self-contained
  const expression = createLivePerformanceProbeExpression(scenarioInput);

  // Then live probe Runtime.evaluate expression is self-contained
  assert.match(expression, /^\(function installBinanceLivePerformanceProbe/);
  assert.match(expression, /"eventLimit":25/);
  assert.doesNotMatch(expression, /DEFAULT_GLOBAL_NAME/);
});

test('user observes that live completion preparation and result expressions remove the action race', () => {
  // Given the live probe fixture contains performance support and bounded buffers
  const preparation = createLivePerformanceCompletionPreparationExpression({
    kind: 'no-orders',
  });
  // When the probe contract evaluates the supplied snapshot
  const result = createLivePerformanceCompletionResultExpression();

  // Then live completion preparation and result expressions remove the action race
  assert.match(preparation, /window\[completionGlobalName\] = \(function waitForBinanceLivePerformanceCompletion/);
  assert.match(preparation, /prepared: true/);
  assert.match(result, /return await completion/);
  assert.match(result, /delete window\[completionGlobalName\]/);
});

test('user observes that live completion Runtime.evaluate expression owns the page-ready contract', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = {
    kind: 'dialog-confirm',
  };
  // When the live completion Runtime.evaluate expression owns the page-ready contract
  const expression = createLivePerformanceCompletionExpression(scenarioInput);

  // Then live completion Runtime.evaluate expression owns the page-ready contract
  assert.match(expression, /^\(function waitForBinanceLivePerformanceCompletion/);
  assert.match(expression, /"kind":"dialog-confirm"/);
  assert.match(expression, /finishAfterPerformanceTail/);
  assert.match(expression, /dialog-action/);
  assert.match(expression, /撤单已完成/);
  assert.doesNotMatch(expression, /DEFAULT_GLOBAL_NAME/);
});
