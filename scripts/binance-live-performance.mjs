import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateLiveOrderCapacityEvidence } from '../e2e/binance-orderbook/helpers/live-order-scale-config.js';

const REQUIRED_SAMPLE_FIELDS = [
  'capacityEvidence',
  'testOrderLedger',
  'stateRestored',
  'noFills',
  'residualTestOrders',
  'uncaughtErrors',
  'maxLongTaskMs',
  'maxLongAnimationFrameMs',
];

const ENVIRONMENT_FIELDS = [
  'browser',
  'os',
  'route',
  'symbol',
  'userscriptSha256',
  'userscriptVersion',
];

const ORDER_LEDGER_FIELDS = ['created', 'fills', 'residual'];
const ORDER_RECORD_FIELDS = ['createdAt', 'positionSide', 'price', 'quantity', 'side', 'symbol'];
const SUMMARY_STAT_FIELDS = ['min', 'median', 'p95', 'max'];

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertFiniteNonNegative(value, path) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite non-negative number`);
  }
}

function assertIsoTimestamp(value, path) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} must be an ISO timestamp`);
  }
}

function assertExactKeys(record, expectedKeys, path) {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} keys must be exactly: ${expected.join(', ')}`);
  }
}

function validateEnvironment(environment, path) {
  assertRecord(environment, path);
  assertExactKeys(environment, ENVIRONMENT_FIELDS, path);
  for (const key of ['browser', 'os', 'route', 'symbol', 'userscriptVersion']) {
    if (typeof environment[key] !== 'string' || environment[key].length === 0) {
      throw new Error(`${path}.${key} must be a non-empty string`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(environment.userscriptSha256)) {
    throw new Error(`${path}.userscriptSha256 must be a SHA-256 hex digest`);
  }
}

function serializeOrderRecord(record) {
  return ORDER_RECORD_FIELDS.map((field) => record[field]).join('\u0000');
}

function validateOrderRecord(record, path) {
  assertRecord(record, path);
  assertExactKeys(record, ORDER_RECORD_FIELDS, path);
  assertIsoTimestamp(record.createdAt, `${path}.createdAt`);
  for (const key of ['positionSide', 'price', 'quantity', 'side', 'symbol']) {
    if (typeof record[key] !== 'string' || record[key].length === 0) {
      throw new Error(`${path}.${key} must be a non-empty string`);
    }
  }
}

function validateOrderLedger(ledger, path) {
  assertRecord(ledger, path);
  assertExactKeys(ledger, ORDER_LEDGER_FIELDS, path);
  const keysByCollection = new Map();
  for (const collection of ORDER_LEDGER_FIELDS) {
    const records = ledger[collection];
    if (!Array.isArray(records)) throw new Error(`${path}.${collection} must be an array`);
    const keys = records.map((record, index) => {
      validateOrderRecord(record, `${path}.${collection}[${index}]`);
      return serializeOrderRecord(record);
    });
    if (new Set(keys).size !== keys.length) {
      throw new Error(`${path}.${collection} must not contain duplicate orders`);
    }
    keysByCollection.set(collection, new Set(keys));
  }
  for (const collection of ['fills', 'residual']) {
    for (const key of keysByCollection.get(collection)) {
      if (!keysByCollection.get('created').has(key)) {
        throw new Error(`${path}.${collection} must reference a created test order`);
      }
    }
  }
}

function validateScenarioParameters(parameters, path) {
  assertRecord(parameters, path);
  if (parameters.kind === 'no-orders') {
    assertExactKeys(parameters, ['kind'], path);
    return parameters;
  }
  if (parameters.kind !== 'order-scale') {
    throw new Error(`${path}.kind must equal no-orders or order-scale`);
  }
  assertExactKeys(parameters, [
    'kind',
    'profileName',
    'label',
    'preferredTargetOrderCount',
    'effectiveTargetOrderCount',
    'sampleCount',
  ], path);
  if (typeof parameters.profileName !== 'string' || parameters.profileName.length === 0) {
    throw new Error(`${path}.profileName must be a non-empty string`);
  }
  if (!['small', 'medium', 'large'].includes(parameters.label)) {
    throw new Error(`${path}.label must equal small, medium, or large`);
  }
  for (const field of [
    'preferredTargetOrderCount',
    'effectiveTargetOrderCount',
    'sampleCount',
  ]) {
    if (!Number.isInteger(parameters[field]) || parameters[field] <= 0) {
      throw new Error(`${path}.${field} must be a positive integer`);
    }
  }
  if (parameters.effectiveTargetOrderCount > parameters.preferredTargetOrderCount) {
    throw new Error(`${path}.effectiveTargetOrderCount must not exceed the preferred target`);
  }
  if (parameters.sampleCount < 3) throw new Error(`${path}.sampleCount must be at least 3`);
  return parameters;
}

function validateCapacityEvidenceForScenario(evidence, parameters, ledger, path) {
  if (parameters.kind === 'no-orders') {
    if (evidence !== null) throw new Error(`${path} must be null for a no-orders scenario`);
    if (ledger.created.length !== 0) throw new Error(`${path} no-orders ledger must be empty`);
    return;
  }
  validateLiveOrderCapacityEvidence(evidence, path);
  if (parameters.effectiveTargetOrderCount > evidence.maxNewOrdersBySlots) {
    throw new Error(`${path} has insufficient order slots for the effective target`);
  }
  if (parameters.effectiveTargetOrderCount > evidence.maxNewOrdersByMargin) {
    throw new Error(`${path} has insufficient margin capacity for the effective target`);
  }
  if (ledger.created.length !== parameters.effectiveTargetOrderCount) {
    throw new Error(`${path} created ledger count must match the effective target`);
  }
}

export function validateLivePerformanceCapture(capture) {
  assertRecord(capture, 'capture');
  assertExactKeys(capture, ['schemaVersion', 'capturedAt', 'environment', 'scenarios'], 'capture');
  if (capture.schemaVersion !== 1) throw new Error('capture.schemaVersion must equal 1');
  assertIsoTimestamp(capture.capturedAt, 'capture.capturedAt');
  validateEnvironment(capture.environment, 'capture.environment');
  if (!Array.isArray(capture.scenarios) || capture.scenarios.length === 0) {
    throw new Error('capture.scenarios must contain at least one scenario');
  }

  const names = new Set();
  for (const [scenarioIndex, scenario] of capture.scenarios.entries()) {
    const path = `capture.scenarios[${scenarioIndex}]`;
    assertRecord(scenario, path);
    assertExactKeys(scenario, ['name', 'parameters', 'applicableSegments', 'samples'], path);
    if (typeof scenario.name !== 'string' || scenario.name.length === 0) {
      throw new Error(`${path}.name must be a non-empty string`);
    }
    if (names.has(scenario.name)) throw new Error(`Duplicate scenario name: ${scenario.name}`);
    names.add(scenario.name);
    validateScenarioParameters(scenario.parameters, `${path}.parameters`);
    if (!Array.isArray(scenario.applicableSegments) || scenario.applicableSegments.length === 0) {
      throw new Error(`${path}.applicableSegments must not be empty`);
    }
    if (new Set(scenario.applicableSegments).size !== scenario.applicableSegments.length) {
      throw new Error(`${path}.applicableSegments must be unique`);
    }
    for (const [segmentIndex, segment] of scenario.applicableSegments.entries()) {
      if (typeof segment !== 'string' || segment.length === 0) {
        throw new Error(`${path}.applicableSegments[${segmentIndex}] must be a non-empty string`);
      }
    }
    if (!Array.isArray(scenario.samples) || scenario.samples.length < 3) {
      throw new Error(`${path}.samples must contain at least three isolated samples`);
    }
    if (
      scenario.parameters.kind === 'order-scale'
      && scenario.parameters.sampleCount !== scenario.samples.length
    ) {
      throw new Error(`${path}.parameters.sampleCount must match samples.length`);
    }

    for (const [sampleIndex, sample] of scenario.samples.entries()) {
      const samplePath = `${path}.samples[${sampleIndex}]`;
      assertRecord(sample, samplePath);
      assertExactKeys(sample, ['segmentsMs', ...REQUIRED_SAMPLE_FIELDS], samplePath);
      validateOrderLedger(sample.testOrderLedger, `${samplePath}.testOrderLedger`);
      validateCapacityEvidenceForScenario(
        sample.capacityEvidence,
        scenario.parameters,
        sample.testOrderLedger,
        `${samplePath}.capacityEvidence`,
      );
      assertRecord(sample.segmentsMs, `${samplePath}.segmentsMs`);
      assertExactKeys(sample.segmentsMs, scenario.applicableSegments, `${samplePath}.segmentsMs`);
      for (const segment of scenario.applicableSegments) {
        assertFiniteNonNegative(sample.segmentsMs[segment], `${samplePath}.segmentsMs.${segment}`);
      }
      if (sample.stateRestored !== true) throw new Error(`${samplePath}.stateRestored must be true`);
      if (sample.noFills !== (sample.testOrderLedger.fills.length === 0)) {
        throw new Error(`${samplePath}.noFills must match testOrderLedger.fills`);
      }
      if (sample.noFills !== true) throw new Error(`${samplePath}.noFills must be true`);
      if (sample.residualTestOrders !== sample.testOrderLedger.residual.length) {
        throw new Error(`${samplePath}.residualTestOrders must match testOrderLedger.residual`);
      }
      if (sample.residualTestOrders !== 0) throw new Error(`${samplePath}.residualTestOrders must equal 0`);
      if (sample.uncaughtErrors !== 0) throw new Error(`${samplePath}.uncaughtErrors must equal 0`);
      assertFiniteNonNegative(sample.maxLongTaskMs, `${samplePath}.maxLongTaskMs`);
      assertFiniteNonNegative(
        sample.maxLongAnimationFrameMs,
        `${samplePath}.maxLongAnimationFrameMs`,
      );
    }
  }
  return capture;
}

function validateSummaryStats(stats, path) {
  assertRecord(stats, path);
  assertExactKeys(stats, SUMMARY_STAT_FIELDS, path);
  for (const field of SUMMARY_STAT_FIELDS) {
    assertFiniteNonNegative(stats[field], `${path}.${field}`);
  }
  if (!(stats.min <= stats.median && stats.median <= stats.p95 && stats.p95 <= stats.max)) {
    throw new Error(`${path} must satisfy min <= median <= p95 <= max`);
  }
}

export function validateLivePerformanceSummary(summary, path = 'summary') {
  assertRecord(summary, path);
  assertExactKeys(summary, ['schemaVersion', 'capturedAt', 'environment', 'scenarios'], path);
  if (summary.schemaVersion !== 1) throw new Error(`${path}.schemaVersion must equal 1`);
  assertIsoTimestamp(summary.capturedAt, `${path}.capturedAt`);
  validateEnvironment(summary.environment, `${path}.environment`);
  if (!Array.isArray(summary.scenarios) || summary.scenarios.length === 0) {
    throw new Error(`${path}.scenarios must contain at least one scenario`);
  }
  const names = new Set();
  for (const [scenarioIndex, scenario] of summary.scenarios.entries()) {
    const scenarioPath = `${path}.scenarios[${scenarioIndex}]`;
    assertRecord(scenario, scenarioPath);
    assertExactKeys(
      scenario,
      [
        'name',
        'parameters',
        'sampleCount',
        'segmentsMs',
        'maxLongTaskMs',
        'maxLongAnimationFrameMs',
      ],
      scenarioPath,
    );
    if (typeof scenario.name !== 'string' || scenario.name.length === 0) {
      throw new Error(`${scenarioPath}.name must be a non-empty string`);
    }
    if (names.has(scenario.name)) throw new Error(`Duplicate scenario name: ${scenario.name}`);
    names.add(scenario.name);
    validateScenarioParameters(scenario.parameters, `${scenarioPath}.parameters`);
    if (!Number.isInteger(scenario.sampleCount) || scenario.sampleCount < 3) {
      throw new Error(`${scenarioPath}.sampleCount must be an integer of at least 3`);
    }
    if (
      scenario.parameters.kind === 'order-scale'
      && scenario.parameters.sampleCount !== scenario.sampleCount
    ) {
      throw new Error(`${scenarioPath}.parameters.sampleCount must match sampleCount`);
    }
    assertRecord(scenario.segmentsMs, `${scenarioPath}.segmentsMs`);
    if (Object.keys(scenario.segmentsMs).length === 0) {
      throw new Error(`${scenarioPath}.segmentsMs must not be empty`);
    }
    for (const [segment, stats] of Object.entries(scenario.segmentsMs)) {
      if (segment.length === 0) throw new Error(`${scenarioPath}.segmentsMs contains an empty key`);
      validateSummaryStats(stats, `${scenarioPath}.segmentsMs.${segment}`);
    }
    validateSummaryStats(scenario.maxLongTaskMs, `${scenarioPath}.maxLongTaskMs`);
    validateSummaryStats(
      scenario.maxLongAnimationFrameMs,
      `${scenarioPath}.maxLongAnimationFrameMs`,
    );
  }
  return summary;
}

function validateComparisonPolicy(policy, path = 'comparisonPolicy') {
  assertRecord(policy, path);
  assertExactKeys(policy, ['absoluteToleranceMs', 'medianRatio', 'p95Ratio'], path);
  assertFiniteNonNegative(policy.absoluteToleranceMs, `${path}.absoluteToleranceMs`);
  if (!Number.isFinite(policy.medianRatio) || policy.medianRatio < 1) {
    throw new Error(`${path}.medianRatio must be at least 1`);
  }
  if (!Number.isFinite(policy.p95Ratio) || policy.p95Ratio < 1) {
    throw new Error(`${path}.p95Ratio must be at least 1`);
  }
  return policy;
}

export function validateLivePerformanceBaseline(baseline) {
  assertRecord(baseline, 'baseline');
  assertExactKeys(
    baseline,
    ['schemaVersion', 'capturedAt', 'environment', 'scenarios', 'comparisonPolicy'],
    'baseline',
  );
  const { comparisonPolicy, ...summary } = baseline;
  validateLivePerformanceSummary(summary, 'baseline');
  validateComparisonPolicy(comparisonPolicy, 'baseline.comparisonPolicy');
  return baseline;
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * percentileValue));
  return sorted[rank - 1];
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function summarizeValues(values) {
  return Object.freeze({
    min: Math.min(...values),
    median: median(values),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  });
}

export function summarizeLivePerformanceCapture(capture) {
  validateLivePerformanceCapture(capture);
  const summary = Object.freeze({
    schemaVersion: 1,
    capturedAt: capture.capturedAt,
    environment: capture.environment,
    scenarios: capture.scenarios.map((scenario) => Object.freeze({
      name: scenario.name,
      parameters: structuredClone(scenario.parameters),
      sampleCount: scenario.samples.length,
      segmentsMs: Object.fromEntries(scenario.applicableSegments.map((segment) => [
        segment,
        summarizeValues(scenario.samples.map((sample) => sample.segmentsMs[segment])),
      ])),
      maxLongTaskMs: summarizeValues(scenario.samples.map((sample) => sample.maxLongTaskMs)),
      maxLongAnimationFrameMs: summarizeValues(
        scenario.samples.map((sample) => sample.maxLongAnimationFrameMs),
      ),
    })),
  });
  validateLivePerformanceSummary(summary);
  return summary;
}

export function compareLivePerformanceSummaries(current, baseline, policy) {
  validateLivePerformanceSummary(current, 'current');
  validateLivePerformanceSummary(baseline, 'baseline');
  validateComparisonPolicy(policy, 'policy');

  const findings = [];
  const baselineScenarios = new Map(baseline.scenarios.map((scenario) => [scenario.name, scenario]));
  const currentScenarioNames = new Set(current.scenarios.map((scenario) => scenario.name));
  for (const scenario of current.scenarios) {
    const previous = baselineScenarios.get(scenario.name);
    if (!previous) {
      findings.push({ scenario: scenario.name, metric: null, reason: 'missing-baseline' });
      continue;
    }
    if (JSON.stringify(scenario.parameters) !== JSON.stringify(previous.parameters)) {
      findings.push({
        scenario: scenario.name,
        metric: null,
        reason: 'configuration-mismatch',
        baseline: previous.parameters,
        current: scenario.parameters,
      });
      continue;
    }
    for (const [segment, stats] of Object.entries(scenario.segmentsMs)) {
      const previousStats = previous.segmentsMs[segment];
      if (!previousStats) {
        findings.push({ scenario: scenario.name, metric: segment, reason: 'missing-baseline' });
        continue;
      }
      for (const [stat, ratio] of [['median', policy.medianRatio], ['p95', policy.p95Ratio]]) {
        const limit = Math.max(
          previousStats[stat] + policy.absoluteToleranceMs,
          previousStats[stat] * ratio,
        );
        if (stats[stat] > limit) {
          findings.push({
            scenario: scenario.name,
            metric: `${segment}.${stat}`,
            reason: 'regression',
            baseline: previousStats[stat],
            current: stats[stat],
            limit,
          });
        }
      }
    }
  }
  for (const scenario of baseline.scenarios) {
    if (!currentScenarioNames.has(scenario.name)) {
      findings.push({ scenario: scenario.name, metric: null, reason: 'missing-current' });
    }
  }
  return Object.freeze(findings);
}

function parseArguments(args) {
  if (args.length === 0) {
    throw new Error('Usage: node scripts/binance-live-performance.mjs <capture.json> [--compare <baseline.json>] [--enforce]');
  }
  const capturePath = args[0];
  let baselinePath = null;
  let enforce = false;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === '--enforce') {
      enforce = true;
      continue;
    }
    if (args[index] === '--compare' && args[index + 1]) {
      baselinePath = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (enforce && !baselinePath) throw new Error('--enforce requires --compare');
  return { capturePath, baselinePath, enforce };
}

export async function runLivePerformanceCli(args) {
  const { capturePath, baselinePath, enforce } = parseArguments(args);
  const capture = JSON.parse(await readFile(resolve(capturePath), 'utf8'));
  const summary = summarizeLivePerformanceCapture(capture);
  if (!baselinePath) return { summary, findings: [] };

  const baseline = JSON.parse(await readFile(resolve(baselinePath), 'utf8'));
  validateLivePerformanceBaseline(baseline);
  const { comparisonPolicy, ...baselineSummary } = baseline;
  const findings = compareLivePerformanceSummaries(summary, baselineSummary, comparisonPolicy);
  if (enforce && findings.length > 0) {
    throw new Error(`Live performance regressions: ${JSON.stringify(findings)}`);
  }
  return { summary, findings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLivePerformanceCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
