import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-strategy29-bollinger/monitor.js', import.meta.url), 'utf8');
const bollingerPatternSource = await readFile(new URL('../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js', import.meta.url), 'utf8');

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
