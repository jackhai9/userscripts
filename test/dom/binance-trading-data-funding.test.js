import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, completeTradingBatch,
  createDataPanelHost, tradingDataset,
} from '../helpers/data-media-migration-host.js';

const endpoint = request => request.url.pathname.split('/').at(-1);
const read = (host, role) => host.panel().querySelector(`[data-role="${role}"]`);
const historyRequests = host => host.network.requests.filter(request =>
  request.url.pathname.startsWith('/futures/data/') || endpoint(request) === 'fundingRate');

test('user receives historical metrics while funding interval metadata is still pending', { timeout: 5_000 }, async t => {
  // Given all market endpoints are available except the optional interval metadata
  const host = createDataPanelHost(t, 'trading');
  const dataset = tradingDataset(Date.now());
  await host.start();
  host.network.requests[0].respond({ serverTime: Date.now() });
  await host.network.waitForRequest(request => endpoint(request) === 'fundingRate');

  // When history and the current rate complete before fundingInfo
  for (const request of host.network.requests.filter(request => !request.settled && endpoint(request) !== 'fundingInfo')) {
    request.respond(dataset[endpoint(request)]);
  }
  await afterDataMediaResponseTurn();

  // Then the market panel renders independently while the interval stays explicitly unknown
  assert.equal(host.panel().querySelector('[data-metric="oi"] .td-number').textContent, '200万 ▲');
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  assert.equal(read(host, 'funding-period').textContent, '当前 · 周期待确认');
  assert.match(read(host, 'updated-at').textContent, /^更新于 /);

  // When the optional metadata exceeds its deadline and the next historical cycle begins
  const interval = host.network.requests.find(request => endpoint(request) === 'fundingInfo');
  host.clock.tick(9_999);
  assert.equal(interval.settled, false);
  host.clock.tick(1);
  await afterDataMediaResponseTurn();
  assert.equal(interval.aborted, true);
  assert.equal(read(host, 'funding-interval-status').textContent, '周期加载失败');
  host.clock.tick(295_000);
  await host.network.waitForRequest(request => !request.settled && endpoint(request) === 'fundingRate');

  // Then interval failure cannot prevent the next normal historical refresh
  assert.equal(historyRequests(host).length, 14);
});

test('user sees first-request failures without a fabricated cache label', { timeout: 5_000 }, async t => {
  // Given a new panel has no cached history or interval metadata
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const dataset = tradingDataset(Date.now());
  const status = Object.fromEntries(Object.keys(dataset).map(key => [key, 403]));

  // When the initial endpoint requests all fail definitively
  await activateTradingData(host, dataset, { status });

  // Then missing data is labelled as a load failure and no row claims an existing cache
  assert.equal(host.panel().querySelector('[data-metric="oi"] .td-data-status').textContent, '加载失败');
  assert.equal(read(host, 'funding-interval-status').textContent, '周期加载失败');
  assert.doesNotMatch(host.element('rows').textContent, /缓存/);
  assert.equal(read(host, 'updated-at').textContent, '等待数据');
});

test('user sees an uncalibrated countdown after a high-latency server time sample', { timeout: 5_000 }, async t => {
  // Given server time was sampled before a three-second response delay
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const sampledTime = Date.now();
  const time = host.network.requests[0];

  // When the delayed sample arrives and the current market data completes
  host.clock.tick(3_000);
  time.respond({ serverTime: sampledTime });
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await afterDataMediaResponseTurn();

  // Then current data remains available without certifying the stale clock sample
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 校时不可用');
  assert.equal(historyRequests(host).length, 7);
});

for (const hours of [1, 4, 8, null]) {
  test(`user sees the reported ${hours === null ? 'unknown' : hours + '-hour'} funding period`, { timeout: 5_000 }, async t => {
    // Given period metadata either identifies the symbol or omits it explicitly
    const host = createDataPanelHost(t, 'trading');
    const data = tradingDataset(Date.now(), { intervalHours: hours, funding: 0.00000029 });
    await host.start();

    // When both current funding and settled history arrive
    await activateTradingData(host, data);

    // Then the reported period and both distinct rate values remain visible
    assert.equal(read(host, 'funding-period').textContent, hours === null ? '当前 · 周期待确认' : `当前 · ${hours}小时`);
    assert.equal(read(host, 'current-funding').textContent, '0.00378%');
    assert.equal(host.panel().querySelector('.td-last-value').textContent, '0.000029%');
    assert.equal(read(host, 'funding-interval-status').hidden, true);
  });
}

test('user refreshes current funding without replacing history or resetting its update time', { timeout: 5_000 }, async t => {
  // Given a displayed history and its original receipt time have been recorded
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host, tradingDataset(Date.now(), { funding: 0.00000029 }));
  const history = host.panel().querySelector('[data-metric="funding"] svg');
  const updatedAt = read(host, 'updated-at');
  const originalTime = updatedAt.textContent;

  // When the independent fifteen-second current-rate refresh completes
  host.clock.tick(14_999);
  assert.equal(host.network.requests.filter(request => endpoint(request) === 'premiumIndex').length, 1);
  host.clock.tick(1);
  const pending = await host.network.waitForRequest(request => !request.settled && endpoint(request) === 'premiumIndex');
  pending.respond({ symbol: 'BTCUSDT', lastFundingRate: '0.00008', time: Date.now(), nextFundingTime: Date.now() + 3_600_000 });
  await afterDataMediaResponseTurn();

  // Then only the current value and age change while history nodes and provenance remain intact
  assert.equal(read(host, 'current-funding').textContent, '0.008%');
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 01:00:00');
  assert.equal(host.panel().querySelector('[data-metric="funding"] svg'), history);
  assert.equal(host.panel().querySelector('.td-last-value').textContent, '0.000029%');
  assert.equal(read(host, 'updated-at'), updatedAt);
  assert.equal(updatedAt.textContent, originalTime);
  assert.equal(read(host, 'elapsed').textContent, '15秒前');
  assert.equal(historyRequests(host).length, 7);
});

test('user stops displaying a current quote when its settlement boundary expires', { timeout: 5_000 }, async t => {
  // Given the authoritative next settlement is two seconds away
  const host = createDataPanelHost(t, 'trading');
  const data = tradingDataset(Date.now(), { funding: 0.00000029 });
  data.premiumIndex.nextFundingTime = Date.now() + 2_000;
  await host.start();
  await activateTradingData(host, data);

  // When the displayed server clock reaches that settlement boundary
  host.clock.tick(1_999);
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  host.clock.tick(1);

  // Then the panel waits for a new current quote without inventing another settlement or changing history
  assert.equal(read(host, 'current-funding').textContent, '--');
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 等待更新');
  assert.equal(host.panel().querySelector('.td-last-value').textContent, '0.000029%');
  assert.equal(historyRequests(host).length, 7);
});

test('user retains a labelled current-rate cache through failure and timeout and recovers on refresh', { timeout: 5_000 }, async t => {
  // Given a successful current quote exists separately from historical market data
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);

  // When a definite client error is followed by a request that exceeds its ten-second deadline
  host.clock.tick(15_000);
  let pending = await host.network.waitForRequest(request => !request.settled && endpoint(request) === 'premiumIndex');
  pending.respond({}, 403);
  await afterDataMediaResponseTurn();
  assert.equal(read(host, 'funding-status').textContent, '缓存 · 更新失败');
  assert.match(read(host, 'funding-status').title, /HTTP 403/);
  host.clock.tick(15_000);
  pending = await host.network.waitForRequest(request => !request.settled && endpoint(request) === 'premiumIndex');
  host.clock.tick(9_999);
  assert.equal(pending.settled, false);
  host.clock.tick(1);
  await afterDataMediaResponseTurn();

  // Then cancellation preserves the known rate with an explicit timeout and leaves history untouched
  assert.equal(pending.aborted, true);
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  assert.match(read(host, 'funding-status').title, /Funding request timed out/);
  assert.equal(historyRequests(host).length, 7);

  // When the next scheduled request succeeds
  host.clock.tick(15_000);
  pending = await host.network.waitForRequest(request => !request.settled && endpoint(request) === 'premiumIndex');
  pending.respond({ symbol: 'BTCUSDT', lastFundingRate: '0', time: Date.now(), nextFundingTime: Date.now() + 60_000 });
  await afterDataMediaResponseTurn();

  // Then a genuine zero is shown with a cleared cache marker
  assert.equal(read(host, 'current-funding').textContent, '0%');
  assert.equal(read(host, 'funding-status').hidden, true);
  assert.equal(host.network.requests.filter(request => endpoint(request) === 'premiumIndex').length, 4);
});

test('user receives data after the initial server-time request reaches its deadline', { timeout: 5_000 }, async t => {
  // Given the server-time request never produces an HTTP response
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const time = host.network.requests[0];

  // When its five-second deadline expires and the market endpoints succeed
  host.clock.tick(4_999);
  assert.equal(time.settled, false);
  host.clock.tick(1);
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await afterDataMediaResponseTurn();

  // Then data remains usable but the countdown does not claim an unverified clock
  assert.equal(time.aborted, true);
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 校时不可用');
  assert.match(read(host, 'updated-at').textContent, /^更新于 /);
});

/** Advancing one hour executes 3600 DOM ticks, which needs a larger runner budget under parallel load. */
test('user loses the calibrated countdown when hourly clock synchronization fails', { timeout: 15_000 }, async t => {
  // Given the current panel began with a calibrated clock
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 04:00:00');

  // When the next hourly calibration returns a definite failure
  host.clock.tick(3_600_000);
  const time = await host.network.waitForRequest(request => !request.settled && endpoint(request) === 'time');
  time.respond({}, 500);
  await afterDataMediaResponseTurn();
  host.clock.tick(1_000);

  // Then the next display tick withdraws the calibrated clock claim
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 校时不可用');
  assert.equal(host.network.requests.filter(request => endpoint(request) === 'time').length, 2);
});

test('user cancels old current funding when switching symbols and keeps the new symbol rate', { timeout: 5_000 }, async t => {
  // Given Bitcoin funding remains pending while its history request has started
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  host.network.requests[0].respond({ serverTime: Date.now() });
  await host.network.waitForRequest(request => endpoint(request) === 'fundingRate');
  const current = host.network.requests.find(request => endpoint(request) === 'premiumIndex');
  const interval = host.network.requests.find(request => endpoint(request) === 'fundingInfo');

  // When the user navigates to STRK before Bitcoin completes
  host.navigate('/en/futures/STRKUSDT');
  const data = tradingDataset(Date.now(), { symbol: 'STRKUSDT', currentFunding: 0.00005, funding: 0.00000029 });
  await activateTradingData(host, data, { symbol: 'STRKUSDT' });
  await completeTradingBatch(host, tradingDataset(Date.now()), { includeInterval: false });
  await afterDataMediaResponseTurn();

  // Then cancelled old requests and late history cannot change the new identity or rate
  assert.equal(current.aborted, true);
  assert.equal(interval.aborted, true);
  assert.equal(host.element('symbol').textContent, 'STRKUSDT');
  assert.equal(read(host, 'current-funding').textContent, '0.005%');
  assert.equal(read(host, 'funding-period').textContent, 'Current · 4h');
  assert.equal(host.panel().querySelector('.td-last-value').textContent, '0.000029%');
  assert.equal(host.element('close').getAttribute('aria-label'), 'Close');
});
