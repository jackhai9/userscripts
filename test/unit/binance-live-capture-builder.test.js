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

test('user builds a no-orders sample directly from one probe snapshot', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = {
    parameters: { kind: 'no-orders' },
    probe: probeSnapshot([{ kind: 'first-feedback', atMs: 3, detail: null }]),
    capacityEvidence: null,
    testOrderLedger: EMPTY_LEDGER,
    stateRestored: true,
  };
  // When the builds a no-orders sample directly from one probe snapshot
  const sample = buildLivePerformanceSample(scenarioInput);

  // Then builds a no-orders sample directly from one probe snapshot
  assert.deepEqual(sample.segmentsMs, {
    clickToFirstFeedback: 3,
    clickToFinalReady: 200,
  });
  assert.equal(sample.maxLongTaskMs, 55);
  assert.equal(sample.maxLongAnimationFrameMs, 60);
  assert.equal(sample.uncaughtErrors, 0);
});

test('user derives cancel and confirm decision timing from semantic probe events', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = {
    parameters: { kind: 'dialog-cancel', testOrderCount: 1 },
    probe: probeSnapshot(dialogEvents(false)),
    capacityEvidence: {},
    testOrderLedger: { created: [{}], fills: [], residual: [] },
    stateRestored: true,
  };
  // When the derives cancel and confirm decision timing from semantic probe events
  const cancel = buildLivePerformanceSample(scenarioInput);
  // Then derives cancel and confirm decision timing from semantic probe events
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

test('user rejects a dialog outcome that contradicts the declared scenario kind', () => {
  // Given the rejected input preserves the specific invalid condition
  const scenarioInput = {
      parameters: { kind: 'dialog-confirm', testOrderCount: 1 },
      probe: probeSnapshot(dialogEvents(false)),
      capacityEvidence: {},
      testOrderLedger: { created: [{}], fills: [], residual: [] },
      stateRestored: true,
    };
  let failure;
  // When the real operation evaluates the rejected input
  try {
    buildLivePerformanceSample(scenarioInput);
  } catch (error) {
    failure = error;
  }
  // Then rejects a dialog outcome that contradicts the declared scenario kind
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /requires the primary dialog action/);
});

test('user rejects a dialog that closes before the recorded user decision', () => {
  // Given the probe fixture contains timing events and scenario evidence
  const events = dialogEvents(true);
  // When the capture builder processes the supplied probe evidence
  events.find((event) => event.kind === 'dialog-hidden').atMs = 140;
  // Then rejects a dialog that closes before the recorded user decision
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

test('user builds and validates a complete three-sample capture without manual timing transcription', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = {
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
  };
  // When the builds and validates a complete three-sample capture without manual timing transcription
  const capture = buildLivePerformanceCapture(scenarioInput);

  // Then builds and validates a complete three-sample capture without manual timing transcription
  assert.equal(capture.scenarios[0].samples.length, 3);
  assert.deepEqual(capture.scenarios[0].applicableSegments, [
    'clickToFirstFeedback',
    'clickToFinalReady',
  ]);
});

test('user rejects unknown raw-bundle fields instead of silently dropping them', () => {
  // Given the rejected input preserves the specific invalid condition
  const scenarioInput = {
      capturedAt: '2026-08-27T01:00:00.000Z',
      environment: {},
      scenarios: [],
      ignored: true,
    };
  let failure;
  // When the real operation evaluates the rejected input
  try {
    buildLivePerformanceCapture(scenarioInput);
  } catch (error) {
    failure = error;
  }
  // Then rejects unknown raw-bundle fields instead of silently dropping them
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /input keys must be exactly/);
});
