import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readSignalGatewaySettings } from '../../src/shared/signal-client-settings.js';

test('user observes that signal settings retain the existing private installation keys', () => {
  // Given the installed scripts have explicit settings and ownership state
  const read = [];
  // When the gateway reads its private configuration
  const settings = readSignalGatewaySettings((key, initial) => {
    read.push(key);
    return key === 'strategy27GatewayAuthSecret' ? 'synthetic-existing-secret' : initial;
  });
  // Then signal settings retain the existing private installation keys
  assert.deepEqual(read, ['strategy27GatewayAuthSecret', 'strategy27GatewayOrigin']);
  assert.deepEqual(settings, { authSecret: 'synthetic-existing-secret', gatewayOrigin: 'http://127.0.0.1:18765' });
});

async function fixture(t, existingStores = null) {
  const page = new JSDOM('<body></body>', { url: 'https://www.binance.com/zh-CN/futures/ARBUSDT', pretendToBeVisual: true }).window;
  const requests = [], menus = [], reads = [], writes = [], timers = new Map();
  let nextTimer = 0;
  page.setInterval = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
  page.clearInterval = id => timers.delete(id);
  t.after(() => { page.dispatchEvent(new page.Event('beforeunload')); page.__TM_STRATEGY29_DEBUG__?.dispose(); page.close(); });
  const stores = existingStores ?? {
    host: new Map([['strategy27GatewayAuthSecret', 'synthetic-existing-secret']]),
    local: new Map([['strategy29SummaryPanelPosition', { left: 30, top: 40 }]]),
  };
  async function run(kind) {
    const values = stores[kind];
    const path = {
      host: '../../scripts/binance-strategy27-events.user.js', local: '../../scripts/binance-strategy29-bollinger.user.js',
    }[kind];
    vm.runInNewContext(await readFile(new URL(path, import.meta.url), 'utf8'), {
      unsafeWindow: page, prompt: () => null, URL, AbortController, DOMException, console,
      GM_getValue(key, initial) {
        reads.push({ kind, key });
        return values.has(key) ? values.get(key) : initial;
      },
      GM_setValue(key, value) { writes.push({ kind, key }); values.set(key, value); },
      GM_registerMenuCommand(label, run) { menus.push({ kind, label, run }); return menus.length; },
      GM_xmlhttpRequest(options) {
        requests.push({ kind, options });
        queueMicrotask(() => options.onload({ status: 503, responseText: JSON.stringify({ schema_version: 1, error: 'module_disabled', strategy_id: '29', status: 'disabled' }) }));
        return { abort() { options.onabort(); } };
      },
    });
    await new Promise(setImmediate);
  }
  async function tick() { for (const fn of timers.values()) fn(); await new Promise(setImmediate); }
  return { page, requests, menus, reads, writes, stores, timers, run, tick };
}

for (const order of [['host', 'local'], ['local', 'host']]) {
  test(`user observes that Strategy29 owns the default summary and private position: ${order.join('-')}`, async t => {
    // Given the installed scripts have explicit settings and ownership state
    const f = await fixture(t);
    for (const kind of order) await f.run(kind);
    // When the current scripts sample the page after both have loaded
    await f.tick();
    // Then Strategy29 owns the default summary and private position: the selected script
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].kind, 'host');
    assert.equal(f.requests[0].options.url, 'http://127.0.0.1:18765/v1/strategy29/status');
    assert.equal(f.requests[0].options.headers.Authorization, 'Bearer synthetic-existing-secret');
    assert.equal(f.page.__TM_SIGNAL_CLIENT_DEBUG__, undefined);
    assert.equal(f.page.__TM_STRATEGY29_DEBUG__.diagnostics.remoteSummary.state, 'module_disabled');
    const panel = f.page.document.querySelector('#jh-strategy29-summary-panel');
    assert.equal(f.page.document.querySelectorAll('#jh-strategy29-summary-panel').length, 1);
    assert.match(panel.textContent, /服务端尚未启用/);
    assert.equal(panel.style.left, '30px');
    assert.equal(panel.style.top, '40px');
    assert.deepEqual([...new Set(f.reads.filter(read => read.kind === 'local').map(read => read.key))].sort(), ['strategy29SummaryPanelCollapsed', 'strategy29SummaryPanelPosition']);
    assert.equal(panel.querySelector('[data-role="body"]').style.display, 'none');
    assert.deepEqual(f.writes, []);
    assert.equal(f.menus.length, 4);
    assert.equal(f.menus.some(menu => /切换.*29|Toggle.*29/.test(menu.label)), false);
    assert.equal(f.timers.size, 2);
    assert.equal(f.page.document.getElementById('jh-strategy29-client-upgrade'), null);
    f.page.__TM_STRATEGY29_DEBUG__.dispose();
    assert.equal(f.page.document.querySelector('#jh-strategy29-summary-panel'), null);
    assert.equal(f.page[Symbol.for('jh-userscripts.signal-gateway')].getState().configured, true);
  });
}

for (const order of [['host', 'local'], ['local', 'host']]) {
  test(`user restores Strategy29 preferences from its own storage after reload: ${order.join('-')}`, async t => {
    // Given the current scripts use independent private preference stores
    const f = await fixture(t);
    f.stores.host.set('strategy27StatusPosition', { left: 200, top: 250 });
    for (const kind of order) await f.run(kind);
    await f.tick();

    // When the user expands the summary and reloads with its saved position
    f.page.document.querySelector('#jh-strategy29-summary-panel [data-role="collapse"]').click();
    f.stores.local.set('strategy29SummaryPanelPosition', { left: 80, top: 90 });
    const reloaded = await fixture(t, f.stores);
    for (const kind of order) await reloaded.run(kind);
    await reloaded.tick();

    // Then only Strategy29 preferences control the restored summary
    const restored = reloaded.page.document.getElementById('jh-strategy29-summary-panel');
    assert.equal(restored.style.left, '80px');
    assert.equal(restored.style.top, '90px');
    assert.equal(restored.querySelector('[data-role="body"]').style.display, 'block');
    assert.deepEqual(f.stores.host.get('strategy27StatusPosition'), { left: 200, top: 250 });
    assert.deepEqual(f.writes, [{ kind: 'local', key: 'strategy29SummaryPanelCollapsed' }]);
    assert.deepEqual(reloaded.writes, []);
  });
}
