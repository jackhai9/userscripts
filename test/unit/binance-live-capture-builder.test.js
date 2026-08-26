import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLivePerformanceCapture,
  buildLivePerformanceSample,
} from '../../e2e/binance-orderbook/helpers/live-capture-builder.js';

const EMPTY_LEDGER = Object.freeze({ created: [], fills: [], residual: [] });

function probeSnapshot(events) {
  return {
    schemaVersion: 1,
    sessionId: 'probe-session',
    scenarioName: 'scenario',
    capturedAt: '2026-08-27T01:00:00.000Z',
    timeOriginMs: 1000,
    armedAtMonotonicMs: 10,
    startedAtMonotonicMs: 20,
    startedAtWallClock: '2026-08-27T01:00:00.010Z',
    finishedAtMonotonicMs: 220,
    performanceSupport: { longTask: true, longAnimationFrame: true },
    dropped: { events: 0, errors: 0, longTasks: 0, longAnimationFrames: 0 },
    events: [
      { kind: 'cancel-click', atMs: 0, detail: null },
      ...events,
      { kind: 'finished', atMs: 200, detail: null },
    ],
    errors: [],
    longTasks: [{ startTime: 100, duration: 55 }],
    longAnimationFrames: [{ startTime: 100, duration: 60 }],
    clickSemanticSignature: '{}',
    lastSemanticSignature: '{}',
    lastSemanticState: {},
    firstFeedbackCaptured: true,
  };
}

function dialogEvents(primary) {
  return [
    { kind: 'first-feedback', atMs: 4, detail: null },
    { kind: 'dialog-visible', atMs: 80, detail: null },
    { kind: 'dialog-action', atMs: 150, detail: { primary, text: primary ? '确认' : '取消' } },
    { kind: 'dialog-hidden', atMs: 160, detail: null },
  ];
}

test('builds a no-orders sample directly from one probe snapshot', () => {
  const sample = buildLivePerformanceSample({
    parameters: { kind: 'no-orders' },
    probe: probeSnapshot([{ kind: 'first-feedback', atMs: 3, detail: null }]),
    capacityEvidence: null,
    testOrderLedger: EMPTY_LEDGER,
    stateRestored: true,
  });

  assert.deepEqual(sample.segmentsMs, {
    clickToFirstFeedback: 3,
    clickToFinalReady: 200,
  });
  assert.equal(sample.maxLongTaskMs, 55);
  assert.equal(sample.maxLongAnimationFrameMs, 60);
  assert.equal(sample.uncaughtErrors, 0);
});

test('derives cancel and confirm decision timing from semantic probe events', () => {
  const cancel = buildLivePerformanceSample({
    parameters: { kind: 'dialog-cancel', testOrderCount: 1 },
    probe: probeSnapshot(dialogEvents(false)),
    capacityEvidence: {},
    testOrderLedger: { created: [{}], fills: [], residual: [] },
    stateRestored: true,
  });
  assert.deepEqual(cancel.segmentsMs, {
    clickToFirstFeedback: 4,
    clickToDialog: 80,
    decisionToFinalReady: 50,
  });

  const confirm = buildLivePerformanceSample({
    parameters: { kind: 'dialog-confirm', testOrderCount: 1 },
    probe: probeSnapshot(dialogEvents(true)),
    capacityEvidence: {},
    testOrderLedger: { created: [{}], fills: [], residual: [] },
    stateRestored: true,
  });
  assert.deepEqual(confirm.segmentsMs, cancel.segmentsMs);
});

test('rejects a dialog outcome that contradicts the declared scenario kind', () => {
  assert.throws(
    () => buildLivePerformanceSample({
      parameters: { kind: 'dialog-confirm', testOrderCount: 1 },
      probe: probeSnapshot(dialogEvents(false)),
      capacityEvidence: {},
      testOrderLedger: { created: [{}], fills: [], residual: [] },
      stateRestored: true,
    }),
    /requires the primary dialog action/,
  );
});

test('rejects a dialog that closes before the recorded user decision', () => {
  const events = dialogEvents(true);
  events.find((event) => event.kind === 'dialog-hidden').atMs = 140;
  assert.throws(
    () => buildLivePerformanceSample({
      parameters: { kind: 'dialog-confirm', testOrderCount: 1 },
      probe: probeSnapshot(events),
      capacityEvidence: {},
      testOrderLedger: { created: [{}], fills: [], residual: [] },
      stateRestored: true,
    }),
    /dialog events are out of order/,
  );
});

test('builds and validates a complete three-sample capture without manual timing transcription', () => {
  const capture = buildLivePerformanceCapture({
    capturedAt: '2026-08-27T01:00:00.000Z',
    environment: {
      browser: 'Chrome 151.0.0.0',
      os: 'macOS (MacIntel)',
      route: 'https://www.binance.com/zh-CN/futures/HYPEUSDT',
      symbol: 'HYPEUSDT',
      userscriptSha256: 'a'.repeat(64),
      userscriptVersion: '2.7.126',
    },
    scenarios: [{
      name: 'cancel-current-symbol-no-orders',
      parameters: { kind: 'no-orders' },
      samples: [1, 2, 3].map((atMs) => ({
        probe: probeSnapshot([{ kind: 'first-feedback', atMs, detail: null }]),
        capacityEvidence: null,
        testOrderLedger: EMPTY_LEDGER,
        stateRestored: true,
      })),
    }],
  });

  assert.equal(capture.scenarios[0].samples.length, 3);
  assert.deepEqual(capture.scenarios[0].applicableSegments, [
    'clickToFirstFeedback',
    'clickToFinalReady',
  ]);
});
