import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = process.argv[2];
if (process.argv.length > 3) throw new Error('Usage: node test/manual/userscript-performance-benchmark.mjs [baseline-revision]');

function readSource(path, revision) {
  return revision === undefined
    ? readFileSync(join(root, path), 'utf8')
    : execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

async function flushFrames(frames) {
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
    if (!frames.length) return;
    for (const callback of frames.splice(0)) callback();
  }
  assert.equal(frames.length, 0, 'fixture did not settle');
}

async function valuation(revision) {
  const markup = `<div data-role="group-item"><span id="cap">市值</span><i data-test="icon-market-cap-explainer"></i><span>$123M</span></div>
    <div data-role="group-item"><span id="fdv">FDV</span><i data-test="icon-fully-diluted-mcap-explainer"></i><span>$456M</span></div>`
    + Array.from({ length: 1000 }, (_, index) => `<div class="quote"><span>${index}</span><p>Price</p></div>`).join('');
  const dom = new JSDOM(markup, { url: 'https://coinmarketcap.com/zh/currencies/bitcoin/', runScripts: 'outside-only' });
  const { window } = dom;
  const counts = { layoutReads: 0, styleReads: 0, fullTextScans: 0 };
  const frames = [];
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.Element.prototype.getBoundingClientRect = () => {
    counts.layoutReads += 1;
    return { width: 100, height: 24, top: 200, left: 100 };
  };
  window.getComputedStyle = () => { counts.styleReads += 1; return { display: 'block', visibility: 'visible' }; };
  const query = window.document.querySelectorAll.bind(window.document);
  window.document.querySelectorAll = selector => {
    if (selector === 'span,p,div') counts.fullTextScans += 1;
    return query(selector);
  };
  try {
    window.eval(readSource('scripts/coinmarketcap-valuation-helper.user.js', revision));
    await flushFrames(frames);
    const initial = { ...counts };
    counts.layoutReads = counts.styleReads = counts.fullTextScans = 0;
    for (let index = 0; index < 10; index += 1) {
      window.document.querySelector('.quote span').firstChild.data = String(index + 1000);
      await Promise.resolve();
    }
    await flushFrames(frames);
    assert.equal(window.document.querySelector('#cap').textContent, '流通市值');
    assert.equal(window.document.querySelector('#fdv').textContent, 'FDV/总估值');
    return { irrelevantQuoteRows: 1000, initial, tenMutationBatchesBeforePaint: { ...counts } };
  } finally {
    window.close();
  }
}

async function media(revision) {
  const dom = new JSDOM(Array.from({ length: 100 }, () => '<video><source></video>').join(''), { url: 'https://njav.com/watch/fixture', runScripts: 'outside-only' });
  const { window } = dom;
  const frames = [];
  const counts = { documentScans: 0, videoScans: 0, requests: [] };
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.XMLHttpRequest = class {
    open(_method, url) { counts.requests.push(url); }
    send() {}
  };
  const query = window.document.querySelectorAll.bind(window.document);
  window.document.querySelectorAll = selector => {
    if (selector === 'video') counts.documentScans += 1;
    return query(selector);
  };
  const elementQuery = window.Element.prototype.querySelectorAll;
  window.Element.prototype.querySelectorAll = function (selector) {
    if (this.tagName === 'VIDEO' && selector === 'source') counts.videoScans += 1;
    return elementQuery.call(this, selector);
  };
  try {
    window.eval(readSource('scripts/m3u8-downloader.user.js', revision));
    await new Promise(setImmediate);
    await flushFrames(frames);
    counts.documentScans = counts.videoScans = 0;
    window.document.querySelector('source').src = 'https://media.example/changed.m3u8';
    await flushFrames(frames);
    assert.deepEqual(counts.requests, ['https://media.example/changed.m3u8']);
    return { existingVideos: 100, ...counts };
  } finally {
    window.close();
  }
}

async function summary(revision) {
  const path = 'src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';
  // The panel's dependencies are unchanged; only its implementation is compared.
  const built = await build({
    stdin: { contents: readSource(path, revision), resolveDir: dirname(join(root, path)), loader: 'js' },
    bundle: true, format: 'esm', platform: 'node', write: false,
  });
  const { createStrategy29SummaryPanel } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/strategy29-gateway-events.json'), 'utf8'));
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTCUSDT' });
  const document = dom.window.document;
  const panel = createStrategy29SummaryPanel(document, 'BTC/USDT:USDT', { loadPosition: () => null, savePosition() {} });
  try {
    panel.addEvents(Array.from({ length: 20 }, (_, index) => ({
      ...fixture.events[0], event_id: `performance-${index}`, sequence: index + 1,
      bar_close_ms: fixture.events[0].bar_close_ms + index * 60_000,
    })), fixture.observed_at_ms);
    const container = document.querySelector('[data-role="events"]');
    const firstRow = container.firstChild;
    const counts = { replacements: 0, elementCreations: 0 };
    const replace = container.replaceChildren.bind(container);
    container.replaceChildren = (...args) => { counts.replacements += 1; return replace(...args); };
    const create = document.createElement.bind(document);
    document.createElement = (...args) => { counts.elementCreations += 1; return create(...args); };
    for (let index = 1; index <= 10; index += 1) panel.addEvents([], fixture.observed_at_ms + index * 5000);
    assert.equal(panel.size, 20);
    return { emptyPolls: 10, retainedRows: panel.size, ...counts, firstRowRetained: firstRow === container.firstChild };
  } finally {
    panel.destroy();
    dom.window.close();
  }
}

async function measure(revision) {
  return { valuation: await valuation(revision), media: await media(revision), summary: await summary(revision) };
}

const report = {
  scope: 'Deterministic synthetic DOM operation counts; not live site CPU or wall-clock performance.',
  baselineRevision: baseline ?? null,
  baseline: baseline === undefined ? null : await measure(baseline),
  current: await measure(),
};
console.log(JSON.stringify(report, null, 2));
