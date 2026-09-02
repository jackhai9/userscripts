import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  compareUserscriptSources,
  createUserscriptReleaseContract,
  parseTampermonkeyMcpReadback,
  parseUserscriptMetadata,
} from '../../scripts/userscript-release-contract.mjs';

const artifactPath = new URL('../../scripts/binance-orderbook-trade.user.js', import.meta.url);
const source = await readFile(artifactPath, 'utf8');
const strategy27ArtifactPath = new URL('../../scripts/binance-strategy27-events.user.js', import.meta.url);
const strategy27Source = await readFile(strategy27ArtifactPath, 'utf8');

test('release contract identifies the generated Binance orderbook artifact', () => {
  const contract = createUserscriptReleaseContract(source, artifactPath.pathname);

  assert.equal(contract.name, '【自写】Binance 订单簿单击下单');
  assert.equal(contract.namespace, 'binance.orderbook.trade');
  assert.match(contract.version, /^\d+\.\d+\.\d+$/);
  assert.equal(contract.runAt, 'document-start');
  assert.equal(contract.updateURL, contract.downloadURL);
  assert.deepEqual(contract.matches, [
    'https://www.binance.com/*/futures/*',
    'https://www.binance.com/futures/*',
  ]);
  assert.match(contract.sha256, /^[a-f0-9]{64}$/);
  assert.equal(contract.bytes, Buffer.byteLength(source));
  assert.equal(contract.characters, source.length);
});

test('release contract identifies the generated Strategy 27 annotation artifact', () => {
  const contract = createUserscriptReleaseContract(strategy27Source, strategy27ArtifactPath.pathname);
  const metadata = parseUserscriptMetadata(strategy27Source);

  assert.equal(contract.name, '【自写】Binance Strategy 27 事件标注');
  assert.equal(contract.namespace, 'binance.strategy27.events');
  assert.equal(contract.version, '0.3.0');
  assert.equal(contract.runAt, 'document-idle');
  assert.equal(contract.updateURL, contract.downloadURL);
  assert.deepEqual(contract.matches, [
    'https://www.binance.com/*/futures/*',
    'https://www.binance.com/futures/*',
  ]);
  assert.deepEqual(metadata.get('connect'), ['127.0.0.1']);
  assert.deepEqual(metadata.get('grant'), [
    'unsafeWindow',
    'GM_xmlhttpRequest',
    'GM_getValue',
    'GM_setValue',
    'GM_registerMenuCommand',
  ]);
  assert.equal(strategy27Source.includes('new WebSocket'), false);
  assert.equal(strategy27Source.includes('wss://'), false);
  assert.equal(strategy27Source.includes('apiKey'), false);
});

test('release contract requires metadata at the first byte', () => {
  assert.throws(
    () => parseUserscriptMetadata(`\n${source}`),
    /metadata must start at the first byte/,
  );
});

test('release contract rejects duplicate identity metadata', () => {
  const duplicate = source.replace('// @namespace    binance.orderbook.trade', [
    '// @namespace    binance.orderbook.trade',
    '// @namespace    duplicate.namespace',
  ].join('\n'));

  assert.throws(
    () => createUserscriptReleaseContract(duplicate, artifactPath.pathname),
    /Expected exactly one @namespace, found 2/,
  );
});

test('source comparison reports exact equality and divergent hashes', () => {
  const equal = compareUserscriptSources(source, source);
  assert.equal(equal.exactSourceMatch, true);
  assert.equal(equal.actual.sha256, equal.expected.sha256);

  const changed = source.replace('// @description  ', '// @description  changed ');
  const divergent = compareUserscriptSources(source, changed);
  assert.equal(divergent.exactSourceMatch, false);
  assert.notEqual(divergent.actual.sha256, divergent.expected.sha256);
});

test('Tampermonkey MCP text read-back separates the transport modification footer', () => {
  const readback = `${source}\n\n---\nLast modified: 2026-08-26T06:52:12.240Z`;
  const parsed = parseTampermonkeyMcpReadback(readback);

  assert.equal(parsed.source, source);
  assert.equal(parsed.lastModified, '2026-08-26T06:52:12.240Z');
});

test('Tampermonkey MCP JSON read-back requires an explicit source value', () => {
  const parsed = parseTampermonkeyMcpReadback(JSON.stringify({
    value: source,
    lastModified: 1_777_184_732,
  }));
  assert.equal(parsed.source, source);
  assert.equal(parsed.lastModified, 1_777_184_732);

  assert.throws(
    () => parseTampermonkeyMcpReadback(JSON.stringify({ lastModified: 1_777_184_732 })),
    /missing the source value/,
  );
});
