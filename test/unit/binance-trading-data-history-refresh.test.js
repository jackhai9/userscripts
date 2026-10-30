import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, createDataPanelHost, isTradingHistoryRequest, tradingDataset,
} from '../helpers/data-media-migration-host.js';

const PERIOD_MS = 300_000;
const BOUNDARY = Date.UTC(2026, 8, 16, 0, 0, 0);
// Activation after the five-second publication grace, as when a user opens a symbol mid-period.
const ACTIVATED_AT = BOUNDARY + 30_000;

/**
 * Live Binance publication on 2026-10-29: open interest and the three ratio endpoints
 * stamp their newest row with the boundary that closed it, while taker volume and basis
 * stamp the start of the period they cover, so their newest row is one period earlier.
 */
function liveDataset(boundary, { openInterestAt = boundary, oi } = {}) {
  const dataset = tradingDataset(boundary, oi === undefined ? {} : { oi });
  const previous = boundary - PERIOD_MS;
  dataset.takerlongshortRatio = dataset.takerlongshortRatio.map(row => ({ ...row, timestamp: previous }));
  dataset.basis = dataset.basis.map(row => ({ ...row, timestamp: previous }));
  const shift = boundary - openInterestAt;
  dataset.openInterestHist = dataset.openInterestHist.map(row => ({ ...row, timestamp: row.timestamp - shift }));
  return dataset;
}

function historyRequests(host) {
  return host.network.requests.filter(isTradingHistoryRequest).map(request => request.url.pathname.split('/').at(-1));
}

test('user stops refreshing trading history once every endpoint publishes its latest five-minute row', { timeout: 5_000 }, async t => {
  // Given trading data loaded with each endpoint's newest live row for this period
  const host = createDataPanelHost(t, 'trading', { now: ACTIVATED_AT });
  await host.start();
  await activateTradingData(host, liveDataset(BOUNDARY));
  const firstRow = host.element('rows').firstElementChild;

  // When the rest of the five-minute period elapses
  host.clock.tick(BOUNDARY + PERIOD_MS - 1 - ACTIVATED_AT);
  await afterDataMediaResponseTurn();

  // Then no history endpoint is requested again and the rendered rows are kept
  assert.equal(historyRequests(host).length, 7);
  assert.equal(host.element('rows').firstElementChild, firstRow);
});

test('user retries only the endpoint that has not published its row and keeps unchanged rows', { timeout: 5_000 }, async t => {
  // Given open interest has not yet published the row that closes this period
  const host = createDataPanelHost(t, 'trading', { now: ACTIVATED_AT });
  await host.start();
  await activateTradingData(host, liveDataset(BOUNDARY, { openInterestAt: BOUNDARY - PERIOD_MS }));
  const firstRow = host.element('rows').firstElementChild;

  // When the first retry still receives the same open-interest rows
  host.clock.tick(10_000);
  const unchanged = await host.network.waitForRequest(request => !request.settled && isTradingHistoryRequest(request));
  unchanged.respond(liveDataset(BOUNDARY, { openInterestAt: BOUNDARY - PERIOD_MS }).openInterestHist);
  await afterDataMediaResponseTurn();

  // Then only open interest was requested and the rendered rows were not rebuilt
  assert.deepEqual(historyRequests(host).slice(7), ['openInterestHist']);
  assert.equal(host.element('rows').firstElementChild, firstRow);

  // When the next retry receives the new open-interest row
  host.clock.tick(15_000);
  const published = await host.network.waitForRequest(request => !request.settled && isTradingHistoryRequest(request));
  published.respond(liveDataset(BOUNDARY, { oi: 3_000_000 }).openInterestHist);
  await afterDataMediaResponseTurn();
  host.clock.tick(BOUNDARY + PERIOD_MS - 1 - (ACTIVATED_AT + 25_000));
  await afterDataMediaResponseTurn();

  // Then the new value is shown once and the period needs no further history requests
  assert.deepEqual(historyRequests(host).slice(7), ['openInterestHist', 'openInterestHist']);
  assert.notEqual(host.element('rows').firstElementChild, firstRow);
  assert.match(host.element('rows').textContent, /300万 ▲/);
});
