import assert from 'node:assert/strict';
import test from 'node:test';
import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { SUMMARY_COPY } from '../../../src/binance-strategy29-bollinger/ui-copy.js';
import { createStrategy29SummaryPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function fixture(locale = 'zh-CN', stored = { left: 100, top: 120 }) {
  const dom = new JSDOM('<body></body>', { url: `https://www.binance.com/${locale}/futures/BTCUSDT` });
  const saves = [];
  const controller = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', {
    locale, loadPosition: () => stored, savePosition: value => saves.push(value),
  });
  const panel = dom.window.document.getElementById('jh-strategy29-summary-panel');
  const header = panel.querySelector('header');
  const captured = new Set();
  header.setPointerCapture = id => captured.add(id);
  header.hasPointerCapture = id => captured.has(id);
  header.releasePointerCapture = id => captured.delete(id);
  const fire = (node, type, x, y, overrides = {}) => node.dispatchEvent(new dom.window.PointerEvent(type, {
    bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, ...overrides,
  }));
  const close = () => { controller.destroy(); dom.window.close(); };
  return { dom, controller, panel, header, captured, fire, saves, close };
}

test('user observes that Chinese panel translates retained status and signals and switches to English without losing rows', () => {
  // Given the panel locale, viewport and saved coordinates
  const f = fixture();
  try {
    // When f.controller.renderStatus processes the configured inputs
    f.controller.renderStatus(status);
    f.controller.addEvents(events.events, events.observed_at_ms);
    // Then user observes that Chinese panel translates retained status and signals and switches to English without losing rows
    assert.match(f.panel.textContent, /Strategy 29 汇总/);
    assert.match(f.panel.textContent, /最近处理状态/);
    assert.match(f.panel.textContent, /看跌预警/);
    assert.match(f.panel.textContent, /全局通知/);
    assert.doesNotMatch(f.panel.textContent, /Global delivery|Last processing status|Bearish warning/);
    const ids = [...f.panel.querySelectorAll('[data-role=remote-event]')].map(e => e.dataset.eventId);
    f.controller.setLocale('en');
    assert.match(f.panel.textContent, /Strategy 29 Summary/);
    assert.match(f.panel.textContent, /Last processing status/);
    assert.match(f.panel.textContent, /Bearish warning/);
    assert.deepEqual([...f.panel.querySelectorAll('[data-role=remote-event]')].map(e => e.dataset.eventId), ids);
    assert.equal(f.panel.querySelectorAll('[data-role=unit]').length, 2);
    f.controller.setLocale('zh-CN');
    assert.match(f.panel.textContent, /看跌预警/);
    assert.equal(f.controller.size, 2);
  } finally { f.close(); }
});

test('user observes that header drag restores, clamps and saves position while buttons and destroyed panels never drag', () => {
  // Given the panel locale, viewport and saved coordinates
  const f = fixture();
  try {
    Object.defineProperties(f.dom.window, { innerWidth: { value: 500, configurable: true }, innerHeight: { value: 400, configurable: true } });
    f.panel.getBoundingClientRect = () => ({ left: parseFloat(f.panel.style.left), top: parseFloat(f.panel.style.top), width: 340, height: 200 });
    // When f.panel.querySelector processes the configured inputs
    const header = f.panel.querySelector('header');
    const { fire } = f;
    // Then user observes that header drag restores, clamps and saves position while buttons and destroyed panels never drag
    assert.equal(f.panel.style.left, '100px');
    assert.equal(f.panel.style.top, '120px');
    fire(header, 'pointerdown', 120, 130);
    assert.deepEqual([...f.captured], [1]);
    fire(header, 'pointermove', 700, 600);
    fire(header, 'pointerup', 700, 600);
    assert.equal(f.captured.size, 0);
    assert.equal(f.panel.style.left, '160px');
    assert.equal(f.panel.style.top, '200px');
    assert.deepEqual(f.saves, [{ left: 160, top: 200 }]);
    fire(f.panel.querySelector('[data-role=collapse]'), 'pointerdown', 170, 210);
    fire(header, 'pointermove', 0, 0);
    fire(header, 'pointerup', 0, 0);
    assert.equal(f.saves.length, 1);
    fire(header, 'pointerdown', 170, 210);
    f.controller.destroy();
    assert.equal(f.captured.size, 0);
    fire(header, 'pointermove', 0, 0);
    fire(header, 'pointerup', 0, 0);
    assert.equal(f.saves.length, 1);
  } finally { f.close(); }
});

for (const ending of ['pointercancel', 'lostpointercapture', 'blur']) {
  test(`user observes that drag ignores other pointers and saves once on cancel, capture loss or blur (ending=${JSON.stringify(ending)})`, () => {
    // Given the panel locale, viewport and saved coordinates
    const f = fixture();
    try {
      f.panel.getBoundingClientRect = () => ({ left: parseFloat(f.panel.style.left), top: parseFloat(f.panel.style.top), width: 340, height: 200 });
      for (const overrides of [{ isPrimary: false }, { button: 2, buttons: 2 }, { buttons: 0 }]) {
        f.fire(f.header, 'pointerdown', 120, 130, overrides);
        assert.equal(f.captured.size, 0);
      }
      // When f.fire processes the configured inputs
      f.fire(f.header, 'pointerdown', 120, 130);
      f.fire(f.header, 'pointerdown', 900, 900, { pointerId: 2 });
      f.fire(f.header, 'pointermove', 800, 800, { pointerId: 2 });
      f.fire(f.header, 'pointerup', 800, 800, { pointerId: 2 });
      // Then user observes that drag ignores other pointers and saves once on cancel, capture loss or blur (ending=the selected case)
      assert.equal(f.panel.style.left, '100px');
      assert.deepEqual(f.saves, []);
      f.fire(f.header, 'pointermove', 180, 170);
      if (ending === 'blur') f.dom.window.dispatchEvent(new f.dom.window.Event('blur'));
      else {
        if (ending === 'lostpointercapture') f.captured.clear();
        f.fire(f.header, ending, 180, 170);
      }
      f.fire(f.header, 'lostpointercapture', 180, 170);
      f.fire(f.header, 'pointerup', 180, 170);
      f.fire(f.header, 'pointermove', 900, 900);
      assert.deepEqual(f.saves, [{ left: 160, top: 160 }]);
      assert.equal(f.captured.size, 0);
      assert.equal(f.panel.style.left, '160px');
      assert.equal(f.panel.style.top, '160px');
    } finally { f.close(); }

  });
}

test('user observes that resize and content growth keep the panel visible, including collapse/expand and locale rerender', () => {
  // Given the panel locale, viewport and saved coordinates
  const f = fixture('en', { left: 900, top: 600 });
  try {
    let height = 200;
    f.panel.getBoundingClientRect = () => ({ left: parseFloat(f.panel.style.left), top: parseFloat(f.panel.style.top), width: 340, height: f.panel.querySelector('[data-role=body]').style.display === 'none' ? 40 : height });
    Object.defineProperties(f.dom.window, { innerWidth: { value: 500, configurable: true }, innerHeight: { value: 400, configurable: true } });
    // When f.dom.window.dispatchEvent processes the configured inputs
    f.dom.window.dispatchEvent(new f.dom.window.Event('resize'));
    // Then user observes that resize and content growth keep the panel visible, including collapse/expand and locale rerender
    assert.equal(f.panel.style.left, '160px');
    assert.equal(f.panel.style.top, '200px');
    height = 300;
    f.controller.renderStatus(status);
    assert.equal(f.panel.style.top, '100px');
    const collapse = f.panel.querySelector('[data-role=collapse]');
    collapse.click();
    assert.equal(collapse.textContent, 'Expand');
    f.controller.setLocale('zh-CN');
    assert.equal(collapse.textContent, '展开');
    assert.equal(f.panel.querySelector('[data-role=body]').style.display, 'none');
    collapse.click();
    assert.equal(f.panel.style.top, '100px');
    assert.equal(collapse.textContent, '收起');
    assert.deepEqual(f.saves, []);
  } finally { f.close(); }
});

test('user observes that invalid persisted positions fail explicitly before installing a panel', () => {
  // Given a persisted position whose horizontal coordinate is not numeric
  const dom = new JSDOM('<body></body>');
  try {
    // When the summary panel loads those persisted coordinates
    const failure = captureStrategyError(() => createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', {
      loadPosition: () => ({ left: 'bad', top: 10 }), savePosition() {},
    }));
    // Then the invalid position is reported without installing a panel
    assert.match(failure.message, /position is invalid/);
    assert.equal(dom.window.document.getElementById('jh-strategy29-summary-panel'), null);
  } finally { dom.window.close(); }
});


test('user observes that configuration and error states rerender in the chosen language without clearing diagnostics', () => {
  // Given the panel locale, viewport and saved coordinates
  const f = fixture('en');
  try {
    // When f.controller.setConnection processes the configured inputs
    f.controller.setConnection('configuration_required', SUMMARY_COPY.configuration);
    // Then user observes that configuration and error states rerender in the chosen language without clearing diagnostics
    assert.equal(f.panel.querySelector('[data-role=connection]').textContent, 'Gateway secret is not configured');
    f.controller.setLocale('zh-CN');
    assert.equal(f.panel.querySelector('[data-role=connection]').textContent, '尚未配置网关密钥');
    f.controller.setConnection('stopped', SUMMARY_COPY.stopped('HTTP 401'));
    assert.equal(f.panel.querySelector('[data-role=connection]').textContent, '远程汇总已停止。技术详情：HTTP 401');
    f.controller.setLocale('en');
    assert.equal(f.panel.querySelector('[data-role=connection]').textContent, 'Remote summary stopped: HTTP 401');
    assert.equal(f.panel.querySelector('[data-role=connection]').dataset.state, 'stopped');
  } finally { f.close(); }
});
