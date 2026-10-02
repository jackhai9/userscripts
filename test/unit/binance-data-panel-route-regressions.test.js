import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataPanelHost, activateTradingData, completeCmcData, cmcDetail, tradingDataset, afterDataMediaResponseTurn } from '../helpers/data-media-migration-host.js';

for (const kind of ['cmc', 'trading']) {
  for (const path of ['/zh-CN/futures/', '/zh-CN/futures/home', '/futures/quiz', '/futures/multipleChart', '/futures/multi-symbols', '/futures/USUSDT/calculator']) {
    test(`user gets no ${kind} panel or requests on ${path}`, async t => {
      // Given a non-trading route covered by the broad installation metadata
      const host = createDataPanelHost(t, kind, { path });
      // When the generated script starts and business deadlines pass
      await host.start();
      host.clock.tick(3_600_000);
      await afterDataMediaResponseTurn();
      // Then neither presentation nor background data requests start
      assert.equal(host.panel(), null);
      assert.equal(host.network.requests.length, 0);
    });
  }

  test(`user activates the ${kind} panel from home and removes it on returning home`, async t => {
    // Given a visible futures home page with no active business loop
    const host = createDataPanelHost(t, kind, { path: '/zh-CN/futures/home' });
    await host.start();
    assert.equal(host.panel(), null);
    assert.equal(host.network.requests.length, 0);
    // When SPA navigation enters a supported contract and its first refresh completes
    host.navigate('/zh-CN/futures/USUSDT');
    if (kind === 'trading') await activateTradingData(host, tradingDataset(Date.now()), { symbol: 'USUSDT' });
    else await completeCmcData(host, cmcDetail({ id: 42, symbol: 'US' }), { symbol: 'US', slug: 'us' });
    // Then exactly one panel owns the current contract
    assert.equal(host.document.querySelectorAll(`#${host.panelId}`).length, 1);
    assert.equal(host.element('symbol').textContent, kind === 'trading' ? 'USUSDT' : 'US #1');
    // When returning home crosses all business refresh deadlines
    host.navigate('/zh-CN/futures/home');
    const requestCount = host.network.requests.length;
    host.clock.tick(3_600_000);
    await afterDataMediaResponseTurn();
    // Then the panel is removed and no business requests continue
    assert.equal(host.panel(), null);
    assert.equal(host.network.requests.length, requestCount);
  });

  test(`user excludes wallet futures pages when installing the ${kind} data panel`, async () => {
    // Given the script is installed through its public generated artifact
    const artifact = new URL(`../../scripts/binance-${kind === 'trading' ? 'trading' : 'coinmarketcap'}-data.user.js`, import.meta.url);
    // When the install metadata is read
    const source = await readFile(artifact, 'utf8');
    // Then both localized and root wallet routes have explicit exclusions
    assert.match(source, /\/\/ @exclude\s+https:\/\/www\.binance\.com\/\*\/my\/wallet\/futures\/\*/);
    assert.match(source, /\/\/ @exclude\s+https:\/\/www\.binance\.com\/my\/wallet\/futures\/\*/);
  });

  test(`user sees only the route symbol in the ${kind} panel despite an unrelated page title`, { timeout: 5_000 }, async t => {
    // Given a matched futures landing page carries a stale Bitcoin title
    const host = createDataPanelHost(t, kind, { path: '/zh-CN/futures' });
    host.document.title = 'BTCUSDT futures';
    await host.start();
    assert.equal(host.panel(), null);
    assert.equal(host.network.requests.length, 0);

    // When SPA navigation enters a Unicode futures trading route
    host.navigate('/zh-CN/futures/龙虾USDT');
    if (kind === 'trading') await activateTradingData(host, tradingDataset(Date.now()), { symbol: '龙虾USDT' });
    else await completeCmcData(host, cmcDetail({ id: 42, symbol: '龙虾' }), { symbol: '龙虾', slug: 'lobster' });

    // Then the route controls the visible identity and the outbound symbol parameters
    assert.match(host.element('symbol').textContent, /^龙虾/);
    assert.equal(host.network.requests.some(request => request.url.searchParams.get('symbol')?.includes('BTC')), false);
    assert.equal(host.document.title, 'BTCUSDT futures');
  });
}
