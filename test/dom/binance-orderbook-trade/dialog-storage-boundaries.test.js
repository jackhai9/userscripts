import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtureDom, isVisibleElement } from '../../helpers/dom.js';
import { showUsdtRebalanceDialog } from '../../../src/binance-orderbook-trade/dom/usdt-rebalance-dialog.js';
import {
  findNativeOrderbookPrecisionOverlay,
  isNativeOrderbookPrecisionMenuOpen,
} from '../../../src/binance-orderbook-trade/dom/orderbook-precision.js';
import {
  isModeSymbolOptionStorageKey,
  loadModeSymbolPrecisionNumberOption,
  loadSymbolSide,
  migrateModeSymbolPrecisionNumberOption,
  modeSymbolPrecisionOptionStorageKey,
  saveModeSymbolPrecisionNumberOption,
} from '../../../src/binance-orderbook-trade/core/panel-options.js';

const DIALOG_ID = 'jh-binance-usdt-rebalance-dialog';
const STYLE_ID = 'jh-binance-usdt-rebalance-dialog-style';
const MODE_KEYS = { OPEN: 'open-ratio', CLOSE: 'close-ratio' };
const RATIO_OPTIONS = [2, 10, 30];

function openDocument(t, html = '<main></main>') {
  const dom = loadFixtureDom(html);
  dom.reconfigure({ url: 'https://native-host.test/' });
  t.after(() => dom.window.close());
  return dom.window.document;
}

/** Native close changes the open state before delivering its later close event. */
function openDialogHost(t) {
  const document = openDocument(t);
  const view = document.defaultView;
  const calls = [];
  view.HTMLDialogElement.prototype.showModal = function showModal() {
    calls.push({ method: 'showModal', dialog: this });
    this.open = true;
  };
  view.HTMLDialogElement.prototype.close = function close() {
    calls.push({ method: 'close', dialog: this });
    if (!this.open) return;
    this.open = false;
    view.queueMicrotask(() => this.dispatchEvent(new view.Event('close')));
  };
  return { document, calls };
}

function rebalanceModel() {
  return {
    title: 'Account Rebalance',
    targetSummary: 'Move 5 USDT from Spot to Funding',
    accountHeading: 'Account',
    currentHeading: 'Current',
    targetHeading: 'Target',
    transferHeading: 'Transfer Plan',
    question: 'Confirm one transfer?',
    cancelLabel: 'Cancel',
    confirmLabel: 'Confirm Rebalance',
    balanceRows: [
      { account: 'Funding', current: '10.00', target: '15.00' },
      { account: 'Spot', current: '20.00', target: '15.00' },
    ],
    transferRows: [{ route: 'Spot → Funding', amount: '5.00 USDT' }],
  };
}

test('user receives native dialog close state before the asynchronous close event', async t => {
  // Given the dialog host has one mounted native dialog and a close-event observer.
  const host = openDialogHost(t);
  const dialog = host.document.createElement('dialog');
  host.document.body.append(dialog);
  const states = [];
  dialog.addEventListener('close', () => states.push(dialog.open));
  dialog.showModal();
  assert.equal(dialog.open, true);

  // When the native host closes the dialog twice before delivering events.
  dialog.close();
  dialog.close();

  // Then open state changes synchronously and only one close event is queued.
  assert.equal(dialog.open, false);
  assert.deepEqual(states, []);
  await Promise.resolve();
  assert.deepEqual(states, [false]);
  assert.deepEqual(host.calls.map(call => call.method), ['showModal', 'close', 'close']);
  assert.equal(host.calls.every(call => call.dialog === dialog), true);
});

for (const variant of [
  { name: 'an absent model', model: () => null, message: 'Invalid USDT rebalance dialog model' },
  { name: 'non-array balance rows', model: () => ({ ...rebalanceModel(), balanceRows: {} }), message: 'Invalid USDT rebalance dialog model' },
  { name: 'a blank title', model: () => ({ ...rebalanceModel(), title: ' ' }), message: 'Invalid USDT rebalance dialog title' },
  { name: 'an absent balance account', model: () => ({ ...rebalanceModel(), balanceRows: [{ current: '10.00', target: '15.00' }] }), message: 'Invalid USDT rebalance dialog balance account' },
  { name: 'a blank transfer route', model: () => ({ ...rebalanceModel(), transferRows: [{ route: ' ', amount: '5.00 USDT' }] }), message: 'Invalid USDT rebalance dialog transfer route' },
  { name: 'an empty transfer plan', model: () => ({ ...rebalanceModel(), transferRows: [] }), message: 'USDT rebalance dialog requires at least one transfer' },
]) {
  test(`user cannot open a rebalance confirmation with ${variant.name}`, t => {
    // Given the proposed dialog lacks one required public model contract.
    const host = openDialogHost(t);
    const model = variant.model();

    // When the real dialog boundary receives the incomplete plan.
    const open = () => showUsdtRebalanceDialog(host.document, model);

    // Then it exposes the exact problem before installing style or opening a confirmation.
    assert.throws(open, { message: variant.message });
    assert.equal(host.document.getElementById(DIALOG_ID), null);
    assert.equal(host.document.getElementById(STYLE_ID), null);
    assert.deepEqual(host.calls, []);
  });
}

test('user can reopen a rebalance dialog after native close without duplicate style or another close request', async t => {
  // Given the first dialog mounts before the document head is available.
  const host = openDialogHost(t);
  host.document.head.remove();
  const firstResult = showUsdtRebalanceDialog(host.document, rebalanceModel());
  const first = host.document.getElementById(DIALOG_ID);
  assert.equal(host.document.getElementById(STYLE_ID).parentElement, host.document.documentElement);

  // When the native host closes the first dialog before its close event is processed.
  first.close();
  const cancelled = await firstResult;

  // Then the public result is cancellation and cleanup does not close an already closed dialog again.
  assert.equal(cancelled, false);
  assert.equal(first.isConnected, false);
  assert.deepEqual(host.calls.map(call => call.method), ['showModal', 'close']);

  // When a second valid plan opens and its explicit confirmation button is clicked.
  const secondResult = showUsdtRebalanceDialog(host.document, rebalanceModel());
  const second = host.document.getElementById(DIALOG_ID);
  assert.equal(host.document.activeElement.dataset.rebalanceDialogAction, 'cancel');
  second.querySelector('[data-rebalance-dialog-action="confirm"]').click();
  const confirmed = await secondResult;

  // Then confirmation is distinct from native close and one stylesheet serves both dialog lifetimes.
  assert.equal(confirmed, true);
  assert.equal(second.isConnected, false);
  assert.equal(host.document.querySelectorAll('#' + STYLE_ID).length, 1);
  assert.deepEqual(host.calls.map(call => call.method), ['showModal', 'close', 'showModal', 'close']);
});

test('user ignores a native-looking precision trigger outside the actual futures orderbook', t => {
  // Given another native control has the same precision classes outside the orderbook.
  const document = openDocument(t, '<section><div class="orderbook-tickSize"><div class="bn-select active"><div class="bn-select-trigger"><span class="tick-content">0.1</span></div></div></div></section>');
  const trigger = document.querySelector('.tick-content');

  // When both public precision readers inspect the unrelated native control.
  const open = isNativeOrderbookPrecisionMenuOpen(trigger);
  const overlay = findNativeOrderbookPrecisionOverlay(trigger, isVisibleElement);

  // Then matching classes cannot turn an unrelated control into the orderbook menu.
  assert.equal(open, false);
  assert.equal(overlay, null);
});

test('user receives an explicit precision contract error when React moves the trigger out of its field', t => {
  // Given the active native select has moved its tick text outside the verified trigger field.
  const document = openDocument(t, '<section id="futuresOrderbook"><div class="orderbook-tickSize"><div class="bn-select active"><div class="bn-select-trigger"></div><span class="tick-content">0.1</span></div></div></section>');
  const trigger = document.querySelector('.tick-content');

  // When the public precision API resolves the changed native structure.
  const read = () => isNativeOrderbookPrecisionMenuOpen(trigger);

  // Then it rejects the new structure instead of clicking a guessed field.
  assert.throws(read, { name: 'OrderbookPrecisionDomError', message: 'Native precision trigger structure has changed' });
});

test('user rejects a native precision overlay identity from a different control protocol', t => {
  // Given the active native select publishes an overlay identifier outside its verified protocol.
  const document = openDocument(t, '<section id="futuresOrderbook"><div class="orderbook-tickSize"><div class="bn-select active"><div class="bn-select-trigger"><span class="tick-content">0.1</span></div></div></div></section>');
  const root = document.querySelector('.orderbook-tickSize');
  const select = document.querySelector('.bn-select');
  select.__reactFiber$native = {
    memoizedProps: { overlay: { props: { id: 'unrelated-dialog-list' } } },
    return: { stateNode: root },
  };
  const trigger = document.querySelector('.tick-content');

  // When the real overlay resolver reads the host-provided owner chain.
  const read = () => findNativeOrderbookPrecisionOverlay(trigger, isVisibleElement);

  // Then the mismatched identifier is explicit before any overlay is accepted.
  assert.throws(read, { name: 'OrderbookPrecisionDomError', message: 'Native precision listbox identity is invalid' });
});

test('user gets the default side and ratio from absent or unsupported native storage values', t => {
  // Given a fresh native storage area contains an unsupported ratio for one symbol and precision.
  const document = openDocument(t);
  const storage = document.defaultView.localStorage;
  const key = 'open-ratio:BTCUSDT:0.1';
  storage.setItem(key, '999');

  // When public settings readers load the new side and the unsupported persisted ratio.
  const side = loadSymbolSide(storage, 'open-side', 'BTCUSDT');
  const ratio = loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.1', RATIO_OPTIONS, 2);

  // Then the designed defaults are returned without rewriting stored data or other scopes.
  assert.equal(side, 'LONG');
  assert.equal(ratio, 2);
  assert.equal(storage.getItem(key), '999');
  assert.equal(storage.length, 1);
});

test('user cannot migrate or save a ratio until its symbol and precision scope are known', t => {
  // Given native storage already contains distinct open and close ratios.
  const document = openDocument(t);
  const storage = document.defaultView.localStorage;
  storage.setItem('open-ratio:BTCUSDT:0.1', '10');
  storage.setItem('close-ratio:BTCUSDT:0.1', '30');

  // When migration lacks precision and a new save lacks its symbol.
  const migrated = migrateModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '', 10, 30, RATIO_OPTIONS);
  const saved = saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', '', '0.1', 2, RATIO_OPTIONS);

  // Then neither incomplete operation writes an unscoped setting or changes an existing mode.
  assert.equal(migrated, false);
  assert.equal(saved, false);
  assert.equal(storage.length, 2);
  assert.equal(storage.getItem('open-ratio:BTCUSDT:0.1'), '10');
  assert.equal(storage.getItem('close-ratio:BTCUSDT:0.1'), '30');
});

test('user rejects a settings mode without its declared storage key', t => {
  // Given an otherwise valid native storage scope omits the selected mode mapping.
  const document = openDocument(t);
  const storage = document.defaultView.localStorage;
  const modeKeys = { CLOSE: MODE_KEYS.CLOSE };

  // When the public scope builder and writer resolve the unavailable open-mode key.
  const resolve = () => modeSymbolPrecisionOptionStorageKey(modeKeys, 'OPEN', 'BTCUSDT', '0.1');
  const save = () => saveModeSymbolPrecisionNumberOption(storage, modeKeys, 'OPEN', 'BTCUSDT', '0.1', 2, RATIO_OPTIONS);

  // Then both operations expose configuration failure and native storage remains empty.
  assert.throws(resolve, { message: '交易模式缺少存储键：OPEN' });
  assert.throws(save, { message: '交易模式缺少存储键：OPEN' });
  assert.equal(storage.length, 0);
});

test('user does not treat a native storage-clear event as a symbol-specific ratio update', t => {
  // Given the native storage event represents clearing storage rather than one changed key.
  const document = openDocument(t);
  const event = new document.defaultView.StorageEvent('storage', { key: null });

  // When the public scope filter evaluates the native event identity.
  const matches = isModeSymbolOptionStorageKey(event.key, Object.values(MODE_KEYS));

  // Then no symbol or precision is invented from an absent key.
  assert.equal(matches, false);
  assert.equal(event.key, null);
});
