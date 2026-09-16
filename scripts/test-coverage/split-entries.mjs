import assert from 'node:assert/strict';
import { parse } from 'acorn';

function statementRanges(source) {
  const ranges = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type?.endsWith('Statement') || node.type?.endsWith('Declaration')) {
      ranges.add(node.start + ':' + node.end);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  return ranges;
}

/** Quoted installers and partial declarations cannot become executable segments. */
export function findArtifactSegments(source, artifacts) {
  const candidates = [];
  for (const artifact of artifacts) {
    assert.ok(artifact.code.length > 0, 'Coverage artifacts must contain executable source');
    let offset = source.indexOf(artifact.code);
    while (offset !== -1) {
      candidates.push({ offset, artifact });
      offset = source.indexOf(artifact.code, offset + artifact.code.length);
    }
  }
  if (candidates.length === 0) return [];
  const ranges = statementRanges(source);
  const segments = candidates.filter(({ offset, artifact }) => artifact.body.length > 0
    && artifact.body.every((node) => ranges.has((offset + node.start) + ':' + (offset + node.end))));
  segments.sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < segments.length; index += 1) {
    assert.ok(segments[index].offset >= segments[index - 1].offset + segments[index - 1].artifact.code.length,
      'Coverage artifact segments must not overlap');
  }
  return segments;
}

function rootRange(fn) {
  assert.ok(Array.isArray(fn.ranges) && fn.ranges.length > 0, 'A captured function requires its V8 root range');
  const root = fn.ranges[0];
  assert.ok(Number.isInteger(root.startOffset) && Number.isInteger(root.endOffset)
    && root.startOffset >= 0 && root.endOffset > root.startOffset, 'Invalid V8 function root bounds');
  for (const range of fn.ranges) {
    assert.ok(range.startOffset >= root.startOffset && range.endOffset <= root.endOffset
      && range.endOffset > range.startOffset && Number.isInteger(range.count) && range.count >= 0,
    'A captured V8 block must remain inside its function root with a nonnegative count');
  }
  return root;
}

/** Clipped parent/child ranges retain the most specific count, including zero. */
function clipContainerRanges(ranges, start, end) {
  const clipped = new Map();
  for (const range of ranges) {
    const from = Math.max(start, range.startOffset);
    const to = Math.min(end, range.endOffset);
    if (from >= to) continue;
    const key = (from - start) + ':' + (to - start);
    const span = range.endOffset - range.startOffset;
    const existing = clipped.get(key);
    if (existing && existing.span < span) continue;
    if (existing && existing.span === span) {
      assert.equal(existing.range.count, range.count, 'Identical V8 block bounds have conflicting counts');
    }
    clipped.set(key, {
      span,
      range: { startOffset: from - start, endOffset: to - start, count: range.count },
    });
  }
  return [...clipped.values()].map(({ range }) => range)
    .sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset);
}

function segmentFunctions(functions, start, end) {
  const containers = [];
  const internal = [];
  for (const fn of functions) {
    const root = rootRange(fn);
    if (root.endOffset <= start || root.startOffset >= end) continue;
    if (root.startOffset <= start && root.endOffset >= end) {
      containers.push(fn);
    } else if (root.startOffset >= start && root.endOffset <= end) {
      internal.push({ ...fn, ranges: fn.ranges.map((range) => ({
        ...range, startOffset: range.startOffset - start, endOffset: range.endOffset - start,
      })) });
    } else {
      assert.fail('A V8 function partially crosses an exact artifact boundary');
    }
  }
  assert.ok(containers.length > 0, 'An artifact requires a captured script or wrapper covering its complete bytes');
  containers.sort((left, right) => (rootRange(left).endOffset - rootRange(left).startOffset)
    - (rootRange(right).endOffset - rootRange(right).startOffset));
  const container = containers[0];
  if (containers.length > 1) {
    const first = rootRange(container);
    const second = rootRange(containers[1]);
    assert.ok(first.startOffset !== second.startOffset || first.endOffset !== second.endOffset,
      'An artifact has ambiguous enclosing V8 function roots');
  }
  // A sandbox wrapper is a script coverage carrier, not another original function.
  // Selecting only the innermost container prevents counting its parents again.
  const carrier = {
    functionName: '',
    isBlockCoverage: container.isBlockCoverage,
    ranges: clipContainerRanges(container.ranges, start, end),
  };
  assert.deepEqual([carrier.ranges[0].startOffset, carrier.ranges[0].endOffset], [0, end - start]);
  return [carrier, ...internal];
}

/** Split before mapping: MCR merges originals across entries, not within one map. */
export function splitCoverageEntry(entry, registry) {
  assert.equal(typeof entry.source, 'string', 'Coverage entries require their actual executed source');
  assert.equal(entry.sourceMap, undefined, 'Split raw V8 entries before assigning a source map');
  const segments = findArtifactSegments(entry.source, registry.artifacts);
  if (segments.length === 0) return [entry];
  return segments.map(({ artifact, offset }) => ({
    ...entry,
    source: artifact.code,
    functions: segmentFunctions(entry.functions, offset, offset + artifact.code.length),
    artifactSegment: { path: artifact.path, offset },
  }));
}
