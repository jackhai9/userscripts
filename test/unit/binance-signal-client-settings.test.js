import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readSignalGatewaySettings } from '../../src/shared/signal-client-settings.js';
import { migrateStrategy29Preferences } from '../../src/shared/strategy29-preferences-migration.js';

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
  test(`generated clients share one private gateway with load order ${order.join('-')}`, async () => {
    const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/zh-CN/futures/ARBUSDT', pretendToBeVisual: true });
    const page = dom.window;
    page.prompt = () => { throw new Error('Private prompt crossed the page boundary'); };
    const hostValues = new Map([['strategy27GatewayAuthSecret', 'synthetic-existing-secret']]);
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
    }
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:18765/v1/strategy29/status');
    assert.equal(requests[0].headers.Authorization, 'Bearer synthetic-existing-secret');
    assert.equal(page.__TM_SIGNAL_CLIENT_DEBUG__.strategy29.state, 'module_disabled');
    assert.equal(page.document.querySelectorAll('#jh-strategy29-summary-panel').length, 1);
    assert.match(page.document.querySelector('#jh-strategy29-summary-panel').textContent, /服务端尚未启用/);
    assert.equal(hostValues.get('strategy29SummaryPanelPosition').left, 30);
    assert.equal(hostValues.get('strategy29SummaryPanelPosition').top, 40);
    assert.equal(hostValues.get('strategy29RemoteSummaryEnabled'), true);
    assert.equal(hostValues.get('strategy27GatewayAuthSecret'), 'synthetic-existing-secret');
    assert.equal(hostValues.has('strategy29GatewayAuthSecret'), false);
    const labels = [...menus.values()].map(menu => menu.label);
    assert.deepEqual(labels.filter(label => label.includes('网关密钥')), ['设置 CorsairQuant 网关密钥']);
    assert.equal(timers.size, 2);
    assert.doesNotMatch(JSON.stringify(page[Symbol.for('jh-userscripts.strategy29-preferences-migration')]), /secret|origin|cursor|events/i);
    page.dispatchEvent(new page.Event('beforeunload'));
    page.__TM_STRATEGY29_DEBUG__.dispose();
    assert.equal(timers.size, 0);
    dom.window.close();
  });
}
