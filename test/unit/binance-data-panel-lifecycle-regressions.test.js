import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const sources = {
  trading: await readFile(new URL('../../src/binance-trading-data/index.user.js', import.meta.url), 'utf8'),
  cmc: await readFile(new URL('../../src/binance-coinmarketcap-data/index.user.js', import.meta.url), 'utf8'),
};

function readFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(braceStart + 1, index);
  }
  assert.fail(`${name} body should be closed`);
}

for (const [name, source] of Object.entries(sources)) {
  test(`${name} data panel removes document drag listeners when panel is removed`, () => {
    const setupDragBody = readFunctionBody(source, 'setupDrag');
    const removePanelBody = readFunctionBody(source, 'removePanel');
    assert.match(setupDragBody, /removeEventListener\('mousemove'/);
    assert.match(setupDragBody, /removeEventListener\('mouseup'/);
    assert.match(removePanelBody, /cleanupPanelDrag\(\)/);
  });

  test(`${name} data panel removes beforeunload listener when panel is removed`, () => {
    const sourceText = source;
    const removePanelBody = readFunctionBody(source, 'removePanel');
    assert.match(sourceText, /removeEventListener\('beforeunload'/);
    assert.match(removePanelBody, /cleanupPanelUnload\(\)/);
  });
}

test('trading data panel does not render after close, hidden, or non-trading route', () => {
  const renderPanelBody = readFunctionBody(sources.trading, 'renderPanel');
  assert.match(sources.trading, /function isActiveTradingPage\(\)/);
  assert.match(renderPanelBody, /if \(!isActiveTradingPage\(\)\) return;/);
});

test('trading data panel invalidates async work on route pause and rejects stale symbols after awaits', () => {
  const pauseBody = readFunctionBody(sources.trading, 'pauseForNonTradingPage');
  const initialFetchBody = readFunctionBody(sources.trading, 'initialFetch');
  const cycleBody = readFunctionBody(sources.trading, 'runCycleAttempt');
  const scheduleBody = readFunctionBody(sources.trading, 'scheduleCycle');
  assert.match(pauseBody, /epoch\+\+/);
  assert.match(initialFetchBody, /getCurrentSymbol\(\) !== symbol/);
  assert.match(cycleBody, /getCurrentSymbol\(\) !== symbol/);
  assert.match(scheduleBody, /!isFuturesTradingPage\(\)/);
});

test('CMC data panel stops business timers on non-trading routes but keeps a route watcher', () => {
  const pauseBody = readFunctionBody(sources.cmc, 'pauseForNonTradingPage');
  const startRouteBody = readFunctionBody(sources.cmc, 'startRouteWatcher');
  assert.match(pauseBody, /stopDataLoop\(\)/);
  assert.doesNotMatch(pauseBody, /stopRouteWatcher\(\)/);
  assert.match(startRouteBody, /setInterval/);
});

test('CMC data panel escapes the CoinMarketCap link href before writing innerHTML', () => {
  const renderDataBody = readFunctionBody(sources.cmc, 'renderData');
  assert.match(renderDataBody, /escapeHtml\(data\.url\)/);
});
