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
} from '../../scripts/test-coverage/source-maps.mjs';

const registry = await createSourceRegistry();

test('user gets coverage maps for the exact install artifacts and complete original sources', async () => {
  // Given the six generated installers and two hand-maintained installers.
  const paths = registry.artifacts.map((artifact) => artifact.path).sort();
  const expected = [
    'auto_refresh', 'binance-coinmarketcap-data', 'binance-orderbook-trade',
    'binance-strategy27-events', 'binance-strategy29-bollinger', 'binance-trading-data',
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
