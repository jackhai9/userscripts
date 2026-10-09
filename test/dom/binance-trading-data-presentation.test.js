import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, completeTradingBatch,
  createDataPanelHost, tradingDataset,
} from '../helpers/data-media-migration-host.js';

test('user can distinguish a tiny settled funding rate from zero', { timeout: 5_000 }, async t => {
  // Given the history endpoint reports the nonzero rate observed for STRK
  const host = createDataPanelHost(t, 'trading', { path: '/zh-CN/futures/STRKUSDT' });
  const dataset = tradingDataset(Date.now(), { symbol: 'STRKUSDT', funding: 0.00000029 });

  // When the installed script renders that settled funding record
  await host.start();
  await activateTradingData(host, dataset, { symbol: 'STRKUSDT' });

  // Then the exact small percentage remains visible instead of a rounded zero
  assert.match(host.element('rows').textContent, /0\.000029%/);
});

test('user sees English trading labels on an English futures page', { timeout: 5_000 }, async t => {
  // Given the trading route explicitly selects English
  const host = createDataPanelHost(t, 'trading', { path: '/en/futures/BTCUSDT' });

  // When the installed panel receives complete market data
  await host.start();
  const time = await host.network.waitForRequest(request => request.url.pathname.endsWith('/time'));
  time.respond({ serverTime: Date.now() });
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await host.rendered(() => host.element('symbol')?.textContent === 'BTCUSDT');

  // Then indicator names and actions match the English page
  assert.match(host.element('rows').textContent, /Open Interest/);
  assert.match(host.element('rows').textContent, /Funding Rate/);
  assert.equal(host.element('close').getAttribute('aria-label'), 'Close');
});

test('user keeps the resumed data session when an earlier time request completes late', { timeout: 5_000 }, async t => {
  // Given the original activation has an outstanding server-time request
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const oldTime = await host.network.waitForRequest(request => request.url.pathname.endsWith('/time'));

  // When a resumed activation completes before the old calibration
  host.setHidden(true);
  host.setHidden(false);
  const newTime = await host.network.waitForRequest(request => request !== oldTime && request.url.pathname.endsWith('/time'));
  newTime.respond({ serverTime: Date.now() });
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await afterDataMediaResponseTurn();
  const requestCount = host.network.requests.length;
  const rendered = host.element('rows').textContent;
  assert.equal(oldTime.aborted, true);
  await afterDataMediaResponseTurn();

  // Then late calibration cannot change the data or start another request batch
  assert.equal(host.network.requests.length, requestCount);
  assert.equal(host.element('rows').textContent, rendered);
});
