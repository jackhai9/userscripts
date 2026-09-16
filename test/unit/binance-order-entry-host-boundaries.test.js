import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  installNativeCloseQuantityTransition,
  installNativePostOnlyTransition,
  installOrderEntryReadProbe,
} from '../helpers/order-entry-host-boundaries.js';

const html = `<!doctype html><body>
  <section id="futuresOrderbook"><div class="row-content"><span>81.0</span></div></section>
  <section id="trade-form">
    <div id="position-direction"><div role="tab" data-trade-mode="OPEN" aria-selected="true">开仓</div><div role="tab" data-trade-mode="CLOSE" aria-selected="false">平仓</div></div>
    <div class="order-type-tabs"><div role="tab" data-tab-key="POST_ONLY" aria-selected="true">只做Maker</div></div>
    <div class="order-entry"><input id="limitPrice-open" value="81.0"><input id="unitAmount-open"><button>开多</button><button>开空</button><div data-testid="max-buy-amount">可开 10 HYPE</div><div data-testid="max-sell-amount">可开 10 HYPE</div></div>
  </section>
  <div id="jh-binance-close-qty-multiplier-panel"><span>Original panel</span></div>
  <div id="jh-binance-close-qty-multiplier-spacer"></div>
</body>`;

function openHost(t) {
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  return dom.window;
}

test('user receives a native Post Only selection only after its requested transition commits', t => {
  // Given the native order type is Limit and no selection request is pending.
  const view = openHost(t);
  const host = installNativePostOnlyTransition({ ownerDocument: view.document });
  assert.deepEqual(host.snapshot(), { requests: 0, committed: false, selected: ['LIMIT'] });
  assert.throws(() => host.commit(), /must be pending/);

  // When the native Post Only tab receives one actual click.
  view.document.querySelector('[data-tab-key="POST_ONLY"]').click();

  // Then the request is observable without fabricating a committed selection.
  assert.deepEqual(host.snapshot(), { requests: 1, committed: false, selected: ['LIMIT'] });

  // When the native host publishes its selection and the boundary is later disposed.
  host.commit();
  assert.deepEqual(host.snapshot(), { requests: 1, committed: true, selected: ['POST_ONLY'] });
  assert.throws(() => host.commit(), /must be pending/);
  host.dispose();
  view.document.querySelector('[data-tab-key="POST_ONLY"]').click();

  // Then the original native selection remains and the detached listener records no further request.
  assert.deepEqual(host.snapshot(), { requests: 1, committed: true, selected: ['POST_ONLY'] });
  assert.equal(view.document.querySelector('[data-tab-key="LIMIT"]'), null);
});

test('user receives native close quantities separately from the actual close-mode click', t => {
  // Given the native close form owns a mode transition whose quantity publication has not arrived.
  const view = openHost(t);
  const closeTab = view.document.querySelector('[data-trade-mode="CLOSE"]');
  let documentClicks = 0;
  let retiredRendererCalls = 0;
  view.document.addEventListener('click', () => { documentClicks += 1; }, true);
  closeTab.addEventListener('click', () => { retiredRendererCalls += 1; });
  const host = installNativeCloseQuantityTransition({ ownerDocument: view.document });
  assert.throws(() => host.publish({ longQty: '3', shortQty: '0' }), /not pending/);

  // When the user clicks Close before the independent quantity publication.
  closeTab.click();

  // Then native mode and buttons change while quantities remain absent, and the real document listener ran.
  assert.equal(documentClicks, 1);
  assert.equal(retiredRendererCalls, 0);
  assert.deepEqual(host.snapshot(), {
    phase: 'quantity-pending', requests: 1, selectedMode: 'CLOSE', quantities: [],
    buttons: [{ text: '平多', disabled: true }, { text: '平空', disabled: true }],
  });
  assert.equal(view.document.querySelector('#limitPrice-close').value, '81.0');
  assert.equal(view.document.querySelector('#unitAmount-close').value, '');
  assert.throws(() => host.publish({ longQty: null, shortQty: '0' }), /explicit non-negative decimal strings/);

  // When the independent native quantity publication confirms one long position.
  host.publish({ longQty: '3', shortQty: '0' });

  // Then the exact quantities and native availability appear without a submit operation.
  assert.deepEqual(host.snapshot(), {
    phase: 'complete', requests: 1, selectedMode: 'CLOSE', quantities: ['可平 3 HYPE', '可平 0 HYPE'],
    buttons: [{ text: '平多', disabled: false }, { text: '平空', disabled: true }],
  });
  host.dispose();
});

test('user measures native DOM reads without changing query results, geometry, or exceptions', t => {
  // Given the browser boundary preserves its original query, rectangle, and size descriptors.
  const view = openHost(t);
  const document = view.document;
  const row = document.querySelector('.row-content');
  const book = document.querySelector('#futuresOrderbook');
  const panel = document.querySelector('#jh-binance-close-qty-multiplier-panel');
  const spacer = document.querySelector('#jh-binance-close-qty-multiplier-spacer');
  const originalQuery = view.Document.prototype.querySelectorAll;
  const originalRect = view.Element.prototype.getBoundingClientRect;
  const originalHeight = Object.getOwnPropertyDescriptor(view.HTMLElement.prototype, 'offsetHeight');
  const probe = installOrderEntryReadProbe({ ownerDocument: document });

  // When actual native queries and layout reads touch the book and the panel.
  const found = document.querySelectorAll('#futuresOrderbook .row-content');
  const empty = book.querySelectorAll('.absent');
  const rectangle = row.getBoundingClientRect();
  const panelHeight = panel.offsetHeight;
  const anchor = spacer.getBoundingClientRect();

  // Then native results remain exact while each observed operation is counted once.
  assert.deepEqual([...found], [row]);
  assert.equal(empty.length, 0);
  assert.deepEqual({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height },
    { x: 0, y: 0, width: 0, height: 0 });
  assert.equal(panelHeight, 0);
  assert.equal(anchor.width, 0);
  assert.throws(() => document.querySelectorAll('['), { name: 'SyntaxError' });
  assert.deepEqual(probe.snapshot(), {
    queryCalls: 2, orderbookScans: 2, layoutReads: 3, orderbookLayoutReads: 1,
    spacerRectReads: 1, panelHeightReads: 1, panelMutations: 0,
  });

  // When instrumentation is disposed before another native query.
  const final = probe.dispose();
  document.querySelectorAll('#futuresOrderbook .row-content');

  // Then original descriptors are restored and the detached counter no longer changes.
  assert.equal(view.Document.prototype.querySelectorAll, originalQuery);
  assert.equal(view.Element.prototype.getBoundingClientRect, originalRect);
  assert.deepEqual(Object.getOwnPropertyDescriptor(view.HTMLElement.prototype, 'offsetHeight'), originalHeight);
  assert.deepEqual(probe.snapshot(), final);
});

test('user detects actual panel writes through a real mutation observer and receives a detached count snapshot', async t => {
  // Given native DOM read instrumentation also observes the mounted panel.
  const view = openHost(t);
  const panel = view.document.querySelector('#jh-binance-close-qty-multiplier-panel');
  const probe = installOrderEntryReadProbe({ ownerDocument: view.document });
  const initial = probe.snapshot();

  // When the native DOM changes one panel attribute and its existing text node.
  panel.setAttribute('data-test-state', 'changed');
  panel.firstChild.firstChild.data = 'Updated panel';
  await Promise.resolve();

  // Then both writes are measured without changing the earlier snapshot or the actual DOM.
  assert.equal(initial.panelMutations, 0);
  assert.equal(probe.snapshot().panelMutations, 2);
  assert.equal(panel.textContent, 'Updated panel');
  assert.equal(panel.getAttribute('data-test-state'), 'changed');
  probe.dispose();
});
