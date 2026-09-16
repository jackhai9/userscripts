import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, completeCmcData,
  completeTradingBatch, createDataPanelHost, cmcDetail, tradingDataset,
} from '../helpers/data-media-migration-host.js';

async function finishInitial(host, kind) {
  if (kind === 'trading') await activateTradingData(host);
  else await completeCmcData(host);
}

for (const kind of ['trading', 'cmc']) {
  test(`user starts the hidden ${kind} panel only after returning to the tab`, { timeout: 5_000 }, async t => {
    // Given installation occurs on the current trading route while the document is hidden
    const host = createDataPanelHost(t, kind, { hidden: true });
    await host.start();
    host.clock.tick(60_000);
    assert.equal(host.network.requests.length, 0);
    assert.equal(host.panel(), null);

    // When the document becomes visible without any route change
    host.setHidden(false);
    await finishInitial(host, kind);

    // Then the current Bitcoin panel renders one initial request batch
    assert.match(host.element('symbol').textContent, /^BTC/);
    assert.equal(host.document.querySelectorAll(`#${host.panelId}`).length, 1);
    assert.equal(host.network.requests.length, kind === 'trading' ? 8 : 3);
  });

  test(`user operates a ${kind} header control without dragging or saving a new position`, { timeout: 5_000 }, async t => {
    // Given a rendered panel retains its existing viewport position
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);
    const panel = host.panel();
    const position = panel.style.cssText;
    const positionKey = kind === 'trading' ? 'jh_binance_trading_data_pos' : 'jh_binance_cmc_data_pos';
    const savedPosition = host.window.localStorage.getItem(positionKey);
    const collapse = host.element('collapse');

    // When idle pointer events and a collapse-button press are followed by pointer movement
    host.document.dispatchEvent(new host.window.MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
    host.document.dispatchEvent(new host.window.MouseEvent('mouseup'));
    collapse.dispatchEvent(new host.window.MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    host.document.dispatchEvent(new host.window.MouseEvent('mousemove', { clientX: 400, clientY: 400 }));
    host.document.dispatchEvent(new host.window.MouseEvent('mouseup'));
    collapse.click();
    host.clock.tick(16);

    // Then the control collapses content while the panel position remains exactly unchanged
    assert.equal(host.element('body').style.display, 'none');
    assert.equal(panel.style.cssText, position);
    assert.equal(host.window.localStorage.getItem(positionKey), savedPosition);
  });

  test(`user stops dragging a removed ${kind} panel when its route becomes inactive`, { timeout: 5_000 }, async t => {
    // Given a fully rendered panel whose header has started a drag
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);
    const panel = host.panel();
    host.element('header').dispatchEvent(new host.window.MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));

    // When leaving the route removes the panel before the next pointer movement
    host.navigate('/zh-CN/futures');
    const position = panel.style.cssText;
    host.document.dispatchEvent(new host.window.MouseEvent('mousemove', { clientX: 400, clientY: 400 }));
    host.document.dispatchEvent(new host.window.MouseEvent('mouseup'));
    host.clock.tick(16);

    // Then detached drag handlers cannot alter the removed panel
    assert.equal(host.panel(), null);
    assert.equal(panel.style.cssText, position);
  });

  test(`user keeps later saved positions after the ${kind} panel removes its unload listener`, { timeout: 5_000 }, async t => {
    // Given a rendered panel with its normal unload persistence listener
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);
    const positionKey = kind === 'trading' ? 'jh_binance_trading_data_pos' : 'jh_binance_cmc_data_pos';

    // When the panel is removed and another valid position is saved before unloading
    host.navigate('/zh-CN/futures');
    host.window.localStorage.setItem(positionKey, '{"left":700,"top":300}');
    host.window.dispatchEvent(new host.window.Event('beforeunload'));

    // Then the old panel cannot overwrite the later persisted position
    assert.equal(host.window.localStorage.getItem(positionKey), '{"left":700,"top":300}');
  });

  test(`user pauses ${kind} business requests off-route and can return through the retained route watcher`, { timeout: 5_000 }, async t => {
    // Given a completed panel refresh on the current trading route
    const host = createDataPanelHost(t, kind);
    await host.start();
    await finishInitial(host, kind);

    // When the user leaves trading, waits through business deadlines, and returns
    host.navigate('/zh-CN/my/wallet/futures/overview');
    const beforePause = host.network.requests.length;
    host.clock.tick(3_600_000);
    assert.equal(host.network.requests.length, beforePause);
    assert.equal(host.panel(), null);
    host.navigate('/zh-CN/futures/BTCUSDT');
    if (kind === 'trading') await activateTradingData(host);
    else await completeCmcData(host, cmcDetail(), { map: false });

    // Then a new current-symbol refresh renders after route reactivation
    assert.equal(host.panel().style.width, '240px');
    assert.match(host.element('symbol').textContent, /^BTC/);
    assert.ok(host.network.requests.length > beforePause);
  });

  test(`user can open the ${kind} panel after a hidden non-trading cold start`, { timeout: 5_000 }, async t => {
    // Given installation occurs in a hidden document on the futures landing route
    const host = createDataPanelHost(t, kind, { path: '/zh-CN/futures', hidden: true });
    await host.start();
    host.clock.tick(60_000);
    assert.equal(host.network.requests.length, 0);

    // When the user returns to the tab and enters a supported trading route
    host.setHidden(false);
    assert.equal(host.network.requests.length, 0);
    host.navigate('/zh-CN/futures/BTCUSDT');
    await finishInitial(host, kind);

    // Then the route watcher creates exactly one correctly identified panel
    assert.equal(host.document.querySelectorAll(`#${host.panelId}`).length, 1);
    assert.match(host.element('symbol').textContent, /^BTC/);
  });

  test(`user sees compact ${kind} row layout in the generated panel DOM`, { timeout: 5_000 }, async t => {
    // Given the complete installed entrypoint runs on a futures page
    const host = createDataPanelHost(t, kind);
    await host.start();

    // When all initial data requests complete
    await finishInitial(host, kind);
    const firstRow = host.element('rows').firstElementChild;

    // Then the actual styles reserve stable label and value space inside 240 pixels
    assert.equal(host.panel().style.width, '240px');
    assert.equal(firstRow.children[1].style.fontVariantNumeric, 'tabular-nums');
    assert.equal(firstRow.children[1].style.textAlign, 'right');
    if (kind === 'trading') {
      assert.equal(firstRow.children[0].style.minWidth, '90px');
      assert.equal(firstRow.children[1].style.flex, '1 1 0%');
    } else {
      assert.equal(firstRow.children[0].style.overflow, 'hidden');
      assert.equal(firstRow.children[0].style.textOverflow, 'ellipsis');
      assert.equal(firstRow.children[1].style.whiteSpace, 'nowrap');
      assert.equal(firstRow.children[1].style.flex, '0 0 auto');
    }
  });

  test(`user keeps the new symbol when a superseded ${kind} response arrives late`, { timeout: 5_000 }, async t => {
    // Given the original Bitcoin request remains pending while the user changes symbol
    const host = createDataPanelHost(t, kind);
    await host.start();
    if (kind === 'trading') {
      host.network.requests[0].respond({ serverTime: Date.now() });
      await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
    }

    // When Ethereum renders before the old Bitcoin request is allowed to finish
    host.navigate('/zh-CN/futures/ETHUSDT');
    if (kind === 'trading') {
      await activateTradingData(host, tradingDataset(Date.now(), { oi: 3000 }), { symbol: 'ETHUSDT' });
      await completeTradingBatch(host, tradingDataset(Date.now()), { symbol: 'BTCUSDT' });
    } else {
      await completeCmcData(host, cmcDetail({ id: 2, symbol: 'ETH' }), { symbol: 'ETH', slug: 'ethereum' });
      await completeCmcData(host);
    }
    await afterDataMediaResponseTurn();

    // Then the late response cannot replace the displayed Ethereum identity or data
    assert.match(host.element('symbol').textContent, /^ETH/);
    if (kind === 'trading') assert.match(host.element('rows').textContent, /3K ▼/);
    else assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/zh/currencies/ethereum/');
  });
}

for (const state of ['hidden', 'off-route']) {
  test(`user starts no trading data batch when server synchronization finishes after becoming ${state}`, { timeout: 5_000 }, async t => {
    // Given the initial server-time request is still pending before the panel mounts
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    const timeRequest = host.network.requests[0];
    assert.equal(host.panel(), null);

    // When the route or document becomes inactive before synchronization completes
    if (state === 'hidden') host.setHidden(true);
    else host.navigate('/zh-CN/futures');
    timeRequest.respond({ serverTime: Date.now() });
    await afterDataMediaResponseTurn();
    host.clock.tick(60_000);

    // Then synchronization cannot mount a panel or start any period endpoints
    assert.equal(host.panel(), null);
    assert.deepEqual(host.network.requests.map(request => request.url.pathname), ['/fapi/v1/time']);
  });
}

for (const state of ['closed', 'hidden', 'off-route']) {
  test(`user receives no late CMC error after the loading panel becomes ${state}`, { timeout: 5_000 }, async t => {
    // Given the CMC panel is waiting for its initial asset mapping
    const host = createDataPanelHost(t, 'cmc');
    await host.start();
    const mapping = host.network.requests[0];
    const rows = host.element('rows');
    const before = rows.innerHTML;
    const panel = host.panel();

    // When the panel becomes inactive before the mapping reports failure
    if (state === 'closed') host.element('close').click();
    else if (state === 'hidden') host.setHidden(true);
    else host.navigate('/zh-CN/futures');
    mapping.fail('error');
    await afterDataMediaResponseTurn();

    // Then the abandoned loading state is not rewritten as a current request failure
    assert.equal(rows.innerHTML, before);
    assert.equal(panel.isConnected, state !== 'off-route');
    assert.equal(host.network.requests.length, 1);
    if (state === 'closed') assert.equal(panel.style.display, 'none');
  });
}

for (const state of ['closed', 'hidden', 'off-route', 'new symbol']) {
  test(`user ignores an old trading cycle response after entering ${state}`, { timeout: 5_000 }, async t => {
    // Given an already-rendered panel has started the next scheduled five-minute refresh
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    await activateTradingData(host);
    host.clock.tick(305_000);
    await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/fundingRate'));
    const oldRequests = host.network.requests.filter(request => !request.settled);
    assert.equal(oldRequests.length, 7);
    const oldPanel = host.panel();
    const oldRows = host.element('rows');

    // When lifecycle invalidation or a symbol change precedes the old cycle completion
    if (state === 'closed') host.element('close').click();
    else if (state === 'hidden') host.setHidden(true);
    else if (state === 'off-route') host.navigate('/zh-CN/futures');
    else {
      host.navigate('/zh-CN/futures/ETHUSDT');
      await activateTradingData(host, tradingDataset(Date.now(), { oi: 3000 }), { symbol: 'ETHUSDT' });
    }
    const rows = state === 'new symbol' ? host.element('rows') : oldRows;
    const before = rows.innerHTML;
    const stale = tradingDataset(Date.now(), { oi: 9_000_000, ratio: 0.5, basis: -0.02, funding: 0.001 });
    oldRequests.forEach(request => request.respond(stale[request.url.pathname.split('/').at(-1)]));
    await afterDataMediaResponseTurn();

    // Then the superseded scheduled batch cannot alter inactive or current-symbol rows
    assert.equal(rows.innerHTML, before);
    assert.equal(oldPanel.isConnected, state !== 'off-route');
    if (state === 'new symbol') {
      assert.match(host.element('symbol').textContent, /^ETH/);
      assert.match(rows.textContent, /3K ▼/);
    }
    if (state === 'closed') assert.equal(oldPanel.style.display, 'none');
  });
}

for (const state of ['closed', 'hidden', 'off-route']) {
  test(`user receives no stale trading render after the panel becomes ${state}`, { timeout: 5_000 }, async t => {
    // Given the panel exists but its initial data responses remain pending
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    host.network.requests[0].respond({ serverTime: Date.now() });
    await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
    const panel = host.panel();
    const rows = host.element('rows');

    // When the lifecycle is invalidated before the pending responses finish
    if (state === 'closed') host.element('close').click();
    else if (state === 'hidden') host.setHidden(true);
    else host.navigate('/zh-CN/futures');
    await completeTradingBatch(host, tradingDataset(Date.now()));
    await afterDataMediaResponseTurn();

    // Then the pending request cannot write its rows into the inactive panel
    assert.equal(rows.innerHTML, '');
    assert.equal(panel.isConnected, state !== 'off-route');
    if (state === 'closed') assert.equal(panel.style.display, 'none');
  });
}

test('user stops the trading server clock sync while the document is hidden', { timeout: 5_000 }, async t => {
  // Given one initial server-time synchronization has completed
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  const timeCount = () => host.network.requests.filter(request => request.url.pathname.endsWith('/time')).length;

  // When an hourly deadline occurs and the following hour is spent hidden
  host.clock.tick(3_600_000);
  assert.equal(timeCount(), 2);
  host.setHidden(true);
  host.clock.tick(3_600_000);

  // Then the hidden panel cannot perform another server synchronization
  assert.equal(timeCount(), 2);
});

test('user opens a correctly escaped CMC link when its asset slug contains quotes', { timeout: 5_000 }, async t => {
  // Given the API mapping returns a slug whose quotation mark must stay inside the URL
  const host = createDataPanelHost(t, 'cmc');
  await host.start();

  // When the complete data response renders that mapped asset link
  await completeCmcData(host, cmcDetail(), { slug: 'bitcoin" data-extra="unexpected' });
  const link = host.element('footer').querySelector('a');

  // Then the quote remains URL content and cannot create an extra HTML attribute
  assert.equal(link.getAttribute('href'), 'https://coinmarketcap.com/zh/currencies/bitcoin" data-extra="unexpected/');
  assert.equal(link.hasAttribute('data-extra'), false);
});
