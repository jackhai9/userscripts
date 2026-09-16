import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDataPanelHost, tradingDataset, completeTradingBatch, cmcDetail, completeCmcData,
} from '../helpers/data-media-migration-host.js';

async function activateTrading(host, dataset = tradingDataset(Date.now()), options) {
  const time = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/time'));
  time.respond({ serverTime: Date.now() });
  await completeTradingBatch(host, dataset, options);
  await host.rendered(panel => panel?.querySelector('[data-role="updated-at"]')?.textContent.startsWith('更新于'));
}

for (const scenario of [
  { name: 'long', values: {}, oi: '2.00M ▲', composite: '偏多 7:0' },
  { name: 'short', values: { oi: 2_000, previousOi: 4_000, ratio: 0.5, basis: -0.01, funding: 0.0002 }, oi: '2K ▼', composite: '偏空 0:7' },
  { name: 'neutral', values: { oi: 50, previousOi: 50, ratio: 1, basis: 0, funding: 0, supply: 0 }, oi: '50.00', composite: '中性 0:0' },
  { name: 'billion', values: { oi: 2_000_000_000 }, oi: '2.00B ▲', composite: '偏多 7:0' },
]) {
  test(`user sees ${scenario.name} indicators and the corresponding fresh directional votes`, { timeout: 5_000 }, async t => {
    // Given a futures page with complete data for one directional scenario
    const host = createDataPanelHost(t, 'trading');
    const dataset = tradingDataset(Date.now(), scenario.values);

    // When the complete installed script receives all seven endpoint responses
    await host.start();
    await activateTrading(host, dataset);

    // Then the visible quantities, votes, and endpoint parameters match that data
    assert.match(host.element('rows').textContent, new RegExp(scenario.oi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(host.element('composite').textContent, new RegExp(scenario.composite));
    assert.equal(host.element('symbol').textContent, 'BTCUSDT');
    assert.equal(host.element('rows').children.length, 8);
    const basisRequest = host.network.requests.find(request => request.url.pathname.endsWith('/basis'));
    assert.equal(basisRequest.url.searchParams.get('pair'), 'BTCUSDT');
    assert.equal(basisRequest.url.searchParams.get('contractType'), 'PERPETUAL');
    assert.equal(basisRequest.url.searchParams.get('period'), '5m');
  });
}

test('user sees missing endpoint data explicitly and receives no retry for client errors', { timeout: 5_000 }, async t => {
  // Given all endpoints return a deterministic 400 error for the current symbol
  const host = createDataPanelHost(t, 'trading');
  const dataset = tradingDataset(Date.now());
  const statuses = Object.fromEntries(Object.keys(dataset).map(key => [key, 400]));

  // When the first complete fetch fails at each endpoint
  await host.start();
  await activateTrading(host, dataset, { status: statuses });

  // Then missing rows remain visible and cannot contribute directional votes
  assert.equal([...host.element('rows').children].every(row => row.children[1].textContent === '--'), true);
  assert.match(host.element('composite').textContent, /中性 0:0/);
  assert.equal(host.network.requests.length, 8);
  assert.equal(host.errors.length, 7);
});

test('user sees cached rows without their directional votes after a failed refresh', { timeout: 5_000 }, async t => {
  // Given a completed bullish fetch with data available in the current-symbol cache
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTrading(host);
  host.setHidden(true);

  // When returning to the page encounters failures for every endpoint
  host.setHidden(false);
  const dataset = tradingDataset(Date.now());
  await activateTrading(host, dataset, { status: Object.fromEntries(Object.keys(dataset).map(key => [key, 400])) });
  await host.rendered(() => host.element('composite').textContent.includes('中性 0:0'));

  // Then cached values are retained with hollow markers and no fresh votes
  assert.match(host.element('rows').textContent, /2\.00M ▲/);
  assert.equal([...host.element('rows').children].every(row => row.lastElementChild.style.background === 'transparent'), true);
  assert.match(host.element('composite').textContent, /中性 0:0/);
});

test('user receives one retry for transient endpoint errors and then sees fresh data', { timeout: 5_000 }, async t => {
  // Given a trading panel whose first endpoint request has a server failure
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const time = await host.network.waitForRequest(request => request.url.pathname.endsWith('/time'));
  time.respond({ serverTime: Date.now() });
  const dataset = tradingDataset(Date.now());

  // When the initial request fails and its single recovery request succeeds
  await completeTradingBatch(host, dataset, { status: { openInterestHist: 503 } });
  const retry = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/openInterestHist'));
  retry.respond(dataset.openInterestHist);
  await host.rendered(panel => panel?.querySelector('[data-role="updated-at"]')?.textContent.startsWith('更新于'));

  // Then the rendered value is fresh and exactly two calls targeted that endpoint
  assert.match(host.element('rows').textContent, /2\.00M ▲/);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/openInterestHist')).length, 2);
  assert.match(host.element('composite').textContent, /偏多 7:0/);
});

test('user sees the current period fetched only after the server boundary delay', { timeout: 5_000 }, async t => {
  // Given the page opens exactly on a five-minute boundary with the previous period
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  await activateTrading(host, tradingDataset(Date.now() - 300_000));
  const previousCount = host.network.requests.length;

  // When virtual time approaches and then reaches the five-second publication delay
  host.clock.tick(4_999);
  assert.equal(host.network.requests.length, previousCount);
  host.clock.tick(1);
  await completeTradingBatch(host, tradingDataset(Date.now(), { ratio: 0.5 }));
  await host.rendered(() => host.element('composite').textContent.includes('偏空 3:4'));

  // Then one new batch updates the votes and highlights the changed ratios
  assert.equal(host.network.requests.length, previousCount + 7);
  assert.match(host.element('composite').textContent, /偏空 3:4/);
  assert.equal(host.element('rows').querySelectorAll('.jh-td-flash').length, 4);
});

for (const kind of ['trading', 'cmc']) {
  test(`user activates the ${kind} panel only on a trading route and retains their collapse choice`, { timeout: 5_000 }, async t => {
    // Given an idle wallet route with an existing saved collapsed preference
    const prefix = kind === 'trading' ? 'jh_binance_trading_data' : 'jh_binance_cmc_data';
    const host = createDataPanelHost(t, kind, { path: '/zh-CN/futures', storage: { [`${prefix}_collapsed`]: '1', [`${prefix}_pos`]: '{invalid' } });
    await host.start();
    assert.equal(host.panel(), null);
    assert.equal(host.network.requests.length, 0);

    // When navigation enters a trading route and the upstream data arrives
    host.navigate('/zh-CN/futures/BTCUSDT');
    if (kind === 'trading') await activateTrading(host);
    else await completeCmcData(host);
    assert.equal(host.element('body').style.display, 'none');
    host.element('collapse').click();

    // Then expanding is persisted and leaving the trading route removes the panel
    assert.equal(host.element('body').style.display, 'block');
    assert.equal(host.window.localStorage.getItem(`${prefix}_collapsed`), '0');
    host.element('collapse').click();
    assert.equal(host.window.localStorage.getItem(`${prefix}_collapsed`), '1');
    host.navigate('/zh-CN/my/wallet/futures/overview');
    assert.equal(host.panel(), null);
    const count = host.network.requests.length;
    host.clock.tick(60_000);
    assert.equal(host.network.requests.length, count);
  });

  test(`user closes the ${kind} panel without visibility or route events restarting it`, { timeout: 5_000 }, async t => {
    // Given a running panel with one completed data refresh
    const host = createDataPanelHost(t, kind);
    await host.start();
    if (kind === 'trading') await activateTrading(host);
    else await completeCmcData(host);

    // When the user closes it, hides the document, and navigates while returning
    host.element('close').click();
    const count = host.network.requests.length;
    host.setHidden(true);
    host.navigate('/zh-CN/futures/ETHUSDT');
    host.setHidden(false);
    host.clock.tick(3_600_000);

    // Then it remains closed and none of the business timers request more data
    assert.equal(host.panel().style.display, 'none');
    assert.equal(host.network.requests.length, count);
  });

  test(`user drags the ${kind} panel within the viewport and stops dragging after route removal`, { timeout: 5_000 }, async t => {
    // Given a visible panel with a valid persisted position
    const prefix = kind === 'trading' ? 'jh_binance_trading_data' : 'jh_binance_cmc_data';
    const host = createDataPanelHost(t, kind, { storage: { [`${prefix}_pos`]: '{"left":40,"top":80}' } });
    await host.start();
    if (kind === 'trading') await activateTrading(host);
    else await completeCmcData(host);
    const panel = host.panel();
    const mouse = (target, type, x, y) => target.dispatchEvent(new host.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

    // When dragging updates the position and navigation removes the panel
    mouse(host.element('header'), 'mousedown', 10, 10);
    mouse(host.document, 'mousemove', 100, 120);
    mouse(host.document, 'mousemove', 130, 150);
    host.clock.tick(16);
    mouse(host.document, 'mouseup', 130, 150);
    host.window.dispatchEvent(new host.window.Event('beforeunload'));
    host.window.dispatchEvent(new host.window.Event('resize'));
    const beforeRemoval = panel.style.cssText;
    host.navigate('/zh-CN/futures');
    mouse(host.document, 'mousemove', 500, 600);
    mouse(host.document, 'mouseup', 500, 600);

    // Then the retained detached element no longer responds to drag events
    assert.equal(host.panel(), null);
    assert.equal(panel.style.cssText, beforeRemoval);
    assert.deepEqual(Object.keys(JSON.parse(host.window.localStorage.getItem(`${prefix}_pos`))).sort(), ['left', 'top']);
  });
}

test('user sees CMC API provenance and all valuation rows after a deterministic asset mapping', { timeout: 5_000 }, async t => {
  // Given a Bitcoin futures route with a unique active CMC mapping
  const host = createDataPanelHost(t, 'cmc');

  // When the complete installed script receives map, detail, and holder responses
  await host.start();
  await completeCmcData(host);

  // Then values, ranking, holder count, and source appear in the real panel DOM
  assert.equal(host.element('symbol').textContent, 'BTC #1');
  assert.equal(host.element('rows').children.length, 12);
  assert.match(host.element('rows').textContent, /流通市值\$1\.2万亿-1\.00%/);
  assert.match(host.element('rows').textContent, /持有者1万/);
  assert.match(host.element('rows').textContent, /Profile score85%/);
  assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/zh/currencies/bitcoin/');
  assert.match(host.element('footer').textContent, /CMC data-api/);
});

for (const scenario of [
  { name: 'missing', rows: [], error: 'CMC symbol not found: BTC' },
  { name: 'ambiguous', rows: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }, { id: 2, symbol: 'BTC', slug: 'other', is_active: 1 }], error: 'CMC symbol ambiguous: BTC' },
  { name: 'inactive', rows: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 0 }], error: 'CMC symbol not found: BTC' },
]) {
  test(`user sees an explicit error for a ${scenario.name} CMC asset mapping`, { timeout: 5_000 }, async t => {
    // Given the current symbol has no single valid mapping response
    const host = createDataPanelHost(t, 'cmc');

    // When the map endpoint returns the specified candidate set
    await host.start();
    const request = await host.network.waitForRequest(request => request.url.pathname.endsWith('/map'));
    request.respond({ data: scenario.rows });
    await host.rendered(() => host.element('rows').textContent.includes(scenario.error));

    // Then the panel reports that exact reason without choosing another asset
    assert.equal(host.element('rows').textContent, `读取失败${scenario.error}`);
    assert.equal(host.network.requests.length, 1);
  });
}

for (const outcome of ['http', 'network', 'timeout', 'json', 'statistics']) {
  test(`user sees page-snapshot provenance when the CMC API has a ${outcome} failure`, { timeout: 5_000 }, async t => {
    // Given the RAVE override resolves directly to its documented asset
    const host = createDataPanelHost(t, 'cmc', { path: '/futures/RAVEUSDT' });
    const detail = cmcDetail({ id: 38967, symbol: 'RAVE', showTreasuriesFlag: true, treasuryHoldings: 1200 });

    // When the API fails and the page snapshot supplies valid detail statistics
    await host.start();
    const api = await host.network.waitForRequest(request => request.url.pathname.endsWith('/detail'));
    if (outcome === 'http') api.respond({}, 503);
    else if (outcome === 'network') api.fail('error');
    else if (outcome === 'timeout') api.fail('timeout');
    else if (outcome === 'json') api.respond('{invalid');
    else api.respond({ data: {} });
    const page = await host.network.waitForRequest(request => request.url.hostname === 'coinmarketcap.com');
    page.respond(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { detailRes: { detail } } } })}</script>`);
    await host.rendered(() => host.element('footer').textContent.includes('CMC 页面快照'));

    // Then the source remains visibly a page snapshot and the override bypasses mapping
    assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/zh/currencies/ravedao/');
    assert.match(host.element('rows').textContent, /金库资产1200 RAVE/);
    assert.equal(host.network.requests.length, 2);
  });
}

test('user can refresh CMC data from the cached asset mapping without losing their current rows', { timeout: 5_000 }, async t => {
  // Given one successful refresh with a cached symbol mapping
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  await completeCmcData(host);
  const previousRows = host.element('rows').textContent;

  // When a scheduled refresh starts and receives updated market statistics
  host.clock.tick(30_000);
  assert.equal(host.element('rows').textContent, previousRows);
  const detail = cmcDetail({ profileCompletionScore: 95, holders: { holderCount: 50 } });
  detail.statistics.price = -123;
  detail.statistics.rank = 'unknown';
  await completeCmcData(host, detail, { map: false, holder: { showFlag: false } });
  await host.rendered(() => host.element('rows').textContent.includes('-$123'));

  // Then the new value appears and no second map request was made
  assert.match(host.element('rows').textContent, /价格-\$123/);
  assert.equal(host.element('symbol').textContent, 'BTC');
  assert.match(host.element('rows').textContent, /Profile score95%/);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/map')).length, 1);
});
