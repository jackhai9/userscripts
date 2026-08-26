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
import { createLiveOrderScalePlan } from '../../e2e/binance-orderbook/helpers/live-order-scale-config.js';

const EMPTY_ORDER_LEDGER = Object.freeze({ created: [], fills: [], residual: [] });

function sample(clickToFeedback, dialog, finalReady, maxLongTaskMs = 0) {
  return {
    capacityEvidence: null,
    segmentsMs: {
      clickToFirstFeedback: clickToFeedback,
      clickToDialog: dialog,
      decisionToFinalReady: finalReady,
    },
    testOrderLedger: structuredClone(EMPTY_ORDER_LEDGER),
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
      parameters: { kind: 'no-orders' },
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
    availableBalance: '13.28',
    currentLeverage: 5,
    perOrderPrice: '2',
    perOrderQuantity: '2.5',
    safetyFactor: '0.8',
    liveMaxNumOrdersLimit: 200,
    existingCurrentSymbolOpenOrders: 0,
    outstandingTestOwnedOrders: 0,
  }).capacityEvidence;
  result.testOrderLedger.created.push({
    symbol: 'XRPUSDT',
    side: 'SELL',
    positionSide: 'SHORT',
    price: '2',
    quantity: '2.5',
    createdAt: `2026-08-26T08:00:0${index + 1}.000Z`,
  });
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

test('live performance capture requires three complete isolated samples', () => {
  assert.equal(validateLivePerformanceCapture(capture()).schemaVersion, 1);
  assert.throws(
    () => validateLivePerformanceCapture(capture([sample(90, 150, 140), sample(100, 160, 150)])),
    /at least three isolated samples/,
  );
});

test('live performance capture rejects missing segments and failed cleanup invariants', () => {
  const missingSegment = capture();
  delete missingSegment.scenarios[0].samples[0].segmentsMs.clickToDialog;
  assert.throws(() => validateLivePerformanceCapture(missingSegment), /keys must be exactly/);

  const residualOrder = capture();
  residualOrder.scenarios[0].samples[1].residualTestOrders = 1;
  assert.throws(() => validateLivePerformanceCapture(residualOrder), /must match testOrderLedger.residual/);
});

test('live performance capture requires fill and residual claims to be backed by the test-order ledger', () => {
  const order = {
    symbol: 'HYPEUSDT',
    side: 'SELL',
    positionSide: 'SHORT',
    price: '100',
    quantity: '0.1',
    createdAt: '2026-08-26T08:00:01.000Z',
  };
  const unsupportedFill = scaleCapture();
  unsupportedFill.scenarios[0].samples[0].testOrderLedger.fills.push(order);
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

test('order-scale capture binds effective target to capacity evidence and created ledger', () => {
  assert.equal(validateLivePerformanceCapture(scaleCapture()).schemaVersion, 1);
  const mismatchedCount = scaleCapture();
  mismatchedCount.scenarios[0].parameters.preferredTargetOrderCount = 2;
  mismatchedCount.scenarios[0].parameters.effectiveTargetOrderCount = 2;
  assert.throws(
    () => validateLivePerformanceCapture(mismatchedCount),
    /created ledger count must match the effective target/,
  );
});

test('live performance summary calculates median and nearest-rank p95', () => {
  const summary = summarizeLivePerformanceCapture(capture());
  const scenario = summary.scenarios[0];

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

test('baseline comparison reports only regressions beyond both tolerances', () => {
  const baseline = summarizeLivePerformanceCapture(capture());
  const current = structuredClone(baseline);
  current.scenarios[0].segmentsMs.clickToDialog.median = 260;
  current.scenarios[0].segmentsMs.clickToDialog.p95 = 400;
  current.scenarios[0].segmentsMs.clickToDialog.max = 400;
  const findings = compareLivePerformanceSummaries(current, baseline, {
    absoluteToleranceMs: 50,
    medianRatio: 1.5,
    p95Ratio: 1.5,
  });

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

test('baseline comparison rejects the same scale name with different effective counts', () => {
  const baseline = summarizeLivePerformanceCapture(capture());
  const current = structuredClone(baseline);
  current.scenarios[0].parameters = {
    kind: 'order-scale',
    profileName: 'smoke',
    label: 'small',
    preferredTargetOrderCount: 1,
    effectiveTargetOrderCount: 1,
    sampleCount: 3,
  };

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
      baseline: { kind: 'no-orders' },
      current: current.scenarios[0].parameters,
    }],
  );
});

test('baseline validation rejects missing summary statistics instead of silently passing comparison', () => {
  const summary = summarizeLivePerformanceCapture(capture());
  const baseline = {
    ...structuredClone(summary),
    comparisonPolicy: { absoluteToleranceMs: 50, medianRatio: 1.5, p95Ratio: 1.5 },
  };
  delete baseline.scenarios[0].segmentsMs.clickToDialog.median;

  assert.throws(() => validateLivePerformanceBaseline(baseline), /keys must be exactly/);
  assert.throws(
    () => compareLivePerformanceSummaries(summary, baseline, baseline.comparisonPolicy),
    /keys must be exactly/,
  );
});

test('baseline comparison reports a baseline scenario omitted from the current capture', () => {
  const baseline = summarizeLivePerformanceCapture(capture());
  const missingScenario = structuredClone(baseline.scenarios[0]);
  missingScenario.name = 'cancel-dialog-confirm';
  baseline.scenarios.push(missingScenario);
  const current = summarizeLivePerformanceCapture(capture());

  assert.deepEqual(
    compareLivePerformanceSummaries(current, baseline, {
      absoluteToleranceMs: 50,
      medianRatio: 1.5,
      p95Ratio: 1.5,
    }),
    [{ scenario: 'cancel-dialog-confirm', metric: null, reason: 'missing-current' }],
  );
});

test('CLI compare and enforce use the documented baseline root shape', async (context) => {
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

  const passing = await runLivePerformanceCli([capturePath, '--compare', baselinePath, '--enforce']);
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
