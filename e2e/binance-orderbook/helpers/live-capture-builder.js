import { validateLivePerformanceProbeSnapshot } from './live-performance-probe.js';
import {
  getLiveScenarioSegments,
  validateLivePerformanceCapture,
} from '../../../scripts/binance-live-performance.mjs';

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertExactKeys(record, expectedKeys, path) {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} keys must be exactly: ${expected.join(', ')}`);
  }
}

function readUniqueEvent(probe, kind) {
  const matches = probe.events.filter((event) => event.kind === kind);
  if (matches.length !== 1) {
    throw new Error(`probe must contain exactly one ${kind} event`);
  }
  const [event] = matches;
  if (!Number.isFinite(event.atMs) || event.atMs < 0) {
    throw new Error(`probe ${kind} event must have a finite non-negative atMs`);
  }
  return event;
}

function maxDuration(entries, path) {
  let maximum = 0;
  for (const [index, entry] of entries.entries()) {
    if (!Number.isFinite(entry.duration) || entry.duration < 0) {
      throw new Error(`${path}[${index}].duration must be a finite non-negative number`);
    }
    maximum = Math.max(maximum, entry.duration);
  }
  return maximum;
}

function readProbeDuration(probe) {
  const duration = probe.finishedAtMonotonicMs - probe.startedAtMonotonicMs;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error('probe duration must be a finite non-negative number');
  }
  return duration;
}

function buildSegments(parameters, probe) {
  const firstFeedback = readUniqueEvent(probe, 'first-feedback');
  const duration = readProbeDuration(probe);
  if (firstFeedback.atMs > duration) throw new Error('probe first feedback occurs after finish');
  if (parameters.kind === 'no-orders') {
    if (probe.events.some((event) => ['dialog-visible', 'dialog-action'].includes(event.kind))) {
      throw new Error('no-orders probe must not contain dialog events');
    }
    return {
      clickToFirstFeedback: firstFeedback.atMs,
      clickToFinalReady: duration,
    };
  }

  const dialogVisible = readUniqueEvent(probe, 'dialog-visible');
  const dialogAction = readUniqueEvent(probe, 'dialog-action');
  const dialogHidden = readUniqueEvent(probe, 'dialog-hidden');
  if (!(
    firstFeedback.atMs <= dialogVisible.atMs
    && dialogVisible.atMs <= dialogAction.atMs
    && dialogAction.atMs <= dialogHidden.atMs
    && dialogHidden.atMs <= duration
  )) {
    throw new Error('probe dialog events are out of order');
  }
  const expectsPrimary = parameters.kind !== 'dialog-cancel';
  if (dialogAction.detail?.primary !== expectsPrimary) {
    throw new Error(
      expectsPrimary
        ? `${parameters.kind} requires the primary dialog action`
        : 'dialog-cancel requires the non-primary dialog action',
    );
  }
  return {
    clickToFirstFeedback: firstFeedback.atMs,
    clickToDialog: dialogVisible.atMs,
    decisionToFinalReady: duration - dialogAction.atMs,
  };
}

export function buildLivePerformanceSample(input) {
  assertRecord(input, 'sample input');
  assertExactKeys(input, [
    'parameters',
    'probe',
    'capacityEvidence',
    'testOrderLedger',
    'stateRestored',
  ], 'sample input');
  const {
    parameters,
    probe,
    capacityEvidence,
    testOrderLedger,
    stateRestored,
  } = input;
  assertRecord(parameters, 'parameters');
  validateLivePerformanceProbeSnapshot(probe);
  assertRecord(testOrderLedger, 'testOrderLedger');
  if (stateRestored !== true) throw new Error('stateRestored must equal true');
  const segmentsMs = buildSegments(parameters, probe);
  if (JSON.stringify(Object.keys(segmentsMs)) !== JSON.stringify(getLiveScenarioSegments(parameters.kind))) {
    throw new Error(`derived segments do not match the ${parameters.kind} contract`);
  }
  return Object.freeze({
    capacityEvidence: structuredClone(capacityEvidence),
    segmentsMs,
    testOrderLedger: structuredClone(testOrderLedger),
    stateRestored: true,
    noFills: testOrderLedger.fills.length === 0,
    residualTestOrders: testOrderLedger.residual.length,
    uncaughtErrors: probe.errors.length,
    maxLongTaskMs: maxDuration(probe.longTasks, 'probe.longTasks'),
    maxLongAnimationFrameMs: maxDuration(
      probe.longAnimationFrames,
      'probe.longAnimationFrames',
    ),
  });
}

export function buildLivePerformanceCapture(input) {
  assertRecord(input, 'input');
  assertExactKeys(input, ['capturedAt', 'environment', 'scenarios'], 'input');
  const { capturedAt, environment, scenarios } = input;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error('scenarios must contain at least one scenario');
  }
  const capture = {
    schemaVersion: 1,
    capturedAt,
    environment: structuredClone(environment),
    scenarios: scenarios.map((scenario, scenarioIndex) => {
      assertRecord(scenario, `scenarios[${scenarioIndex}]`);
      assertExactKeys(
        scenario,
        ['name', 'parameters', 'samples'],
        `scenarios[${scenarioIndex}]`,
      );
      if (!Array.isArray(scenario.samples)) {
        throw new Error(`scenarios[${scenarioIndex}].samples must be an array`);
      }
      return {
        name: scenario.name,
        parameters: structuredClone(scenario.parameters),
        applicableSegments: getLiveScenarioSegments(scenario.parameters?.kind),
        samples: scenario.samples.map((sample, sampleIndex) => {
          assertRecord(sample, `scenarios[${scenarioIndex}].samples[${sampleIndex}]`);
          assertExactKeys(
            sample,
            ['probe', 'capacityEvidence', 'testOrderLedger', 'stateRestored'],
            `scenarios[${scenarioIndex}].samples[${sampleIndex}]`,
          );
          return buildLivePerformanceSample({
            parameters: scenario.parameters,
            ...sample,
          });
        }),
      };
    }),
  };
  validateLivePerformanceCapture(capture);
  return capture;
}
