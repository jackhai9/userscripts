import assert from 'node:assert/strict';
import { COVERAGE_SELF_TEST_FILES } from './config.mjs';

export function verifyCaptures({ expectedNodeTests, capturedNodeTests, browserManifest, capturedBrowserTests }) {
  assert.deepEqual(expectedNodeTests.filter((path) => !capturedNodeTests.has(path)), [],
    'Every selected Node test process must finish its coverage capture');
  if (browserManifest === null) {
    assert.equal(capturedBrowserTests.size, 0, 'Node-only reports cannot include browser captures');
    return { nodeFiles: expectedNodeTests.length, browserScenarios: 0, collectorScenarios: 0 };
  }
  assert.equal(browserManifest.status, 'passed', 'The complete browser run must pass');
  assert.ok(browserManifest.tests.length > 0, 'A browser run must contain tests');
  const expected = [];
  for (const test of browserManifest.tests) {
    assert.deepEqual(test.result, { status: 'passed', retry: 0 },
      'Every selected browser test must pass without skips or retries: ' + test.title);
    if (!COVERAGE_SELF_TEST_FILES.includes(test.file)) expected.push(test.id);
  }
  assert.deepEqual(expected.filter((id) => !capturedBrowserTests.has(id)), [],
    'Every production browser scenario must finish its coverage capture');
  const allIds = new Set(browserManifest.tests.map((test) => test.id));
  assert.deepEqual([...capturedBrowserTests].filter((id) => !allIds.has(id)), [],
    'Coverage captures must belong to the current browser run');
  return {
    nodeFiles: expectedNodeTests.length,
    browserScenarios: expected.length,
    collectorScenarios: browserManifest.tests.length - expected.length,
  };
}
