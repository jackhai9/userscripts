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

test('user keeps one pending calibration through repeated tab visibility changes', { timeout: 5_000 }, async t => {
  // Given the original activation has an outstanding server-time request
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const oldTime = await host.network.waitForRequest(request => request.url.pathname.endsWith('/time'));

  // When repeated returns occur before the original calibration finishes
  for (let index = 0; index < 10; index++) {
    host.setHidden(true);
    host.setHidden(false);
  }
  assert.equal(host.network.requests.length, 1);
  assert.equal(oldTime.aborted, false);
  oldTime.respond({ serverTime: Date.now() });
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await afterDataMediaResponseTurn();

  // Then the original session starts one complete batch and renders current data
  assert.equal(host.network.requests.length, 10);
  assert.match(host.element('rows').textContent, /200万 ▲/);
  assert.equal(host.panel().querySelector('[data-role="funding-countdown"]').textContent, '倒计时 04:00:00');
});
