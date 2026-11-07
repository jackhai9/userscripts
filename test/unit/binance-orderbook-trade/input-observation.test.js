import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtureDom } from '../../helpers/dom.js';
import { createAnimationFrameBoundary } from '../../helpers/orderbook-migration-frames.js';
import { compareDecimalStrings, normalizeDecimalString } from '../../../src/binance-orderbook-trade/core/decimal.js';
import { createBoundedInputWriter, createTradeInputStateReader, isScriptOwnedTradeInputRecoveryState, waitForTradeFormFrameState } from '../../../src/binance-orderbook-trade/dom/trade-form.js';

/** Keep the actual field state machine behind independently controlled browser tasks. */
function createScenario(t, { hidden = false } = {}) {
  const dom = loadFixtureDom('<section><input id="price"><input id="qty"></section>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const inputs = {
    root: document.querySelector('section'),
    priceInput: document.querySelector('#price'),
    qtyInput: document.querySelector('#qty'),
  };
  const frames = createAnimationFrameBoundary(dom.window);
  let now = 0;
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  dom.window.performance.now = () => now;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const reader = createTradeInputStateReader({
    resolveInputs: () => inputs,
    expectedPrice: '81.9', expectedQty: '0.08', includePrice: true,
    normalizeValue: normalizeDecimalString, compareValues: compareDecimalStrings,
    writeValue: createBoundedInputWriter({
      maxWriteAttempts: 5,
      writeValue: (input, value) => {
        writes.push([input.id, value]);
        input.value = value;
        input.dispatchEvent(new dom.window.Event('input'));
      },
    }),
    requiredStableMatchFrames: 2, requiredStableMatchMs: 180,
    requiredStableMismatchFrames: 2, requiredStableMismatchMs: 180,
    maxWriteAttempts: 5, recoverProvisionalMatchRollback: true,
    isRecoveryWriteAllowed: (state) => isScriptOwnedTradeInputRecoveryState({
      ...state, compareValues: compareDecimalStrings,
    }),
    readNowMs: () => now,
  });
  reader();
  return {
    ...inputs, document, frames, writes,
    start(signal = null) {
      return waitForTradeFormFrameState(inputs.root, reader, 1200, 2, signal, {
        observationGapMs: 180, supplementalTimeoutMs: 1200,
      });
    },
    advance(ms, frame = false) {
      now += ms;
      t.mock.timers.tick(ms);
      if (frame) frames.runFrame(now);
    },
    hide(value) {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    },
    jump(ms) { now += ms; },
  };
}

test('user completes stable ladder inputs after the initial paint observations are starved', async (t) => {
  // Given the quantity has been written but no foreground paint callback runs
  const scenario = createScenario(t);
  const pending = scenario.start();

  // When the base deadline passes and independent supplemental timer tasks run
  scenario.advance(1200);
  for (let index = 0; index < 8; index += 1) scenario.advance(100);

  // Then both exact fields pass the original stability contract with one write each
  const result = await pending;
  assert.equal(result?.submittedPrice, '81.9');
  assert.equal(result?.submittedQty, '0.08');
  assert.deepEqual(scenario.writes, [['qty', '0.08'], ['price', '81.9']]);
  assert.equal(scenario.frames.pendingCount, 0);
});

test('user completes a healthy ladder synchronization without waiting for the base deadline', async (t) => {
  // Given the real field reader receives regular foreground paint observations
  const scenario = createScenario(t);
  const pending = scenario.start();

  // When quantity then price stay correct over independent observations
  for (let index = 0; index < 8; index += 1) scenario.advance(100, true);

  // Then synchronization returns the exact fields before 1200 ms
  assert.equal((await pending).submittedPrice, '81.9');
  assert.deepEqual(scenario.writes, [['qty', '0.08'], ['price', '81.9']]);
  assert.equal(scenario.frames.pendingCount, 0);
});

test('user receives no extension for changing inputs observed at a healthy frame rate', async (t) => {
  // Given an outside edit prevents the owned quantity from stabilizing
  const scenario = createScenario(t);
  scenario.qtyInput.value = '99';
  const pending = scenario.start();

  // When observations arrive every 100 ms through the base deadline
  for (let index = 0; index < 12; index += 1) scenario.advance(100, true);

  // Then the base timeout rejects the edited form without overwriting it
  assert.equal(await pending, null);
  assert.equal(scenario.qtyInput.value, '99');
  assert.deepEqual(scenario.writes, [['qty', '0.08']]);
});

test('user can finish after a tail observation gap without resetting prior field progress', async (t) => {
  // Given quantity stability is established before foreground frames stop
  const scenario = createScenario(t);
  const pending = scenario.start();
  for (let index = 0; index < 3; index += 1) scenario.advance(100, true);

  // When the remaining base window has no frames and timer observations resume
  scenario.advance(900);
  for (let index = 0; index < 5; index += 1) scenario.advance(100);

  // Then the existing writes and stable quantity are reused for the exact result
  assert.equal((await pending)?.submittedQty, '0.08');
  assert.deepEqual(scenario.writes, [['qty', '0.08'], ['price', '81.9']]);
});

test('user cannot extend a granted observation deadline by switching tab visibility', async (t) => {
  // Given starvation grants one supplemental window while another value remains present
  const scenario = createScenario(t);
  scenario.qtyInput.value = '99';
  const pending = scenario.start();
  scenario.advance(1200);

  // When visibility changes during the supplement and its absolute deadline passes
  scenario.hide(true);
  scenario.advance(300);
  scenario.hide(false);
  scenario.advance(900);

  // Then the original 2400 ms endpoint ends the wait without another write
  assert.equal(await pending, null);
  assert.deepEqual(scenario.writes, [['qty', '0.08']]);
  assert.equal(scenario.frames.pendingCount, 0);
});

test('user cannot obtain fresh writes from a base deadline callback delivered after the final deadline', async (t) => {
  // Given the first field write is followed by a blocked foreground scheduler
  const scenario = createScenario(t);
  const pending = scenario.start();

  // When the base timeout itself is delivered beyond both windows
  scenario.advance(2500);

  // Then no late read writes the price or accepts the form
  assert.equal(await pending, null);
  assert.deepEqual(scenario.writes, [['qty', '0.08']]);
  assert.equal(scenario.frames.pendingCount, 0);
});

test('user keeps the existing background observation contract despite throttled timers', async (t) => {
  // Given a hidden tab starts the same ladder reader with paused paint frames
  const scenario = createScenario(t, { hidden: true });
  const pending = scenario.start();

  // When independent background timer callbacks arrive one second apart
  for (let index = 0; index < 6; index += 1) scenario.advance(1000);

  // Then valid fields still complete after more than 2400 ms without a foreground extension
  assert.equal((await pending).submittedPrice, '81.9');
  assert.deepEqual(scenario.writes, [['qty', '0.08'], ['price', '81.9']]);
});

test('user Stop during a supplemental input write prevents further observations', async (t) => {
  // Given an owned input event can synchronously stop an active ladder wait
  const scenario = createScenario(t);
  const stop = new AbortController();
  const error = new Error('Stopped');
  scenario.priceInput.addEventListener('input', () => stop.abort(error));
  const pending = scenario.start(stop.signal);
  const rejection = assert.rejects(pending, error);

  // When the supplemental reader writes price and the input listener stops it
  scenario.advance(1200);
  for (let index = 0; index < 12; index += 1) scenario.advance(100);

  // Then the stop reason wins and no scheduled observation remains
  await rejection;
  assert.deepEqual(scenario.writes, [['qty', '0.08'], ['price', '81.9']]);
  assert.equal(scenario.frames.pendingCount, 0);
});

test('user cannot accept a read that consumes the remainder of the supplemental deadline', async (t) => {
  // Given price input dispatch consumes enough main-thread time to cross the hard cutoff
  const scenario = createScenario(t);
  scenario.priceInput.addEventListener('input', () => scenario.jump(1500));
  const pending = scenario.start();

  // When stable quantity lets the supplemental reader write the price
  scenario.advance(1200);
  for (let index = 0; index < 5; index += 1) scenario.advance(100);

  // Then an over-deadline read is rejected without retaining frame callbacks
  assert.equal(await pending, null);
  assert.deepEqual(scenario.writes, [['qty', '0.08'], ['price', '81.9']]);
  assert.equal(scenario.frames.pendingCount, 0);
});

test('user retains one five-write limit across the base and supplemental windows', async (t) => {
  // Given Binance repeatedly clears the same owned quantity after each write
  const scenario = createScenario(t);
  scenario.qtyInput.value = '';
  scenario.qtyInput.addEventListener('input', () => { scenario.qtyInput.value = ''; });
  const pending = scenario.start();

  // When an initial frame gap qualifies the supplement but native rollback persists
  scenario.advance(200, true);
  for (let index = 0; index < 10; index += 1) scenario.advance(100, true);
  for (let index = 0; index < 12; index += 1) scenario.advance(100);

  // Then both windows together stop at five writes and never prepare the price
  assert.equal(await pending, null);
  assert.deepEqual(scenario.writes, Array.from({ length: 5 }, () => ['qty', '0.08']));
  assert.equal(scenario.qtyInput.value, '');
  assert.equal(scenario.priceInput.value, '');
});

test('user rejects a base observation that crosses the final deadline before a supplement is granted', async (t) => {
  // Given a native price input listener can block the base observation task
  const scenario = createScenario(t);
  scenario.priceInput.addEventListener('input', () => scenario.jump(2500));
  let result = 'pending';
  const pending = scenario.start().then(value => { result = value; });

  // When the base reader writes price and its input event blocks beyond both windows
  for (let index = 0; index < 3; index += 1) scenario.advance(100, true);
  await Promise.resolve();

  // Then the overdue read immediately terminates without waiting for another callback
  assert.equal(result, null);
  assert.equal(scenario.frames.pendingCount, 0);
  await pending;
});
