import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'acorn';

import { findArtifactSegments, splitCoverageEntry } from '../../scripts/test-coverage/split-entries.mjs';

function artifact(code, path = 'scripts/proof.user.js') {
  return { path, code, body: parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body };
}

function captured(source, functions) {
  return { url: 'https://fixture.invalid/composed.js', source, functions };
}

function fn(functionName, ranges) {
  return { functionName, isBlockCoverage: true, ranges };
}

function range(startOffset, endOffset, count) {
  return { startOffset, endOffset, count };
}

test('user gets separate exact artifacts without crediting their surrounding fixture code', () => {
  // Given two complete artifacts between unrelated prefix and suffix statements
  const first = artifact('const first = 1;\n', 'scripts/first.user.js');
  const second = artifact('const second = 2;\n', 'scripts/second.user.js');
  const source = 'const prefix = 0;\n' + first.code + second.code + 'const suffix = 3;';
  const entry = captured(source, [fn('', [range(0, source.length, 1)])]);
  // When coverage is split at validated artifact statement boundaries
  const result = splitCoverageEntry(entry, { artifacts: [first, second] });
  // Then each entry has original artifact bytes and one independently rebased script range
  assert.deepEqual(result.map(({ source: code }) => code), [first.code, second.code]);
  assert.deepEqual(result.map(({ functions }) => functions[0].ranges), [
    [range(0, first.code.length, 1)], [range(0, second.code.length, 1)],
  ]);
  assert.deepEqual(result.map(({ artifactSegment }) => artifactSegment.offset), [
    source.indexOf(first.code), source.indexOf(second.code),
  ]);
  assert.equal(entry.source, source);
  assert.deepEqual(entry.functions, [fn('', [range(0, source.length, 1)])]);
});

test('user preserves internal function and branch counts while rebasing their real offsets', () => {
  // Given a function with one unexecuted return inside a prefixed artifact
  const item = artifact('function choose(flag) { if (flag) return 1; return 2; }\n');
  const source = 'const prefix = 0;\n' + item.code;
  const offset = source.indexOf(item.code);
  const returnStart = item.code.indexOf('return 1;');
  const entry = captured(source, [
    fn('', [range(0, source.length, 1)]),
    fn('choose', [range(offset, offset + item.code.length - 1, 2), range(offset + returnStart, offset + returnStart + 9, 0)]),
  ]);
  // When the artifact is isolated from its enclosing script
  const [result] = splitCoverageEntry(entry, { artifacts: [item] });
  // Then the function keeps its original count and its unexecuted branch remains zero
  assert.deepEqual(result.functions, [
    fn('', [range(0, item.code.length, 1)]),
    fn('choose', [range(0, item.code.length - 1, 2), range(returnStart, returnStart + 9, 0)]),
  ]);
});

test('user does not credit an artifact inside an unexecuted wrapper block', () => {
  // Given a script executed once whose enclosing conditional block never ran
  const item = artifact('const answer = 1;\n');
  const source = 'if (false) {\n' + item.code + '}\n';
  const blockStart = source.indexOf('{');
  const blockEnd = source.lastIndexOf('}') + 1;
  const entry = captured(source, [fn('', [range(0, source.length, 1), range(blockStart, blockEnd, 0)])]);
  // When both parent ranges clip to the same artifact boundaries
  const [result] = splitCoverageEntry(entry, { artifacts: [item] });
  // Then the most specific zero count overrides the executed outer script
  assert.deepEqual(result.functions, [fn('', [range(0, item.code.length, 0)])]);
});

test('user counts repeated artifacts from their inner wrapper instead of summing wrapper parents', () => {
  // Given two copies in one wrapper, with only the first block executed twice
  const item = artifact('const answer = 1;\n');
  const source = 'function execute() {\n{\n' + item.code + '}\n{\n' + item.code + '}\n}\n';
  const offsets = [source.indexOf(item.code), source.lastIndexOf(item.code)];
  const entry = captured(source, [
    fn('', [range(0, source.length, 1)]),
    fn('execute', [
      range(0, source.length - 1, 4),
      range(offsets[0] - 2, offsets[0] + item.code.length + 1, 2),
      range(offsets[1] - 2, offsets[1] + item.code.length + 1, 0),
    ]),
  ]);
  // When both artifact occurrences receive their own coverage entry
  const result = splitCoverageEntry(entry, { artifacts: [item] });
  // Then the first copy has two executions and the second stays unexecuted
  assert.deepEqual(result.map(({ functions }) => functions), [
    [fn('', [range(0, item.code.length, 2)])], [fn('', [range(0, item.code.length, 0)])],
  ]);
});

test('user gets no artifact attribution for quoted or incomplete installer bytes', () => {
  // Given exact code quoted as template data and a separate incomplete fragment
  const item = artifact('const answer = 1;\n');
  const quoted = 'const text = ' + String.fromCharCode(96) + item.code + String.fromCharCode(96) + ';';
  const fragment = 'const answer = 1';
  const entry = captured(quoted, [fn('', [range(0, quoted.length, 1)])]);
  // When candidate artifact occurrences are validated against the complete AST
  const quotedSegments = findArtifactSegments(quoted, [item]);
  const partialSegments = findArtifactSegments(fragment, [item]);
  const result = splitCoverageEntry(entry, { artifacts: [item] });
  // Then unknown input passes through unchanged for the existing mapper to reject
  assert.deepEqual(quotedSegments, []);
  assert.deepEqual(partialSegments, []);
  assert.equal(result.length, 1);
  assert.equal(result[0], entry);
});

test('user rejects a function that partially crosses an exact artifact boundary', () => {
  // Given an inconsistent capture whose function starts before and ends inside the artifact
  const item = artifact('const answer = 1;\n');
  const source = 'const prefix = 0;\n' + item.code;
  const offset = source.indexOf(item.code);
  const entry = captured(source, [
    fn('', [range(0, source.length, 1)]),
    fn('crossing', [range(offset - 1, source.length - 2, 1)]),
  ]);
  // When that entry is offered for exact source attribution
  const split = () => splitCoverageEntry(entry, { artifacts: [item] });
  // Then invalid function geometry fails instead of manufacturing covered ranges
  assert.throws(split, /partially crosses an exact artifact boundary/);
});

test('user rejects a capture without an enclosing script or wrapper range', () => {
  // Given an artifact whose only captured range covers a small internal fragment
  const item = artifact('const answer = 1;\n');
  const entry = captured(item.code, [fn('fragment', [range(6, 12, 1)])]);
  // When the splitter would otherwise have to invent a root count
  const split = () => splitCoverageEntry(entry, { artifacts: [item] });
  // Then the missing source of root coverage is an explicit failure
  assert.throws(split, /requires a captured script or wrapper/);
});

test('user rejects overlapping artifact definitions instead of counting the same bytes twice', () => {
  // Given a complete installer that also contains another registered installer as its prefix
  const first = artifact('const first = 1;\n', 'scripts/first.user.js');
  const combined = artifact(first.code + 'const second = 2;\n', 'scripts/combined.user.js');
  // When both definitions match executable statement boundaries
  const find = () => findArtifactSegments(combined.code, [first, combined]);
  // Then ambiguous overlapping attribution is rejected
  assert.throws(find, /segments must not overlap/);
});
