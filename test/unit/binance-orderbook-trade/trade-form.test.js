import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateFloatingPanelLayout,
  createBoundedInputWriter,
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

test('panel insertion point is immediately before the native trade-mode row', () => {
  const dom = loadFixtureDom(fixture);
  const insertionPoint = findTradePanelInsertionPoint(dom.window.document);

  assert.equal(insertionPoint.parent.className, 'trade-header');
  assert.equal(insertionPoint.before.className, 'trade-mode-row');
  assert.equal(insertionPoint.before.previousElementSibling.className, 'quick-controls');
});

test('English trade-mode labels use the same panel insertion contract', () => {
  const dom = loadFixtureDom(
    fixture.replace('>开仓<', '>Open<').replace('>平仓<', '>Close<'),
  );
  const { document } = dom.window;
  const insertionPoint = findTradePanelInsertionPoint(document);
  const tabs = Array.from(document.querySelectorAll('#position-direction [role="tab"]'));

  assert.equal(insertionPoint.parent.className, 'trade-header');
  assert.equal(insertionPoint.before.className, 'trade-mode-row');
  assert.equal(parseTradeModeLabel('Open'), 'OPEN');
  assert.equal(parseTradeModeLabel('Close'), 'CLOSE');
  assert.equal(isTradeModeTab(tabs[0], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
  assert.equal(isTradeModeTab(tabs[1], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
});

test('trade-mode parsing rejects action labels instead of guessing a mode', () => {
  assert.equal(parseTradeModeLabel('Open Long'), null);
  assert.equal(parseTradeModeLabel('Close Short'), null);
  assert.equal(parseTradeModeLabel('开多'), null);
  assert.equal(parseTradeModeLabel('平空'), null);
});

test('reads the exact Chinese and English available-balance contract', () => {
  for (const label of ['可用', 'Avbl']) {
    const dom = loadFixtureDom(`
      <section id="trade-form">
        <div class="bn-flex items-center gap-[4px]">
          <span>${label}</span>
          <span>0.00 USDT</span>
        </div>
      </section>
    `);
    const { document } = dom.window;

    assert.deepEqual(
      readTradeAvailableBalance(document.querySelector('#trade-form'), {
        isVisibleElement: () => true,
      }),
      { amount: '0.00', asset: 'USDT' },
    );
  }
});

test('rejects missing, malformed, or ambiguous available-balance contracts', () => {
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div><span>可用</span><span>0.00 USDT</span></div>
      <div><span>可用</span><span>1.00 USDT</span></div>
      <div><span>Available</span><span>not-a-balance</span></div>
    </section>
  `);

  assert.equal(
    readTradeAvailableBalance(dom.window.document.querySelector('#trade-form'), {
      isVisibleElement: () => true,
    }),
    null,
  );
});

test('panel spacer is restored before native trade mode after a rerender moves it', () => {
  const dom = loadFixtureDom(fixture);
  const { document } = dom.window;
  const spacer = document.createElement('div');
  spacer.id = 'jh-binance-close-qty-multiplier-spacer';
  const insertionPoint = findTradePanelInsertionPoint(document);

  assert.equal(placeTradePanelSpacer(spacer, insertionPoint), true);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);

  document.querySelector('.order-entry').appendChild(spacer);
  assert.notEqual(spacer.nextElementSibling, insertionPoint.before);

  assert.equal(placeTradePanelSpacer(spacer, findTradePanelInsertionPoint(document)), true);
  assert.equal(spacer.parentElement, insertionPoint.parent);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);
});

test('floating panel layout follows anchor movement without changing its size contract', () => {
  const base = {
    panelHeight: 466,
    viewportWidth: 1684,
    viewportHeight: 900,
  };

  assert.deepEqual(
    calculateFloatingPanelLayout({
      ...base,
      anchorRect: { left: 1430, top: 112, width: 241, height: 478 },
    }),
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

test('floating panel layout rejects a hidden anchor', () => {
  assert.equal(
    calculateFloatingPanelLayout({
      anchorRect: { left: 0, top: 0, width: 0, height: 0 },
      panelHeight: 466,
      viewportWidth: 1684,
      viewportHeight: 900,
    }),
    null,
  );
});

test('trade form mutation wait resolves as soon as the requested state is selected', async () => {
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

  openTab.setAttribute('aria-selected', 'true');

  assert.equal(await pending, 'OPEN');
});

test('trade form mutation wait returns the final state at its deadline', async () => {
  const dom = loadFixtureDom('<section id="trade-form"></section>');
  const root = dom.window.document.querySelector('#trade-form');

  assert.equal(
    await waitForTradeFormMutationState(root, () => null, 5),
    null,
  );
});

test('trade form frame wait requires consecutive live-state confirmations', async () => {
  const dom = loadFixtureDom('<section id="trade-form"></section>');
  const root = dom.window.document.querySelector('#trade-form');
  const states = [
    { price: '81.9', qty: '0.01' },
    null,
    { price: '81.9', qty: '0.01' },
    { price: '81.9', qty: '0.01' },
  ];
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);

  const result = await waitForTradeFormFrameState(
    root,
    () => states.shift() ?? null,
    100,
    2,
  );

  assert.deepEqual(result, { price: '81.9', qty: '0.01' });
  assert.equal(states.length, 0);
});

test('trade form frame wait rejects a value that never remains synchronized', async () => {
  const dom = loadFixtureDom('<section id="trade-form"></section>');
  const root = dom.window.document.querySelector('#trade-form');
  let matches = false;
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => {
    matches = !matches;
    callback();
  }, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);

  assert.equal(
    await waitForTradeFormFrameState(
      root,
      () => (matches ? { price: '81.9', qty: '0.01' } : null),
      20,
      2,
    ),
    null,
  );
});

test('trade action button wait survives the selected tab preceding its action buttons', async () => {
  const dom = loadFixtureDom('<section id="trade-form"><div role="tab" aria-selected="true">开仓</div></section>');
  const { document } = dom.window;
  const root = document.querySelector('#trade-form');
  let frame = 0;
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => {
    frame += 1;
    if (frame === 2) {
      const button = document.createElement('button');
      button.textContent = '开空';
      root.append(button);
    }
    callback();
  }, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);

  const button = await waitForTradeActionButtonFrameState(
    document,
    () => Array.from(root.querySelectorAll('button')).find((candidate) => candidate.textContent === '开空') || null,
    () => true,
    100,
    2,
  );

  assert.equal(button?.textContent, '开空');
  assert.equal(button?.isConnected, true);
  assert.equal(frame, 3);
});

test('trade action button wait restarts stability after React replaces the button node', async () => {
  const dom = loadFixtureDom('<section id="trade-form"><button>平空</button></section>');
  const { document } = dom.window;
  const root = document.querySelector('#trade-form');
  const originalButton = root.querySelector('button');
  let replacementButton = null;
  let resolvedButton = originalButton;
  let frame = 0;
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => {
    frame += 1;
    if (frame === 2) {
      replacementButton = document.createElement('button');
      replacementButton.textContent = '平空';
      originalButton.replaceWith(replacementButton);
    }
    if (frame === 3) resolvedButton = replacementButton;
    callback();
  }, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);

  const button = await waitForTradeActionButtonFrameState(
    document,
    () => resolvedButton,
    () => true,
    100,
    2,
  );

  assert.equal(button, replacementButton);
  assert.equal(originalButton.isConnected, false);
  assert.equal(button?.isConnected, true);
  assert.equal(frame, 4);
});

test('trade action button wait rejects a button that remains disabled', async () => {
  const dom = loadFixtureDom('<section id="trade-form"><button aria-disabled="true">开多</button></section>');
  const { document } = dom.window;
  const root = document.querySelector('#trade-form');
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);

  assert.equal(
    await waitForTradeActionButtonFrameState(
      document,
      () => root.querySelector('button'),
      () => true,
      10,
      2,
    ),
    null,
  );
});

test('unexpected trade-mode structure is rejected instead of inserting at a guessed location', () => {
  const dom = loadFixtureDom(`
    <main>
      <div id="position-direction">
        <div role="tab">开仓</div>
        <div role="tab">平仓</div>
      </div>
    </main>
  `);

  assert.equal(findTradePanelInsertionPoint(dom.window.document), null);
});

test('trade form root ignores duplicated Binance tab-pane IDs', () => {
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

  const root = findTradeFormRoot(activeTab, qtyInput);

  assert.equal(root?.id, 'trade-form');
  assert.notEqual(root, document.getElementById('bn-tab-pane-0'));
  assert.equal(root.querySelector('[data-testid="max-buy-amount"]')?.textContent, '0.00 HYPE');
});

test('trade form root observes live position state after React replaces descendants', async () => {
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
  const observer = new MutationObserver(() => {
    observedTexts.push(root.querySelector('[data-testid="max-buy-amount"]')?.textContent);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });

  document.querySelector('.trade-fields').replaceChildren();
  const maxBuy = document.createElement('div');
  maxBuy.dataset.testid = 'max-buy-amount';
  maxBuy.textContent = '0.00 HYPE';
  document.querySelector('.trade-fields').append(maxBuy);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  observer.disconnect();

  assert.equal(root.isConnected, true);
  assert.equal(root.querySelector('[data-testid="max-buy-amount"]')?.textContent, '0.00 HYPE');
  assert.ok(observedTexts.includes('0.00 HYPE'));
});

test('active trade inputs ignore hidden duplicate forms and remain one coherent pair', () => {
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
  const inputs = findActiveTradeInputs(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: (element) => element.closest('section')?.dataset.form === 'visible',
  });

  assert.equal(inputs?.root.dataset.form, 'visible');
  assert.equal(inputs?.priceInput.id, 'limitPrice-close');
  assert.equal(inputs?.qtyInput.id, 'unitAmount-close');
});

test('active trade form can be resolved before a limit-price input is rendered', () => {
  const dom = loadFixtureDom(`
    <section data-form="visible">
      <div id="position-direction"><div role="tab" aria-selected="true">开仓</div></div>
      <input id="unitAmount-open" />
    </section>
  `);
  const { document } = dom.window;
  const visibility = (element) => element.closest('section')?.dataset.form === 'visible';

  assert.equal(findActiveTradeInputs(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: visibility,
  }), null);
  const form = findActiveTradeInputs(document, {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement: visibility,
    requirePrice: false,
  });
  assert.equal(form?.root.dataset.form, 'visible');
  assert.equal(form?.qtyInput.id, 'unitAmount-open');
  assert.equal(form?.priceInput, null);
});

test('trade input synchronization performs one post-transition write after a stable same-node rollback', () => {
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

  assert.equal(readState(), null);
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

test('trade input synchronization can settle a ladder input after repeated stable same-node rollbacks', () => {
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

  assert.equal(readState(), null);
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

test('trade input synchronization recovers a provisional match rolled back before the first observation frame', () => {
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

  assert.equal(readState(), null);
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

test('trade input synchronization uses elapsed stability time instead of assuming a frame rate', () => {
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

  assert.equal(readState(), null);
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

test('one timed synchronization state machine confirms quantity before price without rechecking quantity from zero', () => {
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

  assert.equal(readState(), null);
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

test('trade input stability duration restarts after React rolls the accepted value back', () => {
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

  assert.equal(readState(), null);
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

test('script-owned trade input recovery accepts only the same field previous value or empty state', () => {
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

  assert.equal(isAllowed('qty', {
    preWriteValue: '0.05',
    rollbackValue: '0.05',
    submittedValue: '0.05',
  }), true);
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

test('trade input synchronization recovers a previous acknowledged quantity cleared by Binance', () => {
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

  assert.equal(readState(), null);
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

test('previous acknowledged recovery remains bounded when Binance repeatedly clears the input', () => {
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
  assert.deepEqual(writes.map(({ value }) => value), ['0.1', '0.1', '0.1']);
});

test('previous acknowledged recovery gives a replacement input an independent bounded write', () => {
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

  assert.equal(readState(), null);
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

test('trade input synchronization cancels provisional recovery for a different non-empty value', () => {
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

  assert.equal(readState(), null);
  currentInputs.qtyInput.value = '0.005';
  for (let frame = 0; frame < 5; frame += 1) {
    assert.equal(readState(), null);
  }
  assert.equal(currentInputs.qtyInput.value, '0.005');
  assert.deepEqual(writes.map(({ value }) => value), ['0.07']);
});

test('trade input synchronization rejects a provisionally accepted value that rolls back before settling', () => {
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

  assert.equal(readState(), null);
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

test('bounded input writer shares one total budget for each input identity', () => {
  const writes = [];
  const writeValue = createBoundedInputWriter({
    writeValue: (input, value) => writes.push({ input, value }),
    maxWriteAttempts: 3,
  });
  const input = {};
  const replacement = {};

  assert.equal(writeValue(input, '0.01'), true);
  assert.equal(writeValue(input, '0.02'), true);
  assert.equal(writeValue(input, '0.03'), true);
  assert.equal(writeValue(input, '0.04'), false);
  assert.equal(writeValue(input, '0.05'), false);
  assert.equal(writeValue(replacement, '0.06'), true);
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '0.02', '0.03', '0.06']);
});

test('trade input synchronization remains fail-closed after the post-transition write is rejected', () => {
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

  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(writes.map(({ value }) => value), ['0.01', '0.01']);
});

test('trade input synchronization never exceeds an expanded write-attempt budget', () => {
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
  assert.deepEqual(writes.map(({ value }) => value), ['0.02', '0.02', '0.02']);
});

test('trade input synchronization rejects an invalid rollback stability contract', () => {
  assert.throws(
    () => createTradeInputStateReader({
      resolveInputs: () => null,
      expectedQty: '0.01',
      includePrice: false,
      normalizeValue: String,
      compareValues: (expected, actual) => expected === actual ? 0 : 1,
      writeValue: () => {},
      requiredStableMismatchFrames: 0,
    }),
    /输入框回退稳定帧数必须为正整数/,
  );
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

test('trade input synchronization stops when the recovery policy rejects the rollback', () => {
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

  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.deepEqual(writes.map(({ value }) => value), ['0.02']);
});

test('trade input synchronization cancels the post-transition write when the rollback value changes', () => {
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

  assert.equal(readState(), null);
  assert.equal(readState(), null);
  currentInputs.qtyInput.value = '0.005';
  assert.equal(readState(), null);
  assert.equal(writes.length, 1);
  assert.equal(readState(), null);
  assert.equal(readState(), null);
  assert.equal(currentInputs.qtyInput.value, '0.005');
  assert.deepEqual(writes.map(({ value }) => value), ['0.01']);
});

test('trade input synchronization gives each replacement identity an independent write budget', () => {
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

  assert.equal(readState(), null);
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

test('recognizes only close-quantity mutations as a confirmed close snapshot', async () => {
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div data-testid="max-buy-amount">4.06 HYPE</div>
      <div class="unrelated">unchanged</div>
    </section>
  `);
  const { document, MutationObserver } = dom.window;
  const mutationBatches = [];
  const observer = new MutationObserver((mutations) => mutationBatches.push(mutations));
  observer.observe(document.querySelector('#trade-form'), {
    subtree: true,
    childList: true,
    characterData: true,
  });

  document.querySelector('.unrelated').textContent = 'changed';
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  document.querySelector('[data-testid="max-buy-amount"]').textContent = '0.00 HYPE';
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  observer.disconnect();

  assert.equal(mutationBatches.length, 2);
  assert.equal(mutationBatches[0].some(mutationTouchesCloseQuantity), false);
  assert.equal(mutationBatches[1].some(mutationTouchesCloseQuantity), true);
});
