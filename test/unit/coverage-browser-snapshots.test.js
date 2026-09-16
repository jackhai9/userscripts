import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mergeBrowserSnapshots } from '../../scripts/test-coverage/browser-snapshots.mjs';

const source = ' '.repeat(100);
const root = { functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] };
function functionRecord(count, isBlockCoverage) {
  return { functionName: 'choose', isBlockCoverage, ranges: [{ startOffset: 10, endOffset: 80, count }] };
}
function captureOf(firstFunctions, lastFunctions) {
  return { sessionId: 'isolated-session', snapshots: [
    { phase: 'before-reload', entries: [{ scriptId: '1', url: 'https://fixture.test/code.js', source, functions: firstFunctions }] },
    { phase: 'finish', entries: [{ scriptId: '1', url: 'https://fixture.test/code.js', source, functions: lastFunctions }] },
  ] };
}

test('user keeps detailed execution separate from calls whose block evidence was lost at teardown', () => {
  // Given an executed function has detailed pre-reload evidence and three later coarse calls.
  const detailed = functionRecord(2, true);
  detailed.ranges.push({ startOffset: 45, endOffset: 75, count: 0 });
  const capture = captureOf([root, detailed], [functionRecord(3, false)]);
  const original = structuredClone(capture);

  // When the report projects only evidence that can support a branch decision.
  const result = mergeBrowserSnapshots(capture);

  // Then the unknown branch stays zero, the three real coarse calls remain traceable, and raw input is unchanged.
  assert.deepEqual(result.entries[0].functions, [root, detailed]);
  assert.deepEqual(result.blockEvidenceUnavailable, [{
    sessionId: 'isolated-session', scriptId: '1', url: 'https://fixture.test/code.js',
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    snapshotIndex: 1, phase: 'finish', functionName: 'choose',
    range: { startOffset: 10, endOffset: 80, count: 3 },
  }]);
  assert.deepEqual(capture, original);
});

test('user gets no invented branch credit when only a real zero record precedes teardown calls', () => {
  // Given the function was captured as dormant before its coarse teardown execution.
  const zero = functionRecord(0, false);
  const capture = captureOf([root, zero], [functionRecord(3, false)]);

  // When the partial evidence is projected.
  const result = mergeBrowserSnapshots(capture);

  // Then the original zero masks root-based inference without inventing any replacement range or count.
  assert.deepEqual(result.entries[0].functions, [root, zero]);
  assert.equal(result.blockEvidenceUnavailable[0].range.count, 3);
});

test('user cannot receive a branch report if a coarse function has no matching retained record', () => {
  // Given the script root exists but no detailed or zero record covers the specific function.
  const capture = captureOf([root], [functionRecord(3, false)]);

  // When coarse evidence would otherwise be removed and inferred from the script root.
  const merge = () => mergeBrowserSnapshots(capture);

  // Then collection fails instead of silently crediting unknown blocks.
  assert.throws(merge, /matching captured detailed or zero function/);
});

test('user merges real detailed counts across checkpoints without counting the script root twice', () => {
  // Given one script ran once and a function ran in two independently reset intervals.
  const capture = captureOf([root, functionRecord(2, true)], [functionRecord(3, true)]);

  // When the snapshots for that exact script are merged.
  const result = mergeBrowserSnapshots(capture);

  // Then actual call counts sum while the recorded script root stays one.
  assert.deepEqual(result.entries[0].functions, [root, functionRecord(5, true)]);
  assert.deepEqual(result.blockEvidenceUnavailable, []);
});

test('user keeps reloaded documents with the same URL as distinct script identities', () => {
  // Given both documents expose identical bytes and URL but different CDP script IDs.
  const capture = captureOf([root, functionRecord(2, true)], [root, functionRecord(3, true)]);
  capture.snapshots[1].entries[0].scriptId = '2';

  // When browser snapshots are grouped.
  const result = mergeBrowserSnapshots(capture);

  // Then source mapping receives both actual executions without merging by URL.
  assert.deepEqual(result.entries.map(entry => ({ id: entry.scriptId, count: entry.functions[1].ranges[0].count })),
    [{ id: '1', count: 2 }, { id: '2', count: 3 }]);
});

for (const changed of ['source', 'url']) {
  test(`user rejects reused script identity with inconsistent ${changed}`, () => {
    // Given two snapshots claim the same CDP identity but disagree about its source provenance.
    const capture = captureOf([root], [root]);
    capture.snapshots[1].entries[0][changed] += 'changed';

    // When a caller tries to merge those incompatible samples.
    const merge = () => mergeBrowserSnapshots(capture);

    // Then no execution can be credited to mismatched bytes or locations.
    assert.throws(merge, /cannot change/);
  });
}
