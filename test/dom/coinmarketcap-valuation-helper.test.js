import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const artifact = new URL('../../scripts/coinmarketcap-valuation-helper.user.js', import.meta.url);
const source = readFileSync(artifact, 'utf8');

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
      top: Number(this.closest('[data-top]')?.dataset.top ?? 200),
      left: Number(this.closest('[data-left]')?.dataset.left ?? 100),
    };
  };
  const query = document.querySelectorAll.bind(document);
  document.querySelectorAll = selector => {
    if (selector === 'span,p,div') scans += 1;
    return query(selector);
  };
  new vm.Script(source, { filename: fileURLToPath(artifact) }).runInContext(dom.getInternalVMContext());
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

test('user observes that valuation matching never reads layout for unrelated quote rows', t => {
  // Given the CoinMarketCap page contains valuation labels and surrounding quotes
  const background = Array.from({ length: 200 }, (_, index) => `<div class="quote"><span>${index}</span><p>Price</p></div>`).join('');
  // When the valuation helper handles the page content
  const h = harness(t, cards + background);
  // Then valuation matching never reads layout for unrelated quote rows
  assert.equal(h.document.querySelector('#cap').textContent, '流通市值');
  assert.equal(h.document.querySelector('#fdv').textContent, 'FDV/总估值');
  assert.equal(h.document.querySelectorAll('.jh-cmc-valuation-highlight').length, 2);
  assert.equal(h.measured.filter(element => element.closest('.quote')).length, 0);
  assert.ok(h.measured.length <= 12, `only the two metric scopes/cards need layout, received ${h.measured.length}`);
});

test('user observes that independent price mutation batches share one rename scan per animation frame', async t => {
  // Given the CoinMarketCap page contains valuation labels and surrounding quotes
  const h = harness(t, cards + '<div id="price">123</div>');
  const initialScans = h.scans;
  // When the valuation helper handles the page content
  for (let index = 0; index < 10; index += 1) {
    h.document.querySelector('#price').firstChild.data = String(index);
    await Promise.resolve();
  }
  // Then independent price mutation batches share one rename scan per animation frame
  assert.equal(h.scans, initialScans);
  assert.equal(h.frames.length, 1);
  await h.flush();
  assert.equal(h.scans, initialScans + 1);
  assert.equal(h.document.querySelector('#cap').textContent, '流通市值');
});

test('user observes that text-only labels still react to a delayed nearby value and replacement labels', async t => {
  // Given the supplied input describes this data scenario
  const scenarioInput = '<div data-role="group-item"><p id="label">市值</p><span id="value"></span></div>';
  // When the text-only labels still react to a delayed nearby value and replacement labels
  const h = harness(t, scenarioInput);
  // Then text-only labels still react to a delayed nearby value and replacement labels
  assert.equal(h.document.querySelector('#label').textContent, '市值');
  h.document.querySelector('#value').textContent = '$123';
  await h.flush();
  assert.equal(h.document.querySelector('#label').textContent, '流通市值');
  h.document.querySelector('#label').replaceWith(Object.assign(h.document.createElement('p'), { id: 'label', textContent: '完全稀释估值 (FDV)' }));
  await h.flush();
  assert.equal(h.document.querySelector('#label').textContent, 'FDV/总估值');
});

test('user observes that hidden and out-of-area labels retain the original text', t => {
  // Given the supplied input describes this data scenario
  const scenarioInput = `
    <div data-hidden><span id="hidden">市值</span><span>$123M</span></div>
    <div data-top="900"><span id="lower">FDV</span><span>$456M</span></div>
  `;
  // When the hidden and out-of-area labels retain the original text
  const h = harness(t, scenarioInput);
  // Then hidden and out-of-area labels retain the original text
  assert.equal(h.document.querySelector('#hidden').textContent, '市值');
  assert.equal(h.document.querySelector('#lower').textContent, 'FDV');
});

test('user observes that a queued scan validates the current route before changing labels', async t => {
  // Given the CoinMarketCap page contains valuation labels and surrounding quotes
  const h = harness(t, cards);
  h.document.querySelector('#cap').textContent = '市值';
  await Promise.resolve();
  h.window.history.pushState({}, '', '/zh/watchlist/');
  // When the valuation helper handles the page content
  await h.flush();
  // Then a queued scan validates the current route before changing labels
  assert.equal(h.document.querySelector('#cap').textContent, '市值');
  h.window.history.pushState({}, '', '/zh/currencies/ethereum/');
  h.document.querySelector('#cap').textContent = '市值';
  await h.flush();
  assert.equal(h.document.querySelector('#cap').textContent, '流通市值');
});

test('user sees explainer labels renamed in definition terms and plain parent containers', t => {
  // Given the statistics use supported layouts without group-item cards
  const markup = '<dl><dt id="term">市值<i data-test="icon-market-cap-explainer"></i></dt><dd>$123M</dd></dl>'
    + '<section> <span id="plain">FDV</span><i data-test="icon-fully-diluted-mcap-explainer"></i></section>';

  // When the full valuation helper scans the visible statistics
  const h = harness(t, markup);

  // Then explainer identity renames both labels without creating unsupported card highlights
  assert.equal(h.document.getElementById('term').firstChild.textContent, '流通市值');
  assert.equal(h.document.getElementById('plain').textContent, 'FDV/总估值');
  assert.equal(h.document.querySelectorAll('.jh-cmc-valuation-highlight').length, 0);
});

test('user keeps explainer content intact while its neighboring metric label is renamed', t => {
  // Given nested explainer text repeats the label without a nearby numeric metric
  const markup = '<section data-role="group-item"><div id="explainer" data-test="icon-fully-diluted-mcap-explainer">FDV<span id="nested">FDV</span></div><span id="actual">FDV</span></section>';

  // When explainer-based matching identifies the surrounding metric label
  const h = harness(t, markup);

  // Then the icon and its descendants preserve their content while the actual label changes
  assert.equal(h.document.getElementById('explainer').firstChild.textContent, 'FDV');
  assert.equal(h.document.getElementById('nested').textContent, 'FDV');
  assert.equal(h.document.getElementById('actual').textContent, 'FDV/总估值');
  assert.equal(h.document.querySelectorAll('.jh-cmc-valuation-highlight').length, 1);
});

test('user retains hidden and misplaced explainer labels outside the visible statistics area', t => {
  // Given explainer scopes are hidden, above the statistics, or beyond their right edge
  const markup = '<section style="visibility:hidden" data-role="group-item"><span id="hidden">市值</span><i data-test="icon-market-cap-explainer"></i><span>$1M</span></section>'
    + '<section data-top="90" data-role="group-item"><span id="above">FDV</span><i data-test="icon-fully-diluted-mcap-explainer"></i><span>$2M</span></section>'
    + '<section data-left="500" data-role="group-item"><span id="right">市值</span><i data-test="icon-market-cap-explainer"></i><span>$3M</span></section>';

  // When the full helper applies its visibility and page-area rules
  const h = harness(t, markup);

  // Then labels outside the intended rendered area remain unchanged and unhighlighted
  assert.equal(h.document.getElementById('hidden').textContent, '市值');
  assert.equal(h.document.getElementById('above').textContent, 'FDV');
  assert.equal(h.document.getElementById('right').textContent, '市值');
  assert.equal(h.document.querySelectorAll('.jh-cmc-valuation-highlight').length, 0);
});

test('user can match a unit-valued metric while preserving whitespace and its embedded icon', t => {
  // Given a text-only metric has a unit-suffixed value and separate whitespace text nodes
  const markup = '<section data-role="group-item"><div id="label"> \n<i id="icon"></i> FDV </div><span>123M</span></section>';

  // When the helper renames the direct nonempty label node
  const h = harness(t, markup);

  // Then the metric changes without replacing the icon or whitespace surrounding it
  const label = h.document.getElementById('label');
  assert.equal(label.firstChild.textContent, ' \n');
  assert.equal(label.lastChild.textContent, 'FDV/总估值');
  assert.equal(label.children.length, 1);
  assert.equal(label.firstElementChild.id, 'icon');
  assert.equal(label.parentElement.classList.contains('jh-cmc-valuation-highlight'), true);
});
