import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import {
  afterDataMediaResponseTurn, cmcDetail, completeCmcData, createDataMediaNetwork, installDataMediaClock, observeDom,
} from '../helpers/data-media-migration-host.js';

const entry = fileURLToPath(new URL('../../src/binance-coinmarketcap-data/index.user.js', import.meta.url));
const bundle = await build({
  entryPoints: [entry], bundle: true, write: false, charset: 'utf8', format: 'iife',
  platform: 'browser', target: ['es2020'], legalComments: 'none',
});
const source = bundle.outputFiles[0].text;
const PANEL_ID = 'jh-binance-cmc-data-panel';

/** Reuse the independently checked GM transport and clock with the real source entrypoint. */
function createCmcHost(t, { path = '/zh-CN/futures/BTCUSDT', storage = {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: `https://www.binance.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const clock = installDataMediaClock(t, window);
  const network = createDataMediaNetwork();
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  window.GM_xmlhttpRequest = network.gmRequest;
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  const setHidden = value => {
    hidden = value;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
  };
  t.after(() => { setHidden(true); window.close(); });
  return {
    window, document: window.document, network, clock, setHidden,
    panel: () => window.document.getElementById(PANEL_ID),
    element: suffix => window.document.getElementById(`${PANEL_ID}-${suffix}`),
    navigate: path => window.history.pushState({}, '', path),
    rendered: predicate => observeDom(window, () => predicate(window.document.getElementById(PANEL_ID))),
    async start() {
      if (window.document.readyState === 'loading') {
        await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
      new vm.Script(source, { filename: entry }).runInContext(dom.getInternalVMContext());
    },
  };
}

test('user sees unavailable CMC values instead of zero when the provider returns null or empty fields', { timeout: 5_000 }, async t => {
  // Given a valid asset has explicitly empty statistics and optional metadata
  const host = createCmcHost(t);
  const detail = cmcDetail({ profileCompletionScore: null, holders: { total: null } });
  for (const key of Object.keys(detail.statistics)) detail.statistics[key] = key === 'price' ? '' : null;
  await host.start();

  // When the API and holder endpoint return their missing values
  await completeCmcData(host, detail, { holder: { showFlag: true, count: null } });

  // Then no absent field becomes a zero price, change, ratio, score, or rank
  assert.doesNotMatch(host.element('rows').textContent, /\$0|0\.00%/);
  assert.match(host.element('rows').textContent, /--/);
  assert.equal(host.element('symbol').textContent, 'BTC');
});

test('user can read calculated CMC interpretations and expand their basis in a three-column table', { timeout: 5_000 }, async t => {
  // Given CMC reports a positive daily move and a fully specified valuation snapshot
  const host = createCmcHost(t);
  const detail = cmcDetail();
  Object.assign(detail.statistics, {
    price: 2, priceChangePercentage24h: 12.5, marketCap: 200_000_000,
    fullyDilutedMarketCap: 500_000_000, volume24h: 150_000_000, turnover: 0.75,
    totalSupply: 250_000_000, circulatingSupply: 100_000_000,
  });
  await host.start();

  // When the current asset snapshot is rendered through the userscript entrypoint
  await completeCmcData(host, detail);

  // Then every metric has a value and interpretation and the supply comparison uses the response
  assert.deepEqual([...host.panel().querySelectorAll('thead th')].map(node => node.textContent), ['指标', '数值', '解读']);
  assert.equal(host.element('rows').querySelectorAll('tr[data-metric]').length, 12);
  const fdv = host.element('rows').querySelector('[data-metric="fdv"]');
  assert.match(fdv.textContent, /2\.50倍/);
  const supply = host.element('rows').querySelector('[data-metric="circulating-supply"]');
  assert.match(supply.textContent, /40\.0%/);
  const button = supply.querySelector('button');
  assert.equal(button.getAttribute('aria-expanded'), 'false');

  // When the user opens the explanation for circulating supply
  button.click();

  // Then the associated explanation becomes readable without issuing a data request
  const explanation = host.document.getElementById(button.getAttribute('aria-controls'));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(explanation.hidden, false);
  assert.match(explanation.textContent, /40\.0%/);
  assert.equal(host.network.requests.length, 3);
});

for (const locale of ['zh-CN', 'en']) {
  test(`user sees CMC loading and mapping errors in ${locale} with their original cause`, { timeout: 5_000 }, async t => {
    // Given the supported futures route selects one of the panel languages
    const host = createCmcHost(t, { path: `/${locale}/futures/BTCUSDT` });
    await host.start();
    assert.equal(host.panel().lang, locale);
    assert.equal(host.element('rows').textContent, locale === 'zh-CN' ? '正在读取 CoinMarketCap...' : 'Loading CoinMarketCap...');

    // When no active CMC asset can be mapped to the current contract
    host.network.requests[0].respond({ data: [] });
    await host.rendered(() => host.element('rows').textContent.includes('CMC symbol not found: BTC'));

    // Then the visible wrapper and controls use the selected language without losing the cause
    assert.equal(host.element('rows').textContent, `${locale === 'zh-CN' ? '读取失败' : 'Unable to load data'}CMC symbol not found: BTC`);
    assert.equal(host.element('refresh').title, locale === 'zh-CN' ? '刷新' : 'Refresh');
    assert.equal(host.element('close').getAttribute('aria-label'), locale === 'zh-CN' ? '关闭' : 'Close');
    assert.equal(host.element('footer').textContent, locale === 'zh-CN' ? '来源：CoinMarketCap' : 'Source: CoinMarketCap');
    assert.equal(host.network.requests.length, 1);
  });
}

test('user switches the complete CMC panel language and number units while retaining source timestamps', { timeout: 5_000 }, async t => {
  // Given a Chinese CMC snapshot is visible with a known data timestamp and saved panel preferences
  const storage = { jh_binance_cmc_data_pos: '{"left":100,"top":80}', jh_binance_cmc_data_collapsed: '0' };
  const host = createCmcHost(t, { storage });
  await host.start();
  await completeCmcData(host);
  const dataTime = host.element('footer').querySelector('.cmc-times > span').textContent;
  host.clock.tick(1_000);

  // When an English route refreshes the same asset through its cached deterministic mapping
  host.navigate('/en/futures/BTCUSDT');
  assert.equal(host.element('rows').textContent, 'Loading CoinMarketCap...');
  await completeCmcData(host, cmcDetail(), { map: false });

  // Then all text, units, controls, and source links are English but the reported CMC time is unchanged
  assert.deepEqual([...host.panel().querySelectorAll('thead th')].map(node => node.textContent), ['Metric', 'Value', 'Interpretation']);
  assert.equal(host.panel().querySelector('.cmc-title').textContent, 'CMC data');
  assert.equal(host.element('rows').querySelector('[data-metric="price"] [data-role="metric-value"]').textContent, '$60K');
  assert.equal(host.element('rows').querySelector('[data-metric="total-supply"] .cmc-number').textContent, '21M');
  assert.doesNotMatch(host.element('rows').textContent, /\p{Script=Han}/u);
  assert.equal(host.element('refresh').title, 'Refresh');
  assert.equal(host.element('collapse').title, 'Collapse');
  assert.equal(host.element('close').title, 'Close');
  assert.match(host.element('rows').querySelector('button').getAttribute('aria-label'), /View interpretation basis/);
  assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/currencies/bitcoin/');
  assert.equal(host.element('footer').querySelector('.cmc-times > span').textContent, dataTime);
  assert.match(host.element('footer').textContent, /Fetched .*Refreshes every 30s/);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/map')).length, 1);
  assert.equal(host.window.localStorage.getItem('jh_binance_cmc_data_pos'), storage.jh_binance_cmc_data_pos);
  assert.equal(host.window.localStorage.getItem('jh_binance_cmc_data_collapsed'), '0');

  // When the user returns to the Chinese route and collapses the panel
  host.navigate('/zh-CN/futures/BTCUSDT');
  await completeCmcData(host, cmcDetail(), { map: false });
  host.element('collapse').click();

  // Then Chinese units return and collapse affects only its own stored preference
  assert.equal(host.element('rows').querySelector('[data-metric="price"] .cmc-number').textContent, '$6万');
  assert.equal(host.element('rows').querySelector('[data-metric="total-supply"] .cmc-number').textContent, '2100万');
  assert.equal(host.element('body').style.display, 'none');
  assert.equal(host.element('collapse').title, '展开');
  assert.equal(host.element('collapse').getAttribute('aria-expanded'), 'false');
  assert.equal(host.window.localStorage.getItem('jh_binance_cmc_data_collapsed'), '1');
  assert.equal(host.window.localStorage.getItem('jh_binance_cmc_data_pos'), storage.jh_binance_cmc_data_pos);
});

test('user sees an English page-snapshot source and treasury unit after an API failure', { timeout: 5_000 }, async t => {
  // Given the documented RAVE mapping does not need a symbol map request
  const host = createCmcHost(t, { path: '/futures/RAVEUSDT' });
  const detail = cmcDetail({ id: 38967, symbol: 'RAVE', showTreasuriesFlag: true, treasuryHoldings: 1200, latestUpdateTime: '2026-09-15T22:00:00Z' });
  await host.start();

  // When the API fails and the localized page provides its older snapshot
  host.network.requests[0].respond({}, 503);
  const page = await host.network.waitForRequest(request => request.url.hostname === 'coinmarketcap.com');
  page.respond(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { detailRes: { detail } } } })}</script>`);
  await host.rendered(() => host.element('footer').textContent.includes('CMC page snapshot'));

  // Then the source remains a page snapshot and treasury quantity is not mislabeled as addresses
  assert.equal(page.url.href, 'https://coinmarketcap.com/currencies/ravedao/');
  assert.equal(host.element('footer').querySelector('a').textContent, 'CMC page snapshot');
  assert.equal(host.element('footer').querySelector('a').href, page.url.href);
  const treasury = host.element('rows').querySelector('[data-metric="treasury"]');
  assert.equal(treasury.querySelector('.cmc-number').textContent, '1.2K');
  assert.equal(treasury.querySelector('.cmc-unit').textContent, 'RAVE');
  assert.match(treasury.textContent, /Treasury token holdings/);
  assert.equal(host.network.requests.length, 2);
  const sourceClock = new host.window.Date(detail.latestUpdateTime).toTimeString().slice(0, 8);
  assert.equal(host.element('footer').querySelector('.cmc-times > span').textContent, `CMC ${sourceClock}`);
});

test('user retains an expanded CMC explanation across the thirty-second refresh without duplicate requests', { timeout: 5_000 }, async t => {
  // Given a loaded CMC panel has its FDV explanation expanded
  const host = createCmcHost(t, { path: '/en/futures/BTCUSDT' });
  await host.start();
  await completeCmcData(host);
  host.element('rows').querySelector('[data-expand-metric="fdv"]').click();
  const previousRows = host.element('rows').innerHTML;
  host.clock.tick(29_999);
  assert.equal(host.network.requests.length, 3);

  // When the unchanged thirty-second schedule starts its next snapshot
  host.clock.tick(1);
  const pending = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/detail'));
  assert.equal(host.element('rows').innerHTML, previousRows);
  host.clock.tick(30_000);
  assert.equal(host.network.requests.filter(request => !request.settled).length, 1);
  const detail = cmcDetail();
  detail.statistics.price = 65_000;
  pending.respond({ data: detail });
  const holder = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/show_holders'));
  holder.respond({ data: { showFlag: true, count: 10_000 } });
  await host.rendered(() => host.element('rows').querySelector('[data-metric="price"] .cmc-number').textContent === '$65K');

  // Then the latest value renders while the selected explanation remains expanded
  const button = host.element('rows').querySelector('[data-expand-metric="fdv"]');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(host.document.getElementById(button.getAttribute('aria-controls')).hidden, false);
  assert.equal(host.network.requests.length, 5);

  // When the user expands another metric and then closes that explanation
  const supply = host.element('rows').querySelector('[data-expand-metric="total-supply"]');
  supply.click();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  supply.click();

  // Then both disclosures close without changing the data-fetch schedule
  assert.equal(supply.getAttribute('aria-expanded'), 'false');
  assert.equal(host.document.getElementById(supply.getAttribute('aria-controls')).hidden, true);
  assert.equal(host.network.requests.length, 5);
});

test('user keeps new-language CMC rows after the superseded symbol mapping fails', { timeout: 5_000 }, async t => {
  // Given a Chinese Bitcoin lookup is pending when the user opens English Ethereum
  const host = createCmcHost(t);
  await host.start();
  const oldMapping = host.network.requests[0];
  host.navigate('/en/futures/ETHUSDT');
  await completeCmcData(host, cmcDetail({ id: 2, symbol: 'ETH' }), { symbol: 'ETH', slug: 'ethereum' });
  const rows = host.element('rows').innerHTML;
  const footer = host.element('footer').innerHTML;

  // When the original Bitcoin lookup reports a late error
  oldMapping.fail('error');
  await afterDataMediaResponseTurn();

  // Then the old epoch cannot replace the English asset, interpretations, or source
  assert.equal(host.element('rows').innerHTML, rows);
  assert.equal(host.element('footer').innerHTML, footer);
  assert.equal(host.element('symbol').textContent, 'ETH #1');
  assert.equal(host.panel().lang, 'en');
  assert.equal(host.element('footer').querySelector('a').href, 'https://coinmarketcap.com/currencies/ethereum/');
});
