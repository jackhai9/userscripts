import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRATEGY29_REMOTE_ENABLED_KEY,
  createStrategy29RemoteSummary,
} from '../../../src/binance-strategy29-bollinger/remote-summary.js';
import { Strategy29GatewayTransportError } from '../../../src/binance-strategy29-bollinger/core/remote-summary-client.js';

function fixture({ enabled = true, authSecret = 'synthetic-secret', poll } = {}) {
  const values = new Map([
    [STRATEGY29_REMOTE_ENABLED_KEY, enabled],
    ['strategy29GatewayAuthSecret', authSecret],
    ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
  ]);
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
    registerMenuCommand: (label, callback) => menus.push({ label, callback }),
    promptUser: (...args) => { prompts.push(args); return null; },
    createPanel: (_document, canonicalSymbol) => {
      const calls = [];
      const panel = {
        canonicalSymbol,
        calls,
        setConnection: (...args) => calls.push(['connection', ...args]),
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
  return { view, values, menus, prompts, panels, clients, summary };
}

test('remote summary is opt-in and registers configuration without requesting data', async () => {
  const f = fixture({ enabled: false });
  assert.equal(f.summary.sample(0), undefined);
  assert.equal(f.panels.length, 0);
  assert.equal(f.clients.length, 0);
  assert.equal(f.menus.length, 3);
  assert.equal(f.summary.diagnostics.enabled, false);
});

test('gateway configuration uses only the injected userscript prompt adapter', () => {
  const f = fixture({ enabled: false });
  f.view.prompt = () => { throw new Error('page prompt must not be called'); };
  f.menus.find(menu => menu.label === 'Set Strategy 29 gateway secret').callback();
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0][0], /gateway secret/);
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

test('invalid stored origin stops one visible remote context without per-second reconstruction', async () => {
  const f = fixture();
  f.values.set('strategy29GatewayOrigin', 'https://127.0.0.1:8729');
  await f.summary.sample(0);
  await f.summary.sample(10_000);
  assert.equal(f.panels.length, 1);
  assert.equal(f.clients.length, 0);
  assert.equal(f.summary.diagnostics.state, 'stopped');
  assert.match(f.panels[0].calls[0][2], /loopback origin/);
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
