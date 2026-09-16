import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mergeScriptCovs } from '@bcoe/v8-coverage';

function functionKey(fn) {
  assert.ok(fn.ranges.length > 0, 'A browser function must contain its captured root');
  const root = fn.ranges[0];
  return root.startOffset + ':' + root.endOffset;
}

/**
 * Unloaded Chromium contexts can retain calls while losing their block ranges.
 * Keep those raw calls as separate evidence; only detailed or original zero
 * records can support branch credit. The matching-range guard prevents MCR from
 * inferring missing functions' execution from their enclosing script root.
 */
export function mergeBrowserSnapshots(capture) {
  assert.equal(typeof capture.sessionId, 'string', 'Browser captures require their CDP session identity');
  assert.ok(capture.snapshots.length > 0, 'Browser captures require at least one snapshot');
  const scripts = new Map();
  for (const [snapshotIndex, snapshot] of capture.snapshots.entries()) {
    const seen = new Set();
    for (const entry of snapshot.entries) {
      assert.equal(seen.has(entry.scriptId), false, 'A snapshot cannot contain duplicate script IDs');
      seen.add(entry.scriptId);
      assert.equal(typeof entry.source, 'string', 'Browser snapshots require actual executed bytes');
      if (!scripts.has(entry.scriptId)) scripts.set(entry.scriptId, []);
      scripts.get(entry.scriptId).push({ entry, snapshotIndex, phase: snapshot.phase });
    }
  }
  const entries = [];
  const blockEvidenceUnavailable = [];
  for (const [scriptId, samples] of scripts) {
    const first = samples[0].entry;
    const retained = new Set();
    const projected = [];
    const unavailable = [];
    for (const { entry, snapshotIndex, phase } of samples) {
      assert.equal(entry.source, first.source, 'A script ID cannot change source bytes within one CDP session');
      assert.equal(entry.url, first.url, 'A script ID cannot change URL within one CDP session');
      const functions = [];
      for (const fn of entry.functions) {
        assert.equal(typeof fn.isBlockCoverage, 'boolean', 'Browser function granularity must be explicit');
        const key = functionKey(fn);
        if (!fn.isBlockCoverage && fn.ranges[0].count > 0) {
          assert.equal(fn.ranges.length, 1, 'Function-only coverage cannot contain detailed blocks');
          unavailable.push({ snapshotIndex, phase, fn, key });
        } else {
          retained.add(key);
          functions.push(structuredClone(fn));
        }
      }
      if (functions.length > 0) projected.push({ scriptId, url: entry.url, functions });
    }
    for (const { snapshotIndex, phase, fn, key } of unavailable) {
      assert.ok(retained.has(key),
        'Function-only calls require a matching captured detailed or zero function; script-root inference is unsafe');
      blockEvidenceUnavailable.push({
        sessionId: capture.sessionId, scriptId, url: first.url,
        sourceSha256: createHash('sha256').update(first.source).digest('hex'),
        snapshotIndex, phase, functionName: fn.functionName, range: { ...fn.ranges[0] },
      });
    }
    assert.ok(projected.length > 0, 'A browser script requires retained coverage evidence');
    entries.push({ ...mergeScriptCovs(projected), source: first.source });
  }
  return { entries, blockEvidenceUnavailable };
}
