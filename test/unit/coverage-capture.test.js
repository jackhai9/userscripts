import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCaptures } from '../../scripts/test-coverage/capture-contract.mjs';

function captureEvidence() {
  return {
    expectedNodeTests: ['test/unit/example.test.js'],
    capturedNodeTests: new Set(['test/unit/example.test.js']),
    browserManifest: {
      status: 'passed',
      tests: [{ id: 'production-1', file: 'e2e/binance-orderbook/specs/example.pw.js',
        title: 'user sees accepted orders', result: { status: 'passed', retry: 0 } }],
    },
    capturedBrowserTests: new Set(['production-1']),
  };
}

test('user cannot receive a complete report when a Node process missed collection', () => {
  // Given one selected Node process has no coverage capture.
  const evidence = captureEvidence();
  evidence.capturedNodeTests.clear();

  // When report completeness is verified.
  const verify = () => verifyCaptures(evidence);

  // Then test completion alone cannot produce a complete-coverage result.
  assert.throws(verify, /Every selected Node test process/);
});

test('user cannot mistake a passed browser scenario for a completed coverage capture', () => {
  // Given the scenario passed but its coverage fixture did not write a capture.
  const evidence = captureEvidence();
  evidence.capturedBrowserTests.clear();

  // When report completeness is verified.
  const verify = () => verifyCaptures(evidence);

  // Then the absent scenario invalidates the coverage report.
  assert.throws(verify, /Every production browser scenario/);
});

test('user can run the collector self-test without crediting its virtual code to production', () => {
  // Given production was captured and an extra collector test executed virtual source.
  const evidence = captureEvidence();
  evidence.browserManifest.tests.push({ id: 'collector-proof',
    file: 'e2e/binance-orderbook/specs/coverage-merge.pw.js', title: 'user gets a branch union',
    result: { status: 'passed', retry: 0 } });

  // When the report verifies all production captures and the separate self-test outcome.
  const result = verifyCaptures(evidence);

  // Then completeness succeeds without a synthetic production capture.
  assert.deepEqual(result, { nodeFiles: 1, browserScenarios: 1, collectorScenarios: 1 });
  assert.deepEqual([...evidence.capturedBrowserTests], ['production-1']);
});

for (const status of ['failed', 'skipped', 'timedOut']) {
  test(`user cannot get a complete report after a browser scenario was ${status}`, () => {
    // Given an otherwise complete capture set contains an unsuccessful scenario.
    const evidence = captureEvidence();
    evidence.browserManifest.tests[0].result.status = status;

    // When the report verifies the scenario outcome.
    const verify = () => verifyCaptures(evidence);

    // Then even an existing capture cannot turn the run into passing evidence.
    assert.throws(verify, /Every selected browser test must pass/);
  });
}

test('user cannot merge stale browser captures into a fresh run', () => {
  // Given current captures are mixed with a test ID from an older run.
  const evidence = captureEvidence();
  evidence.capturedBrowserTests.add('previous-run');

  // When capture ownership is verified against the current browser manifest.
  const verify = () => verifyCaptures(evidence);

  // Then stale captures are rejected even though no current scenario is missing.
  assert.throws(verify, /current browser run/);
});
