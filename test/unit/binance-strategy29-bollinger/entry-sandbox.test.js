import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { SIGNAL_GATEWAY_BRIDGE } from '../../../src/shared/signal-gateway-bridge.js';
import { installStrategyClock } from '../../helpers/strategy-migration-boundaries.js';

const ENTRY = 'src/binance-strategy29-bollinger/index.user.js';

async function bundledEntry() {
  const result = await build({ entryPoints: [ENTRY], bundle: true, write: false, format: 'iife' });
  return result.outputFiles[0].text;
}

function preferenceSandbox(t, stored, symbol = 'BTCUSDT') {
  const dom = new JSDOM('<body></body>', {
    url: `https://www.binance.com/en/futures/${symbol}`, pretendToBeVisual: true,
  });
  const reads = [];
  const writes = [];
  Object.defineProperty(dom.window, SIGNAL_GATEWAY_BRIDGE, { value: {
    version: 1,
    getState: () => ({ available: true, configured: false, settingsRevision: 0 }),
    request() { throw new Error('Unconfigured gateway must not receive a request'); },
  } });
  const sandbox = {
    unsafeWindow: dom.window,
    GM_getValue(key, initial) {
      reads.push({ key, initial });
      return stored.has(key) ? stored.get(key) : initial;
    },
    GM_setValue(key, value) {
      const saved = structuredClone(value);
      stored.set(key, saved);
      writes.push({ key, value: saved });
    },
    URL, AbortController, DOMException, console,
  };
  t.after(() => { dom.window.__TM_STRATEGY29_DEBUG__?.dispose(); dom.window.close(); });
  return { dom, sandbox, reads, writes, panel: () => dom.window.document.getElementById('jh-strategy29-summary-panel') };
}

for (const [label, initial, collapsed] of [
  ['starts collapsed without a saved preference', undefined, true],
  ['restores a saved collapsed preference', true, true],
  ['restores a saved expanded preference', false, false],
]) {
  test(`user ${label} through the sandbox entry and retains the saved position`, async (t) => {
    // Given this userscript's private preference storage and its own saved panel position.
    const stored = new Map([['strategy29SummaryPanelPosition', { left: 140, top: 160 }]]);
    if (initial !== undefined) stored.set('strategy29SummaryPanelCollapsed', initial);
    const fixture = preferenceSandbox(t, stored);

    // When the actual bundled userscript starts its current-symbol summary.
    vm.runInNewContext(await bundledEntry(), fixture.sandbox);

    // Then the initial presentation uses the saved boolean without writing a new preference.
    const panel = fixture.panel();
    assert.equal(panel.querySelector('[data-role=body]').style.display, collapsed ? 'none' : 'block');
    assert.equal(panel.querySelector('[data-role=collapse]').getAttribute('aria-expanded'), String(!collapsed));
    assert.equal(panel.querySelector('[data-role=collapse]').textContent, collapsed ? 'Expand' : 'Collapse');
    assert.equal(panel.style.left, '140px');
    assert.equal(panel.style.top, '160px');
    assert.deepEqual(fixture.reads.filter(({ key }) => key === 'strategy29SummaryPanelCollapsed'), [
      { key: 'strategy29SummaryPanelCollapsed', initial: true },
    ]);
    assert.deepEqual(fixture.reads.map(({ key }) => key).sort(), ['strategy29SummaryPanelCollapsed', 'strategy29SummaryPanelPosition']);
    assert.deepEqual(fixture.writes, []);
    assert.equal(fixture.dom.window.__TM_STRATEGY29_DEBUG__.diagnostics.remoteSummary.state, 'configuration_required');
    assert.equal(fixture.dom.window.__TM_STRATEGY29_DEBUG__.diagnostics.timerRunning, true);
  });
}

test('user restores the shared fold preference only when another tab or symbol creates a panel', async (t) => {
  // Given one installed summary and private storage shared by a second tab.
  const stored = new Map([['strategy29SummaryPanelPosition', { left: 140, top: 160 }]]);
  const source = await bundledEntry();
  const first = preferenceSandbox(t, stored);
  vm.runInNewContext(source, first.sandbox);
  const firstPanel = first.panel();

  // When the user expands the first tab and opens a different symbol in another tab.
  firstPanel.querySelector('[data-role=collapse]').click();
  const second = preferenceSandbox(t, stored, 'ETHUSDT');
  vm.runInNewContext(source, second.sandbox);

  // Then the second panel restores the expanded preference without rewriting either saved preference.
  const secondPanel = second.panel();
  assert.equal(stored.get('strategy29SummaryPanelCollapsed'), false);
  assert.equal(firstPanel.querySelector('[data-role=body]').style.display, 'block');
  assert.equal(secondPanel.querySelector('[data-role=body]').style.display, 'block');
  assert.deepEqual(second.writes, []);

  // When the first tab collapses and the existing second tab changes only its locale.
  firstPanel.querySelector('[data-role=collapse]').click();
  second.dom.window.history.pushState({}, '', '/zh-CN/futures/ETHUSDT');

  // Then the stored preference changes while the existing second panel remains expanded.
  assert.equal(stored.get('strategy29SummaryPanelCollapsed'), true);
  assert.equal(second.panel(), secondPanel);
  assert.equal(secondPanel.querySelector('[data-role=body]').style.display, 'block');
  assert.equal(secondPanel.querySelector('[data-role=collapse]').textContent, '收起');
  assert.deepEqual(second.writes, []);

  // When the second tab navigates to another symbol and creates a new summary.
  second.dom.window.history.pushState({}, '', '/zh-CN/futures/SOLUSDT');

  // Then the replacement reads the latest collapsed preference and retains its own saved position.
  assert.equal(secondPanel.isConnected, false);
  assert.equal(second.panel().querySelector('[data-role=body]').style.display, 'none');
  assert.equal(second.panel().querySelector('[data-role=collapse]').getAttribute('aria-expanded'), 'false');
  assert.equal(second.panel().querySelector('[data-role=symbol]').textContent, 'SOL/USDT:USDT');
  assert.equal(second.panel().style.left, '140px');
  assert.equal(second.panel().style.top, '160px');
  assert.deepEqual(first.writes.filter(({ key }) => key === 'strategy29SummaryPanelCollapsed'), [
    { key: 'strategy29SummaryPanelCollapsed', value: false },
    { key: 'strategy29SummaryPanelCollapsed', value: true },
  ]);
  assert.deepEqual(second.writes, []);
});

test('user observes that sandbox entry reuses the page runtime with one timer across repeated injection', async (t) => {
  // Given the userscript sandbox and separate native page context
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT', pretendToBeVisual: true });
  const source = await bundledEntry();
  const clock = installStrategyClock(t, dom.window);
  t.after(() => { dom.window.__TM_STRATEGY29_DEBUG__?.dispose(); dom.window.close(); });
  const menus = [];
  const stored = new Map();
  let pagePromptCalls = 0;
  dom.window.prompt = () => { pagePromptCalls += 1; return 'captured-by-page'; };
  const sandbox = {
    unsafeWindow: dom.window,
    prompt(message) { return message.includes('secret') ? 'sandbox-secret' : null; },
    GM_xmlhttpRequest() { throw new Error('Strategy29 must use the shared transport'); },
    GM_getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    GM_setValue(key, value) { stored.set(key, value); },
    GM_registerMenuCommand(label, callback) { menus.push({ label, callback }); },
    URL,
    AbortController,
    DOMException,
    console,
  };
  // When the actual userscript is injected twice into the same native page
  vm.runInNewContext(source, sandbox);
  const firstRuntime = dom.window.__TM_STRATEGY29_DEBUG__;
  vm.runInNewContext(source, sandbox);
  // Then both injections share the page runtime and its single scheduling interval
  assert.equal(typeof dom.window.__TM_STRATEGY29_DEBUG__.dispose, 'function');
  assert.equal(sandbox.__TM_STRATEGY29_DEBUG__, undefined);
  assert.equal(dom.window.__TM_STRATEGY29_DEBUG__, firstRuntime);
  assert.equal(dom.window[Symbol.for('jh-userscripts.strategy29-bollinger')] === firstRuntime, true);
  assert.deepEqual([...clock.intervals.values()], [{ milliseconds: 1000 }]);
  assert.deepEqual(menus, []);
  assert.equal(stored.size, 0);
  assert.equal(dom.window.__TM_STRATEGY29_DEBUG__.diagnostics.remoteSummary.state, 'waiting_for_gateway');
  assert.equal(pagePromptCalls, 0);
  assert.match(dom.window.document.getElementById('jh-strategy29-client-upgrade').textContent, /Update or install the Strategy 27 signal client/);
  assert.equal(dom.window.document.getElementById('jh-strategy29-summary-panel'), null);
  dom.window.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');
  assert.match(dom.window.document.getElementById('jh-strategy29-client-upgrade').textContent, /更新或安装 Strategy 27 信号客户端/);
  assert.equal(dom.window.__TM_STRATEGY29_DEBUG__.diagnostics.timerRunning, true);
  dom.window.__TM_STRATEGY29_DEBUG__.dispose();
  assert.equal(dom.window.document.getElementById('jh-strategy29-client-upgrade'), null);
  dom.window.close();
});
