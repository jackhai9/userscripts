import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { cmcDetail, tradingDataset } from '../../../test/helpers/data-media-migration-host.js';

export const DATA_PANEL_ORIGIN = 'https://www.binance.com';
export const DATA_PANEL_NOW = Date.UTC(2026, 9, 9, 0, 0, 0);
export const POSITION_AUDIT_KEY = '__data_panel_fixture_position_writes__';
export const DATA_PANELS = Object.freeze([
  {
    name: 'trading', id: 'jh-binance-trading-data-panel', width: 480,
    key: 'jh_binance_trading_data_pos', artifact: 'binance-trading-data',
  },
  {
    name: 'cmc', id: 'jh-binance-cmc-data-panel', width: 500,
    key: 'jh_binance_cmc_data_pos', artifact: 'binance-coinmarketcap-data',
  },
]);
export const CMC_HEADERS = Object.freeze({
  Accept: 'application/json, text/plain, */*',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
});

/** The fixture accepts only the current public data protocols and keeps native browser storage. */
export async function createDataPanelsFixture(context, {
  dataset = tradingDataset(DATA_PANEL_NOW), detail = cmcDetail(),
} = {}) {
  const requests = [];
  const gmRequests = [];
  const errors = [];
  const map = { data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] };

  await context.exposeBinding('__dataPanelFixtureCmcResponse', (_source, request) => {
    assert.deepEqual(Object.keys(request).sort(), ['headers', 'method', 'timeout', 'url']);
    assert.equal(request.method, 'GET');
    assert.equal(request.timeout, 20_000);
    assert.deepEqual(request.headers, CMC_HEADERS);
    gmRequests.push(request);
    const url = new URL(request.url);
    let body;
    if (url.origin === 'https://api.coinmarketcap.com' && url.pathname === '/data-api/v1/cryptocurrency/map') {
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        symbol: 'BTC', listing_status: 'active', _: String(DATA_PANEL_NOW),
      });
      body = map;
    } else if (url.origin === 'https://api.coinmarketcap.com' && url.pathname === '/data-api/v3/cryptocurrency/detail') {
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        id: '1', convertId: '2781', languageCode: 'zh', _: String(DATA_PANEL_NOW),
      });
      body = { data: detail };
    } else if (url.origin === 'https://dapi.coinmarketcap.com' && url.pathname === '/dex-stats/v3/dexer/crypto-holder/show_holders') {
      assert.deepEqual(Object.fromEntries(url.searchParams), { cryptoId: '1', _: String(DATA_PANEL_NOW) });
      body = { data: { showFlag: true, count: 10_000 } };
    } else {
      assert.fail(`Unmodeled CMC request: ${url.origin}${url.pathname}`);
    }
    return { status: 200, responseText: JSON.stringify(body) };
  });

  await context.addInitScript(({ origin, keys, auditKey }) => {
    if (location.origin !== origin) return;
    const nativeSetItem = Storage.prototype.setItem;
    if (localStorage.getItem(auditKey) === null) nativeSetItem.call(localStorage, auditKey, '[]');
    window.dataPanelFixture = { resizeEvents: 0, gmCompletions: [], pointerEvents: [] };
    window.addEventListener('resize', () => { window.dataPanelFixture.resizeEvents += 1; });
    document.addEventListener('mousemove', event => {
      window.dataPanelFixture.pointerEvents.push({
        buttons: event.buttons, x: event.clientX, y: event.clientY, trusted: event.isTrusted,
      });
    }, { capture: true });

    // Preserve real storage semantics so another tab and reload see the same preference.
    Storage.prototype.setItem = function (key, value) {
      nativeSetItem.call(this, key, value);
      if (this !== localStorage || !keys.includes(key)) return;
      const writes = JSON.parse(localStorage.getItem(auditKey));
      writes.push({ key, value: JSON.parse(value) });
      nativeSetItem.call(localStorage, auditKey, JSON.stringify(writes));
    };
    window.GM_xmlhttpRequest = options => {
      for (const name of ['onload', 'onerror', 'ontimeout']) {
        if (typeof options[name] !== 'function') throw new Error(`Missing GM callback: ${name}`);
      }
      const request = {
        method: options.method, url: options.url,
        timeout: options.timeout, headers: options.headers,
      };
      window.__dataPanelFixtureCmcResponse(request).then(response => {
        window.dataPanelFixture.gmCompletions.push({ url: options.url, response });
        options.onload(response);
      });
    };
  }, { origin: DATA_PANEL_ORIGIN, keys: DATA_PANELS.map(panel => panel.key), auditKey: POSITION_AUDIT_KEY });

  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.method(), 'GET');
    if (url.origin === DATA_PANEL_ORIGIN && /^\/(?:zh-CN|en)\/futures\/BTCUSDT$/.test(url.pathname) && request.isNavigationRequest()) {
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><meta charset="utf-8"><title>Offline data panel fixture</title>'
          + '<link rel="icon" href="data:,"><style>html{color-scheme:light dark}body{margin:0;background:light-dark(#edf1f5,#0b0e11);font:16px system-ui}main{padding:24px;color:light-dark(#475569,#a6b0bf)}</style>'
          + '</head><body><main>Offline data panel fixture · Example data</main></body></html>',
      });
      return;
    }
    assert.equal(url.origin, DATA_PANEL_ORIGIN);
    const params = Object.fromEntries(url.searchParams);
    requests.push({ method: request.method(), path: url.pathname, params });
    if (url.pathname === '/fapi/v1/time') {
      assert.deepEqual(params, {});
      await route.fulfill({ json: { serverTime: DATA_PANEL_NOW } });
      return;
    }
    const endpoint = url.pathname.split('/').at(-1);
    assert.equal(Object.hasOwn(dataset, endpoint), true, `Unmodeled fetch: ${url.pathname}`);
    if (endpoint === 'fundingRate') {
      assert.equal(url.pathname, '/fapi/v1/fundingRate');
      assert.deepEqual(params, { symbol: 'BTCUSDT', limit: '40' });
    } else if (endpoint === 'premiumIndex') {
      assert.equal(url.pathname, '/fapi/v1/premiumIndex');
      assert.deepEqual(params, { symbol: 'BTCUSDT' });
    } else if (endpoint === 'fundingInfo') {
      assert.equal(url.pathname, '/fapi/v1/fundingInfo');
      assert.deepEqual(params, {});
    } else if (endpoint === 'basis') {
      assert.equal(url.pathname, '/futures/data/basis');
      assert.deepEqual(params, { pair: 'BTCUSDT', period: '5m', limit: '30', contractType: 'PERPETUAL' });
    } else {
      assert.equal(url.pathname, `/futures/data/${endpoint}`);
      assert.deepEqual(params, { symbol: 'BTCUSDT', period: '5m', limit: '30' });
    }
    await route.fulfill({ json: dataset[endpoint] });
  });

  async function open(page, {
    viewport = { width: 1600, height: 1200 }, positions, install = true,
    locale = 'zh-CN', theme = 'light', controlledClock = false,
    panels = DATA_PANELS.map(panel => panel.name),
  } = {}) {
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme });
    if (controlledClock) {
      await page.clock.install({ time: DATA_PANEL_NOW });
      await page.clock.pauseAt(DATA_PANEL_NOW);
    } else {
      await page.clock.setFixedTime(DATA_PANEL_NOW);
    }
    await page.goto(`${DATA_PANEL_ORIGIN}/${locale}/futures/BTCUSDT`);
    if (positions) {
      await page.evaluate(({ definitions, positions, auditKey }) => {
        for (const panel of definitions) {
          if (Object.hasOwn(positions, panel.name)) localStorage.setItem(panel.key, JSON.stringify(positions[panel.name]));
        }
        localStorage.setItem(auditKey, '[]');
      }, { definitions: DATA_PANELS, positions, auditKey: POSITION_AUDIT_KEY });
    }
    if (install) await installDataPanels(page, { locale, panels });
  }
  return { open, requests, gmRequests, errors, map, dataset };
}

export async function installDataPanels(page, {
  locale = 'zh-CN', panels = DATA_PANELS.map(panel => panel.name),
} = {}) {
  for (const name of panels) {
    const panel = DATA_PANELS.find(definition => definition.name === name);
    assert.ok(panel, `Unknown panel installation: ${name}`);
    await page.addScriptTag({ path: fileURLToPath(new URL(`../../../scripts/${panel.artifact}.user.js`, import.meta.url)) });
  }
  if (panels.includes('trading')) {
    await expect(page.locator('#jh-binance-trading-data-panel [data-role="updated-at"]')).toContainText(locale === 'zh-CN' ? '更新于' : 'Updated');
    await expect(page.locator('#jh-binance-trading-data-panel-symbol')).toHaveText('BTCUSDT');
  }
  if (panels.includes('cmc')) {
    await expect(page.locator('#jh-binance-cmc-data-panel-footer a')).toHaveText('CMC data-api');
    await expect(page.locator('#jh-binance-cmc-data-panel-symbol')).toHaveText('BTC #1');
  }
}
