import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, cmcDetail, completeCmcData,
  completeTradingBatch, createDataPanelHost, isTradingHistoryRequest, tradingDataset,
} from '../helpers/data-media-migration-host.js';

async function finishInitial(host, kind) {
  if (kind === 'trading') await activateTradingData(host);
  else await completeCmcData(host);
  await afterDataMediaResponseTurn();
}

function fundingRequests(host) {
  return host.network.requests.filter(request => request.url.pathname.endsWith('/premiumIndex'));
}

function read(host, role) {
  return host.panel().querySelector(`[data-role="${role}"]`);
}

async function finishCurrentFunding(host, values = {}) {
  const request = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/premiumIndex'));
  request.respond(tradingDataset(Date.now(), values).premiumIndex);
  await afterDataMediaResponseTurn();
}

for (const kind of ['trading', 'cmc']) {
  test(`user keeps ${kind} data and row nodes through ten quick tab switches without extra requests`, { timeout: 5_000 }, async t => {
    // Given a fully rendered panel has a fresh snapshot and stable row nodes
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);
    const panel = host.panel();
    const rows = [...host.element('rows').children];
    const requestCount = host.network.requests.length;
    const updated = kind === 'trading' ? read(host, 'updated-at').textContent : host.element('footer').innerHTML;
    const step = kind === 'trading' ? 500 : 1_450;

    // When the user returns ten times before either foreground refresh deadline
    for (let index = 0; index < 10; index++) {
      host.clock.tick(step);
      host.setHidden(true);
      host.clock.tick(step);
      host.setHidden(false);
      host.clock.tick(0);
    }
    await afterDataMediaResponseTurn();

    // Then the same data stays visible without Loading, recalibration, or new requests
    assert.equal(host.panel(), panel);
    assert.deepEqual([...host.element('rows').children], rows);
    assert.equal(host.network.requests.length, requestCount);
    assert.equal(kind === 'trading' ? read(host, 'updated-at').textContent : host.element('footer').innerHTML, updated);
    assert.equal(host.element('rows').textContent.includes('加载中'), false);
    if (kind === 'trading') assert.equal(read(host, 'current-funding').textContent, '0.00378%');

    // When the original foreground deadline arrives after the last return
    host.clock.tick((kind === 'trading' ? 15_000 : 30_000) - step * 20 - 1);
    assert.equal(host.network.requests.length, requestCount);
    host.clock.tick(1);
    await afterDataMediaResponseTurn();

    // Then tab switching has not postponed the next scheduled request
    assert.equal(host.network.requests.length, requestCount + 1);
  });

  test(`user returns to an overdue ${kind} snapshot without clearing data or duplicating pending refreshes`, { timeout: 5_000 }, async t => {
    // Given a hidden panel has exceeded its foreground interval but not its background interval
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);
    const rows = [...host.element('rows').children];
    const initialCount = host.network.requests.length;
    host.setHidden(true);
    host.clock.tick(kind === 'trading' ? 20_000 : 40_000);

    // When repeated returns happen while one due refresh remains pending
    host.setHidden(false);
    host.clock.tick(0);
    for (let index = 0; index < 10; index++) {
      host.setHidden(true);
      host.setHidden(false);
      host.clock.tick(0);
    }
    await afterDataMediaResponseTurn();

    // Then only the overdue feed is requested and its previous data remains mounted
    assert.deepEqual([...host.element('rows').children], rows);
    assert.equal(host.network.requests.length, initialCount + 1);
    if (kind === 'trading') {
      assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
      assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/time')).length, 1);
      assert.equal(read(host, 'current-funding').textContent, '0.00378%');
      await finishCurrentFunding(host, { currentFunding: 0.00008 });
      assert.equal(read(host, 'current-funding').textContent, '0.008%');
    } else {
      await completeCmcData(host, cmcDetail({ statistics: { ...cmcDetail().statistics, price: 70_000 } }), { map: false });
      await afterDataMediaResponseTurn();
      assert.match(host.element('rows').textContent, /价格\$7万/);
      assert.equal(host.network.requests.length, initialCount + 2);
    }
  });

  test(`user stops background ${kind} requests immediately when leaving the trading route`, { timeout: 5_000 }, async t => {
    // Given an activated panel continues to own its current symbol in a hidden tab
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);
    host.setHidden(true);
    const count = host.network.requests.length;

    // When the hidden page navigates away and remains there through all refresh deadlines
    host.navigate('/zh-CN/futures');
    host.clock.tick(3_600_000);
    await afterDataMediaResponseTurn();

    // Then the panel is removed immediately and no business requests run off-route
    assert.equal(host.panel(), null);
    assert.equal(host.network.requests.length, count);
  });

  test(`user keeps a new background ${kind} symbol when the old symbol response arrives late`, { timeout: 5_000 }, async t => {
    // Given the original Bitcoin request is pending when its tab becomes hidden
    const host = createDataPanelHost(t, kind);
    await host.start();
    if (kind === 'trading') {
      host.network.requests[0].respond({ serverTime: Date.now() });
      await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
    }
    host.setHidden(true);

    // When background navigation completes Ethereum before the old Bitcoin response
    host.navigate('/zh-CN/futures/ETHUSDT');
    assert.equal(host.network.requests.filter(request => !request.settled
      && (request.url.pathname.endsWith('/time') || request.url.searchParams.get('symbol') === 'ETH')).length, 1);
    if (kind === 'trading') {
      await activateTradingData(host, tradingDataset(Date.now(), { symbol: 'ETHUSDT', oi: 3000 }), { symbol: 'ETHUSDT' });
      await completeTradingBatch(host, tradingDataset(Date.now()), { includeInterval: false });
    } else {
      await completeCmcData(host, cmcDetail({ id: 2, symbol: 'ETH' }), { symbol: 'ETH', slug: 'ethereum' });
      await completeCmcData(host);
    }
    await afterDataMediaResponseTurn();
    const count = host.network.requests.length;
    host.setHidden(false);
    host.clock.tick(0);

    // Then returning retains the already loaded Ethereum data without restarting either symbol
    assert.match(host.element('symbol').textContent, /^ETH/);
    assert.equal(host.network.requests.length, count);
    if (kind === 'trading') assert.match(host.element('rows').textContent, /3000 ▼/);
    else assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/zh/currencies/ethereum/');
  });
}

test('user completes the original trading initialization while hidden without restarting clock or history requests', { timeout: 5_000 }, async t => {
  // Given the first server-time request is still pending after panel creation
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const time = host.network.requests[0];
  const panel = host.panel();

  // When the user hides the tab before calibration and every initial response finishes
  host.setHidden(true);
  assert.equal(time.aborted, false);
  await activateTradingData(host);
  host.setHidden(false);
  host.clock.tick(0);
  await afterDataMediaResponseTurn();

  // Then the original session renders a calibrated current rate with one request batch
  assert.equal(host.panel(), panel);
  assert.equal(host.network.requests.length, 10);
  assert.match(host.element('rows').textContent, /200万 ▲/);
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 04:00:00');
});

test('user completes a CMC request in the background and returns to its updated snapshot', { timeout: 5_000 }, async t => {
  // Given mapping is complete while the first CMC detail request is pending
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  host.network.requests[0].respond({ data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] });
  const detail = await host.network.waitForRequest(request => request.url.pathname.endsWith('/detail'));

  // When the detail and holder requests complete after hiding the tab
  host.setHidden(true);
  detail.respond({ data: cmcDetail() });
  const holders = await host.network.waitForRequest(request => request.url.pathname.endsWith('/show_holders'));
  holders.respond({ data: { showFlag: true, count: 10_000 } });
  await afterDataMediaResponseTurn();

  // Then the original request publishes its snapshot without waiting for tab activation
  assert.match(host.element('rows').textContent, /价格\$6万/);
  assert.equal(host.network.requests.length, 3);
  const rows = [...host.element('rows').children];

  // When the user returns after that background completion
  host.setHidden(false);
  host.clock.tick(0);

  // Then the same completed snapshot needs no additional request or Loading state
  assert.deepEqual([...host.element('rows').children], rows);
  assert.equal(host.network.requests.length, 3);
});

test('user receives CMC background snapshots every five minutes with a fresh foreground deadline after completion', { timeout: 5_000 }, async t => {
  // Given a completed CMC snapshot is kept in a hidden tab
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  await finishInitial(host, 'cmc');
  host.setHidden(true);

  // When two successive background deadlines receive new snapshots
  for (const price of [70_000, 80_000]) {
    const count = host.network.requests.length;
    host.clock.tick(299_999);
    assert.equal(host.network.requests.length, count);
    host.clock.tick(1);
    await afterDataMediaResponseTurn();
    assert.equal(host.network.requests.length, count + 1);
    await completeCmcData(host, cmcDetail({ statistics: { ...cmcDetail().statistics, price } }), { map: false });
    await afterDataMediaResponseTurn();
  }
  host.setHidden(false);
  host.clock.tick(29_999);

  // Then background updates cost one request chain per deadline and stay fresh on return
  assert.equal(host.network.requests.length, 7);
  assert.match(host.element('rows').textContent, /价格\$8万/);
  host.clock.tick(1);
  await afterDataMediaResponseTurn();
  assert.equal(host.network.requests.length, 8);
});

test('user keeps trading history on five-minute boundaries while current funding refreshes once per background minute', { timeout: 5_000 }, async t => {
  // Given trading data is fully loaded before the tab becomes hidden
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  host.setHidden(true);

  // When five background minutes elapse with completed current funding requests
  for (let minute = 1; minute <= 5; minute++) {
    host.clock.tick(59_999);
    assert.equal(fundingRequests(host).length, minute);
    host.clock.tick(1);
    assert.equal(fundingRequests(host).length, minute + 1);
    await finishCurrentFunding(host);
  }
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
  host.clock.tick(4_999);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
  host.clock.tick(1);
  await completeTradingBatch(host, tradingDataset(Date.now(), { oi: 3_000_000 }));
  await afterDataMediaResponseTurn();

  // Then one historical cycle publishes after its existing five-second boundary delay
  assert.equal(fundingRequests(host).length, 6);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 14);
  assert.match(host.element('rows').textContent, /300万 ▲/);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/time')).length, 1);
});

test('user resumes the trading countdown immediately without drawing it every background second', { timeout: 5_000 }, async t => {
  // Given the displayed current funding has a calibrated four-hour countdown
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  const countdown = read(host, 'funding-countdown');
  const updated = read(host, 'updated-at').textContent;

  // When the tab spends ten seconds hidden and then becomes visible
  host.setHidden(true);
  host.clock.tick(10_000);
  assert.equal(countdown.textContent, '倒计时 04:00:00');
  host.setHidden(false);

  // Then elapsed time is reflected immediately without changing data provenance
  assert.equal(countdown.textContent, '倒计时 03:59:50');
  assert.equal(read(host, 'elapsed').textContent, '10秒前');
  assert.equal(read(host, 'updated-at').textContent, updated);
  assert.equal(host.network.requests.length, 10);
});

test('user keeps a CMC failure visible across tab switches until the next refresh is due', { timeout: 5_000 }, async t => {
  // Given the first CMC mapping request has reported a concrete network failure
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  host.network.requests[0].fail('error');
  await afterDataMediaResponseTurn();
  const error = host.element('rows').textContent;
  assert.match(error, /CMC API request failed/);

  // When repeated tab switches take place during the failed request's cooldown
  for (let index = 0; index < 10; index++) {
    host.setHidden(true);
    host.clock.tick(1_000);
    host.setHidden(false);
    host.clock.tick(0);
  }

  // Then visibility cannot erase the failure or generate an immediate retry loop
  assert.equal(host.element('rows').textContent, error);
  assert.equal(host.network.requests.length, 1);
  host.clock.tick(19_999);
  assert.equal(host.network.requests.length, 1);
  host.clock.tick(1);
  assert.equal(host.network.requests.length, 2);
});

test('user keeps funding failure provenance across tab switches until its retry deadline', { timeout: 5_000 }, async t => {
  // Given a displayed rate remains cached after the scheduled funding request fails
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  host.clock.tick(15_000);
  fundingRequests(host).at(-1).respond({}, 403);
  await afterDataMediaResponseTurn();

  // When the user switches tabs repeatedly within the fifteen-second cooldown
  for (let index = 0; index < 10; index++) {
    host.setHidden(true);
    host.clock.tick(1_000);
    host.setHidden(false);
    host.clock.tick(0);
  }

  // Then the cache reason and rate stay visible without another clock or historical request
  assert.equal(read(host, 'current-funding').textContent, '0.00378%');
  assert.equal(read(host, 'funding-status').textContent, '缓存 · 更新失败');
  assert.match(read(host, 'funding-status').title, /HTTP 403/);
  assert.equal(fundingRequests(host).length, 2);
  assert.equal(host.network.requests.length, 11);
  host.clock.tick(4_999);
  assert.equal(fundingRequests(host).length, 2);
  host.clock.tick(1);
  assert.equal(fundingRequests(host).length, 3);
});

test('user preserves the pending historical retry deadline across visibility changes', { timeout: 5_000 }, async t => {
  // Given one period endpoint is delayed and scheduled to retry ten seconds after the first attempt
  const host = createDataPanelHost(t, 'trading');
  const previous = tradingDataset(Date.now() - 300_000);
  await host.start();
  await activateTradingData(host, previous);
  host.clock.tick(5_000);
  const partial = tradingDataset(Date.now());
  partial.basis = previous.basis;
  await completeTradingBatch(host, partial);
  await afterDataMediaResponseTurn();

  // When the user repeatedly hides and returns before the pending retry is due
  for (let index = 0; index < 9; index++) {
    host.setHidden(true);
    host.clock.tick(1_000);
    host.setHidden(false);
    host.clock.tick(0);
  }
  host.clock.tick(999);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 14);
  host.clock.tick(1);

  // Then the existing deadline retries only the delayed endpoint without restarting a full batch
  const pending = host.network.requests.filter(request => !request.settled && isTradingHistoryRequest(request));
  assert.deepEqual(pending.map(request => request.url.pathname), ['/futures/data/basis']);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/time')).length, 1);
});

test('user waits for the latest publication window after background timers are delayed across multiple periods', { timeout: 5_000 }, async t => {
  // Given an active historical schedule is retained while the tab is hidden
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  host.setHidden(true);

  // When browser scheduling resumes one second into a much later five-minute period
  host.clock.tick(1_201_000);
  await afterDataMediaResponseTurn();
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
  host.clock.tick(3_999);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
  host.clock.tick(1);

  // Then only the latest period receives one complete batch after its five-second publication delay
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 14);
  await completeTradingBatch(host, tradingDataset(Date.now(), { oi: 3_000_000 }));
  await afterDataMediaResponseTurn();
  assert.match(host.element('rows').textContent, /300万 ▲/);
});

test('user discards a historical response from an expired background cycle and fetches the current period once', { timeout: 5_000 }, async t => {
  // Given a five-minute refresh is pending after an earlier snapshot has rendered
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  const updated = read(host, 'updated-at').textContent;
  host.clock.tick(305_000);
  const pending = host.network.requests.filter(request => !request.settled && isTradingHistoryRequest(request));
  const old = tradingDataset(Date.now(), { oi: 9_000_000 });
  host.setHidden(true);

  // When the old response arrives only after its entire publication window has expired
  host.clock.tick(300_000);
  pending.forEach(request => request.respond(old[request.url.pathname.split('/').at(-1)]));
  await afterDataMediaResponseTurn();

  // Then obsolete data cannot advance the displayed snapshot's timestamp or replace its values
  assert.equal(read(host, 'updated-at').textContent, updated);
  assert.match(host.element('rows').textContent, /200万 ▲/);
  host.clock.tick(0);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 21);
});

test('user schedules CMC refresh from request completion instead of repeatedly resetting or overlapping a slow response', { timeout: 5_000 }, async t => {
  // Given initial mapping succeeds but its snapshot takes five seconds to finish
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  host.network.requests[0].respond({ data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] });
  await host.network.waitForRequest(request => request.url.pathname.endsWith('/detail'));
  host.clock.tick(5_000);
  await completeCmcData(host, cmcDetail(), { map: false });
  await afterDataMediaResponseTurn();

  // When the tab is hidden and shown during the next completion-based interval
  host.setHidden(true);
  host.clock.tick(29_999);
  host.setHidden(false);
  host.clock.tick(0);
  await afterDataMediaResponseTurn();

  // Then a completed snapshot stays fresh for thirty seconds despite the slow initial request
  assert.equal(host.network.requests.length, 3);
  host.clock.tick(1);
  await afterDataMediaResponseTurn();
  assert.equal(host.network.requests.length, 4);
});

test('user discards an initial history batch delayed beyond its publication window', { timeout: 5_000 }, async t => {
  // Given calibration has completed but the first historical batch is still pending
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  host.network.requests[0].respond({ serverTime: Date.now() });
  await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
  const pending = host.network.requests.filter(isTradingHistoryRequest);
  const old = tradingDataset(Date.now(), { oi: 9_000_000 });
  const initial = host.element('rows').querySelector('[data-metric="oi"] .td-number').textContent;

  // When initial history arrives after the background tab has crossed two publication windows
  host.setHidden(true);
  host.clock.tick(605_000);
  pending.forEach(request => request.respond(old[request.url.pathname.split('/').at(-1)]));
  await afterDataMediaResponseTurn();

  // Then the late batch cannot certify a fresh snapshot and only the current window is requested
  assert.equal(host.element('rows').querySelector('[data-metric="oi"] .td-number').textContent, initial);
  assert.equal(read(host, 'updated-at').textContent, '等待数据');
  host.clock.tick(0);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 14);
});

test('user immediately loses an expired current funding quote on returning from a hidden settlement boundary', { timeout: 5_000 }, async t => {
  // Given the latest authoritative funding quote expires in two seconds
  const host = createDataPanelHost(t, 'trading');
  const dataset = tradingDataset(Date.now());
  dataset.premiumIndex.nextFundingTime = Date.now() + 2_000;
  await host.start();
  await activateTradingData(host, dataset);
  const history = host.panel().querySelector('[data-metric="funding"] svg');
  const updated = read(host, 'updated-at').textContent;

  // When settlement passes while hidden and the user returns before another quote is due
  host.setHidden(true);
  host.clock.tick(3_000);
  host.setHidden(false);

  // Then the old quote is immediately withdrawn without fabricating a new period or replacing history
  assert.equal(read(host, 'current-funding').textContent, '--');
  assert.equal(read(host, 'funding-countdown').textContent, '倒计时 等待更新');
  assert.equal(host.panel().querySelector('[data-metric="funding"] svg'), history);
  assert.equal(read(host, 'updated-at').textContent, updated);
  assert.equal(host.network.requests.length, 10);
});

for (const phase of ['initial', 'periodic']) {
  test(`user rejects an old ${phase} trading response after a background language change precedes route detection`, { timeout: 5_000 }, async t => {
    // Given Binance retained a native history method and one Chinese-path history batch is pending
    const host = createDataPanelHost(t, 'trading');
    const nativePushState = host.window.history.pushState;
    await host.start();
    if (phase === 'initial') {
      host.network.requests[0].respond({ serverTime: Date.now() });
      await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
    } else {
      await activateTradingData(host);
      host.clock.tick(305_000);
    }
    const pending = host.network.requests.filter(request => !request.settled && isTradingHistoryRequest(request));
    assert.equal(pending.length, 7);
    const previousValue = host.element('rows').querySelector('[data-metric="oi"] .td-number').textContent;
    const updated = read(host, 'updated-at').textContent;
    host.setHidden(true);

    // When the host replaces the patched method and the old response returns before the route watchdog
    host.window.history.pushState = nativePushState;
    host.navigate('/en/futures/BTCUSDT');
    const old = tradingDataset(Date.now(), { oi: 9_000_000 });
    pending.forEach(request => request.respond(old[request.url.pathname.split('/').at(-1)]));
    await afterDataMediaResponseTurn();

    // Then old-path results cannot update values or freshness even though the symbol still matches
    assert.equal(host.element('rows').querySelector('[data-metric="oi"] .td-number').textContent, previousValue);
    assert.equal(read(host, 'updated-at').textContent, updated);

    // When the retained watchdog discovers the new path and its requests complete
    host.clock.tick(5_000);
    await activateTradingData(host, tradingDataset(Date.now(), { oi: 3_000_000 }));

    // Then the new path owns English data and subsequent returns do not reinitialize it
    assert.equal(host.element('rows').querySelector('[data-metric="oi"] .td-number').textContent, '3M ▲');
    assert.equal(host.element('close').getAttribute('aria-label'), 'Close');
    const count = host.network.requests.length;
    host.setHidden(false);
    host.clock.tick(0);
    assert.equal(host.network.requests.length, count);
  });
}
