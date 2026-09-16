import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCloseDisplayQuantities,
  resolveConfirmedCloseDirection,
  shouldDisableCloseControl,
} from '../../../src/binance-orderbook-trade/core/close-action.js';

for (const { name, context, selectedSide } of [
  { name: 'the short side is still unread', context: { knowsLong: true, knowsShort: false, hasLong: true, hasShort: false }, selectedSide: 'LONG' },
  { name: 'the long side is still unread', context: { knowsLong: false, knowsShort: true, hasLong: false, hasShort: true }, selectedSide: 'SHORT' },
  { name: 'the close context has not arrived', context: null, selectedSide: 'SHORT' },
]) {
  test(`user cannot choose a close direction while ${name}`, () => {
    // Given a position snapshot that does not confirm both sides.
    const selection = selectedSide;

    // When the close action resolves its target direction.
    const direction = resolveConfirmedCloseDirection(context, selection);

    // Then no direction is authorized from incomplete position evidence.
    assert.equal(direction, null);
  });
}

for (const { name, hasLong, hasShort, selectedSide, expected } of [
  { name: 'only the long position exists', hasLong: true, hasShort: false, selectedSide: 'SHORT', expected: 'LONG' },
  { name: 'only the short position exists', hasLong: false, hasShort: true, selectedSide: 'LONG', expected: 'SHORT' },
  { name: 'both sides exist and short is selected', hasLong: true, hasShort: true, selectedSide: 'SHORT', expected: 'SHORT' },
  { name: 'both sides exist and long is selected', hasLong: true, hasShort: true, selectedSide: 'LONG', expected: 'LONG' },
  { name: 'both sides are confirmed flat', hasLong: false, hasShort: false, selectedSide: 'LONG', expected: null },
]) {
  test(`user closes the confirmed direction when ${name}`, () => {
    // Given fresh knowledge of both sides and an explicit panel selection.
    const context = { knowsLong: true, knowsShort: true, hasLong, hasShort };

    // When the target direction is resolved.
    const direction = resolveConfirmedCloseDirection(context, selectedSide);

    // Then the existing position wins unless both sides require a user choice.
    assert.equal(direction, expected);
  });
}

for (const { name, input, expected } of [
  {
    name: 'keeps the last close quantities during a mode transition',
    input: { rawLongQty: 4.07, rawShortQty: 4.06, cachedLongQty: 0.42, cachedShortQty: 0, transitionPending: true },
    expected: { longQty: 0.42, shortQty: 0, isUsingCache: true, shouldCommit: false },
  },
  {
    name: 'sees unknown quantities during the first close-mode transition',
    input: { rawLongQty: 4.07, rawShortQty: 4.06, transitionPending: true },
    expected: { longQty: null, shortQty: null, isUsingCache: false, shouldCommit: false },
  },
  {
    name: 'keeps a cached short quantity while the long side is still unknown',
    input: { rawLongQty: 4.07, rawShortQty: 4.06, cachedShortQty: 0.6, transitionPending: true },
    expected: { longQty: null, shortQty: 0.6, isUsingCache: true, shouldCommit: false },
  },
  {
    name: 'sees a newly confirmed zero replace the old short quantity',
    input: { rawLongQty: 0.42, rawShortQty: 0, cachedLongQty: 0.42, cachedShortQty: 4.06, transitionPending: false },
    expected: { longQty: 0.42, shortQty: 0, isUsingCache: false, shouldCommit: true },
  },
  {
    name: 'keeps only the missing long side cached after the transition',
    input: { rawLongQty: null, rawShortQty: 0, cachedLongQty: 0.42, cachedShortQty: 4.06 },
    expected: { longQty: 0.42, shortQty: 0, isUsingCache: true, shouldCommit: true },
  },
  {
    name: 'keeps only the missing short side cached after the transition',
    input: { rawLongQty: 0, rawShortQty: null, cachedLongQty: 0.42, cachedShortQty: 4.06 },
    expected: { longQty: 0, shortQty: 4.06, isUsingCache: true, shouldCommit: true },
  },
  {
    name: 'retains the cached snapshot when both live quantities are missing',
    input: { rawLongQty: null, rawShortQty: null, cachedLongQty: 0.42, cachedShortQty: 4.06 },
    expected: { longQty: 0.42, shortQty: 4.06, isUsingCache: true, shouldCommit: false },
  },
  {
    name: 'keeps both sides unknown when neither live nor cached quantities exist',
    input: { rawLongQty: null, rawShortQty: null },
    expected: { longQty: null, shortQty: null, isUsingCache: false, shouldCommit: false },
  },
  {
    name: 'accepts a fresh short quantity without inventing a long quantity',
    input: { rawLongQty: null, rawShortQty: 0.6 },
    expected: { longQty: null, shortQty: 0.6, isUsingCache: false, shouldCommit: true },
  },
]) {
  test(`user ${name}`, () => {
    // Given the live and cached quantities for the current close-mode transition.
    const snapshot = { ...input };

    // When the panel resolves the quantities it can safely display.
    const display = resolveCloseDisplayQuantities(snapshot);

    // Then values, cache provenance, and permission to commit match that evidence.
    assert.deepEqual(display, expected);
  });
}

for (const { name, input, expected } of [
  { name: 'can close a confirmed position', input: { actionDisabled: false, knowsPosition: true, hasPosition: true }, expected: false },
  { name: 'cannot close a confirmed flat side', input: { actionDisabled: false, knowsPosition: true, hasPosition: false }, expected: true },
  { name: 'does not see a disabled flash while position knowledge is pending', input: { actionDisabled: false, knowsPosition: false, hasPosition: false }, expected: false },
  { name: 'cannot close while another action disables the control', input: { actionDisabled: true, knowsPosition: true, hasPosition: true }, expected: true },
  { name: 'can use the default enabled action for a confirmed position', input: { knowsPosition: true, hasPosition: true }, expected: false },
]) {
  test(`user ${name}`, () => {
    // Given the confirmed display state and any action-level lock.
    const controlState = { ...input };

    // When close-button availability is derived.
    const disabled = shouldDisableCloseControl(controlState);

    // Then only confirmed flatness or an action lock disables the button.
    assert.equal(disabled, expected);
  });
}
