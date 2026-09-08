import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStrategy29RemoteSummary,
} from '../../../src/binance-strategy29-bollinger/remote-summary.js';
import { formatLocalizedText } from '../../../src/binance-strategy29-bollinger/ui-copy.js';
import { Strategy29GatewayTransportError } from '../../../src/binance-strategy29-bollinger/core/remote-summary-client.js';

function fixture({ available = true, authSecret = 'synthetic-secret', poll } = {}) {
  const values = new Map([
    ['strategy29GatewayAuthSecret', authSecret],
    ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
  ]);
  const gatewayState = { available, configured: authSecret.length > 0, settingsRevision: 0 };
  const menus = [];
  const panels = [];
  const prompts = [];
  const view = {
    location: { pathname: '/en/futures/BTRUSDT' },
    document: { body: {} },
    console: { warn() {} },
  };
  const clients = [];
  const summary = createStrategy29RemoteSummary({
    view,
    request: async () => { throw new Error('unexpected raw request'); },
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand: (label, callback, options) => {
      const id = options?.id ?? menus.length;
      menus[id] = { label, callback };
      return id;
    },
    getGatewayState: () => gatewayState,
    createPanel: (_document, canonicalSymbol, options) => {
      const calls = [];
      const panel = {
        canonicalSymbol,
        options,
        locale: options.locale,
        calls,
        setLocale: locale => { panel.locale = locale; calls.push(['locale', locale]); },
        setConnection: (state, message) => calls.push(['connection', state, formatLocalizedText(message, panel.locale)]),
        renderStatus: (...args) => calls.push(['status', ...args]),
        addEvents: (...args) => calls.push(['events', ...args]),
        clearEvents: (...args) => calls.push(['clear', ...args]),
        destroy: () => calls.push(['destroy']),
      };
      panels.push(panel);
      return panel;
    },
    createClient: (options) => {
      const client = {
        options,
        diagnostics: { cursor: null },
        poll: poll ?? (async () => ({ state: 'connected', pages: 1, hasMore: false })),
      };
      clients.push(client);
      return client;
    },
  });
  return { view, values, gatewayState, menus, prompts, panels, clients, summary };
}

test('waits without a panel until the shared gateway becomes available', async () => {
  const f = fixture({ available: false });
  assert.equal(f.summary.sample(0), undefined);
  assert.equal(f.panels.length, 0);
  assert.equal(f.clients.length, 0);
  assert.equal(f.summary.diagnostics.state, 'waiting_for_gateway');
  f.gatewayState.available = true;
  await f.summary.sample(1);
  assert.equal(f.clients.length, 1);
  assert.equal(f.summary.diagnostics.state, 'connected');
});

test('pause preserves the current client and panel and permits one resumed request', async () => {
  let completeOld;
  const oldResponse = new Promise(resolve => { completeOld = resolve; });
  let polls = 0;
  const signals = [];
  const f = fixture({ poll: signal => {
    signals.push(signal);
    polls += 1;
    return polls === 1 ? oldResponse : new Promise(() => {});
  } });
  const oldPoll = f.summary.sample(0);
  f.summary.pause();
  assert.equal(signals[0].aborted, true);
  assert.equal(f.summary.diagnostics.contextPresent, true);
  assert.equal(f.panels[0].calls.some(call => call[0] === 'destroy'), false);
  f.summary.sample(1);
  assert.equal(f.clients.length, 1);
  assert.equal(f.panels.length, 1);
  assert.equal(signals[1].aborted, false);
  completeOld({ state: 'connected', pages: 1, hasMore: false });
  await oldPoll;
  assert.equal(f.summary.diagnostics.inFlight, true);
  assert.equal(f.summary.diagnostics.state, 'connecting');
  assert.equal(f.summary.sample(10_000), undefined);
  assert.equal(polls, 2);
  f.summary.dispose();
});

test('remote module owns no gateway configuration menu and uses host settings', async () => {
  const f = fixture();
  await f.summary.sample(0);
  assert.deepEqual(f.menus.map(menu => menu.label), []);
  assert.equal(Object.hasOwn(f.clients[0].options, 'authSecret'), false);
  assert.equal(Object.hasOwn(f.clients[0].options, 'gatewayOrigin'), false);
});

test('polls the current route symbol independently of the visible chart interval', async () => {
  const f = fixture();
  await f.summary.sample(0);
  assert.equal(f.panels[0].canonicalSymbol, 'BTR/USDT:USDT');
  assert.equal(f.clients[0].options.canonicalSymbol, 'BTR/USDT:USDT');
  assert.equal(f.summary.diagnostics.inFlight, false);
  assert.equal(f.summary.diagnostics.state, 'connected');
  assert.equal(f.summary.sample(4_999), undefined);
  assert.equal(f.clients.length, 1);
});

test('route retirement aborts ownership and ignores a late old-symbol response', async () => {
  let resolve;
  let polls = 0;
  const pending = new Promise((value) => { resolve = value; });
  const f = fixture({ poll: () => {
    polls += 1;
    return polls === 1 ? pending : Promise.resolve({ state: 'connected', pages: 1, hasMore: false });
  } });
  const first = f.summary.sample(0);
  f.view.location.pathname = '/en/futures/ETHUSDT';
  await f.summary.sample(1_000);
  resolve({ state: 'connected', pages: 1, hasMore: false });
  await first;
  assert.deepEqual(f.panels[0].calls.at(-1), ['destroy']);
  assert.equal(f.panels[1].canonicalSymbol, 'ETH/USDT:USDT');
  assert.notEqual(f.summary.diagnostics.canonicalSymbol, 'BTR/USDT:USDT');
});

test('transport and contract failures remain remote-only and never expose the secret', async () => {
  for (const error of [
    new Strategy29GatewayTransportError('offline'),
    new TypeError('invalid response contract'),
  ]) {
    const f = fixture({ poll: async () => { throw error; } });
    await f.summary.sample(0);
    assert.equal(f.summary.diagnostics.inFlight, false);
    assert.equal(f.summary.diagnostics.state, error instanceof TypeError ? 'stopped' : 'disconnected');
    assert.doesNotMatch(JSON.stringify(f.summary.diagnostics), /synthetic-secret/);
  }
});

test('missing secret creates a visible configuration state without constructing a client', async () => {
  const f = fixture({ authSecret: '' });
  await f.summary.sample(0);
  assert.equal(f.clients.length, 0);
  assert.deepEqual(f.panels[0].calls[0], ['connection', 'configuration_required', 'Gateway secret is not configured']);
});

test('settings revision retires the prior client and reconstructs the active route', async () => {
  const f = fixture();
  await f.summary.sample(0);
  f.gatewayState.settingsRevision += 1;
  await f.summary.sample(1);
  assert.equal(f.clients.length, 2);
  assert.deepEqual(f.panels[0].calls.at(-1), ['destroy']);
  assert.equal(f.summary.diagnostics.gatewayRevision, 1);
});

test('unsupported futures route is classified once without a retry/log loop', async () => {
  const f = fixture();
  let warnings = 0;
  f.view.console.warn = () => { warnings += 1; };
  f.view.location.pathname = '/en/futures/BTCUSD_PERP';
  await f.summary.sample(0);
  await f.summary.sample(1_000);
  assert.equal(f.summary.diagnostics.state, 'unsupported_route');
  assert.equal(warnings, 1);
  assert.equal(f.panels.length, 0);
  assert.equal(f.clients.length, 0);
});

test('locale switches preserve the pending request, client cursor and panel while updating existing menu IDs', async () => {
  let complete;
  let requestSignal;
  const f = fixture({ poll: signal => { requestSignal = signal; return new Promise(resolve => { complete = resolve; }); } });
  const pending = f.summary.sample(0);
  f.clients[0].diagnostics.cursor = 41;
  f.view.location.pathname = '/zh-CN/futures/BTRUSDT';
  assert.equal(f.summary.sample(1), undefined);
  assert.equal(f.clients.length, 1);
  assert.equal(f.panels.length, 1);
  assert.equal(f.panels[0].locale, 'zh-CN');
  assert.equal(f.summary.diagnostics.cursor, 41);
  assert.equal(requestSignal.aborted, false);
  assert.equal(f.menus.length, 0);
  assert.deepEqual(f.menus.map(menu => menu.label), []);
  complete({ state: 'connected', pages: 1, hasMore: false });
  await pending;
  assert.deepEqual(f.panels[0].calls.at(-1), ['connection', 'connected', '已连接']);
  f.view.location.pathname = '/en/futures/BTRUSDT';
  f.summary.sample(2);
  assert.equal(f.panels[0].locale, 'en');
  assert.equal(f.summary.diagnostics.cursor, 41);
  assert.equal(f.clients.length, 1);
  assert.equal(f.menus.length, 0);
  f.summary.dispose();
});

test('no-auth locale change updates the existing panel and localized prompts without creating a client', () => {
  const f = fixture({ authSecret: '' });
  f.summary.sample(0);
  f.view.location.pathname = '/zh-CN/futures/BTRUSDT';
  f.summary.sample(1);
  assert.equal(f.panels.length, 1);
  assert.equal(f.panels[0].locale, 'zh-CN');
  assert.equal(f.clients.length, 0);
  assert.equal(f.summary.diagnostics.state, 'configuration_required');
  assert.deepEqual(f.menus.map(menu => menu.label), []);
  f.summary.dispose();
});

test('position adapters persist only the dedicated coordinate value and restore it across symbol contexts', async () => {
  const f = fixture();
  await f.summary.sample(0);
  assert.equal(f.panels[0].options.loadPosition(), null);
  f.panels[0].options.savePosition({ left: 72, top: 124 });
  assert.deepEqual(f.values.get('strategy29SummaryPanelPosition'), { left: 72, top: 124 });
  f.view.location.pathname = '/en/futures/ETHUSDT';
  await f.summary.sample(1);
  assert.deepEqual(f.panels[1].options.loadPosition(), { left: 72, top: 124 });
  assert.equal(f.values.get('strategy29GatewayAuthSecret'), 'synthetic-secret');
  f.summary.dispose();
});
