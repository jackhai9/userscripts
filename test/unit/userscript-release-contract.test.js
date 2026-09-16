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

test('user installs Strategy29 with its independent observation-only identity', async () => {
  // Given the current generated Strategy29 installer.
  const artifact = new URL('../../scripts/binance-strategy29-bollinger.user.js', import.meta.url);
  const text = await readFile(artifact, 'utf8');
  // When its install identity and browser capabilities are inspected.
  const contract = createUserscriptReleaseContract(text, artifact.pathname);
  const metadata = parseUserscriptMetadata(text);
  // Then the installer retains its pinned identity and declared observation boundary.
  assert.equal(contract.name, '【自写】Binance Strategy 29 布林带信号');
  assert.equal(contract.namespace, 'binance.strategy29.bollinger');
  assert.equal(contract.version, '0.5.5');
  assert.equal(contract.runAt, 'document-start');
  assert.equal(contract.updateURL, 'https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy29-bollinger.user.js');
  assert.equal(contract.downloadURL, contract.updateURL);
  assert.equal(metadata.get('connect'), undefined);
  assert.deepEqual(metadata.get('grant'), [
    'unsafeWindow',
    'GM_getValue',
    'GM_setValue',
  ]);
  for (const forbidden of ['new WebSocket', 'wss://', 'fetch(', 'place-order', 'apiKey', 'apiSecret', 'synthetic-secret', 'detectBollingerSignals']) {
    if (forbidden === 'detectBollingerSignals') {
      assert.equal(source.includes(forbidden), false, 'orderbook must not bundle the detector');
    } else assert.equal(text.includes(forbidden), false);
  }
});

test('user identifies the generated orderbook installer by its release contract', () => {
  // Given the public orderbook artifact at its install path.
  const path = artifactPath.pathname;
  // When the installer is parsed into a release contract.
  const contract = createUserscriptReleaseContract(source, path);
  // Then identity, route scope, update location, and content fingerprints match the artifact.
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

test('user identifies Strategy27 and its declared local gateway capabilities', () => {
  // Given the current generated annotation installer.
  const path = strategy27ArtifactPath.pathname;
  // When its release contract and browser grants are parsed.
  const contract = createUserscriptReleaseContract(strategy27Source, path);
  const metadata = parseUserscriptMetadata(strategy27Source);
  // Then the installer retains its identity and exact gateway capability boundary.
  assert.equal(contract.name, '【自写】Binance Strategy 27 事件标注');
  assert.equal(contract.namespace, 'binance.strategy27.events');
  assert.equal(contract.version, '0.6.5');
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

test('user rejects an installer whose metadata no longer begins at the first byte', () => {
  // Given an installer has unexpected content before its metadata header.
  const malformed = `\n${source}`;
  // When release validation attempts to read that metadata.
  const validate = () => parseUserscriptMetadata(malformed);
  // Then validation names the broken first-byte contract.
  assert.throws(validate, /metadata must start at the first byte/);
});

test('user rejects an installer with ambiguous duplicate namespace metadata', () => {
  // Given two namespace declarations appear in one installer.
  const duplicate = source.replace('// @namespace    binance.orderbook.trade', [
    '// @namespace    binance.orderbook.trade',
    '// @namespace    duplicate.namespace',
  ].join('\n'));

  // When its release identity is validated.
  const validate = () => createUserscriptReleaseContract(duplicate, artifactPath.pathname);
  // Then the duplicate identity fails with its exact conflicting count.
  assert.throws(validate, /Expected exactly one @namespace, found 2/);
});

test('user distinguishes exact installed source from a modified installer', () => {
  // Given an exact source copy and one with changed metadata.
  const exactCopy = source.slice();
  const changed = source.replace('// @description  ', '// @description  changed ');
  // When both installed texts are compared with the original artifact.
  const equal = compareUserscriptSources(source, exactCopy);
  const divergent = compareUserscriptSources(source, changed);
  // Then exact identity and differing content hashes distinguish the two installations.
  assert.equal(equal.exactSourceMatch, true);
  assert.equal(equal.actual.sha256, equal.expected.sha256);
  assert.equal(divergent.exactSourceMatch, false);
  assert.notEqual(divergent.actual.sha256, divergent.expected.sha256);
});

test('user compares installed source without the MCP transport modification footer', () => {
  // Given an MCP text readback includes its separate modification timestamp.
  const readback = `${source}\n\n---\nLast modified: 2026-08-26T06:52:12.240Z`;
  // When the transport response is parsed.
  const parsed = parseTampermonkeyMcpReadback(readback);
  // Then installer bytes remain exact and the timestamp stays separate.
  assert.equal(parsed.source, source);
  assert.equal(parsed.lastModified, '2026-08-26T06:52:12.240Z');
});

test('user requires explicit installed source in an MCP JSON readback', () => {
  // Given the transport returns one complete readback and one without source text.
  const complete = JSON.stringify({
    value: source,
    lastModified: 1_777_184_732,
  });
  const missingSource = JSON.stringify({ lastModified: 1_777_184_732 });
  // When the complete response is parsed and the incomplete response is validated.
  const parsed = parseTampermonkeyMcpReadback(complete);
  const validate = () => parseTampermonkeyMcpReadback(missingSource);
  // Then the exact source and timestamp are retained and absent source is rejected.
  assert.equal(parsed.source, source);
  assert.equal(parsed.lastModified, 1_777_184_732);

  assert.throws(
    validate,
    /missing the source value/,
  );
});
