import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../scripts/coinmarketcap-valuation-helper.user.js', import.meta.url), 'utf8');

function harness(t, markup, { pathname = '/zh/currencies/bitcoin/' } = {}) {
  const dom = new JSDOM(markup, {
    url: `https://coinmarketcap.com${pathname}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const document = window.document;
  const frames = [];
  const measured = [];
  let scans = 0;
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.Element.prototype.getBoundingClientRect = function () {
    measured.push(this);
    return {
      width: this.closest('[data-hidden]') ? 0 : 120, height: 24,
      top: Number(this.closest('[data-top]')?.dataset.top ?? 200), left: 100,
    };
  };
  window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  const query = document.querySelectorAll.bind(document);
  document.querySelectorAll = selector => {
    if (selector === 'span,p,div') scans += 1;
    return query(selector);
  };
  window.eval(source);
  async function flush() {
    for (let round = 0; round < 5; round += 1) {
      await Promise.resolve();
      if (!frames.length) return;
      for (const callback of frames.splice(0)) callback();
    }
    assert.equal(frames.length, 0, 'renaming must settle without an observer feedback loop');
  }
  return { window, document, measured, frames, flush, get scans() { return scans; } };
}

const cards = `
  <div data-role="group-item"><span id="cap">市值</span><i data-test="icon-market-cap-explainer"></i><span>$123M</span></div>
  <div data-role="group-item"><span id="fdv">FDV</span><i data-test="icon-fully-diluted-mcap-explainer"></i><span>$456M</span></div>
`;

test('valuation matching never reads layout for unrelated quote rows', t => {
  const background = Array.from({ length: 200 }, (_, index) => `<div class="quote"><span>${index}</span><p>Price</p></div>`).join('');
  const h = harness(t, cards + background);
  assert.equal(h.document.querySelector('#cap').textContent, '流通市值');
  assert.equal(h.document.querySelector('#fdv').textContent, 'FDV/总估值');
  assert.equal(h.document.querySelectorAll('.jh-cmc-valuation-highlight').length, 2);
  assert.equal(h.measured.filter(element => element.closest('.quote')).length, 0);
  assert.ok(h.measured.length <= 12, `only the two metric scopes/cards need layout, received ${h.measured.length}`);
});

test('independent price mutation batches share one rename scan per animation frame', async t => {
  const h = harness(t, cards + '<div id="price">123</div>');
  const initialScans = h.scans;
  for (let index = 0; index < 10; index += 1) {
    h.document.querySelector('#price').firstChild.data = String(index);
    await Promise.resolve();
  }
  assert.equal(h.scans, initialScans);
  assert.equal(h.frames.length, 1);
  await h.flush();
  assert.equal(h.scans, initialScans + 1);
  assert.equal(h.document.querySelector('#cap').textContent, '流通市值');
});

test('text-only labels still react to a delayed nearby value and replacement labels', async t => {
  const h = harness(t, '<div data-role="group-item"><p id="label">市值</p><span id="value"></span></div>');
  assert.equal(h.document.querySelector('#label').textContent, '市值');
  h.document.querySelector('#value').textContent = '$123';
  await h.flush();
  assert.equal(h.document.querySelector('#label').textContent, '流通市值');
  h.document.querySelector('#label').replaceWith(Object.assign(h.document.createElement('p'), { id: 'label', textContent: '完全稀释估值 (FDV)' }));
  await h.flush();
  assert.equal(h.document.querySelector('#label').textContent, 'FDV/总估值');
});

test('hidden and out-of-area labels retain the original text', t => {
  const h = harness(t, `
    <div data-hidden><span id="hidden">市值</span><span>$123M</span></div>
    <div data-top="900"><span id="lower">FDV</span><span>$456M</span></div>
  `);
  assert.equal(h.document.querySelector('#hidden').textContent, '市值');
  assert.equal(h.document.querySelector('#lower').textContent, 'FDV');
});

test('a queued scan validates the current route before changing labels', async t => {
  const h = harness(t, cards);
  h.document.querySelector('#cap').textContent = '市值';
  await Promise.resolve();
  h.window.history.pushState({}, '', '/zh/watchlist/');
  await h.flush();
  assert.equal(h.document.querySelector('#cap').textContent, '市值');
  h.window.history.pushState({}, '', '/zh/currencies/ethereum/');
  h.document.querySelector('#cap').textContent = '市值';
  await h.flush();
  assert.equal(h.document.querySelector('#cap').textContent, '流通市值');
});
