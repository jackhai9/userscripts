import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'acorn';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { ROOT, productionSourceFiles } from '../../scripts/test-coverage/config.mjs';
import {
  createSourceRegistry,
  mapCoverageEntry,
  retainProjectSourceMappings,
} from '../../scripts/test-coverage/source-maps.mjs';

const registry = await createSourceRegistry();

test('user excludes bundled vendor code without extending adjacent project coverage', () => {
  // Given project and vendor mappings share a generated line and one project source is unexecuted
  const sources = ['src/first.js', 'node_modules/parser/index.js', 'src/second.js', 'src/unexecuted.js'];
  const map = { version: 3, sources, sourcesContent: ['first', 'vendor', 'second', 'unexecuted'], names: [],
    mappings: encode([[[0, 0, 0, 0], [7, 1, 0, 0], [13, 2, 0, 0]], [[0, 1, 1, 0]]]) };

  // When the mapper retains the complete project source set
  const result = retainProjectSourceMappings(map, new Set(sources.filter(path => path.startsWith('src/'))));

  // Then vendor columns explicitly clear attribution and all project sources remain
  assert.deepEqual(result.sources, ['src/first.js', 'src/second.js', 'src/unexecuted.js']);
  assert.deepEqual(result.sourcesContent, ['first', 'second', 'unexecuted']);
  assert.deepEqual(decode(result.mappings), [[[0, 0, 0, 0], [7], [13, 1, 0, 0]], [[0]]]);
});

test('user rejects a coverage source outside the project and bundled dependencies', () => {
  // Given a map claims an unknown source that is neither project code nor a dependency
  const map = { sources: ['outside/unknown.js'], sourcesContent: ['unknown'], names: [], mappings: '' };

  // When the registry attempts to classify its source
  const classify = () => retainProjectSourceMappings(map, new Set());

  // Then the unexpected source is exposed instead of silently reducing the denominator
  assert.throws(classify, /Unexpected non-project coverage source: outside\/unknown.js/);
});

test('user gets coverage maps for the exact install artifacts and complete original sources', async () => {
  // Given the seven generated installers and two hand-maintained installers.
  const paths = registry.artifacts.map((artifact) => artifact.path).sort();
  const expected = [
    'auto_refresh', 'binance-coinmarketcap-data', 'binance-orderbook-trade',
    'binance-strategy27-events', 'binance-strategy29-bollinger', 'binance-strategy31-volume-reversal', 'binance-trading-data',
    'coinmarketcap-valuation-helper', 'm3u8-downloader',
  ].map((name) => 'scripts/' + name + '.user.js').sort();
  // When the coverage compiler produces its maps without changing executable bytes.
  const entries = await Promise.all(registry.artifacts.map(async (artifact) => ({
    artifact, installed: await readFile(resolve(ROOT, artifact.path), 'utf8'),
  })));
  // Then every installer remains exact and each original source includes its real header and line positions.
  assert.deepEqual(paths, expected);
  for (const { artifact, installed } of entries) {
    assert.equal(artifact.code, installed);
    for (const [index, path] of artifact.map.sources.entries()) {
      assert.equal(artifact.map.sourcesContent[index], registry.sources.get(path), path);
    }
  }
  assert.equal(registry.sources.size, (await productionSourceFiles()).length);
});

test('user sees shared originals once when generated scripts execute before and after each other', () => {
  // Given two actual generated scripts within a sandbox prefix and suffix.
  const orderbook = registry.artifacts.find((artifact) => artifact.path.endsWith('/binance-orderbook-trade.user.js'));
  const signals = registry.artifacts.find((artifact) => artifact.path.endsWith('/binance-strategy29-bollinger.user.js'));
  const source = 'const fixtureBefore = true;\n' + orderbook.code + '\n{\n' + signals.code + '}\n';
  // When one browser script's coverage is mapped without changing its collected offsets.
  const functions = [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }];
  const mapped = mapCoverageEntry({ url: 'https://www.binance.com/__binance_orderbook_userscript__.js', source, functions }, registry);
  // Then both installers use one canonical entry for their shared chart controller.
  const shared = resolve(ROOT, 'src/shared/chart-marker-save-controller.js');
  assert.equal(mapped.sourceMap.sources.filter((path) => path === shared).length, 1);
  assert.equal(mapped.source, source);
  assert.equal(mapped.functions, functions);
  const lines = decode(mapped.sourceMap.mappings);
  assert.deepEqual(lines[0], []);
  assert.equal(mapped.sourceMap.sourcesContent[mapped.sourceMap.sources.indexOf(shared)],
    registry.sources.get('src/shared/chart-marker-save-controller.js'));
});

test('user gets no execution credit from a quoted installer or an extracted source fragment', () => {
  // Given installer bytes that occur only as a string value, with the same file path as real code.
  const code = '(() => { if (globalThis.flag) globalThis.result = 1; })();\n';
  const path = 'src/shared/proof.js';
  const proofRegistry = {
    sources: new Map([[path, code]]),
    artifacts: [{
      path: 'scripts/proof.user.js', code,
      body: parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body,
      map: { version: 3, sources: [path], sourcesContent: [code], names: [], mappings: encode([[[0, 0, 0, 0]]]) },
    }],
  };
  const quoted = 'const data = ' + String.fromCharCode(96) + code + String.fromCharCode(96) + ';';
  // When quoted data and partial functions are offered as coverage of the original source.
  const quotedResult = mapCoverageEntry({ url: path, source: quoted, functions: [] }, proofRegistry);
  const fragmentResult = mapCoverageEntry({ url: path, source: 'if (globalThis.flag) globalThis.result = 1;', functions: [] }, proofRegistry);
  // Then neither input is attributed to the original production file.
  assert.equal(quotedResult, null);
  assert.equal(fragmentResult, null);
});

test('user can attribute anonymous VM execution only when the complete original source matches', () => {
  // Given the complete auto-refresh installer and an anonymous VM script URL.
  const path = 'scripts/auto_refresh.user.js';
  const source = registry.sources.get(path);
  const entry = { url: 'evalmachine.<anonymous>', source, functions: [] };
  // When coverage identifies the anonymous script by its exact original bytes.
  const mapped = mapCoverageEntry(entry, registry);
  // Then coverage names the real installer without substituting any executed text.
  assert.equal(mapped.url, new URL('../../scripts/auto_refresh.user.js', import.meta.url).href);
  assert.equal(mapped.source, source);
});
