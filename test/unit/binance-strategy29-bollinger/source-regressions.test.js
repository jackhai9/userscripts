import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGY29_REFERENCE_SHA256 } from '../../../src/binance-strategy29-bollinger/core/remote-summary-contract.js';

const source = await readFile(new URL('../../../src/binance-strategy29-bollinger/monitor.js', import.meta.url), 'utf8');
const bollingerPatternSource = await readFile(new URL('../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../../../src/binance-strategy29-bollinger/index.user.js', import.meta.url), 'utf8');
const remoteSource = await readFile(new URL('../../../src/binance-strategy29-bollinger/remote-summary.js', import.meta.url), 'utf8');

function readFunctionBody(name, sourceText = source) {
  const start = sourceText.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = sourceText.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return sourceText.slice(braceStart + 1, index);
  }
  assert.fail(`${name} body should be closed`);
}

function readUserscriptVersion(sourceText) {
  const match = sourceText.match(/^\/\/ @version\s+(\S+)\s*$/m);
  assert.notEqual(match, null, 'userscript version metadata should exist');
  return match[1];
}

test('bearish chart alerts reconcile every loaded closed-bar window without silent truncation', () => {
  const synchronizeBody = readFunctionBody('synchronizeBearishBollingerAlerts');
  assert.match(synchronizeBody, /reconcileBearishBollingerAlertWindow\(\{/);
  assert.match(synchronizeBody, /lastProcessedClosedBarsWindowKey/);
  assert.match(synchronizeBody, /lastProcessedSignals/);
  assert.doesNotMatch(synchronizeBody, /lastProcessedClosedBarTime/);
  assert.doesNotMatch(synchronizeBody, /\.slice\(-BEARISH_BOLLINGER_ALERT_MAX_MARKERS\)/);
  assert.doesNotMatch(source, /BEARISH_BOLLINGER_ALERT_MAX_MARKERS/);
  assert.doesNotMatch(source, /nextExportAtMs/);
});

test('Bollinger chart alert failures distinguish snapshot races from contract failures', () => {
  const synchronizeBody = readFunctionBody('synchronizeBearishBollingerAlerts');
  const snapshotBranchStart = synchronizeBody.indexOf("failureKind === 'retry'");
  assert.ok(snapshotBranchStart >= 0);
  assert.match(synchronizeBody, /applyBollingerAlertTaskFailure\(context, error\)/);
  assert.match(synchronizeBody, /failureKind === 'retry'[\s\S]*等待下一次采样/);
  assert.match(synchronizeBody, /context\.cleanupPending[\s\S]*context\.layer\.clear\(\)/);
  assert.match(bollingerPatternSource, /context\.failed = true;/);
  assert.match(bollingerPatternSource, /context\.cleanupPending = true;/);
});

test('Strategy29 sandbox metadata is exact and coordinates through unsafeWindow', () => {
  assert.equal(readUserscriptVersion(entrySource), '0.2.0');
  assert.deepEqual(
    [...entrySource.matchAll(/^\/\/ @grant\s+(\S+)\s*$/gm)].map(match => match[1]),
    ['unsafeWindow', 'GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_registerMenuCommand'],
  );
  assert.deepEqual(
    [...entrySource.matchAll(/^\/\/ @connect\s+(\S+)\s*$/gm)].map(match => match[1]),
    ['127.0.0.1'],
  );
  assert.match(entrySource, /installStrategy29\(unsafeWindow,/);
  assert.match(entrySource, /globalThis\.prompt\.bind\(globalThis\)/);
  assert.doesNotMatch(remoteSource, /view\.prompt/);
  assert.doesNotMatch(entrySource, /@grant\s+none/);
});

test('remote summary remains read-only and does not add chart or exchange transports', () => {
  assert.doesNotMatch(remoteSource, /WebSocket|\.fetch\(|createMultipointShape|createShape|exchangeInfo|apiKey|apiSecret/);
  assert.match(remoteSource, /createStrategy29RemoteSummary/);
});

test('remote parity display is pinned to the exact reviewed local detector bytes', () => {
  assert.equal(createHash('sha256').update(bollingerPatternSource).digest('hex'), STRATEGY29_REFERENCE_SHA256);
});
