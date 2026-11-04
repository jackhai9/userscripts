import assert from 'node:assert/strict';
import test from 'node:test';

import { createFillSoundScope } from '../../src/binance-orderbook-trade/order-sound/fill-sound-scope.js';

function openScope(symbol = 'BIRBUSDT') {
  const clock = { time: 0, symbol };
  const scope = createFillSoundScope({ now: () => clock.time, readCurrentSymbol: () => clock.symbol });
  return { clock, scope };
}

function fill(symbol, overrides = {}) {
  return { s: symbol, c: 'web_client', o: 'LIMIT', ot: 'LIMIT', x: 'TRADE', X: 'FILLED', ...overrides };
}

test('user hears an own fill and not a fill of another symbol', () => {
  // Given a BIRBUSDT tab
  const { clock, scope } = openScope();

  // When a BIRBUSDT fill sounds, then later only an ETHUSDT fill sounds twice
  scope.recordOrderUpdate(fill('BIRBUSDT'));
  clock.time = 600;
  const own = scope.allowSound();
  clock.time = 5_000;
  scope.recordOrderUpdate(fill('ETHUSDT', { X: 'PARTIALLY_FILLED' }));
  clock.time = 5_600;
  const foreign = [scope.allowSound(), scope.allowSound()];

  // Then the own sound plays and both calls for the foreign sound stay silent
  assert.equal(own, true);
  assert.deepEqual(foreign, [false, false]);
  assert.deepEqual(scope.snapshot(), { ownFills: 1, foreignFills: 1, allowed: 1, suppressed: 2, unattributed: 0 });
});

test('user hears one sound per own fill even while another symbol keeps filling', () => {
  // Given a BIRBUSDT tab where ETHUSDT and BIRBUSDT both fill
  const { clock, scope } = openScope();
  scope.recordOrderUpdate(fill('ETHUSDT'));
  scope.recordOrderUpdate(fill('BIRBUSDT'));

  // When the native player starts two queued sounds
  clock.time = 600;
  const first = scope.allowSound();
  clock.time = 2_600;
  const second = scope.allowSound();

  // Then the own fill accounts for one sound and the foreign fill's sound is silent
  assert.deepEqual([first, second], [true, false]);
});

test('user keeps native sound for system orders, unknown shapes and non-trading routes', () => {
  // Given a BIRBUSDT tab
  const { clock, scope } = openScope();
  const outcomes = [];

  // When other-symbol liquidation, system close and unknown orders fill, and a fill arrives off a trading route
  for (const order of [
    fill('ETHUSDT', { o: 'LIQUIDATION', ot: 'LIQUIDATION' }),
    fill('ETHUSDT', { c: 'autoclose-1' }),
    fill('ETHUSDT', { c: 'adl_autoclose-1' }),
    fill('ETHUSDT', { c: 'settlement_autoclose-1' }),
    fill('ETHUSDT', { c: '' }),
    fill('ETHUSDT', { x: 'CALCULATED' }),
    fill('eth', {}),
  ]) {
    scope.recordOrderUpdate(order);
    outcomes.push(scope.allowSound());
  }
  clock.symbol = null;
  scope.recordOrderUpdate(fill('ETHUSDT'));
  outcomes.push(scope.allowSound());

  // Then every one of those sounds keeps playing
  assert.deepEqual(outcomes, Array(8).fill(true));
  assert.equal(scope.snapshot().foreignFills, 0);
});

test('user keeps native sound without recent fill evidence and ignores non-sound order updates', () => {
  // Given a BIRBUSDT tab whose ETHUSDT fill is older than the attribution window
  const { clock, scope } = openScope();
  scope.recordOrderUpdate(fill('ETHUSDT'));
  scope.recordOrderUpdate(fill('BIRBUSDT', { x: 'NEW', X: 'NEW' }));
  scope.recordOrderUpdate(fill('BIRBUSDT', { x: 'CANCELED', X: 'CANCELED' }));

  // When a sound starts within the window and another starts after it
  clock.time = 120_000;
  const withinWindow = scope.allowSound();
  clock.time = 120_001;
  const afterWindow = scope.allowSound();

  // Then new and cancelled own orders do not unlock the foreign sound, and stale evidence does not silence later ones
  assert.equal(withinWindow, false);
  assert.equal(afterWindow, true);
  assert.deepEqual(scope.snapshot(), { ownFills: 0, foreignFills: 1, allowed: 0, suppressed: 1, unattributed: 1 });
});

test('user does not let an own fill older than the sound window unlock a later foreign sound', () => {
  // Given a BIRBUSDT tab whose own fill sound never played, then an ETHUSDT fill
  const { clock, scope } = openScope();
  scope.recordOrderUpdate(fill('BIRBUSDT'));
  clock.time = 10_001;
  scope.recordOrderUpdate(fill('ETHUSDT'));

  // When the foreign fill's sound starts
  clock.time = 10_600;
  const outcome = scope.allowSound();

  // Then it stays silent
  assert.equal(outcome, false);
});
