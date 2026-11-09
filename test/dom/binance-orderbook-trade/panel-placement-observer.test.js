import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createPanelPlacementObserver } from '../../../src/binance-orderbook-trade/dom/panel-placement-observer.js';
import { findTradePanelInsertionPoint } from '../../../src/binance-orderbook-trade/dom/trade-form.js';

const form = `<section id="native-form"><header><div id="quick">Leverage</div>
  <div id="mode-row"><div><div id="position-direction">
  <div role="tab">Open</div><div role="tab">Close</div>
  </div></div></div></header></section>`;

function createHost(t, html = '') {
  const dom = new JSDOM(`<body>${html}</body>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const sizeObservers = [];
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); sizeObservers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  };
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => { throw new Error('Structural observation must not read layout'); };
  let ready = 0;
  let insertionQueries = 0;
  const querySelector = document.querySelector.bind(document);
  document.querySelector = selector => {
    if (selector === '#position-direction') insertionQueries += 1;
    return querySelector(selector);
  };
  const timers = new Map();
  let nextTimer = 0;
  const controller = createPanelPlacementObserver(document, {
    panelId: 'owned-panel', spacerId: 'owned-spacer', onReady() { ready += 1; },
    waitLimitMs: 15000,
    setTimeout(callback, delay) { nextTimer += 1; timers.set(nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  t.after(() => controller.stop());
  return {
    document, controller, sizeObservers, timers,
    get ready() { return ready; },
    get insertionQueries() { return insertionQueries; },
    expireWait() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, { callback }] of pending) callback();
    },
    deliverSize(target, width, height) {
      for (const observer of sizeObservers) {
        if (observer.targets.has(target)) observer.callback([{ target, contentRect: { width, height } }]);
      }
    },
  };
}

test('user gets one placement signal when the native form mounts after unrelated market updates', async t => {
  // Given the page has market rows and a script panel but no native placement anchor.
  const host = createHost(t, '<div id="market"></div><div id="owned-panel"><button>Order</button></div>');
  host.controller.wait(null, null);

  // When market rows and script-owned controls mutate before the native header mounts.
  host.document.getElementById('market').innerHTML = '<button>Market menu</button><span>81.5</span>';
  host.document.getElementById('owned-panel').innerHTML = '<button>New order control</button>';
  host.document.body.insertAdjacentHTML('beforeend', '<div id="owned-spacer"><button>Owned</button></div>');
  await Promise.resolve();

  // Then unrelated and script-owned changes neither query the native form nor read layout.
  assert.equal(host.ready, 0);
  assert.equal(host.insertionQueries, 0);

  // When the native header arrives as one committed subtree.
  host.document.body.insertAdjacentHTML('beforeend', form);
  await Promise.resolve();

  // Then the real structural contract produces one ready signal.
  assert.equal(host.ready, 1);
});

test('user waits for the complete native insertion contract including its leading controls and mode labels', async t => {
  // Given the native header lacks both its leading controls and a recognized close label.
  const host = createHost(t, form);
  host.document.getElementById('quick').remove();
  const closeTab = host.document.querySelector('[role="tab"]:last-child');
  closeTab.textContent = 'Loading';
  host.controller.wait(null, null);

  // When the native mode label settles while the leading controls remain absent.
  closeTab.textContent = 'Close';
  await Promise.resolve();

  // Then an incomplete header still cannot schedule placement.
  assert.equal(host.ready, 0);

  // When the host restores the leading controls in the same header.
  host.document.querySelector('header').insertAdjacentHTML('afterbegin', '<div>Leverage</div>');
  await Promise.resolve();

  // Then the complete contract schedules placement exactly once.
  assert.equal(host.ready, 1);
});

test('user waits for nonzero spacer dimensions without rearming observers on repeated hidden renders', async t => {
  // Given a valid native header owns a spacer whose layout is not ready.
  const host = createHost(t, form);
  const point = findTradePanelInsertionPoint(host.document);
  const spacer = host.document.createElement('div');
  spacer.id = 'owned-spacer';
  point.parent.insertBefore(spacer, point.before);
  host.controller.wait(point, spacer);

  // When repeated hidden renders and zero-area deliveries leave the same anchor unchanged.
  host.controller.wait(point, spacer);
  spacer.style.height = '400px';
  host.deliverSize(spacer, 0, 0);
  host.deliverSize(spacer, 320, 0);
  await Promise.resolve();

  // Then zero-area layout does not schedule a render or create another observer.
  assert.equal(host.ready, 0);
  assert.equal(host.sizeObservers.length, 1);

  // When the browser publishes the actual visible spacer dimensions.
  host.deliverSize(spacer, 320, 400);

  // Then that layout transition requests one placement render.
  assert.equal(host.ready, 1);
});

test('user releases stale spacer observation when the native header is replaced', async t => {
  // Given a zero-area spacer belongs to the old native header.
  const host = createHost(t, form);
  const point = findTradePanelInsertionPoint(host.document);
  const spacer = host.document.createElement('div');
  spacer.id = 'owned-spacer';
  point.parent.insertBefore(spacer, point.before);
  host.controller.wait(point, spacer);

  // When the old header unmounts before its replacement is ready.
  host.document.getElementById('native-form').remove();
  await Promise.resolve();
  host.deliverSize(spacer, 320, 400);

  // Then detached layout cannot wake the panel and its observer no longer holds the spacer.
  assert.equal(host.ready, 0);
  assert.equal(host.sizeObservers[0].targets.size, 0);

  // When native rendering commits a replacement header.
  host.document.body.insertAdjacentHTML('beforeend', form);
  await Promise.resolve();

  // Then the new header, rather than the detached one, requests placement.
  assert.equal(host.ready, 1);
});

test('user receives no placement work after cleanup and can wait again in a later visible lifecycle', async t => {
  // Given placement observation is waiting for the first native header.
  const host = createHost(t);
  host.controller.wait(null, null);

  // When cleanup precedes a late native mount.
  host.controller.stop();
  host.document.body.insertAdjacentHTML('beforeend', form);
  await Promise.resolve();

  // Then the stopped observer cannot publish work into the inactive lifecycle.
  assert.equal(host.ready, 0);

  // When a later lifecycle waits for another missing header and the host commits it.
  host.document.getElementById('native-form').remove();
  host.controller.wait(null, null);
  host.document.body.insertAdjacentHTML('beforeend', form);
  await Promise.resolve();

  // Then only the new lifecycle receives one placement signal.
  assert.equal(host.ready, 1);
});

test('user sees placement when React settles the mode label text in place', async t => {
  // Given the native header is mounted but its close tab still shows a loading label.
  const host = createHost(t, form);
  const closeLabel = host.document.querySelector('[role="tab"]:last-child').firstChild;
  closeLabel.data = 'Loading';
  host.controller.wait(null, null);
  await Promise.resolve();
  const queriesBefore = host.insertionQueries;

  // When market text elsewhere updates and React then writes the label's text node.
  host.document.body.insertAdjacentHTML('afterbegin', '<span id="price">81.5</span>');
  await Promise.resolve();
  host.document.getElementById('price').firstChild.data = '81.6';
  await Promise.resolve();
  assert.equal(host.insertionQueries, queriesBefore);
  closeLabel.data = 'Close';
  await Promise.resolve();

  // Then only the mode-label text change completes the contract and schedules placement.
  assert.equal(host.ready, 1);
});

test('user page stops document observation after the wait limit and resumes only in a new lifecycle', async t => {
  // Given a page whose native form never satisfies the placement contract, such as one-way mode.
  const host = createHost(t);
  host.controller.wait(null, null);
  assert.equal(host.timers.size, 1);
  assert.equal([...host.timers.values()][0].delay, 15000);

  // When the wait limit elapses and later failed renders ask to wait again.
  host.expireWait();
  host.controller.wait(null, null);
  host.document.body.insertAdjacentHTML('beforeend', form);
  await Promise.resolve();

  // Then the expired episode neither re-arms observation nor reacts to the late form.
  assert.equal(host.ready, 0);
  assert.equal(host.timers.size, 0);

  // When the page is hidden and shown again, starting a new placement lifecycle.
  host.controller.stop();
  host.document.getElementById('native-form').remove();
  host.controller.wait(null, null);
  host.document.body.insertAdjacentHTML('beforeend', form);
  await Promise.resolve();

  // Then the new lifecycle observes the native mount within its own limit.
  assert.equal(host.ready, 1);
  assert.equal(host.timers.size, 1);
});

test('user releases the wait limit timer once placement succeeds', async t => {
  // Given a pending placement episode.
  const host = createHost(t);
  host.controller.wait(null, null);

  // When the panel is positioned.
  host.controller.stop();

  // Then no expiry remains scheduled for the finished episode.
  assert.equal(host.timers.size, 0);
});
