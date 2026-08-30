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

test('live probe snapshot requires complete supported performance evidence', () => {
  assert.equal(validateLivePerformanceProbeSnapshot(snapshot()).schemaVersion, 1);
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

test('live probe snapshot rejects every bounded-buffer overflow', () => {
  for (const stream of ['events', 'errors', 'longTasks', 'longAnimationFrames']) {
    const dropped = { events: 0, errors: 0, longTasks: 0, longAnimationFrames: 0 };
    dropped[stream] = 1;
    assert.throws(
      () => validateLivePerformanceProbeSnapshot(snapshot({ dropped })),
      new RegExp(`${stream} overflowed`),
    );
  }
});

test('live probe Runtime.evaluate expression is self-contained', () => {
  const expression = createLivePerformanceProbeExpression({ eventLimit: 25 });

  assert.match(expression, /^\(function installBinanceLivePerformanceProbe/);
  assert.match(expression, /"eventLimit":25/);
  assert.doesNotMatch(expression, /DEFAULT_GLOBAL_NAME/);
});

test('live completion preparation and result expressions remove the action race', () => {
  const preparation = createLivePerformanceCompletionPreparationExpression({
    kind: 'no-orders',
  });
  const result = createLivePerformanceCompletionResultExpression();

  assert.match(preparation, /window\[completionGlobalName\] = \(function waitForBinanceLivePerformanceCompletion/);
  assert.match(preparation, /prepared: true/);
  assert.match(result, /return await completion/);
  assert.match(result, /delete window\[completionGlobalName\]/);
});

test('live completion Runtime.evaluate expression owns the page-ready contract', () => {
  const expression = createLivePerformanceCompletionExpression({
    kind: 'dialog-confirm',
  });

  assert.match(expression, /^\(function waitForBinanceLivePerformanceCompletion/);
  assert.match(expression, /"kind":"dialog-confirm"/);
  assert.match(expression, /finishAfterPerformanceTail/);
  assert.match(expression, /dialog-action/);
  assert.match(expression, /撤单已完成/);
  assert.doesNotMatch(expression, /DEFAULT_GLOBAL_NAME/);
});
