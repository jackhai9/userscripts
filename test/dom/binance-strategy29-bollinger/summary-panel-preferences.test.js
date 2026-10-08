import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createStrategy29SummaryPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';
import { SUMMARY_COPY } from '../../../src/binance-strategy29-bollinger/ui-copy.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

test('user keeps a restored collapsed panel at its saved bottom position from the first layout', (t) => {
  // Given a saved position that fits the collapsed height but not the expanded summary.
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTCUSDT' });
  t.after(() => dom.window.close());
  Object.defineProperty(dom.window, 'innerHeight', { value: 600 });
  const measurements = [];
  const saves = [];
  const nativeRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id !== 'jh-strategy29-summary-panel') return nativeRect.call(this);
    const collapsed = this.querySelector('[data-role=body]').style.display === 'none';
    measurements.push({ collapsed, expanded: this.querySelector('[data-role=collapse]').getAttribute('aria-expanded') });
    return { left: Number.parseFloat(this.style.left), top: Number.parseFloat(this.style.top), width: 340, height: collapsed ? 40 : 400 };
  };

  // When the real panel restores its presentation before any viewport clamp.
  const controller = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', {
    loadPosition: () => ({ left: 200, top: 550 }), savePosition: value => saves.push(['position', value]),
    loadCollapsed: () => true, saveCollapsed: value => saves.push(['collapsed', value]),
  });
  t.after(() => controller.destroy());

  // Then its first and subsequent measurements use the collapsed height without shifting or saving.
  const panel = dom.window.document.getElementById('jh-strategy29-summary-panel');
  assert.deepEqual(measurements[0], { collapsed: true, expanded: 'false' });
  assert.deepEqual(measurements.filter(value => !value.collapsed || value.expanded !== 'false'), []);
  assert.equal(panel.style.top, '550px');
  assert.equal(panel.style.left, '200px');
  assert.deepEqual(saves, []);
});

test('user saves fold changes only on clicks while locale and live data retain the active presentation', (t) => {
  // Given a restored expanded panel and separate position and collapsed storage adapters.
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTCUSDT' });
  const saves = [];
  const controller = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', {
    loadPosition: () => null, savePosition: value => saves.push(['position', value]),
    loadCollapsed: () => false, saveCollapsed: value => saves.push(['collapsed', value]),
  });
  t.after(() => { controller.destroy(); dom.window.close(); });
  const panel = dom.window.document.getElementById('jh-strategy29-summary-panel');
  const collapse = panel.querySelector('[data-role=collapse]');

  // When connection, status, events, locale and viewport updates render the panel.
  controller.setConnection('connected', SUMMARY_COPY.connected);
  controller.renderStatus(status);
  controller.addEvents(events.events, events.observed_at_ms);
  controller.setLocale('zh-CN');
  dom.window.dispatchEvent(new dom.window.Event('resize'));

  // Then the expanded presentation and its preference remain unchanged by rendering.
  assert.equal(panel.querySelector('[data-role=body]').style.display, 'block');
  assert.equal(collapse.textContent, '收起');
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(saves, []);

  // When the user collapses the panel and another status and locale update arrives.
  collapse.click();
  controller.renderStatus(status);
  controller.addEvents([], events.observed_at_ms + 5000);
  controller.setLocale('en');

  // Then only the click saves the collapsed value and new signal state remains retained.
  assert.equal(panel.querySelector('[data-role=body]').style.display, 'none');
  assert.equal(collapse.textContent, 'Expand');
  assert.equal(collapse.getAttribute('aria-expanded'), 'false');
  assert.equal(controller.size, 2);
  assert.deepEqual(saves, [['collapsed', true]]);

  // When the user expands the same panel again.
  collapse.click();

  // Then the second click saves the explicit expanded boolean without changing its position preference.
  assert.equal(panel.querySelector('[data-role=body]').style.display, 'block');
  assert.equal(collapse.textContent, 'Collapse');
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(saves, [['collapsed', true], ['collapsed', false]]);
});

for (const invalid of [null, 'false', 0, {}]) {
  test(`user receives an explicit failure for a nonboolean collapsed preference (${JSON.stringify(invalid)})`, (t) => {
    // Given private collapsed storage containing an invalid value.
    const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTCUSDT' });
    t.after(() => dom.window.close());
    const saves = [];
    const options = {
      loadPosition: () => null, savePosition: value => saves.push(value),
      loadCollapsed: () => invalid, saveCollapsed: value => saves.push(value),
    };

    // When the real summary panel attempts to restore that preference.
    const create = () => createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', options);

    // Then initialization reports the invalid boolean before inserting or saving a panel.
    assert.throws(create, { name: 'TypeError', message: 'Strategy 29 panel collapsed preference is invalid' });
    assert.equal(dom.window.document.getElementById('jh-strategy29-summary-panel'), null);
    assert.deepEqual(saves, []);
  });
}
