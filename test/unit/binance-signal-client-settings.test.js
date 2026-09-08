import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readSignalGatewaySettings } from '../../src/shared/signal-client-settings.js';

test('signal settings retain the existing private installation keys', () => {
  const read = [];
  const settings = readSignalGatewaySettings((key, initial) => {
    read.push(key);
    return key === 'strategy27GatewayAuthSecret' ? 'synthetic-existing-secret' : initial;
  });
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
    local: new Map([['strategy29SummaryPanelPosition', { left: 30, top: 40 }], ['strategy29RemoteSummaryEnabled', false]]),
  };
  async function run(kind) {
    const values = kind === 'host' || kind === 'old-host' ? stores.host : stores.local;
    const path = {
      host: '../../scripts/binance-strategy27-events.user.js', local: '../../scripts/binance-strategy29-bollinger.user.js',
      'old-host': '../fixtures/strategy29-migration/host-0.5.1.user.js',
      'old-local': '../fixtures/strategy29-migration/local-0.4.1.user.js',
      legacy: '../fixtures/strategy29-migration/legacy-0.3.0.user.js',
    }[kind];
    vm.runInNewContext(await readFile(new URL(path, import.meta.url), 'utf8'), {
      unsafeWindow: page, prompt: () => null, URL, AbortController, DOMException, console,
      GM_getValue(key, initial) {
        reads.push({ kind, key });
        if (kind === 'legacy' && key === 'strategy29RemoteSummaryEnabled') return true;
        if (kind === 'legacy' && key.endsWith('AuthSecret')) return 'synthetic-legacy-secret';
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
  test(`Strategy29 owns the default summary and private position: ${order.join('-')}`, async t => {
    const f = await fixture(t);
    for (const kind of order) await f.run(kind);
    await f.tick();
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
    assert.deepEqual([...new Set(f.reads.filter(read => read.kind === 'local').map(read => read.key))], ['strategy29PanelPositionHandoffVersion', 'strategy29SummaryPanelPosition']);
    assert.deepEqual(f.writes, [{ kind: 'local', key: 'strategy29PanelPositionHandoffVersion' }]);
    assert.equal(f.menus.length, 4);
    assert.equal(f.menus.some(menu => /切换.*29|Toggle.*29/.test(menu.label)), false);
    assert.equal(f.timers.size, 2);
    assert.equal(f.page.document.getElementById('jh-strategy29-client-upgrade'), null);
    f.page.__TM_STRATEGY29_DEBUG__.dispose();
    assert.equal(f.page.document.querySelector('#jh-strategy29-summary-panel'), null);
    assert.equal(f.page[Symbol.for('jh-userscripts.signal-gateway')].getState().configured, true);
  });
}

for (const pair of [['old-host', 'local'], ['host', 'old-local'], ['host', 'legacy']]) {
  for (const order of [pair, [...pair].reverse()]) {
    test(`staged upgrade cannot duplicate the summary: ${order.join('-')}`, async t => {
      const f = await fixture(t);
      let legacyPanel;
      for (const kind of order) {
        await f.run(kind);
        if (kind === 'legacy') legacyPanel = f.page.document.querySelector('#jh-strategy29-summary-panel');
      }
      await f.tick();
      const legacy = pair.includes('legacy');
      assert.equal(f.page.document.querySelectorAll('#jh-strategy29-summary-panel').length, legacy ? 1 : 0);
      assert.equal(f.requests.filter(request => request.kind !== 'legacy').length, 0);
      if (legacy) {
        assert.equal(f.page.document.querySelector('#jh-strategy29-summary-panel'), legacyPanel);
        await assert.rejects(f.run('local'), /Incompatible Strategy 29 runtime/);
        assert.equal(f.page.document.querySelector('#jh-strategy29-summary-panel'), legacyPanel);
      }
      if (pair.includes('old-host')) {
        assert.equal(f.page.__TM_STRATEGY29_DEBUG__.diagnostics.remoteSummary.state, 'waiting_for_gateway');
        assert.match(f.page.document.querySelector('#jh-strategy29-client-upgrade').textContent, /更新/);
      }
    });
  }
}


for (const order of [['host', 'local'], ['local', 'host']]) {
  test(`host-owned position is handed back once: ${order.join('-')}`, async t => {
    const f = await fixture(t);
    f.stores.host.set('strategy29SummaryPanelPosition', { left: 200, top: 250 });
    for (const kind of order) await f.run(kind);
    await f.tick();
    const panel = f.page.document.getElementById('jh-strategy29-summary-panel');
    assert.equal(panel.style.left, '200px');
    assert.equal(panel.style.top, '250px');
    assert.equal(f.stores.local.get('strategy29PanelPositionHandoffVersion'), 1);
    f.stores.local.set('strategy29SummaryPanelPosition', { left: 80, top: 90 });
    const reloaded = await fixture(t, f.stores);
    for (const kind of order) await reloaded.run(kind);
    await reloaded.tick();
    const restored = reloaded.page.document.getElementById('jh-strategy29-summary-panel');
    assert.equal(restored.style.left, '80px');
    assert.equal(restored.style.top, '90px');
    assert.equal(reloaded.writes.filter(write => write.kind === 'local').length, 0);
  });
}

test('invalid legacy position stops only the summary without copying malformed private values', async t => {
  const f = await fixture(t);
  f.stores.host.set('strategy29SummaryPanelPosition', { left: 'broken', top: 80, privateExtra: 'synthetic-value' });
  await f.run('host');
  await f.run('local');
  await f.tick();
  const record = f.page[Symbol.for('jh-userscripts.strategy29-panel-position-handoff')];
  assert.equal(JSON.stringify(record), JSON.stringify({ version: 1, error: 'invalid_position' }));
  assert.equal(f.page[Symbol.for('jh-userscripts.signal-gateway')].version, 1);
  assert.equal(f.page.__TM_STRATEGY29_DEBUG__.diagnostics.remoteSummary.state, 'stopped');
  assert.equal(f.page.__TM_STRATEGY29_DEBUG__.diagnostics.runtimeFailure, null);
  assert.equal(f.writes.filter(write => write.kind === 'local').length, 0);
  assert.equal(f.timers.size, 2);
});
