import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, completeCmcData, completeTradingBatch,
  createDataPanelHost, cmcDetail, tradingDataset,
} from '../helpers/data-media-migration-host.js';

for (const scenario of [
  { name: 'an empty body', body: '', error: 'CMC symbol not found: BTC' },
  { name: 'a null payload', body: null, error: 'CMC symbol not found: BTC' },
  { name: 'a non-array map', body: { data: {} }, error: 'CMC symbol not found: BTC' },
  { name: 'only incomplete and inactive rows', body: { data: [null, { is_active: 1 }, { is_active: 0, symbol: 'BTC' }] }, error: 'CMC symbol not found: BTC' },
  { name: 'a matching asset without an ID', body: { data: [{ symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] }, error: '无法识别当前合约' },
  { name: 'a matching asset without a slug', body: { data: [{ id: 1, symbol: 'BTC', is_active: 1 }] }, error: '无法识别当前合约' },
]) {
  test(`user sees an explicit asset error when CMC mapping returns ${scenario.name}`, { timeout: 5_000 }, async t => {
    // Given the current contract requires one complete active asset mapping
    const host = createDataPanelHost(t, 'cmc');
    await host.start();
    const mapping = await host.network.waitForRequest(request => request.url.pathname.endsWith('/map'));

    // When the upstream mapping cannot identify a usable current asset
    mapping.respond(scenario.body);
    await host.rendered(() => host.element('rows').textContent.includes(scenario.error));

    // Then the precise failure is visible and no guessed detail or page request is issued
    assert.equal(host.element('rows').textContent, `读取失败${scenario.error}`);
    assert.equal(host.network.requests.length, 1);
    assert.equal(host.element('symbol').textContent, 'BTCUSDT');
  });
}

test('user resolves the one complete active CMC asset among incomplete unrelated rows', { timeout: 5_000 }, async t => {
  // Given the mapping endpoint returns null, inactive, and symbol-less rows beside Bitcoin
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  const mapping = await host.network.waitForRequest(request => request.url.pathname.endsWith('/map'));

  // When the one active complete mapping and its detail endpoints succeed
  mapping.respond({ data: [null, { is_active: 1 }, { id: 9, symbol: 'BTC', slug: 'inactive', is_active: 0 }, { id: 1, symbol: ' btc ', slug: ' bitcoin ', is_active: 1 }] });
  await completeCmcData(host, cmcDetail(), { map: false });

  // Then the normalized Bitcoin mapping controls the public detail request and source link
  assert.equal(host.network.requests[1].url.searchParams.get('id'), '1');
  assert.equal(host.element('symbol').textContent, 'BTC #1');
  assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/zh/currencies/bitcoin/');
  assert.equal(host.network.requests.length, 3);
});

test('user keeps valid CMC valuation data when its detail cannot identify a holder endpoint', { timeout: 5_000 }, async t => {
  // Given Bitcoin is mapped correctly but the detail response omits its holder lookup ID
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  host.network.requests[0].respond({ data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] });
  const request = await host.network.waitForRequest(request => request.url.pathname.endsWith('/detail'));
  const detail = cmcDetail({ holders: { total: 17 } });
  delete detail.id;

  // When the valid valuation statistics render without a supplemental holder request
  request.respond({ data: detail });
  await host.rendered(() => host.element('footer').textContent.includes('CMC data-api'));

  // Then the existing count and valuation rows remain usable without an invalid-ID request
  assert.match(host.element('rows').textContent, /价格\$6万/);
  assert.match(host.element('rows').textContent, /持有者17/);
  assert.equal(host.network.requests.length, 2);
  assert.equal(host.network.requests.some(request => request.url.pathname.endsWith('/show_holders')), false);
});

test('user keeps the new CMC symbol when the superseded mapping fails late', { timeout: 5_000 }, async t => {
  // Given Bitcoin mapping is pending while the user switches to Ethereum
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  const oldMapping = host.network.requests[0];
  host.navigate('/zh-CN/futures/ETHUSDT');
  await completeCmcData(host, cmcDetail({ id: 2, symbol: 'ETH' }), { symbol: 'ETH', slug: 'ethereum' });
  const rows = host.element('rows').innerHTML;
  const footer = host.element('footer').innerHTML;

  // When the old Bitcoin request reports a transport failure after Ethereum has rendered
  oldMapping.fail('error');
  await afterDataMediaResponseTurn();

  // Then the stale rejection cannot replace current rows, identity, or provenance
  assert.equal(host.element('rows').innerHTML, rows);
  assert.equal(host.element('footer').innerHTML, footer);
  assert.equal(host.element('symbol').textContent, 'ETH #1');
  assert.equal(host.network.requests.length, 4);
});

for (const scenario of [
  { name: 'HTTP rejection', respond: request => request.respond('', 403), error: 'CMC HTTP 403' },
  { name: 'network failure', respond: request => request.fail('error'), error: 'CMC request failed' },
  { name: 'timeout', respond: request => request.fail('timeout'), error: 'CMC request timeout' },
  { name: 'empty page', respond: request => request.respond(''), error: 'CMC page missing __NEXT_DATA__' },
  { name: 'absent statistics', respond: request => request.respond('<script id="__NEXT_DATA__">{"props":{"pageProps":{"detailRes":{"detail":{}}}}}</script>'), error: 'CMC page missing detail statistics' },
]) {
  test(`user sees the exact CMC page-snapshot failure after a ${scenario.name}`, { timeout: 5_000 }, async t => {
    // Given the API is unavailable for the documented RAVE asset override
    const host = createDataPanelHost(t, 'cmc', { path: '/futures/RAVEUSDT' });
    await host.start();
    const api = await host.network.waitForRequest(request => request.url.pathname.endsWith('/detail'));
    api.respond({}, 503);
    const page = await host.network.waitForRequest(request => request.url.hostname === 'coinmarketcap.com');

    // When the fallback page fails in the specified observable way
    scenario.respond(page);
    await host.rendered(() => host.element('rows').textContent.includes(scenario.error));

    // Then the original page failure reason remains visible to the user
    assert.equal(host.element('rows').textContent, `读取失败${scenario.error}`);
    assert.equal(host.network.requests.length, 2);
    assert.equal(host.element('footer').textContent, '来源：CoinMarketCap 中文页');
  });
}

for (const holderKey of ['total', 'count']) {
  test(`user sees large and negative CMC supply values with the available holder ${holderKey}`, { timeout: 5_000 }, async t => {
    // Given API details supply large token amounts and an alternate supported holder field
    const host = createDataPanelHost(t, 'cmc');
    const detail = cmcDetail({ holders: { [holderKey]: 42 }, profileCompletionScore: { percentage: 'unavailable' }, latestUpdateTime: 'unavailable' });
    Object.assign(detail.statistics, { totalSupply: 1_200_000_000_000, maxSupply: 300_000_000, circulatingSupply: -20_000 });

    // When detail data succeeds and the dedicated holder endpoint publishes no count
    await host.start();
    await completeCmcData(host, detail, { holder: { showFlag: false } });

    // Then unit formatting, negative signs, unavailable fields, and fallback holder identity are preserved
    const text = host.element('rows').textContent;
    assert.match(text, /总供应量1\.2万亿 BTC/);
    assert.match(text, /最大供应量3亿 BTC/);
    assert.match(text, /流通供应量-2万 BTC/);
    assert.match(text, /持有者42/);
    assert.match(text, /Profile score--/);
    assert.match(host.element('footer').textContent, /CMC -- \/ 拉取/);
  });
}

test('user sees explicit unavailable metrics when an otherwise valid CMC response omits statistics fields', { timeout: 5_000 }, async t => {
  // Given a valid asset detail has no optional statistic, holder, timestamp, or score fields
  const host = createDataPanelHost(t, 'cmc');
  const detail = { id: 1, statistics: {} };
  await host.start();

  // When the detail response renders with no separately published holder count
  await completeCmcData(host, detail, { holder: { showFlag: false } });

  // Then unavailable values stay visible instead of becoming directional changes or guessed quantities
  assert.equal(host.element('symbol').textContent, 'BTC');
  assert.equal([...host.element('rows').children].every(row => row.children[1].textContent === '--'), true);
  assert.match(host.element('footer').textContent, /CMC -- \/ 拉取/);
});

test('user retains CMC detail rows when the optional holder endpoint times out', { timeout: 5_000 }, async t => {
  // Given the map and detail APIs have already succeeded
  const host = createDataPanelHost(t, 'cmc', { path: '/futures/RAVEUSDT' });
  await host.start();
  host.network.requests[0].respond({ data: cmcDetail({ id: 38967, symbol: 'RAVE' }) });
  const holder = await host.network.waitForRequest(request => request.url.pathname.endsWith('/show_holders'));

  // When only the supplemental holder request times out
  holder.fail('timeout');
  await host.rendered(() => host.element('footer').textContent.includes('CMC data-api'));

  // Then the successful valuation details remain visible with an unavailable holder metric
  assert.match(host.element('rows').textContent, /流通市值\$1\.2万亿/);
  assert.match(host.element('rows').textContent, /持有者--/);
  assert.equal(host.element('symbol').textContent, 'RAVE #1');
});

test('user can force a new CMC refresh while scheduled refreshes avoid duplicating pending work', { timeout: 5_000 }, async t => {
  // Given a rendered panel has a cached asset mapping
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  await completeCmcData(host);
  const detail = cmcDetail({ showTreasuriesFlag: true, treasuryHoldings: 1 });

  // When manual refresh supersedes a pending request while the interval also becomes due
  host.element('refresh').click();
  const old = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/detail'));
  const count = host.network.requests.length;
  host.clock.tick(30_000);
  assert.equal(host.network.requests.length, count);
  host.element('refresh').click();
  const current = await host.network.waitForRequest(request => request !== old && !request.settled && request.url.pathname.endsWith('/detail'));
  current.respond({ data: { ...detail, statistics: { ...detail.statistics, price: 100 } } });
  await host.rendered(() => host.element('rows').textContent.includes('价格$100'));
  old.respond({ data: { ...detail, statistics: { ...detail.statistics, price: 50 } } });
  await afterDataMediaResponseTurn();

  // Then only the latest forced request controls the panel's visible price
  assert.match(host.element('rows').textContent, /价格\$100/);
  assert.doesNotMatch(host.element('rows').textContent, /价格\$50/);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/map')).length, 1);
});

for (const outcome of ['http', 'network']) {
  test(`user sees a trading endpoint remain unavailable after its single ${outcome} retry fails`, { timeout: 5_000 }, async t => {
    // Given the trading panel starts with the current period available at other endpoints
    const host = createDataPanelHost(t, 'trading');
    await host.start();
    host.network.requests[0].respond({ serverTime: Date.now() });
    const dataset = tradingDataset(Date.now());
    await completeTradingBatch(host, dataset, { status: { openInterestHist: 503 } });
    const retry = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/openInterestHist'));

    // When the only immediate retry fails through its declared transport result
    if (outcome === 'http') retry.respond({}, 503);
    else retry.fail();
    await host.rendered(panel => panel?.querySelector('[data-role="updated-at"]')?.textContent.startsWith('更新于'));

    // Then that row stays unavailable while unrelated successful endpoints retain their votes
    assert.equal(host.element('rows').firstElementChild.children[1].textContent, '--');
    assert.match(host.element('composite').textContent, /偏多 6:0/);
    assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/openInterestHist')).length, 2);
  });
}

test('user can render trading data with local time after server synchronization fails', { timeout: 5_000 }, async t => {
  // Given the server-time endpoint returns an explicit HTTP failure
  const host = createDataPanelHost(t, 'trading');
  await host.start();

  // When synchronization fails but the seven data endpoints still succeed
  host.network.requests[0].respond({}, 500);
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await host.rendered(panel => panel?.querySelector('[data-role="updated-at"]')?.textContent.startsWith('更新于'));

  // Then current data remains visible and the local-time recovery reason is recorded
  assert.match(host.element('composite').textContent, /偏多 7:0/);
  assert.equal(host.errors.some(args => args.includes('获取服务器时间失败，使用本地时间')), true);
});

test('user sees no fabricated open-interest trend before enough history is available', { timeout: 5_000 }, async t => {
  // Given the initial history has only one current open-interest data point
  const host = createDataPanelHost(t, 'trading');
  const dataset = tradingDataset(Date.now());
  dataset.openInterestHist = [dataset.openInterestHist[0]];

  // When the complete trading entrypoint renders this short history
  await host.start();
  await activateTradingData(host, dataset);

  // Then the quantity has no directional arrow and only the other six indicators vote
  assert.equal(host.element('rows').firstElementChild.children[1].textContent, '1.00M');
  assert.match(host.element('composite').textContent, /偏多 6:0/);
});

test('user retries only delayed period endpoints after the publication grace interval', { timeout: 5_000 }, async t => {
  // Given the page opens on a new boundary while the exchange still serves the prior period
  const host = createDataPanelHost(t, 'trading');
  const old = tradingDataset(Date.now() - 300_000);
  await host.start();
  await activateTradingData(host, old);
  host.clock.tick(5_000);
  const mixed = tradingDataset(Date.now());
  mixed.basis = old.basis;
  mixed.takerlongshortRatio = old.takerlongshortRatio;
  await completeTradingBatch(host, mixed);
  await afterDataMediaResponseTurn();
  const count = host.network.requests.length;

  // When the first retry deadline arrives and the two delayed endpoints catch up
  host.clock.tick(9_999);
  assert.equal(host.network.requests.length, count);
  host.clock.tick(1);
  const pending = host.network.requests.filter(request => !request.settled);
  const current = tradingDataset(Date.now());
  pending.forEach(request => request.respond(current[request.url.pathname.split('/').at(-1)]));
  await afterDataMediaResponseTurn();

  // Then the retry fetches only the pending period endpoints and keeps funding untouched
  assert.deepEqual(pending.map(request => request.url.pathname.split('/').at(-1)).sort(), ['basis', 'takerlongshortRatio']);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/fundingRate')).length, 2);
  assert.match(host.element('composite').textContent, /偏多 7:0/);
});

test('user keeps valid trading metrics visible while retrying their missing publication timestamp', { timeout: 5_000 }, async t => {
  // Given the basis endpoint supplies a valid metric without the current period timestamp
  const host = createDataPanelHost(t, 'trading');
  const dataset = tradingDataset(Date.now());
  delete dataset.basis[0].timestamp;
  await host.start();
  await activateTradingData(host, dataset);
  host.clock.tick(5_000);
  await completeTradingBatch(host, dataset);
  await afterDataMediaResponseTurn();
  const count = host.network.requests.length;
  assert.match(host.element('composite').textContent, /偏多 7:0/);

  // When only the timestamp-less endpoint reaches its retry deadline and publishes a fresh value
  host.clock.tick(9_999);
  assert.equal(host.network.requests.length, count);
  host.clock.tick(1);
  const pending = host.network.requests.filter(request => !request.settled);
  assert.deepEqual(pending.map(request => request.url.pathname.split('/').at(-1)), ['basis']);
  pending[0].respond([{ timestamp: Date.now(), basisRate: '-0.02' }]);
  await afterDataMediaResponseTurn();

  // Then the fresh basis value changes its vote without retrying already current endpoints
  assert.match(host.element('composite').textContent, /偏多 6:1/);
  assert.equal(host.network.requests.length, count + 1);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/fundingRate')).length, 2);
});

test('user receives the documented bounded retry schedule while period data remains delayed', { timeout: 5_000 }, async t => {
  // Given a new cycle repeatedly receives the previous period's six endpoint timestamps
  const host = createDataPanelHost(t, 'trading');
  const stale = tradingDataset(Date.now() - 300_000);
  await host.start();
  await activateTradingData(host, stale);
  host.clock.tick(5_000);
  await completeTradingBatch(host, stale);
  await afterDataMediaResponseTurn();
  const observed = [];

  // When each explicit retry deadline is reached without advancing endpoint timestamps
  for (const delay of [10_000, 15_000, 20_000, 30_000]) {
    const before = host.network.requests.length;
    host.clock.tick(delay - 1);
    assert.equal(host.network.requests.length, before);
    host.clock.tick(1);
    const requests = host.network.requests.filter(request => !request.settled);
    observed.push({ delay, count: requests.length });
    requests.forEach(request => request.respond(stale[request.url.pathname.split('/').at(-1)]));
    await afterDataMediaResponseTurn();
  }

  // Then retries use ten, fifteen, twenty, and thirty seconds with no funding re-fetch
  assert.deepEqual(observed, [10_000, 15_000, 20_000, 30_000].map(delay => ({ delay, count: 6 })));
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/fundingRate')).length, 2);
});

test('user stops retrying an expired period and resumes at the next publication window', { timeout: 5_000 }, async t => {
  // Given installation occurs twenty seconds before the current period expires
  const boundary = Date.UTC(2026, 8, 16);
  const host = createDataPanelHost(t, 'trading', { now: boundary + 280_000 });
  const stale = tradingDataset(boundary - 300_000);
  await host.start();
  await activateTradingData(host, stale);
  host.clock.tick(0);
  await completeTradingBatch(host, stale);
  await afterDataMediaResponseTurn();
  host.clock.tick(10_000);
  host.network.requests.filter(request => !request.settled).forEach(request => request.respond(stale[request.url.pathname.split('/').at(-1)]));
  await afterDataMediaResponseTurn();
  const count = host.network.requests.length;

  // When the old window closes and the next boundary's five-second grace elapses
  host.clock.tick(14_999);
  assert.equal(host.network.requests.length, count);
  host.clock.tick(1);
  await completeTradingBatch(host, tradingDataset(Date.now()));
  await afterDataMediaResponseTurn();

  // Then one complete new-period batch replaces further retries of the expired window
  assert.equal(host.network.requests.length, count + 7);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/fundingRate')).length, 3);
  assert.match(host.element('composite').textContent, /偏多 7:0/);
});
