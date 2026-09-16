import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGY29_REFERENCE_SHA256 } from '../../../src/binance-strategy29-bollinger/core/remote-summary-contract.js';

function readUserscriptVersion(sourceText) {
  const match = sourceText.match(/^\/\/ @version\s+(\S+)\s*$/m);
  assert.notEqual(match, null, 'userscript version metadata should exist');
  return match[1];
}

test('user installs Strategy29 with only the reviewed sandbox capabilities', async () => {
  // Given the public entry and remote-summary modules define the sandbox boundary.
  const paths = ['index.user.js', 'remote-summary.js'].map(path =>
    new URL('../../../src/binance-strategy29-bollinger/' + path, import.meta.url));

  // When their current source bytes are read for the capability audit.
  const [entrySource, remoteSource] = await Promise.all(paths.map(path => readFile(path, 'utf8')));

  // Then metadata and page coordination keep the exact reviewed grants and transport boundary.
  assert.equal(readUserscriptVersion(entrySource), '0.5.5');
  assert.deepEqual(
    [...entrySource.matchAll(/^\/\/ @grant\s+(\S+)\s*$/gm)].map(match => match[1]),
    ['unsafeWindow', 'GM_getValue', 'GM_setValue'],
  );
  assert.deepEqual(
    [...entrySource.matchAll(/^\/\/ @connect\s+(\S+)\s*$/gm)].map(match => match[1]),
    [],
  );
  assert.match(entrySource, /installStrategy29\(unsafeWindow,/);
  assert.doesNotMatch(entrySource, /prompt|GM_xmlhttpRequest/);
  assert.doesNotMatch(remoteSource, /view\.prompt/);
  assert.doesNotMatch(entrySource, /@grant\s+none/);
});

test('user receives a remote summary module with no chart mutations or exchange transport', async () => {
  // Given the remote summary is an explicitly read-only module.
  const path = new URL('../../../src/binance-strategy29-bollinger/remote-summary.js', import.meta.url);

  // When the actual module is inspected for forbidden capabilities.
  const remoteSource = await readFile(path, 'utf8');

  // Then the module retains its entrypoint without acquiring unrelated data or chart APIs.
  assert.doesNotMatch(remoteSource, /WebSocket|\.fetch\(|createMultipointShape|createShape|exchangeInfo|apiKey|apiSecret/);
  assert.match(remoteSource, /createStrategy29RemoteSummary/);
});

test('user sees remote parity pinned to the exact reviewed local detector bytes', async () => {
  // Given the remote contract names the reviewed detector hash.
  const path = new URL('../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js', import.meta.url);

  // When the current detector source is hashed without rewriting its bytes.
  const source = await readFile(path, 'utf8');
  const actual = createHash('sha256').update(source).digest('hex');

  // Then parity can only be claimed for that exact detector implementation.
  assert.equal(actual, STRATEGY29_REFERENCE_SHA256);
});
