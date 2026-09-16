import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';

/** Observe an actual host mutation instead of assuming a render duration. */
export function observeDom(window, predicate) {
  if (predicate()) return Promise.resolve();
  return new Promise(resolve => {
    const observer = new window.MutationObserver(() => {
      if (!predicate()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(window.document, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

/** A delivered host task follows promise reactions without assuming their depth. */
export function afterDataMediaResponseTurn() {
  return new Promise(resolve => {
    const { port1, port2 } = new MessageChannel();
    port1.once('message', () => {
      port1.close();
      port2.close();
      resolve();
    });
    port2.postMessage('response-turn-complete');
  });
}

/** Node owns wall time and browser task timers; the page retains its real DOM. */
export function installDataMediaClock(t, window, now = Date.UTC(2026, 8, 16, 0, 0, 0)) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
  window.Date = Date;
  window.setTimeout = globalThis.setTimeout;
  window.clearTimeout = globalThis.clearTimeout;
  window.setInterval = globalThis.setInterval;
  window.clearInterval = globalThis.clearInterval;
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(Date.now()), 16);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  return t.mock.timers;
}

/** Requests remain pending until the scenario supplies a modeled HTTP outcome. */
export function createDataMediaNetwork() {
  const requests = [];
  const listeners = new Set();
  function publish(request) {
    requests.push(request);
    for (const listener of listeners) listener();
  }
  function waitForRequest(predicate) {
    const existing = requests.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      const listener = () => {
        const request = requests.find(predicate);
        if (!request) return;
        listeners.delete(listener);
        resolve(request);
      };
      listeners.add(listener);
    });
  }
  function fetch(url) {
    return new Promise((resolve, reject) => {
      const request = {
        url: new URL(url), kind: 'fetch', settled: false,
        respond(body, status = 200) {
          assert.equal(request.settled, false, 'each HTTP request has one terminal outcome');
          request.settled = true;
          resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
        },
        fail(error = new Error('fixture network unavailable')) {
          assert.equal(request.settled, false);
          request.settled = true;
          reject(error);
        },
      };
      publish(request);
    });
  }
  function gmRequest(options) {
    const request = {
      url: new URL(options.url), kind: 'gm', options, settled: false,
      respond(body, status = 200) {
        assert.equal(request.settled, false, 'each GM request has one terminal outcome');
        request.settled = true;
        options.onload({ status, responseText: typeof body === 'string' ? body : JSON.stringify(body) });
      },
      fail(kind = 'error') {
        assert.equal(request.settled, false);
        request.settled = true;
        assert.ok(['error', 'timeout'].includes(kind));
        options[`on${kind}`]();
      },
    };
    publish(request);
    return { abort() { request.settled = true; } };
  }
  return { requests, fetch, gmRequest, waitForRequest };
}

export function createDataPanelHost(t, kind, {
  path = '/zh-CN/futures/BTCUSDT', storage = {}, hidden = false,
  now = Date.UTC(2026, 8, 16, 0, 0, 0),
} = {}) {
  assert.ok(['trading', 'cmc'].includes(kind));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: `https://www.binance.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const clock = installDataMediaClock(t, window, now);
  const network = createDataMediaNetwork();
  const errors = [];
  window.fetch = network.fetch;
  window.GM_xmlhttpRequest = network.gmRequest;
  window.console.error = (...args) => { errors.push(args); };
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  const panelId = kind === 'trading' ? 'jh-binance-trading-data-panel' : 'jh-binance-cmc-data-panel';
  const artifact = new URL(`../../scripts/binance-${kind === 'trading' ? 'trading' : 'coinmarketcap'}-data.user.js`, import.meta.url);
  function setHidden(value) {
    hidden = value;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
  }
  t.after(() => { setHidden(true); window.close(); });
  return {
    window, document: window.document, clock, network, errors, panelId,
    panel: () => window.document.getElementById(panelId),
    element: suffix => window.document.getElementById(`${panelId}-${suffix}`),
    setHidden,
    navigate: path => window.history.pushState({}, '', path),
    async start({ waitForDocumentReady = true } = {}) {
      // Wait for the real document readiness signal before installing the idle script.
      if (waitForDocumentReady && window.document.readyState === 'loading') {
        await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
      new vm.Script(readFileSync(artifact, 'utf8'), { filename: fileURLToPath(artifact) }).runInContext(dom.getInternalVMContext());
    },
    rendered: predicate => observeDom(window, () => predicate(window.document.getElementById(panelId))),
  };
}

export function tradingDataset(timestamp, {
  oi = 2_000_000, previousOi = 1_000_000, supply = 10_000_000,
  ratio = 1.5, basis = 0.01, funding = -0.0002,
} = {}) {
  return {
    openInterestHist: Array.from({ length: 7 }, (_, index) => ({
      timestamp, sumOpenInterest: String(index === 6 ? oi : previousOi),
      sumOpenInterestValue: '100000000', CMCCirculatingSupply: String(supply),
    })),
    topLongShortAccountRatio: [{ timestamp, longShortRatio: String(ratio) }],
    topLongShortPositionRatio: [{ timestamp, longShortRatio: String(ratio) }],
    globalLongShortAccountRatio: [{ timestamp, longShortRatio: String(ratio) }],
    takerlongshortRatio: [{ timestamp, buySellRatio: String(ratio) }],
    basis: [{ timestamp, basisRate: String(basis) }],
    fundingRate: [{ fundingRate: String(funding) }],
  };
}

export async function completeTradingBatch(host, dataset, { symbol = 'BTCUSDT', status = {} } = {}) {
  const pending = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/fundingRate') && request.url.searchParams.get('symbol') === symbol);
  assert.equal(pending.kind, 'fetch');
  const batch = host.network.requests.filter(request => !request.settled && (request.url.searchParams.get('symbol') || request.url.searchParams.get('pair')) === symbol);
  assert.equal(batch.length, 7);
  for (const request of batch) {
    const key = request.url.pathname.split('/').at(-1);
    request.respond(dataset[key], status[key] ?? 200);
  }
  return batch;
}

export async function activateTradingData(host, dataset = tradingDataset(Date.now()), options) {
  const time = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/time'));
  time.respond({ serverTime: Date.now() });
  await completeTradingBatch(host, dataset, options);
  await host.rendered(panel => panel?.querySelector('[data-role="updated-at"]')?.textContent.startsWith('更新于'));
  await afterDataMediaResponseTurn();
}

export function cmcDetail(overrides = {}) {
  return {
    id: 1, name: 'Bitcoin', symbol: 'BTC', latestUpdateTime: '2026-09-16T00:00:00Z',
    profileCompletionScore: { percentage: 85 },
    statistics: {
      price: 60_000, priceChangePercentage24h: 2.5, marketCap: 1_200_000_000_000,
      marketCapChangePercentage24h: -1, ucm: 1_000_000_000, volume24h: 100_000_000,
      turnover: 0.05, fullyDilutedMarketCap: 1_300_000_000_000,
      fullyDilutedMarketCapChangePercentage24h: 0, liquidityMcapRatio: 0.03,
      totalSupply: 21_000_000, maxSupply: 21_000_000, circulatingSupply: 20_000_000,
      rank: 1,
    },
    ...overrides,
  };
}

export async function completeCmcData(host, detail = cmcDetail(), { symbol = 'BTC', slug = 'bitcoin', holder = { showFlag: true, count: 10_000 }, map = true } = {}) {
  if (map) {
    const request = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/map') && request.url.searchParams.get('symbol') === symbol);
    request.respond({ data: [{ id: detail.id, symbol, slug, is_active: 1 }] });
  }
  const request = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/detail') && request.url.searchParams.get('id') === String(detail.id));
  request.respond({ data: detail });
  if (!detail.showTreasuriesFlag) {
    const holders = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/show_holders') && request.url.searchParams.get('cryptoId') === String(detail.id));
    holders.respond({ data: holder });
  }
  await host.rendered(panel => panel?.querySelector('a')?.textContent === 'CMC data-api');
}
