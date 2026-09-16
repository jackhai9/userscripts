import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  compareLivePerformanceSummaries,
  runLivePerformanceCli,
  summarizeLivePerformanceCapture,
  validateLivePerformanceBaseline,
  validateLivePerformanceCapture,
} from '../../scripts/binance-live-performance.mjs';
import {
  createLiveOrderCapacityEvidence,
  createLiveOrderScalePlan,
} from '../../e2e/binance-orderbook/helpers/live-order-scale-config.js';

const EMPTY_ORDER_LEDGER = Object.freeze({ created: [], fills: [], residual: [] });

function testOrder(index = 0) {
  return {
    symbol: 'XRPUSDT',
    side: 'SELL',
    positionSide: 'SHORT',
    price: '2',
    quantity: '2.5',
    createdAt: `2026-08-26T08:00:0${index + 1}.000Z`,
  };
}

function singleOrderCapacityEvidence() {
  return createLiveOrderCapacityEvidence({
    testBudget: '13.28',
    currentLeverage: 5,
    perOrderPrice: '2',
    perOrderQuantity: '2.5',
    safetyFactor: '0.8',
    liveMaxNumOrdersLimit: 200,
    existingCurrentSymbolOpenOrders: 0,
    outstandingTestOwnedOrders: 0,
  });
}

function sample(clickToFeedback, dialog, finalReady, maxLongTaskMs = 0) {
  return {
    capacityEvidence: singleOrderCapacityEvidence(),
    segmentsMs: {
      clickToFirstFeedback: clickToFeedback,
      clickToDialog: dialog,
      decisionToFinalReady: finalReady,
    },
    testOrderLedger: { created: [testOrder()], fills: [], residual: [] },
    stateRestored: true,
    noFills: true,
    residualTestOrders: 0,
    uncaughtErrors: 0,
    maxLongTaskMs,
    maxLongAnimationFrameMs: maxLongTaskMs + 5,
  };
}

function capture(samples = [sample(90, 150, 140), sample(100, 160, 150), sample(110, 210, 170)]) {
  return {
    schemaVersion: 1,
    capturedAt: '2026-08-26T08:00:00.000Z',
    environment: {
      browser: 'Chrome',
      os: 'macOS',
      route: 'https://www.binance.com/zh-CN/futures/HYPEUSDT',
      symbol: 'HYPEUSDT',
      userscriptVersion: '2.7.119',
      userscriptSha256: 'c'.repeat(64),
    },
    scenarios: [{
      name: 'cancel-dialog-cancel',
      parameters: { kind: 'dialog-cancel', testOrderCount: 1 },
      applicableSegments: ['clickToFirstFeedback', 'clickToDialog', 'decisionToFinalReady'],
      samples,
    }],
  };
}

function scaleSample(index) {
  const result = sample(90 + index, 150 + index, 140 + index);
  result.capacityEvidence = createLiveOrderScalePlan({
    schemaVersion: 1,
    profileName: 'smoke',
    sampleCount: 3,
    maxOrderCount: 3,
    scaleRatios: { small: 0.25, medium: 0.5, large: 1 },
  }, {
    testBudget: '13.28',
    currentLeverage: 5,
    perOrderPrice: '2',
    perOrderQuantity: '2.5',
    safetyFactor: '0.8',
    liveMaxNumOrdersLimit: 200,
    existingCurrentSymbolOpenOrders: 0,
    outstandingTestOwnedOrders: 0,
  }).capacityEvidence;
  result.testOrderLedger.created = [testOrder(index)];
  return result;
}

function scaleCapture() {
  const result = capture([scaleSample(0), scaleSample(1), scaleSample(2)]);
  result.scenarios[0].parameters = {
    kind: 'order-scale',
    profileName: 'smoke',
    label: 'small',
    preferredTargetOrderCount: 1,
    effectiveTargetOrderCount: 1,
    sampleCount: 3,
  };
  return result;
}

test('user observes that live performance capture requires three complete isolated samples', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = capture();
  // When the real operation processes that input
  const observed = validateLivePerformanceCapture(scenarioInput).schemaVersion;
  // Then live performance capture requires three complete isolated samples
  assert.equal(observed, 1);
  assert.throws(
    () => validateLivePerformanceCapture(capture([sample(90, 150, 140), sample(100, 160, 150)])),
    /at least three isolated samples/,
  );
});

test('user observes that scenario kind fixes the exact wall-clock segment contract', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const invalid = capture();
  invalid.scenarios[0].applicableSegments = ['clickToFirstFeedback', 'decisionToFinalReady'];
  // When the performance contract processes the supplied capture
  for (const entry of invalid.scenarios[0].samples) {
    delete entry.segmentsMs.clickToDialog;
  }
  // Then scenario kind fixes the exact wall-clock segment contract
  assert.throws(
    () => validateLivePerformanceCapture(invalid),
    /applicableSegments must match the dialog-cancel contract/,
  );
});

test('user observes that live performance capture models no-orders, dialog-cancel, and dialog-confirm explicitly', () => {
  // Given captures describe all three supported dialog outcomes
  const dialogCancel = capture();

  const dialogConfirm = structuredClone(dialogCancel);
  dialogConfirm.scenarios[0].name = 'cancel-dialog-confirm';
  dialogConfirm.scenarios[0].parameters.kind = 'dialog-confirm';

  const noOrders = structuredClone(dialogCancel);
  noOrders.scenarios[0].name = 'cancel-current-symbol-no-orders';
  noOrders.scenarios[0].parameters = { kind: 'no-orders' };
  noOrders.scenarios[0].applicableSegments = [
    'clickToFirstFeedback',
    'clickToFinalReady',
  ];
  for (const entry of noOrders.scenarios[0].samples) {
    entry.capacityEvidence = null;
    entry.testOrderLedger = structuredClone(EMPTY_ORDER_LEDGER);
    entry.segmentsMs = {
      clickToFirstFeedback: entry.segmentsMs.clickToFirstFeedback,
      clickToFinalReady: entry.segmentsMs.decisionToFinalReady,
    };
  }
  // When all three complete evidence records are validated
  const kinds = [dialogCancel, dialogConfirm, noOrders].map(value => validateLivePerformanceCapture(value).scenarios[0].parameters.kind);
  // Then each recorded outcome remains distinct in the validated capture
  assert.deepEqual(kinds, ['dialog-cancel', 'dialog-confirm', 'no-orders']);
});

test('user observes that dialog captures bind the declared test-order count to capacity and ledger evidence', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const missingOrder = capture();
  // When the performance contract processes the supplied capture
  missingOrder.scenarios[0].samples[0].testOrderLedger.created = [];
  // Then dialog captures bind the declared test-order count to capacity and ledger evidence
  assert.throws(
    () => validateLivePerformanceCapture(missingOrder),
    /created ledger count must match the declared test order count/,
  );

  const insufficientCapacity = capture();
  insufficientCapacity.scenarios[0].samples[0].capacityEvidence = {
    ...insufficientCapacity.scenarios[0].samples[0].capacityEvidence,
    maxNewOrdersByMargin: 0,
  };
  assert.throws(
    () => validateLivePerformanceCapture(insufficientCapacity),
    /does not match its inputs|insufficient margin capacity/,
  );
});

test('user observes that live performance capture rejects missing segments and failed cleanup invariants', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const missingSegment = capture();
  // When the performance contract processes the supplied capture
  delete missingSegment.scenarios[0].samples[0].segmentsMs.clickToDialog;
  // Then live performance capture rejects missing segments and failed cleanup invariants
  assert.throws(() => validateLivePerformanceCapture(missingSegment), /keys must be exactly/);

  const residualOrder = capture();
  residualOrder.scenarios[0].samples[1].residualTestOrders = 1;
  assert.throws(() => validateLivePerformanceCapture(residualOrder), /must match testOrderLedger.residual/);
});

test('user observes that live performance capture requires fill and residual claims to be backed by the test-order ledger', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const order = {
    symbol: 'HYPEUSDT',
    side: 'SELL',
    positionSide: 'SHORT',
    price: '100',
    quantity: '0.1',
    createdAt: '2026-08-26T08:00:01.000Z',
  };
  const unsupportedFill = scaleCapture();
  // When the performance contract processes the supplied capture
  unsupportedFill.scenarios[0].samples[0].testOrderLedger.fills.push(order);
  // Then live performance capture requires fill and residual claims to be backed by the test-order ledger
  assert.throws(
    () => validateLivePerformanceCapture(unsupportedFill),
    /fills must reference a created test order/,
  );

  const mismatchedClaim = scaleCapture();
  mismatchedClaim.scenarios[0].samples[0].testOrderLedger.fills.push(
    mismatchedClaim.scenarios[0].samples[0].testOrderLedger.created[0],
  );
  assert.throws(
    () => validateLivePerformanceCapture(mismatchedClaim),
    /noFills must match testOrderLedger.fills/,
  );
});

test('user observes that order-scale capture binds effective target to capacity evidence and created ledger', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = scaleCapture();
  // When the real operation processes that input
  const observed = validateLivePerformanceCapture(scenarioInput).schemaVersion;
  // Then order-scale capture binds effective target to capacity evidence and created ledger
  assert.equal(observed, 1);
  const mismatchedCount = scaleCapture();
  mismatchedCount.scenarios[0].parameters.preferredTargetOrderCount = 2;
  mismatchedCount.scenarios[0].parameters.effectiveTargetOrderCount = 2;
  assert.throws(
    () => validateLivePerformanceCapture(mismatchedCount),
    /created ledger count must match the effective target/,
  );
});

test('user observes that live performance summary calculates median and nearest-rank p95', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const summary = summarizeLivePerformanceCapture(capture());
  // When the performance contract processes the supplied capture
  const scenario = summary.scenarios[0];

  // Then live performance summary calculates median and nearest-rank p95
  assert.equal(scenario.sampleCount, 3);
  assert.deepEqual(scenario.segmentsMs.clickToFirstFeedback, {
    min: 90,
    median: 100,
    p95: 110,
    max: 110,
  });
  assert.deepEqual(scenario.segmentsMs.clickToDialog, {
    min: 150,
    median: 160,
    p95: 210,
    max: 210,
  });
});

test('user observes that baseline comparison reports only regressions beyond both tolerances', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const baseline = summarizeLivePerformanceCapture(capture());
  const current = structuredClone(baseline);
  current.scenarios[0].segmentsMs.clickToDialog.median = 260;
  current.scenarios[0].segmentsMs.clickToDialog.p95 = 400;
  current.scenarios[0].segmentsMs.clickToDialog.max = 400;
  // When the performance contract processes the supplied capture
  const findings = compareLivePerformanceSummaries(current, baseline, {
    absoluteToleranceMs: 50,
    medianRatio: 1.5,
    p95Ratio: 1.5,
  });

  // Then baseline comparison reports only regressions beyond both tolerances
  assert.deepEqual(findings, [
    {
      scenario: 'cancel-dialog-cancel',
      metric: 'clickToDialog.median',
      reason: 'regression',
      baseline: 160,
      current: 260,
      limit: 240,
    },
    {
      scenario: 'cancel-dialog-cancel',
      metric: 'clickToDialog.p95',
      reason: 'regression',
      baseline: 210,
      current: 400,
      limit: 315,
    },
  ]);
});

test('user observes that baseline comparison rejects the same scale name with different effective counts', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const baseline = summarizeLivePerformanceCapture(capture());
  const current = structuredClone(baseline);
  // When the performance contract processes the supplied capture
  current.scenarios[0].parameters = {
    kind: 'order-scale',
    profileName: 'smoke',
    label: 'small',
    preferredTargetOrderCount: 1,
    effectiveTargetOrderCount: 1,
    sampleCount: 3,
  };

  // Then baseline comparison rejects the same scale name with different effective counts
  assert.deepEqual(
    compareLivePerformanceSummaries(current, baseline, {
      absoluteToleranceMs: 50,
      medianRatio: 1.5,
      p95Ratio: 1.5,
    }),
    [{
      scenario: 'cancel-dialog-cancel',
      metric: null,
      reason: 'configuration-mismatch',
      baseline: { kind: 'dialog-cancel', testOrderCount: 1 },
      current: current.scenarios[0].parameters,
    }],
  );
});

test('user observes that baseline validation rejects missing summary statistics instead of silently passing comparison', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const summary = summarizeLivePerformanceCapture(capture());
  const baseline = {
    ...structuredClone(summary),
    comparisonPolicy: { absoluteToleranceMs: 50, medianRatio: 1.5, p95Ratio: 1.5 },
  };
  // When the performance contract processes the supplied capture
  delete baseline.scenarios[0].segmentsMs.clickToDialog.median;

  // Then baseline validation rejects missing summary statistics instead of silently passing comparison
  assert.throws(() => validateLivePerformanceBaseline(baseline), /keys must be exactly/);
  assert.throws(
    () => compareLivePerformanceSummaries(summary, baseline, baseline.comparisonPolicy),
    /keys must be exactly/,
  );
});

test('user observes that baseline comparison reports a baseline scenario omitted from the current capture', () => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const baseline = summarizeLivePerformanceCapture(capture());
  const missingScenario = structuredClone(baseline.scenarios[0]);
  missingScenario.name = 'cancel-dialog-confirm';
  baseline.scenarios.push(missingScenario);
  // When the performance contract processes the supplied capture
  const current = summarizeLivePerformanceCapture(capture());

  // Then baseline comparison reports a baseline scenario omitted from the current capture
  assert.deepEqual(
    compareLivePerformanceSummaries(current, baseline, {
      absoluteToleranceMs: 50,
      medianRatio: 1.5,
      p95Ratio: 1.5,
    }),
    [{ scenario: 'cancel-dialog-confirm', metric: null, reason: 'missing-current' }],
  );
});

test('user compare and enforce use the documented baseline root shape', async (context) => {
  // Given the capture fixture contains measured segments and cleanup evidence
  const directory = await mkdtemp(join(tmpdir(), 'binance-live-performance-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const capturePath = join(directory, 'capture.json');
  const baselinePath = join(directory, 'baseline.json');
  const liveCapture = capture();
  const summary = summarizeLivePerformanceCapture(liveCapture);
  const baseline = {
    ...summary,
    comparisonPolicy: { absoluteToleranceMs: 50, medianRatio: 1.5, p95Ratio: 1.5 },
  };
  await writeFile(capturePath, JSON.stringify(liveCapture));
  await writeFile(baselinePath, JSON.stringify(baseline));

  // When the performance contract processes the supplied capture
  const passing = await runLivePerformanceCli([capturePath, '--compare', baselinePath, '--enforce']);
  // Then CLI compare and enforce use the documented baseline root shape
  assert.deepEqual(passing.findings, []);

  liveCapture.scenarios[0].samples = [
    sample(90, 500, 140),
    sample(100, 600, 150),
    sample(110, 700, 170),
  ];
  await writeFile(capturePath, JSON.stringify(liveCapture));
  await assert.rejects(
    runLivePerformanceCli([capturePath, '--compare', baselinePath, '--enforce']),
    /Live performance regressions/,
  );
});
