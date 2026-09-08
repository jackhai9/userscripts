import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readSignalGatewaySettings } from '../../src/shared/signal-client-settings.js';
import { migrateStrategy29Preferences, isStrategy29CompanionReady } from '../../src/shared/strategy29-preferences-migration.js';

test('signal settings retain the existing private installation keys', () => {
  const read = [];
  const settings = readSignalGatewaySettings((key, initial) => {
    read.push(key);
    return key === 'strategy27GatewayAuthSecret' ? 'synthetic-existing-secret' : initial;
  });
  assert.deepEqual(read, ['strategy27GatewayAuthSecret', 'strategy27GatewayOrigin']);
  assert.deepEqual(settings, { authSecret: 'synthetic-existing-secret', gatewayOrigin: 'http://127.0.0.1:18765' });
});

for (const forbidden of ['secret', 'origin', 'cursor', 'events', 'Authorization']) {
  test(`migration rejects the unexpected ${forbidden} field before private writes`, () => {
    const view = { [Symbol.for('jh-userscripts.strategy29-preferences-migration')]: {
      version: 1, enabled: true, position: null, [forbidden]: 'synthetic-value',
    } };
    let writes = 0;
    assert.throws(() => migrateStrategy29Preferences(view, (_key, initial) => initial, () => { writes += 1; }), /record is invalid/);
    assert.equal(writes, 0);
  });
}

for (const order of [[27, 29], [29, 27]]) {
 for (const migrated of [false, true]) {
  test(`generated clients share one private gateway with load order ${order.join('-')} and migrated=${migrated}`, async () => {
    const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/zh-CN/futures/ARBUSDT', pretendToBeVisual: true });
    const page = dom.window;
    page.prompt = () => { throw new Error('Private prompt crossed the page boundary'); };
    const hostValues = new Map([['strategy27GatewayAuthSecret', 'synthetic-existing-secret']]);
    if (migrated) {
      hostValues.set('strategy29UnifiedPreferencesMigrated', true);
      hostValues.set('strategy29RemoteSummaryEnabled', true);
      hostValues.set('strategy29SummaryPanelPosition', { left: 60, top: 70 });
    }
    const localValues = new Map([
      ['strategy29RemoteSummaryEnabled', true], ['strategy29SummaryPanelPosition', { left: 30, top: 40 }],
      ['strategy29GatewayAuthSecret', 'synthetic-obsolete-secret'],
    ]);
    const requests = [];
    const menus = new Map();
    const timers = new Map();
    page.setInterval = callback => { const id = timers.size + 1; timers.set(id, callback); return id; };
    page.clearInterval = id => timers.delete(id);
    for (const id of order) {
      const values = id === 27 ? hostValues : localValues;
      const sandbox = {
        unsafeWindow: page, prompt: () => null, URL, AbortController, DOMException, console,
        GM_getValue: (key, initial) => values.has(key) ? values.get(key) : initial,
        GM_setValue: (key, value) => { assert.equal(id, 27); values.set(key, value); },
        GM_registerMenuCommand: (label, run, options = {}) => {
          assert.equal(id, 27);
          const menuId = options.id ?? menus.size + 1;
          menus.set(menuId, { label, run });
          return menuId;
        },
        GM_xmlhttpRequest: options => {
          assert.equal(id, 27);
          requests.push(options);
          queueMicrotask(() => options.onload({ status: 503, responseText: JSON.stringify({ schema_version: 1, error: 'module_disabled', strategy_id: '29', status: 'disabled' }) }));
          return { abort() { options.onabort(); } };
        },
      };
      const name = id === 27 ? 'binance-strategy27-events' : 'binance-strategy29-bollinger';
      vm.runInNewContext(await readFile(new URL(`../../scripts/${name}.user.js`, import.meta.url), 'utf8'), sandbox);
      await new Promise(setImmediate);
      if (id === 27 && order[0] === 27) {
        page.document.dispatchEvent(new page.Event('visibilitychange'));
        page.dispatchEvent(new page.Event('pageshow'));
        [...menus.values()].find(menu => menu.label.includes('重新连接')).run();
        assert.equal(page.__TM_SIGNAL_CLIENT_DEBUG__.strategy29.state, 'waiting_for_companion');
        assert.equal(page.__TM_SIGNAL_CLIENT_DEBUG__.strategy29.moduleFailure, null);
        assert.equal(requests.length, 0);
      }
    }
    page.dispatchEvent(new page.Event('jh-strategy29-preferences-ready'));
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:18765/v1/strategy29/status');
    assert.equal(requests[0].headers.Authorization, 'Bearer synthetic-existing-secret');
    assert.equal(page.__TM_SIGNAL_CLIENT_DEBUG__.strategy29.state, 'module_disabled');
    assert.equal(page.document.querySelectorAll('#jh-strategy29-summary-panel').length, 1);
    assert.match(page.document.querySelector('#jh-strategy29-summary-panel').textContent, /服务端尚未启用/);
    assert.equal(hostValues.get('strategy29SummaryPanelPosition').left, migrated ? 60 : 30);
    assert.equal(hostValues.get('strategy29SummaryPanelPosition').top, migrated ? 70 : 40);
    assert.equal(hostValues.get('strategy29RemoteSummaryEnabled'), true);
    assert.equal(hostValues.get('strategy27GatewayAuthSecret'), 'synthetic-existing-secret');
    assert.equal(hostValues.has('strategy29GatewayAuthSecret'), false);
    const labels = [...menus.values()].map(menu => menu.label);
    assert.deepEqual(labels.filter(label => label.includes('网关密钥')), ['设置 CorsairQuant 网关密钥']);
    assert.equal(timers.size, 2);
    assert.equal(page.document.getElementById('jh-strategy29-client-upgrade'), null);
    assert.doesNotMatch(JSON.stringify(page[Symbol.for('jh-userscripts.strategy29-preferences-migration')]), /secret|origin|cursor|events/i);
    page.dispatchEvent(new page.Event('beforeunload'));
    page.__TM_STRATEGY29_DEBUG__.dispose();
    assert.equal(timers.size, 0);
    dom.window.close();
  });
 }
}

test('completed migration does not bypass readiness validation', () => {
  const page = { [Symbol.for('jh-userscripts.strategy29-preferences-migration')]: { version: 1, secret: 'synthetic' } };
  assert.throws(() => isStrategy29CompanionReady(page), /invalid/);
  assert.throws(() => migrateStrategy29Preferences(page, () => true, () => assert.fail('write')), /invalid/);
});

/** Frozen released entry reproduces real ownership during independently scheduled Tampermonkey updates. */
for (const order of [['legacy', 'host'], ['host', 'legacy']]) {
  test(`partial upgrade preserves the legacy remote owner: ${order.join('-')}`, async (t) => {
    const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/zh-CN/futures/ARBUSDT', pretendToBeVisual: true });
    const page = dom.window;
    const requests = [];
    const timers = new Map();
    const menus = new Map();
    let timerId = 0;
    page.setInterval = callback => { timers.set(++timerId, callback); return timerId; };
    page.clearInterval = id => timers.delete(id);
    t.after(() => { page.dispatchEvent(new page.Event('beforeunload')); page.__TM_STRATEGY29_DEBUG__.dispose(); page.close(); });
    async function run(kind) {
      const path = kind === 'legacy' ? '../fixtures/strategy29-migration/legacy-0.3.0.user.js'
        : kind === 'local' ? '../../scripts/binance-strategy29-bollinger.user.js' : '../../scripts/binance-strategy27-events.user.js';
      vm.runInNewContext(await readFile(new URL(path, import.meta.url), 'utf8'), {
        unsafeWindow: page, prompt: () => null, URL, AbortController, DOMException, console,
        GM_getValue: (key, initial) => key.endsWith('AuthSecret') ? 'synthetic-existing-secret' : key === 'strategy29RemoteSummaryEnabled' ? true : initial,
        GM_setValue: () => assert.fail('No migration is possible with the legacy owner'),
        GM_registerMenuCommand: (label, run, options = {}) => { const id = options.id ?? menus.size + 1; menus.set(id, { kind, label, run }); return id; },
        GM_xmlhttpRequest: options => { requests.push({ kind, options }); return { abort() { options.onabort(); } }; },
      });
      await new Promise(setImmediate);
    }
    let legacyPanel;
    for (const kind of order) {
      await run(kind);
      if (kind === 'legacy') legacyPanel = page.document.getElementById('jh-strategy29-summary-panel');
    }
    assert.equal(page.document.getElementById('jh-strategy29-summary-panel'), legacyPanel);
    assert.equal(page.document.querySelectorAll('#jh-strategy29-summary-panel').length, 1);
    assert.equal(requests.filter(r => r.kind === 'legacy').length, 1);
    assert.equal(requests.filter(r => r.kind === 'host').length, 0);
    assert.equal([...menus.values()].filter(m => m.kind === 'host').length, 4);
    assert.equal(page.__TM_SIGNAL_CLIENT_DEBUG__.strategy29.state, 'waiting_for_companion');
    page.document.dispatchEvent(new page.Event('visibilitychange'));
    page.dispatchEvent(new page.PageTransitionEvent('pagehide', { persisted: true }));
    page.dispatchEvent(new page.Event('pageshow'));
    [...menus.values()].find(m => m.kind === 'host' && m.label.includes('重新连接')).run();
    for (const callback of timers.values()) callback();
    assert.equal(page.__TM_SIGNAL_CLIENT_DEBUG__.strategy29.moduleFailure, null);
    assert.equal(requests.filter(r => r.kind === 'host').length, 0);
    await assert.rejects(run('local'), /Incompatible Strategy 29 runtime; reload/);
    assert.equal(isStrategy29CompanionReady(page), false);
    assert.equal(page.document.getElementById('jh-strategy29-summary-panel'), legacyPanel);
  });
}
