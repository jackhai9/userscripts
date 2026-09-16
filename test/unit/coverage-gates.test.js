import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBranchCoverage } from '../../scripts/test-coverage/gates.mjs';

const critical = 'src/binance-orderbook-trade/core/cancel-orders.js';
const policy = { minimumBranches: 80, criticalSources: [critical] };

function measuredCoverage() {
  return {
    layers: ['node', 'browser'],
    summary: { branches: { total: 1000, covered: 850, pct: 85 } },
    files: [{ path: critical, summary: { branches: { total: 100, covered: 92, pct: 92 } } }],
  };
}

test('user sees a passed staged gate separately from the unmet repository target', () => {
  // Given complete merged coverage meets the staged floor and critical-module threshold.
  const coverage = measuredCoverage();

  // When the staged policy assesses the measured counts.
  const result = assessBranchCoverage(coverage, policy);

  // Then passing the current gate does not claim that all production branches reached 90 percent.
  assert.equal(result.passed, true);
  assert.equal(result.targetMet, false);
  assert.equal(result.measured, 85);
  assert.deepEqual(result.critical, [{ path: critical, percentage: 92, passed: true }]);
  assert.deepEqual(result.failures, []);
});

test('user gets a failing gate when global coverage falls below its staged floor', () => {
  // Given production coverage has fallen below the checked-in threshold.
  const coverage = measuredCoverage();
  coverage.summary.branches.covered = 790;

  // When coverage is checked with the same explicit policy.
  const result = assessBranchCoverage(coverage, policy);

  // Then the global deficit fails even though the critical module still passes.
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['All production sources: 79.00% is below the staged 80% threshold']);
});

test('user cannot hide a critical-module regression behind high aggregate coverage', () => {
  // Given global coverage is high but a critical module has lost a branch scenario.
  const coverage = measuredCoverage();
  coverage.summary.branches.covered = 960;
  coverage.files[0].summary.branches.covered = 89;

  // When the critical-source policy is applied.
  const result = assessBranchCoverage(coverage, policy);

  // Then the named critical module fails independently of the aggregate.
  assert.equal(result.passed, false);
  assert.equal(result.targetMet, true);
  assert.deepEqual(result.failures, [critical + ': 89.00% is below 90%']);
});

test('user can require the final target without accepting a rounded-up display percentage', () => {
  // Given an exact branch ratio is below 90 percent although its display rounded to 90.
  const coverage = measuredCoverage();
  coverage.summary.branches = { covered: 89999, total: 100000, pct: 90 };

  // When the final target is required rather than only the staged threshold.
  const result = assessBranchCoverage(coverage, policy, { requireTarget: true });

  // Then the exact counts keep the target unmet and fail the strict run.
  assert.equal(result.passed, false);
  assert.equal(result.targetMet, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /final 90% target/);
});

test('user cannot substitute a Node-only report for merged coverage', () => {
  // Given every reported Node branch is covered but no browser layer was collected.
  const coverage = measuredCoverage();
  coverage.layers = ['node'];
  coverage.summary.branches.covered = 1000;

  // When a caller offers that partial report to the repository gate.
  const assess = () => assessBranchCoverage(coverage, policy);

  // Then the layer mismatch is rejected before any threshold can pass.
  assert.throws(assess, /both Node and browser/);
});

test('user cannot drop a critical source from the denominator to pass the gate', () => {
  // Given a report has aggregate metrics but omits a required critical source.
  const coverage = measuredCoverage();
  coverage.files = [];

  // When the report is assessed against the explicit source policy.
  const assess = () => assessBranchCoverage(coverage, policy);

  // Then the incomplete source set is rejected rather than treated as fully covered.
  assert.throws(assess, /Missing or duplicate critical coverage source/);
});
