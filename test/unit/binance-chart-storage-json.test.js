import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { snapshotJson } from '../../src/binance-orderbook-trade/chart-storage/json.js';

const jsonSource = readFileSync(new URL('../../src/binance-orderbook-trade/chart-storage/json.js', import.meta.url), 'utf8');

/** Evaluates the production module with a counting encoder at the platform boundary. */
function loadJsonWithEncodingCounter() {
  const counter = { calls: 0 };
  class CountingTextEncoder extends TextEncoder {
    encode(input) {
      counter.calls += 1;
      return super.encode(input);
    }
  }
  const context = vm.createContext({ TextEncoder: CountingTextEncoder });
  vm.runInContext(jsonSource.replace(/^export /gm, ''), context);
  return { snapshotJson: context.snapshotJson, counter };
}

function chartSnapshot(sourceCount) {
  return {
    charts: [{
      panes: [{
        sources: Array.from({ length: sourceCount }, (_, index) => ({
          type: 'LineToolTrendLine',
          id: `line-${index}`,
          state: { symbol: 'BTCUSDT', visible: true, linewidth: 2, text: '趋势 "note"' },
          points: [{ time_t: 1700000000 + index, price: 100000.5 + index }],
        })),
      }],
    }],
  };
}

function utf8JsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

test('user mirrors a large chart snapshot without encoding each value separately', () => {
  // Given a one-line and a five-hundred-line chart snapshot
  const json = loadJsonWithEncodingCounter();
  const small = chartSnapshot(1);
  const large = chartSnapshot(500);

  // When the mirror copies both snapshots
  json.snapshotJson(small, { remaining: Infinity }, new Set());
  const smallEncodings = json.counter.calls;
  const copy = json.snapshotJson(large, { remaining: Infinity }, new Set());
  const largeEncodings = json.counter.calls - smallEncodings;

  // Then the copied data is complete while byte accounting work does not grow per value
  assert.notEqual(copy, large);
  assert.equal(JSON.stringify(copy), JSON.stringify(large));
  assert.equal(largeEncodings, smallEncodings);
});

test('user copies a snapshot within a budget equal to its exact UTF-8 JSON size', () => {
  // Given short and long text with escapes, control characters, non-ASCII, emoji and lone surrogates
  const value = {
    plain: 'line\nfeed\t"quoted" back\\slash \b\f\r \u0000\u001f\u007f é 中文 😀 \ud83d \ude00',
    numbers: [0, -1.5, 1e21, 1e-7, 123456789.125],
    long: `${'chart "content"\n'.repeat(40)}${'趋势'.repeat(20)}😀\ud800`,
    flags: [true, false, null],
    '键 "k"': { nested: [' ', ' '] },
  };
  const exactBytes = utf8JsonBytes(value);

  // When the copy receives exactly that budget and one byte less
  const budget = { remaining: exactBytes };
  const copy = snapshotJson(value, budget);
  const smaller = { remaining: exactBytes - 1 };

  // Then the exact budget is fully consumed and the smaller budget is rejected
  assert.deepEqual(copy, value);
  assert.equal(budget.remaining, 0);
  assert.throws(() => snapshotJson(value, smaller), /Chart JSON byte limit exceeded/);
});

test('user keeps property order, signed zero and a __proto__ key as stored data', () => {
  // Given a snapshot whose own keys include __proto__ and non-insertion numeric order
  const value = JSON.parse('{"b":1,"__proto__":{"polluted":true},"a":-0,"10":"ten","2":"two"}');
  value.a = -0;

  // When the mirror copies it and the caller later changes the original
  const copy = snapshotJson(value);
  value.b = 2;

  // Then the copy is an independent plain object with the same own data
  assert.deepEqual(Object.keys(copy), ['2', '10', 'b', '__proto__', 'a']);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(copy, '__proto__').value, { polluted: true });
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.equal(Object.is(copy.a, -0), true);
  assert.equal(copy.b, 1);
});

test('user rejects accessor properties without running their getters', () => {
  // Given a snapshot property backed by a getter
  let getterRuns = 0;
  const value = { revision: 1 };
  Object.defineProperty(value, 'computed', { enumerable: true, get() { getterRuns += 1; return 2; } });

  // When the mirror inspects the snapshot
  const copy = () => snapshotJson(value);

  // Then the snapshot is refused before the getter can run
  assert.throws(copy, /Chart JSON requires enumerable data properties/);
  assert.equal(getterRuns, 0);
});

test('user accepts plain snapshots created by the chart iframe realm', () => {
  // Given plain objects and arrays from another JavaScript realm
  const value = vm.runInNewContext('({ revision: 3, points: [{ price: 1 }, { price: 2 }] })');

  // When the mirror copies the foreign snapshot
  const copy = snapshotJson(value);

  // Then the copy contains the same data in this realm
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal(Array.isArray(copy.points), true);
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), { revision: 3, points: [{ price: 1 }, { price: 2 }] });
});

for (const scenario of [
  { name: 'shared references', value: () => { const shared = { a: 1 }; return { x: shared, y: shared }; }, error: /shared references or cycles/ },
  { name: 'cycles', value: () => { const node = { a: 1 }; node.self = node; return node; }, error: /shared references or cycles/ },
  { name: 'sparse arrays', value: () => [1, , 3], error: /arrays must be dense/ },
  { name: 'symbol keys', value: () => ({ [Symbol('meta')]: 1 }), error: /symbol properties/ },
  { name: 'non-finite numbers', value: () => ({ price: Number.NaN }), error: /numbers must be finite/ },
  { name: 'null-prototype objects', value: () => Object.create(null), error: /must be plain JSON/ },
  { name: 'derived-prototype objects', value: () => Object.create({ inherited: true }), error: /must be plain JSON/ },
  { name: 'dates', value: () => new Date(0), error: /must be plain JSON/ },
]) {
  test(`user keeps native storage for snapshots containing ${scenario.name}`, () => {
    // Given a snapshot outside the plain JSON contract
    const value = scenario.value();

    // When the mirror tries to copy it
    const copy = () => snapshotJson(value);

    // Then the copy is refused so the native write path keeps the value
    assert.throws(copy, scenario.error);
  });
}
