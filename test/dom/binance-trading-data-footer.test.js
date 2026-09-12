import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../src/binance-trading-data/index.user.js', import.meta.url), 'utf8');

function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail('function declaration must be complete');
}

function harness(t) {
  const dom = new JSDOM('<body></body>');
  t.after(() => dom.window.close());
  const updatedAt = new Date(2026, 8, 12, 12, 34, 56).getTime();
  let now = updatedAt;
  t.mock.method(Date, 'now', () => now);
  const context = vm.createContext({
    document: dom.window.document, window: dom.window, Date,
    PANEL_ID: 'jh-binance-trading-data-panel', PANEL_WIDTH: 240,
    C: { bg: '#fff', border: '#ddd', sub: '#666', text: '#111' },
    lastUpdateTs: updatedAt,
    injectFlashStyle() {}, normalizeSavedPosition: () => null,
    loadPosition: () => null, loadCollapsed: () => false,
    keepPanelInViewport() {}, savePanelPosition() {}, cleanupPanelDrag() {},
    setupDrag() {}, setupCollapseAndClose() {}, cleanupPanelUnload() {},
  });
  vm.runInContext(declaration('ensurePanel'), context);
  vm.runInContext(declaration('updateFooter'), context);
  const panel = context.ensurePanel();
  const footer = panel.querySelector('#jh-binance-trading-data-panel-footer');
  context.updateFooter(footer);
  return { context, footer, window: dom.window, updatedAt, setNow: value => { now = value; } };
}

test('sixty elapsed-time updates preserve the footer elements and update the displayed seconds', t => {
  const h = harness(t);
  const row = h.footer.firstElementChild;
  const labels = [...row.children];
  for (let second = 1; second <= 60; second += 1) {
    h.setNow(h.updatedAt + second * 1000);
    h.context.updateFooter(h.footer);
  }
  assert.equal(h.footer.firstElementChild, row);
  assert.equal(row.children[0], labels[0]);
  assert.equal(row.children[1], labels[1]);
  assert.equal(labels[0].textContent, '更新于 12:34:56');
  assert.equal(labels[1].textContent, '60秒前');
});

test('a repeated render in the same second produces no footer DOM mutation', t => {
  const h = harness(t);
  const observer = new h.window.MutationObserver(() => {});
  observer.observe(h.footer, { childList: true, subtree: true, characterData: true });
  h.context.updateFooter(h.footer);
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
});

test('new data updates the retained timestamp label and resets elapsed seconds', t => {
  const h = harness(t);
  h.context.lastUpdateTs = h.updatedAt + 300_000;
  h.setNow(h.context.lastUpdateTs);
  h.context.updateFooter(h.footer);
  assert.equal(h.footer.children[0].children[0].textContent, '更新于 12:39:56');
  assert.equal(h.footer.children[0].children[1].textContent, '0秒前');
});
