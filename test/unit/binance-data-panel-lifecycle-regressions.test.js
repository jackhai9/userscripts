import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, completeCmcData,
  createDataPanelHost, cmcDetail, tradingDataset, isTradingHistoryRequest,
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
    assert.equal(host.network.requests.length, kind === 'trading' ? 10 : 3);
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
    host.element('header').dispatchEvent(new host.window.MouseEvent('mousedown', {
      bubbles: true, clientX: 10, clientY: 10, button: 0, buttons: 1,
    }));

    // When leaving the route removes the panel before the next pointer movement
    host.navigate('/zh-CN/futures');
    const position = panel.style.cssText;
    host.document.dispatchEvent(new host.window.MouseEvent('mousemove', { clientX: 400, clientY: 400, buttons: 1 }));
    host.document.dispatchEvent(new host.window.MouseEvent('mouseup'));
    host.clock.tick(16);

    // Then detached drag handlers cannot alter the removed panel
    assert.equal(host.panel(), null);
    assert.equal(panel.style.cssText, position);

    // When another tab's saved preference changes before the window resizes
    const positionKey = kind === 'trading' ? 'jh_binance_trading_data_pos' : 'jh_binance_cmc_data_pos';
    host.window.localStorage.setItem(positionKey, '{"left":700,"top":300}');
    host.window.dispatchEvent(new host.window.Event('resize'));

    // Then removed resize handlers cannot move the detached panel or change the newer preference
    assert.equal(panel.style.cssText, position);
    assert.equal(host.window.localStorage.getItem(positionKey), '{"left":700,"top":300}');
  });

  test(`user keeps later saved positions after the ${kind} panel is removed and the page unloads`, { timeout: 5_000 }, async t => {
    // Given a rendered panel on the active trading route
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
    assert.equal(host.panel().style.width, kind === 'trading' ? '320px' : '336px');
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

    // Then the table keeps three semantic columns and aligned tabular numeric values
    assert.equal(host.panel().style.width, kind === 'trading' ? '320px' : '336px');
    assert.equal(host.element('rows').tagName, 'TBODY');
    assert.equal(firstRow.children.length, 3);
    assert.equal(firstRow.firstElementChild.getAttribute('scope'), 'row');
    const value = firstRow.querySelector(kind === 'trading' ? '.td-value' : '.cmc-value');
    const styles = host.window.getComputedStyle(value);
    assert.equal(styles.fontVariantNumeric, 'tabular-nums');
    assert.equal(styles.textAlign, 'right');
  });

  test(`user keeps the new symbol after superseded ${kind} requests are cancelled`, { timeout: 5_000 }, async t => {
    // Given the original Bitcoin request remains pending while the user changes symbol
    const host = createDataPanelHost(t, kind);
    await host.start();
    if (kind === 'trading') {
      host.network.requests[0].respond({ serverTime: Date.now() });
      await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
    }
    const oldRequests = host.network.requests.filter(request => !request.settled);

    // When Ethereum replaces the session that owns the unfinished Bitcoin requests
    host.navigate('/zh-CN/futures/ETHUSDT');
    if (kind === 'trading') {
      await activateTradingData(host, tradingDataset(Date.now(), { symbol: 'ETHUSDT', oi: 3000 }), { symbol: 'ETHUSDT' });
    } else {
      await completeCmcData(host, cmcDetail({ id: 2, symbol: 'ETH' }), { symbol: 'ETH', slug: 'ethereum' });
    }
    await afterDataMediaResponseTurn();

    // Then cancelled work cannot replace the displayed Ethereum identity or data
    assert.equal(oldRequests.every(request => request.aborted), true);
    assert.match(host.element('symbol').textContent, /^ETH/);
    if (kind === 'trading') assert.match(host.element('rows').textContent, /3000 ▼/);
    else assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/zh/currencies/ethereum/');
  });
}

for (const state of ['closed', 'off-route']) {
  test(`user starts no trading data batch when server synchronization finishes after becoming ${state}`, { timeout: 5_000 }, async t => {
    // Given initial server time is pending while the panel shows its loading state
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    const timeRequest = host.network.requests[0];
    const panel = host.panel();

    // When the panel is closed or its route becomes inactive before synchronization completes
    if (state === 'closed') host.element('close').click();
    else host.navigate('/zh-CN/futures');
    await afterDataMediaResponseTurn();
    host.clock.tick(60_000);

    // Then cancellation prevents data requests and leaves no late render
    assert.equal(timeRequest.aborted, true);
    assert.equal(host.panel(), state === 'closed' ? panel : null);
    if (state === 'closed') assert.equal(panel.style.display, 'none');
    assert.deepEqual(host.network.requests.map(request => request.url.pathname), ['/fapi/v1/time']);
  });
}

for (const state of ['closed', 'off-route']) {
  test(`user receives no late CMC error after the loading panel becomes ${state}`, { timeout: 5_000 }, async t => {
    // Given the CMC panel is waiting for its initial asset mapping
    const host = createDataPanelHost(t, 'cmc');
    await host.start();
    const mapping = host.network.requests[0];
    const rows = host.element('rows');
    const before = rows.innerHTML;
    const panel = host.panel();

    // When a mapping failure is queued immediately before its panel becomes inactive
    mapping.fail('error');
    if (state === 'closed') host.element('close').click();
    else host.navigate('/zh-CN/futures');
    await afterDataMediaResponseTurn();

    // Then the abandoned loading state is not rewritten as a current request failure
    assert.equal(rows.innerHTML, before);
    assert.equal(panel.isConnected, state !== 'off-route');
    assert.equal(host.network.requests.length, 1);
    if (state === 'closed') assert.equal(panel.style.display, 'none');
  });
}

for (const state of ['closed', 'off-route', 'new symbol']) {
  test(`user cancels the old trading cycle after entering ${state}`, { timeout: 5_000 }, async t => {
    // Given an already-rendered panel has started the next scheduled five-minute refresh
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    await activateTradingData(host);
    host.clock.tick(305_000);
    await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/fundingRate'));
    const oldRequests = host.network.requests.filter(request => !request.settled && isTradingHistoryRequest(request));
    assert.equal(oldRequests.length, 7);
    const oldPanel = host.panel();
    const oldRows = host.element('rows');

    // When lifecycle invalidation or a symbol change precedes the old cycle completion
    if (state === 'closed') host.element('close').click();
    else if (state === 'off-route') host.navigate('/zh-CN/futures');
    else {
      host.navigate('/zh-CN/futures/ETHUSDT');
      await activateTradingData(host, tradingDataset(Date.now(), { symbol: 'ETHUSDT', oi: 3000 }), { symbol: 'ETHUSDT' });
    }
    const rows = state === 'new symbol' ? host.element('rows') : oldRows;
    const before = rows.innerHTML;
    await afterDataMediaResponseTurn();

    // Then cancellation prevents the scheduled batch from altering inactive or current-symbol rows
    assert.equal(oldRequests.every(request => request.aborted), true);
    assert.equal(rows.innerHTML, before);
    assert.equal(oldPanel.isConnected, state !== 'off-route');
    if (state === 'new symbol') {
      assert.match(host.element('symbol').textContent, /^ETH/);
      assert.match(rows.textContent, /3000 ▼/);
    }
    if (state === 'closed') assert.equal(oldPanel.style.display, 'none');
  });
}

for (const state of ['closed', 'off-route']) {
  test(`user receives no stale trading render after the panel becomes ${state}`, { timeout: 5_000 }, async t => {
    // Given the panel exists but its initial data responses remain pending
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    host.network.requests[0].respond({ serverTime: Date.now() });
    await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
    const panel = host.panel();
    const rows = host.element('rows');
    const initialRows = rows.innerHTML;
    const pending = host.network.requests.filter(request => !request.settled && isTradingHistoryRequest(request));

    // When the lifecycle is invalidated before the pending responses finish
    if (state === 'closed') host.element('close').click();
    else host.navigate('/zh-CN/futures');
    await afterDataMediaResponseTurn();

    // Then the pending request cannot write its rows into the inactive panel
    assert.equal(rows.innerHTML, initialRows);
    assert.equal(pending.length, 7);
    assert.equal(pending.every(request => request.aborted), true);
    assert.equal(panel.isConnected, state !== 'off-route');
    if (state === 'closed') assert.equal(panel.style.display, 'none');
  });
}

test('user retains hourly trading server synchronization while the document is hidden', { timeout: 5_000 }, async t => {
  // Given one initial server-time synchronization has completed
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTradingData(host);
  const timeCount = () => host.network.requests.filter(request => request.url.pathname.endsWith('/time')).length;

  // When successive hourly deadlines occur while the initialized tab remains hidden
  host.setHidden(true);
  host.clock.tick(3_600_000);
  assert.equal(timeCount(), 2);
  const request = host.network.requests.find(request => !request.settled && request.url.pathname.endsWith('/time'));
  request.respond({ serverTime: Date.now() });
  await afterDataMediaResponseTurn();
  host.clock.tick(3_600_000);

  // Then the same session maintains its hourly calibration without tab reactivation
  assert.equal(timeCount(), 3);
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
