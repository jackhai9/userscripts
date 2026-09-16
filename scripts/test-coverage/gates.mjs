import assert from 'node:assert/strict';
import { BRANCH_TARGET } from './config.mjs';

function branchRate({ covered, total }) {
  assert.ok(Number.isInteger(total) && Number.isInteger(covered)
    && total >= 0 && covered >= 0 && covered <= total, 'Invalid branch coverage counts');
  return total === 0 ? 100 : covered / total * 100;
}

/** Rounded display percentages must never decide whether a threshold passed. */
export function assessBranchCoverage(coverage, policy, { requireTarget = false } = {}) {
  assert.deepEqual(coverage.layers, ['node', 'browser'], 'Coverage gates require both Node and browser execution');
  assert.ok(coverage.summary.branches.total > 0, 'Production coverage needs a nonempty denominator');
  assert.ok(Number.isFinite(policy.minimumBranches) && policy.minimumBranches >= 0
    && policy.minimumBranches <= BRANCH_TARGET, 'Invalid branch threshold');
  assert.ok(Array.isArray(policy.criticalSources) && policy.criticalSources.length > 0,
    'Critical coverage sources must be explicit');
  assert.equal(new Set(policy.criticalSources).size, policy.criticalSources.length, 'Duplicate critical coverage source');
  const measured = branchRate(coverage.summary.branches);
  const targetMet = measured >= BRANCH_TARGET;
  const failures = [];
  if (measured < policy.minimumBranches) {
    failures.push(`All production sources: ${measured.toFixed(2)}% is below the configured ${policy.minimumBranches}% threshold`);
  }
  const critical = policy.criticalSources.map((path) => {
    const matches = coverage.files.filter((file) => file.path === path);
    assert.equal(matches.length, 1, 'Missing or duplicate critical coverage source: ' + path);
    const percentage = branchRate(matches[0].summary.branches);
    if (percentage < BRANCH_TARGET) failures.push(`${path}: ${percentage.toFixed(2)}% is below ${BRANCH_TARGET}%`);
    return { path, percentage, passed: percentage >= BRANCH_TARGET };
  });
  if (requireTarget && !targetMet) {
    failures.push(`All production sources: ${measured.toFixed(2)}% is below the final ${BRANCH_TARGET}% target`);
  }
  return { passed: failures.length === 0, measured, minimumBranches: policy.minimumBranches,
    target: BRANCH_TARGET, targetMet, requireTarget, critical, failures };
}
