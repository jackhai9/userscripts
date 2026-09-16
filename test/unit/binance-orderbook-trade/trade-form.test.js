import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import { createAnimationFrameBoundary } from '../../helpers/orderbook-migration-frames.js';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateFloatingPanelLayout,
  createBoundedInputWriter,
  createTradeInputResolver,
  createTradeInputStateReader,
  findActiveTradeInputs,
  findTradeFormRoot,
  findTradePanelInsertionPoint,
  isScriptOwnedTradeInputRecoveryState,
  isTradeModeTab,
  mutationTouchesCloseQuantity,
  parseTradeModeLabel,
  placeTradePanelSpacer,
  readTradeAvailableBalance,
  waitForTradeActionButtonFrameState,
  waitForTradeFormFrameState,
  waitForTradeFormMutationState,
} from '../../../src/binance-orderbook-trade/dom/trade-form.js';
import {
  compareDecimalStrings,
  normalizeDecimalString,
} from '../../../src/binance-orderbook-trade/core/decimal.js';
import { loadFixtureDom } from '../../helpers/dom.js';

const fixture = await readFile(
  new URL('../../fixtures/binance-orderbook-trade/right-trade-form.html', import.meta.url),
  'utf8',
);

test('user preserves frame callback order, cancellation, and next-frame scheduling in the boundary fixture', () => {
  // Given an isolated browser frame queue contains ordinary and cancelled callbacks
  const dom = loadFixtureDom('<main></main>');
  const frames = createAnimationFrameBoundary(dom.window);
  const calls = [];
  let cancelledDuringFrame;
  const first = dom.window.requestAnimationFrame((timestamp) => {
    calls.push(['first', timestamp]);
    dom.window.cancelAnimationFrame(cancelledDuringFrame);
    dom.window.requestAnimationFrame((nextTimestamp) => calls.push(['next', nextTimestamp]));
  });
  const cancelledBeforeFrame = dom.window.requestAnimationFrame((timestamp) => calls.push(['cancelled-before', timestamp]));
  cancelledDuringFrame = dom.window.requestAnimationFrame((timestamp) => calls.push(['cancelled-during', timestamp]));
  dom.window.cancelAnimationFrame(cancelledBeforeFrame);

  // When the first explicit browser frame runs
  frames.runFrame(16);

  // Then cancelled callbacks do not run and newly scheduled callbacks remain pending
  assert.equal(first, 1);
  assert.equal(cancelledBeforeFrame, 2);
  assert.equal(cancelledDuringFrame, 3);
  assert.deepEqual(calls, [['first', 16]]);
  assert.equal(frames.pendingCount, 1);

  // When the following explicit frame runs
  frames.runFrame(32);

  // Then the deferred callback receives the next frame timestamp exactly once
  assert.deepEqual(calls, [['first', 16], ['next', 32]]);
  assert.equal(frames.pendingCount, 0);
});

test("user sees that panel insertion point is immediately before the native trade-mode row", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(fixture);
  // When the trade form state is read or synchronized
  const insertionPoint = findTradePanelInsertionPoint(dom.window.document);

  // Then sees that panel insertion point is immediately before the native trade-mode row
  assert.equal(insertionPoint.parent.className, 'trade-header');
  assert.equal(insertionPoint.before.className, 'trade-mode-row');
  assert.equal(insertionPoint.before.previousElementSibling.className, 'quick-controls');
});

test("user sees that English trade-mode labels use the same panel insertion contract", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(
    fixture.replace('>开仓<', '>Open<').replace('>平仓<', '>Close<'),
  );
  const { document } = dom.window;
  // When the trade form state is read or synchronized
  const insertionPoint = findTradePanelInsertionPoint(document);
  const tabs = Array.from(document.querySelectorAll('#position-direction [role="tab"]'));

  // Then sees that English trade-mode labels use the same panel insertion contract
  assert.equal(insertionPoint.parent.className, 'trade-header');
  assert.equal(insertionPoint.before.className, 'trade-mode-row');
  assert.equal(parseTradeModeLabel('Open'), 'OPEN');
  assert.equal(parseTradeModeLabel('Close'), 'CLOSE');
  assert.equal(isTradeModeTab(tabs[0], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
  assert.equal(isTradeModeTab(tabs[1], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
});

test("user sees that trade-mode parsing rejects action labels instead of guessing a mode", () => {
  // Given the current trade fields and requested values are available
  const scenarioInputs = ['Open Long'];

  // When the trade form state is read or synchronized
  const observed = parseTradeModeLabel(...scenarioInputs);

  // Then sees that trade-mode parsing rejects action labels instead of guessing a mode
  assert.equal(observed, null);
  assert.equal(parseTradeModeLabel('Close Short'), null);
  assert.equal(parseTradeModeLabel('开多'), null);
  assert.equal(parseTradeModeLabel('平空'), null);
});

for (const [scenarioIndex, label] of (['可用', 'Avbl']).entries()) {
  test(`user reads the exact Chinese and English available-balance contract (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const dom = loadFixtureDom(`
      <section id="trade-form">
        <div class="bn-flex items-center gap-[4px]">
          <span>${label}</span>
          <span>0.00 USDT</span>
        </div>
      </section>
    `);
    const { document } = dom.window;

    // When the real adapter handles this fixture
    const observed = readTradeAvailableBalance(document.querySelector('#trade-form'), {
        isVisibleElement: () => true,
      });

    // Then the user reads the exact Chinese and English available-balance contract
    assert.deepEqual(
      observed,
      { amount: '0.00', asset: 'USDT' },
    );
  });
}

test("user rejects missing, malformed, or ambiguous available-balance contracts", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div><span>可用</span><span>0.00 USDT</span></div>
      <div><span>可用</span><span>1.00 USDT</span></div>
      <div><span>Available</span><span>not-a-balance</span></div>
    </section>
  `);

  // When the trade form state is read or synchronized
  const observed = readTradeAvailableBalance(dom.window.document.querySelector('#trade-form'), {
      isVisibleElement: () => true,
    });

  // Then rejects missing, malformed, or ambiguous available-balance contracts
  assert.equal(
    observed,
    null,
  );
});

for (const [scenarioIndex, asset] of (['龙虾', '币安人生', '4', '1INCH', '1000PEPE', 'A_B']).entries()) {
  test(`user sees that available-balance asset identifiers retain Unicode and single-digit names (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const dom = loadFixtureDom(`<section><div><span>可用</span><span>1,234.50 ${asset}</span></div></section>`);
    // When the real adapter handles this fixture
    const observed = readTradeAvailableBalance(dom.window.document.querySelector('section'), {
      isVisibleElement: () => true,
    });

    // Then the user sees that available-balance asset identifiers retain Unicode and single-digit names
    assert.deepEqual(observed, { amount: '1234.50', asset });
  });
}

test("user sees that panel spacer is restored before native trade mode after a rerender moves it", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(fixture);
  const { document } = dom.window;
  const spacer = document.createElement('div');
  spacer.id = 'jh-binance-close-qty-multiplier-spacer';
  // When the trade form state is read or synchronized
  const insertionPoint = findTradePanelInsertionPoint(document);

  // Then sees that panel spacer is restored before native trade mode after a rerender moves it
  assert.equal(placeTradePanelSpacer(spacer, insertionPoint), true);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);

  document.querySelector('.order-entry').appendChild(spacer);
  assert.notEqual(spacer.nextElementSibling, insertionPoint.before);

  assert.equal(placeTradePanelSpacer(spacer, findTradePanelInsertionPoint(document)), true);
  assert.equal(spacer.parentElement, insertionPoint.parent);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);
});

test("user sees that floating panel layout follows anchor movement without changing its size contract", () => {
  // Given the current trade fields and requested values are available
  const base = {
    panelHeight: 466,
    viewportWidth: 1684,
    viewportHeight: 900,
  };

  // When the trade form state is read or synchronized
  const observed = calculateFloatingPanelLayout({
      ...base,
      anchorRect: { left: 1430, top: 112, width: 241, height: 478 },
    });

  // Then sees that floating panel layout follows anchor movement without changing its size contract
  assert.deepEqual(
    observed,
    { width: 280, left: 1396, top: 112 },
  );
  assert.deepEqual(
    calculateFloatingPanelLayout({
      ...base,
      anchorRect: { left: 1430, top: 45, width: 241, height: 478 },
    }),
    { width: 280, left: 1396, top: 45 },
  );
});

test("user sees that floating panel layout rejects a hidden anchor", () => {
  // Given the current trade fields and requested values are available
  const scenarioInputs = [{
      anchorRect: { left: 0, top: 0, width: 0, height: 0 },
      panelHeight: 466,
      viewportWidth: 1684,
      viewportHeight: 900,
    }];

  // When the trade form state is read or synchronized
  const observed = calculateFloatingPanelLayout(...scenarioInputs);

  // Then sees that floating panel layout rejects a hidden anchor
  assert.equal(
    observed,
    null,
  );
});

test("user sees that trade form mutation wait resolves as soon as the requested state is selected", async () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div role="tab" aria-selected="false">Open</div>
      <div role="tab" aria-selected="true">Close</div>
    </section>
  `);
  const { document } = dom.window;
  const root = document.querySelector('#trade-form');
  const openTab = root.firstElementChild;
  const pending = waitForTradeFormMutationState(
    root,
    () => (openTab.getAttribute('aria-selected') === 'true' ? 'OPEN' : null),
    100,
  );

  // When the trade form state is read or synchronized
  openTab.setAttribute('aria-selected', 'true');

  // Then sees that trade form mutation wait resolves as soon as the requested state is selected
  assert.equal(await pending, 'OPEN');
});

test("user receives the final trade form state at its virtual mutation deadline", async (t) => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom('<section id="trade-form"></section>');
  const root = dom.window.document.querySelector('#trade-form');
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // When the trade form state is read or synchronized
  const pending = waitForTradeFormMutationState(root, () => root.querySelector('[data-ready]'), 50);
  t.mock.timers.tick(50);
  const observed = await pending;

  // Then sees that trade form mutation wait returns the final state at its deadline
  assert.equal(
    observed,
    null,
  );
});

test('user confirms controlled trade inputs only after consecutive stable frames', async () => {
  // Given real native inputs match the expected values on the first observed frame
  const dom = loadFixtureDom('<section><input id="price" value="81.9"><input id="qty" value="0.01"></section>');
  const root = dom.window.document.querySelector('section');
  const price = root.querySelector('#price');
  const qty = root.querySelector('#qty');
  const frames = createAnimationFrameBoundary(dom.window);
  let result = 'pending';
  const pending = waitForTradeFormFrameState(root, () => (
    price.value === '81.9' && qty.value === '0.01' ? { price: price.value, qty: qty.value } : null
  ), 1000, 2).then((value) => { result = value; return value; });

  // When the first match is followed by a native rollback and one restored match
  frames.runFrame(16);
  qty.value = '0';
  frames.runFrame(32);
  qty.value = '0.01';
  frames.runFrame(48);
  await Promise.resolve();

  // Then the interrupted matching sequence cannot complete early
  assert.equal(result, 'pending');
  assert.equal(frames.pendingCount, 1);

  // When the restored values remain valid for their second consecutive frame
  frames.runFrame(64);
  const observed = await pending;

  // Then the actual controlled values are returned and frame observation stops
  assert.deepEqual(observed, { price: '81.9', qty: '0.01' });
  assert.equal(frames.pendingCount, 0);
});

test('user rejects trade inputs that keep rolling back before their virtual deadline', async (t) => {
  // Given a real native quantity input alternates between the expected and rolled-back values
  const dom = loadFixtureDom('<section><input value="0.01"></section>');
  const root = dom.window.document.querySelector('section');
  const qty = root.querySelector('input');
  const frames = createAnimationFrameBoundary(dom.window);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result = 'pending';
  const pending = waitForTradeFormFrameState(root, () => (
    qty.value === '0.01' ? { price: '81.9', qty: qty.value } : null
  ), 20, 2).then((value) => { result = value; return value; });

  // When each matching frame is followed by a native rollback before stability
  for (let frame = 1; frame <= 4; frame += 1) {
    qty.value = frame % 2 === 1 ? '0.01' : '0';
    frames.runFrame(frame * 4);
  }
  t.mock.timers.tick(19);
  await Promise.resolve();

  // Then the unstable values remain unconfirmed before the deadline
  assert.equal(result, 'pending');

  // When the final virtual millisecond expires
  t.mock.timers.tick(1);
  const observed = await pending;

  // Then no input state is accepted and the outstanding frame is cancelled
  assert.equal(observed, null);
  assert.equal(frames.pendingCount, 0);
});

test('user waits for stable action buttons when the selected mode mounts first', async () => {
  // Given the selected mode is mounted before its corresponding native action button
  const dom = loadFixtureDom('<section><div role="tab" aria-selected="true">Open</div></section>');
  const { document } = dom.window;
  const root = document.querySelector('section');
  const frames = createAnimationFrameBoundary(dom.window);
  let result = 'pending';
  const pending = waitForTradeActionButtonFrameState(document, () => root.querySelector('button'), () => true, 1000, 2)
    .then((value) => { result = value; return value; });

  // When one frame has no button and the next contains the newly mounted control
  frames.runFrame(16);
  const nativeButton = document.createElement('button');
  nativeButton.textContent = '开空';
  root.append(nativeButton);
  frames.runFrame(32);
  await Promise.resolve();

  // Then a single actionable observation is still insufficient
  assert.equal(result, 'pending');

  // When the same button remains actionable for another frame
  frames.runFrame(48);
  const observed = await pending;

  // Then the exact connected native button is accepted
  assert.equal(observed, nativeButton);
  assert.equal(observed.textContent, '开空');
  assert.equal(observed.isConnected, true);
  assert.equal(frames.pendingCount, 0);
});

test('user restarts action-button stability after React replaces the native node', async () => {
  // Given an observed native button may be replaced before the locator updates its reference
  const dom = loadFixtureDom('<section><button>平空</button></section>');
  const { document } = dom.window;
  const root = document.querySelector('section');
  const originalButton = root.querySelector('button');
  const replacementButton = document.createElement('button');
  replacementButton.textContent = '平空';
  let resolvedButton = originalButton;
  const frames = createAnimationFrameBoundary(dom.window);
  let result = 'pending';
  const pending = waitForTradeActionButtonFrameState(document, () => resolvedButton, () => true, 1000, 2)
    .then((value) => { result = value; return value; });

  // When React replaces the previously observed button and the locator catches up a frame later
  frames.runFrame(16);
  originalButton.replaceWith(replacementButton);
  frames.runFrame(32);
  resolvedButton = replacementButton;
  frames.runFrame(48);
  await Promise.resolve();

  // Then the replacement starts its own stability period
  assert.equal(result, 'pending');
  assert.equal(originalButton.isConnected, false);

  // When the replacement survives its second actionable frame
  frames.runFrame(64);
  const observed = await pending;

  // Then only the new connected button is returned
  assert.equal(observed, replacementButton);
  assert.equal(observed.isConnected, true);
  assert.equal(frames.pendingCount, 0);
});

test('user rejects a natively disabled action button at the virtual deadline', async (t) => {
  // Given the native button remains aria-disabled throughout observation
  const dom = loadFixtureDom('<section id="trade-form"><button aria-disabled="true">开多</button></section>');
  const { document } = dom.window;
  const root = document.querySelector('#trade-form');
  const frames = createAnimationFrameBoundary(dom.window);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result = 'pending';
  const pending = waitForTradeActionButtonFrameState(document, () => root.querySelector('button'), () => true, 10, 2)
    .then((value) => { result = value; return value; });

  // When repeated frames still show the disabled button before the timeout
  frames.runFrame(4);
  frames.runFrame(8);
  t.mock.timers.tick(9);
  await Promise.resolve();

  // Then a mounted but disabled native button stays unaccepted
  assert.equal(result, 'pending');

  // When the final virtual millisecond expires
  t.mock.timers.tick(1);
  const observed = await pending;

  // Then no action target is returned and frame observation ends
  assert.equal(observed, null);
  assert.equal(frames.pendingCount, 0);
});

test("user sees that unexpected trade-mode structure is rejected instead of inserting at a guessed location", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <main>
      <div id="position-direction">
        <div role="tab">开仓</div>
        <div role="tab">平仓</div>
      </div>
    </main>
  `);

  // When the trade form state is read or synchronized
  const observed = findTradePanelInsertionPoint(dom.window.document);

  // Then sees that unexpected trade-mode structure is rejected instead of inserting at a guessed location
  assert.equal(observed, null);
});

test("user sees that trade form root ignores duplicated Binance tab-pane IDs", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="bn-tab-pane-0"><button>平空</button></section>
    <section id="bn-tab-pane-0"><button>平空</button></section>
    <section id="trade-form">
      <div id="position-direction">
        <div role="tab" aria-controls="bn-tab-pane-0" aria-selected="true">平仓</div>
      </div>
      <div data-testid="max-buy-amount">0.00 HYPE</div>
      <input id="unitAmount-close" />
      <button>平多</button>
      <button>平空</button>
    </section>
  `);
  const { document } = dom.window;
  const activeTab = document.querySelector('#position-direction [aria-selected="true"]');
  const qtyInput = document.querySelector('#unitAmount-close');

  // When the trade form state is read or synchronized
  const root = findTradeFormRoot(activeTab, qtyInput);

  // Then sees that trade form root ignores duplicated Binance tab-pane IDs
  assert.equal(root?.id, 'trade-form');
  assert.notEqual(root, document.getElementById('bn-tab-pane-0'));
  assert.equal(root.querySelector('[data-testid="max-buy-amount"]')?.textContent, '0.00 HYPE');
});

test("user sees that trade form root observes live position state after React replaces descendants", async () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div id="position-direction">
        <div role="tab" aria-selected="true">平仓</div>
      </div>
      <div class="trade-fields">
        <div data-testid="max-buy-amount">0.42 HYPE</div>
        <input id="unitAmount-close" />
      </div>
    </section>
  `);
  const { document, MutationObserver } = dom.window;
  const activeTab = document.querySelector('#position-direction [aria-selected="true"]');
  const qtyInput = document.querySelector('#unitAmount-close');
  const root = findTradeFormRoot(activeTab, qtyInput);
  const observedTexts = [];
  const delivered = Promise.withResolvers();
  const observer = new MutationObserver(() => {
    observedTexts.push(root.querySelector('[data-testid="max-buy-amount"]')?.textContent);
    delivered.resolve();
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });

  document.querySelector('.trade-fields').replaceChildren();
  const maxBuy = document.createElement('div');
  maxBuy.dataset.testid = 'max-buy-amount';
  maxBuy.textContent = '0.00 HYPE';
  document.querySelector('.trade-fields').append(maxBuy);
  await delivered.promise;
  // When the trade form state is read or synchronized
  observer.disconnect();

  // Then sees that trade form root observes live position state after React replaces descendants
  assert.equal(root.isConnected, true);
  assert.equal(root.querySelector('[data-testid="max-buy-amount"]')?.textContent, '0.00 HYPE');
  assert.ok(observedTexts.includes('0.00 HYPE'));
});

test("user sees that active trade inputs ignore hidden duplicate forms and remain one coherent pair", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section data-form="hidden">
      <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
      <input id="limitPrice-hidden" />
      <input id="unitAmount-hidden" />
    </section>
    <section data-form="visible">
      <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
      <input id="limitPrice-close" />
      <input id="unitAmount-close" />
    </section>
  `);
  const { document } = dom.window;
  // When the trade form state is read or synchronized
  const inputs = findActiveTradeInputs(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: (element) => element.closest('section')?.dataset.form === 'visible',
  });

  // Then sees that active trade inputs ignore hidden duplicate forms and remain one coherent pair
  assert.equal(inputs?.root.dataset.form, 'visible');
  assert.equal(inputs?.priceInput.id, 'limitPrice-close');
  assert.equal(inputs?.qtyInput.id, 'unitAmount-close');
});

test("user sees that active trade form can be resolved before a limit-price input is rendered", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section data-form="visible">
      <div id="position-direction"><div role="tab" aria-selected="true">开仓</div></div>
      <input id="unitAmount-open" />
    </section>
  `);
  const { document } = dom.window;
  const visibility = (element) => element.closest('section')?.dataset.form === 'visible';

  // When the trade form state is read or synchronized
  const observed = findActiveTradeInputs(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: visibility,
  });

  // Then sees that active trade form can be resolved before a limit-price input is rendered
  assert.equal(observed, null);
  const form = findActiveTradeInputs(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: visibility,
    requirePrice: false,
  });
  assert.equal(form?.root.dataset.form, 'visible');
  assert.equal(form?.qtyInput.id, 'unitAmount-open');
  assert.equal(form?.priceInput, null);
});

test("user sees that trade input resolver scans the document once and then resolves live inputs inside the cached root", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
      <input id="limitPrice-close" />
      <input id="unitAmount-close" />
    </section>
  `);
  const { document } = dom.window;
  const originalQuerySelectorAll = document.querySelectorAll.bind(document);
  let documentScans = 0;
  document.querySelectorAll = (...args) => {
    documentScans += 1;
    return originalQuerySelectorAll(...args);
  };
  // When the trade form state is read or synchronized
  const resolveInputs = createTradeInputResolver(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: () => true,
  });



  // Then sees that trade input resolver scans the document once and then resolves live inputs inside the cached root
  assert.equal(resolveInputs()?.qtyInput.id, 'unitAmount-close');
  const scansAfterDiscovery = documentScans;
  assert.ok(scansAfterDiscovery > 0);
  assert.equal(resolveInputs()?.priceInput.id, 'limitPrice-close');
  assert.equal(resolveInputs()?.qtyInput.id, 'unitAmount-close');
  assert.equal(documentScans, scansAfterDiscovery);
});

test("user sees that trade input resolver starts from a proven root without another document scan", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
      <input id="limitPrice-close" />
      <input id="unitAmount-close" />
    </section>
  `);
  const { document } = dom.window;
  const root = document.querySelector('#trade-form');
  const originalQuerySelectorAll = document.querySelectorAll.bind(document);
  let documentScans = 0;
  document.querySelectorAll = (...args) => {
    documentScans += 1;
    return originalQuerySelectorAll(...args);
  };
  // When the trade form state is read or synchronized
  const resolveInputs = createTradeInputResolver(document, {
    initialRoot: root,
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: () => true,
  });



  // Then sees that trade input resolver starts from a proven root without another document scan
  assert.equal(resolveInputs()?.qtyInput.id, 'unitAmount-close');
  assert.equal(resolveInputs()?.priceInput.id, 'limitPrice-close');
  assert.equal(documentScans, 0);
});

test("user sees that trade input resolver follows React descendant replacement without rescanning the document", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
      <input id="limitPrice-close" />
      <input id="unitAmount-close" />
    </section>
  `);
  const { document } = dom.window;
  const originalQuerySelectorAll = document.querySelectorAll.bind(document);
  let documentScans = 0;
  document.querySelectorAll = (...args) => {
    documentScans += 1;
    return originalQuerySelectorAll(...args);
  };
  const resolveInputs = createTradeInputResolver(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: () => true,
  });
  const first = resolveInputs();
  const scansAfterDiscovery = documentScans;
  const replacementPrice = document.createElement('input');
  replacementPrice.id = 'limitPrice-close-replacement';
  const replacementQty = document.createElement('input');
  replacementQty.id = 'unitAmount-close-replacement';
  first.priceInput.replaceWith(replacementPrice);
  // When the trade form state is read or synchronized
  first.qtyInput.replaceWith(replacementQty);

  const second = resolveInputs();
  // Then sees that trade input resolver follows React descendant replacement without rescanning the document
  assert.equal(second?.root, first.root);
  assert.equal(second?.priceInput, replacementPrice);
  assert.equal(second?.qtyInput, replacementQty);
  assert.equal(documentScans, scansAfterDiscovery);
});

test("user sees that trade input resolver waits inside a connected root while React temporarily removes inputs", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
      <input id="limitPrice-close" />
      <input id="unitAmount-close" />
    </section>
  `);
  const { document } = dom.window;
  const originalQuerySelectorAll = document.querySelectorAll.bind(document);
  let documentScans = 0;
  document.querySelectorAll = (...args) => {
    documentScans += 1;
    return originalQuerySelectorAll(...args);
  };
  const resolveInputs = createTradeInputResolver(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: () => true,
  });
  const first = resolveInputs();
  const scansAfterDiscovery = documentScans;
  first.priceInput.remove();
  // When the trade form state is read or synchronized
  first.qtyInput.remove();

  // Then sees that trade input resolver waits inside a connected root while React temporarily removes inputs
  assert.equal(resolveInputs(), null);
  assert.equal(first.root.isConnected, true);
  assert.equal(documentScans, scansAfterDiscovery);

  const replacementPrice = document.createElement('input');
  replacementPrice.id = 'limitPrice-close-replacement';
  const replacementQty = document.createElement('input');
  replacementQty.id = 'unitAmount-close-replacement';
  first.root.append(replacementPrice, replacementQty);

  const recovered = resolveInputs();
  assert.equal(recovered?.priceInput, replacementPrice);
  assert.equal(recovered?.qtyInput, replacementQty);
  assert.equal(documentScans, scansAfterDiscovery);
});

test("user sees that trade input resolver rediscovers the form after React replaces the cached root", () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <main>
      <section id="trade-form">
        <div id="position-direction"><div role="tab" aria-selected="true">平仓</div></div>
        <input id="limitPrice-close" />
        <input id="unitAmount-close" />
      </section>
    </main>
  `);
  const { document } = dom.window;
  const resolveInputs = createTradeInputResolver(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: () => true,
  });
  const first = resolveInputs();
  // When the trade form state is read or synchronized
  first.root.outerHTML = `
    <section id="trade-form-next">
      <div id="position-direction"><div role="tab" aria-selected="true">开仓</div></div>
      <input id="limitPrice-open" />
      <input id="unitAmount-open" />
    </section>
  `;

  const second = resolveInputs();
  // Then sees that trade input resolver rediscovers the form after React replaces the cached root
  assert.equal(first.root.isConnected, false);
  assert.equal(second?.root.id, 'trade-form-next');
  assert.equal(second?.priceInput.id, 'limitPrice-open');
  assert.equal(second?.qtyInput.id, 'unitAmount-open');
});

test("user sees that trade input synchronization performs one post-transition write after a stable same-node rollback", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: { value: '' },
    qtyInput: { value: '' },
  };
  const writes = [];
  let qtyWrites = 0;
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedPrice: '81.9',
    expectedQty: '0.01',
    includePrice: true,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      if (input === currentInputs.qtyInput) {
        qtyWrites += 1;
        input.value = qtyWrites === 1 ? '' : value;
        return;
      }
      input.value = value;
    },
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization performs one post-transition write after a stable same-node rollback
  assert.equal(observed, null);
  assert.equal(readState(), null);
  assert.equal(writes.length, 1);
  assert.equal(readState(), null);
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '0.01']);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedPrice: '81.9',
    submittedQty: '0.01',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '0.01', '81.9']);
});

test("user sees that trade input synchronization can settle a ladder input after repeated stable same-node rollbacks", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  let qtyWrites = 0;
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.02',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      qtyWrites += 1;
      input.value = qtyWrites < 3 ? '' : value;
    },
    requiredStableMismatchFrames: 2,
    maxWriteAttempts: 5,
    isRecoveryWriteAllowed: ({ currentInput, rollbackValue }) => (
      currentInput === currentInputs.qtyInput && rollbackValue === null
    ),
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization can settle a ladder input after repeated stable same-node rollbacks
  assert.equal(observed, null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.02',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.02', '0.02', '0.02']);
});

test("user sees that trade input synchronization recovers a provisional match rolled back before the first observation frame", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.07',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
    requiredStableMismatchFrames: 2,
    requiredStableMatchFrames: 2,
    maxWriteAttempts: 5,
    recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: ({
      preWriteValue,
      rollbackValue,
      submittedValue,
    }) => isScriptOwnedTradeInputRecoveryState({
      preWriteValue,
      rollbackValue,
      submittedValue,
      previousSubmittedValue: null,
      compareValues: compareDecimalStrings,
    }),
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization recovers a provisional match rolled back before the first observation frame
  assert.equal(observed, null);
  currentInputs.qtyInput.value = '';
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.07',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.07', '0.07']);
});

test("user sees that trade input synchronization uses elapsed stability time instead of assuming a frame rate", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  let nowMs = 0;
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.08',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      input.value = value;
    },
    requiredStableMatchFrames: 2,
    requiredStableMatchMs: 180,
    readNowMs: () => nowMs,
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization uses elapsed stability time instead of assuming a frame rate
  assert.equal(observed, null);
  nowMs = 100;
  assert.equal(readState(), null);
  nowMs = 150;
  assert.equal(readState(), null);
  nowMs = 280;
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.08',
  });
});

test("user sees that one timed synchronization state machine confirms quantity before price without rechecking quantity from zero", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: { value: '' },
    qtyInput: { value: '' },
  };
  const writes = [];
  let nowMs = 0;
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedPrice: '81.9',
    expectedQty: '0.08',
    includePrice: true,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
    requiredStableMatchFrames: 2,
    requiredStableMatchMs: 180,
    readNowMs: () => nowMs,
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that one timed synchronization state machine confirms quantity before price without rechecking quantity from zero
  assert.equal(observed, null);
  nowMs = 100;
  assert.equal(readState(), null);
  nowMs = 280;
  assert.equal(readState(), null);
  assert.deepEqual(writes.map(({ value }) => value), ['0.08', '81.9']);
  nowMs = 380;
  assert.equal(readState(), null);
  nowMs = 460;
  assert.equal(readState(), null);
  nowMs = 560;
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedPrice: '81.9',
    submittedQty: '0.08',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.08', '81.9']);
});

test("user sees that trade input stability duration restarts after React rolls the accepted value back", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  let nowMs = 0;
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.09',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push(value);
      input.value = value;
    },
    requiredStableMismatchFrames: 2,
    requiredStableMismatchMs: 180,
    requiredStableMatchFrames: 2,
    requiredStableMatchMs: 180,
    maxWriteAttempts: 3,
    recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: ({ rollbackValue }) => rollbackValue === null,
    readNowMs: () => nowMs,
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input stability duration restarts after React rolls the accepted value back
  assert.equal(observed, null);
  nowMs = 100;
  assert.equal(readState(), null);
  currentInputs.qtyInput.value = '';
  nowMs = 150;
  assert.equal(readState(), null);
  nowMs = 250;
  assert.equal(readState(), null);
  nowMs = 330;
  assert.equal(readState(), null);
  assert.deepEqual(writes, ['0.09', '0.09']);
  nowMs = 430;
  assert.equal(readState(), null);
  nowMs = 510;
  assert.equal(readState(), null);
  nowMs = 610;
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.09',
  });
});

test("user sees that script-owned trade input recovery accepts only the same field previous value or empty state", () => {
  // Given the current trade fields and requested values are available
  const previousSubmittedInputs = {
    submittedPrice: '84.5',
    submittedQty: '0.05',
  };
  const isAllowed = (field, state) => isScriptOwnedTradeInputRecoveryState({
    ...state,
    previousSubmittedValue: field === 'qty'
      ? previousSubmittedInputs.submittedQty
      : previousSubmittedInputs.submittedPrice,
    compareValues: compareDecimalStrings,
  });

  // When the trade form state is read or synchronized
  const observed = isAllowed('qty', {
    preWriteValue: '0.05',
    rollbackValue: '0.05',
    submittedValue: '0.05',
  });

  // Then sees that script-owned trade input recovery accepts only the same field previous value or empty state
  assert.equal(observed, true);
  assert.equal(isAllowed('qty', {
    preWriteValue: '0.05',
    rollbackValue: null,
    submittedValue: null,
  }), true);
  assert.equal(isAllowed('qty', {
    preWriteValue: '84.5',
    rollbackValue: '84.5',
    submittedValue: '84.5',
  }), false);
  assert.equal(isAllowed('price', {
    preWriteValue: '84.5',
    rollbackValue: '84.5',
    submittedValue: null,
  }), true);
  assert.equal(isAllowed('qty', {
    preWriteValue: '0.03',
    rollbackValue: '0.03',
    submittedValue: '0.03',
  }), false);
});

test("user sees that trade input synchronization recovers a previous acknowledged quantity cleared by Binance", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '0.05' },
  };
  const writes = [];
  const previousSubmittedInputs = {
    submittedPrice: '84.5',
    submittedQty: '0.05',
  };
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.1',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
    requiredStableMismatchFrames: 2,
    requiredStableMatchFrames: 2,
    maxWriteAttempts: 5,
    recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: ({
      field,
      preWriteValue,
      rollbackValue,
      submittedValue,
    }) => isScriptOwnedTradeInputRecoveryState({
      preWriteValue,
      rollbackValue,
      submittedValue,
      previousSubmittedValue: field === 'qty'
        ? previousSubmittedInputs.submittedQty
        : previousSubmittedInputs.submittedPrice,
      compareValues: compareDecimalStrings,
    }),
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization recovers a previous acknowledged quantity cleared by Binance
  assert.equal(observed, null);
  assert.equal(readState(), null);
  currentInputs.qtyInput.value = '';
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.1',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.1', '0.1']);
});

test("user sees that previous acknowledged recovery remains bounded when Binance repeatedly clears the input", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '0.05' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.1',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = '';
    },
    requiredStableMismatchFrames: 1,
    maxWriteAttempts: 3,
    recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: ({
      preWriteValue,
      rollbackValue,
      submittedValue,
    }) => isScriptOwnedTradeInputRecoveryState({
      preWriteValue,
      rollbackValue,
      submittedValue,
      previousSubmittedValue: '0.05',
      compareValues: compareDecimalStrings,
    }),
  });

  for (let frame = 0; frame < 10; frame += 1) {
    assert.equal(readState(), null);
  }
  // When the trade form state is read or synchronized
  const observed = writes.map(({ value }) => value);

  // Then sees that previous acknowledged recovery remains bounded when Binance repeatedly clears the input
  assert.deepEqual(observed, ['0.1', '0.1', '0.1']);
});

test("user sees that previous acknowledged recovery gives a replacement input an independent bounded write", () => {
  // Given the current trade fields and requested values are available
  let currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '0.05' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.1',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
    requiredStableMismatchFrames: 2,
    requiredStableMatchFrames: 2,
    maxWriteAttempts: 5,
    recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: ({
      preWriteValue,
      rollbackValue,
      submittedValue,
    }) => isScriptOwnedTradeInputRecoveryState({
      preWriteValue,
      rollbackValue,
      submittedValue,
      previousSubmittedValue: '0.05',
      compareValues: compareDecimalStrings,
    }),
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that previous acknowledged recovery gives a replacement input an independent bounded write
  assert.equal(observed, null);
  assert.equal(readState(), null);
  currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '0.05' },
  };
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.1',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.1', '0.1']);
});

test("user sees that trade input synchronization cancels provisional recovery for a different non-empty value", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.07',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
    requiredStableMismatchFrames: 2,
    requiredStableMatchFrames: 2,
    maxWriteAttempts: 5,
    recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: ({
      preWriteValue,
      rollbackValue,
      submittedValue,
    }) => isScriptOwnedTradeInputRecoveryState({
      preWriteValue,
      rollbackValue,
      submittedValue,
      previousSubmittedValue: null,
      compareValues: compareDecimalStrings,
    }),
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization cancels provisional recovery for a different non-empty value
  assert.equal(observed, null);
  currentInputs.qtyInput.value = '0.005';
  for (let frame = 0; frame < 5; frame += 1) {
    assert.equal(readState(), null);
  }
  assert.equal(currentInputs.qtyInput.value, '0.005');
  assert.deepEqual(writes.map(({ value }) => value), ['0.07']);
});

test("user sees that trade input synchronization rejects a provisionally accepted value that rolls back before settling", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.19',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
    requiredStableMismatchFrames: 2,
    requiredStableMatchFrames: 3,
    maxWriteAttempts: 5,
    isRecoveryWriteAllowed: ({ rollbackValue }) => rollbackValue === null,
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization rejects a provisionally accepted value that rolls back before settling
  assert.equal(observed, null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  currentInputs.qtyInput.value = '';
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedQty: '0.19',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.19', '0.19']);
});

test("user sees that bounded input writer shares one total budget for each input identity", () => {
  // Given the current trade fields and requested values are available
  const writes = [];
  const writeValue = createBoundedInputWriter({
    writeValue: (input, value) => writes.push({ input, value }),
    maxWriteAttempts: 3,
  });
  const input = {};
  const replacement = {};

  // When the trade form state is read or synchronized
  const observed = writeValue(input, '0.01');

  // Then sees that bounded input writer shares one total budget for each input identity
  assert.equal(observed, true);
  assert.equal(writeValue(input, '0.02'), true);
  assert.equal(writeValue(input, '0.03'), true);
  assert.equal(writeValue(input, '0.04'), false);
  assert.equal(writeValue(input, '0.05'), false);
  assert.equal(writeValue(replacement, '0.06'), true);
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '0.02', '0.03', '0.06']);
});

test("user sees that trade input synchronization remains fail-closed after the post-transition write is rejected", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.01',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = '';
    },
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization remains fail-closed after the post-transition write is rejected
  assert.equal(observed, null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '0.01']);
});

test("user sees that trade input synchronization never exceeds an expanded write-attempt budget", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.02',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = '';
    },
    requiredStableMismatchFrames: 1,
    maxWriteAttempts: 3,
    isRecoveryWriteAllowed: ({ rollbackValue }) => rollbackValue === null,
  });

  for (let frame = 0; frame < 10; frame += 1) {
    assert.equal(readState(), null);
  }
  // When the trade form state is read or synchronized
  const observed = writes.map(({ value }) => value);

  // Then sees that trade input synchronization never exceeds an expanded write-attempt budget
  assert.deepEqual(observed, ['0.02', '0.02', '0.02']);
});

test("user sees that trade input synchronization rejects an invalid rollback stability contract", () => {
  // Given the current trade fields and requested values are available
  const scenarioInputs = [{
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: (expected, actual) => expected === actual ? 0 : 1,
      writeValue: () => {},
      requiredStableMismatchFrames: 0,
    }];

  // When the trade form state is read or synchronized
  const observedFailure = captureThrownError(() => createTradeInputStateReader(...scenarioInputs));

  // Then sees that trade input synchronization rejects an invalid rollback stability contract
  assert.match(observedFailure.message, /输入框回退稳定帧数必须为正整数/);
  assert.throws(
    () => createTradeInputStateReader({
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: () => 1,
      writeValue: () => {},
      maxWriteAttempts: 0,
    }),
    /输入框写入次数必须为正整数/,
  );
  assert.throws(
    () => createTradeInputStateReader({
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: () => 1,
      writeValue: () => {},
      requiredStableMatchFrames: 0,
    }),
    /输入框写入稳定帧数必须为正整数/,
  );
  assert.throws(
    () => createTradeInputStateReader({
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: () => 1,
      writeValue: () => {},
      requiredStableMismatchMs: -1,
    }),
    /输入框回退稳定时间不能为负数/,
  );
  assert.throws(
    () => createTradeInputStateReader({
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: () => 1,
      writeValue: () => {},
      requiredStableMatchMs: Number.NaN,
    }),
    /输入框写入稳定时间不能为负数/,
  );
  assert.throws(
    () => createTradeInputStateReader({
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: () => 1,
      writeValue: () => {},
      recoverProvisionalMatchRollback: 'yes',
    }),
    /输入框临时恢复标记必须为布尔值/,
  );
});

test("user sees that trade input synchronization stops when the recovery policy rejects the rollback", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.02',
    includePrice: false,
    normalizeValue: String,
    compareValues: (expected, actual) => expected === actual ? 0 : 1,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = '';
    },
    maxWriteAttempts: 5,
    isRecoveryWriteAllowed: () => false,
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization stops when the recovery policy rejects the rollback
  assert.equal(observed, null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(writes.map(({ value }) => value), ['0.02']);
});

test("user sees that trade input synchronization cancels the post-transition write when the rollback value changes", () => {
  // Given the current trade fields and requested values are available
  const currentInputs = {
    root: {},
    priceInput: null,
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedQty: '0.01',
    includePrice: false,
    normalizeValue: String,
    compareValues: (expected, actual) => expected === actual ? 0 : 1,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = writes.length === 1 ? '' : value;
    },
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization cancels the post-transition write when the rollback value changes
  assert.equal(observed, null);
  assert.equal(readState(), null);
  currentInputs.qtyInput.value = '0.005';
  assert.equal(readState(), null);
  assert.equal(writes.length, 1);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(currentInputs.qtyInput.value, '0.005');
  assert.deepEqual(writes.map(({ value }) => value), ['0.01']);
});

test("user sees that trade input synchronization gives each replacement identity an independent write budget", () => {
  // Given the current trade fields and requested values are available
  let currentInputs = {
    root: {},
    priceInput: { value: '' },
    qtyInput: { value: '' },
  };
  const writes = [];
  const readState = createTradeInputStateReader({
    resolveInputs: () => currentInputs,
    expectedPrice: '81.9',
    expectedQty: '0.01',
    includePrice: true,
    normalizeValue: String,
    compareValues: (expected, actual) => expected === actual ? 0 : 1,
    writeValue: (input, value) => {
      writes.push({ input, value });
      input.value = value;
    },
  });

  // When the trade form state is read or synchronized
  const observed = readState();

  // Then sees that trade input synchronization gives each replacement identity an independent write budget
  assert.equal(observed, null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedPrice: '81.9',
    submittedQty: '0.01',
  });

  currentInputs = {
    root: {},
    priceInput: { value: '' },
    qtyInput: { value: '' },
  };
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(readState(), {
    ...currentInputs,
    submittedPrice: '81.9',
    submittedQty: '0.01',
  });
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '81.9', '0.01', '81.9']);
});

test("user sees that recognizes only close-quantity mutations as a confirmed close snapshot", async () => {
  // Given the current trade fields and requested values are available
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div data-testid="max-buy-amount">4.06 HYPE</div>
      <div class="unrelated">unchanged</div>
    </section>
  `);
  const { document, MutationObserver } = dom.window;
  const mutationBatches = [];
  const deliveries = [Promise.withResolvers(), Promise.withResolvers()];
  const observer = new MutationObserver((mutations) => {
    mutationBatches.push(mutations);
    deliveries[mutationBatches.length - 1].resolve();
  });
  observer.observe(document.querySelector('#trade-form'), {
    subtree: true,
    childList: true,
    characterData: true,
  });

  document.querySelector('.unrelated').textContent = 'changed';
  await deliveries[0].promise;
  document.querySelector('[data-testid="max-buy-amount"]').textContent = '0.00 HYPE';
  await deliveries[1].promise;
  // When the trade form state is read or synchronized
  observer.disconnect();

  // Then sees that recognizes only close-quantity mutations as a confirmed close snapshot
  assert.equal(mutationBatches.length, 2);
  assert.equal(mutationBatches[0].some(mutationTouchesCloseQuantity), false);
  assert.equal(mutationBatches[1].some(mutationTouchesCloseQuantity), true);
});
