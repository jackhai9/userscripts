import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createOrderNotificationFactorySignature } from '../../../src/binance-orderbook-trade/order-notifications/factory-structure.js';

const capture = JSON.parse(readFileSync(new URL('../../fixtures/binance-order-notifications/native-factories.json', import.meta.url), 'utf8'));
const signature = source => createOrderNotificationFactorySignature(source, '30877');

for (const id of ['30877', '39116', '55401']) {
  test(`user recognizes every captured local-name variant of notification module ${id}`, () => {
    // Given complete independently captured factories for one notification module
    const factories = capture.factories.filter(factory => factory.id === id);

    // When their complete structures and resolved bindings are compared
    const signatures = factories.map(factory => createOrderNotificationFactorySignature(factory.source, id));

    // Then all captured variants share exactly one accepted structure
    assert.equal(signatures.length, id === '30877' ? 6 : id === '39116' ? 2 : 1);
    assert.equal(new Set(signatures).size, 1);
  });
}

test('user recognizes an unseen consistent rename across closures and declaration patterns', () => {
  // Given equivalent factories with independently written local names and formatting
  const original = '30877(a,b,r){const {value:c}=a;let d=c;for(let e of a.items){d+=e}try{return function f(g){return g?f(g-1):r(40477).run(d+b)}}catch(h){throw h}}';
  const renamed = `30877(module, exports, require) {
    const {value: initial} = module;
    let total = initial;
    for (let item of module.items) { total += item }
    try {
      return function recur(count) { return count ? recur(count - 1) : require(40477).run(total + exports) }
    } catch (failure) { throw failure }
  }`;

  // When both complete factories receive structural signatures
  const observed = [signature(original), signature(renamed)];

  // Then lexical declarations and every resolved reference retain the same identity
  assert.equal(observed[0], observed[1]);
});

test('user recognizes whitespace comments quotes and equivalent number spelling', () => {
  // Given equal literals and code with different source formatting
  const sources = ['30877(a,b,r){return r(2e3).run("filled",a)}', "30877(module, exports, require) { /* public formatting */ return require(2000).run('filled', module) }"];

  // When literal values and local bindings are compared
  const observed = sources.map(signature);

  // Then source spelling does not create another notification variant
  assert.equal(observed[0], observed[1]);
});

const changedContracts = [
  ['boolean value', '30877(a){return !0}', '30877(a){return false}'],
  ['boolean and number types', '30877(a){return false}', '30877(a){return 0}'],
  ['truthiness of a binding', '30877(a){return !a}', '30877(a){return true}'],
  ['truthiness with side effects', '30877(a){return !a()}', '30877(a){return true}'],
  ['string truthiness', '30877(a){return !"0"}', '30877(a){return false}'],
  ['bigint truthiness', '30877(a){return !0n}', '30877(a){return true}'],
  ['sequence truthiness side effect', '30877(a){return !(a(),0)}', '30877(a){return true}'],
  ['export key', '30877(a,b,r){return {fill:a}}', '30877(a,b,r){return {cancel:a}}'],
  ['member key', '30877(a,b,r){return a.run(b)}', '30877(a,b,r){return a.stop(b)}'],
  ['shorthand key', '30877(a,b,r){return {a}}', '30877(c,b,r){return {c}}'],
  ['destructured key', '30877(a,b,r){const {fill:c}=a;return c}', '30877(a,b,r){const {cancel:c}=a;return c}'],
  ['global reference', '30877(a,b,r){return setTimeout(a,30)}', '30877(a,b,r){return clearTimeout(a,30)}'],
  ['import ID', '30877(a,b,r){return r(40477)}', '30877(a,b,r){return r(40478)}'],
  ['side effect', '30877(a,b,r){a.play();return b}', '30877(a,b,r){a.load();return b}'],
  ['operator', '30877(a,b,r){return a&&b}', '30877(a,b,r){return a||b}'],
  ['literal value', '30877(a,b,r){return r(a,30)}', '30877(a,b,r){return r(a,31)}'],
  ['directive', '30877(a,b,r){"use strict";return a}', '30877(a,b,r){"use other";return a}'],
  ['regular expression pattern', '30877(a,b,r){return /fill/g.test(a)}', '30877(a,b,r){return /cancel/g.test(a)}'],
  ['regular expression flags', '30877(a,b,r){return /fill/g.test(a)}', '30877(a,b,r){return /fill/i.test(a)}'],
  ['bigint value', '30877(a,b,r){return 1n}', '30877(a,b,r){return 2n}'],
  ['non-finite numeric value', '30877(a,b,r){return 1e400}', '30877(a,b,r){return null}'],
  ['tagged template raw value', '30877(a,b,r){return a`\\u0061`}', '30877(a,b,r){return a`a`}'],
  ['computed property reference', '30877(a,b,r){return a[b]}', '30877(a,b,r){return a[r]}'],
  ['closure binding', '30877(a,b,r){return function(c){return a+c}}', '30877(a,b,r){return function(c){return c+c}}'],
  ['shadowed global binding', '30877(a,b,r){return function(c){return String(c)}}', '30877(a,b,r){return function(String){return String(String)}}'],
  ['implicit arguments reference', '30877(a,b,r){return arguments[0]}', '30877(a,b,r){return a[0]}'],
  ['implicit arguments initialization', '30877(){var arguments;return arguments[0]}', '30877(){var value;return value[0]}'],
];

for (const [compact, expanded] of [['!0', 'true'], ['!1', 'false']]) {
  test(`user recognizes the equivalent boolean spelling ${compact} and ${expanded}`, () => {
    // Given a repacker expands a pure boolean constant without changing its value
    const sources = [`30877(a){return a({enabled:${compact}})}`, `30877(callback){return callback({enabled:${expanded}})}`];

    // When both representations pass through the actual structure matcher
    const observed = sources.map(signature);

    // Then only the constant spelling differs and both select the same structure
    assert.equal(observed[0], observed[1]);
  });
}

for (const [contract, original, changed] of changedContracts) {
  test(`user rejects a notification factory with a changed ${contract}`, () => {
    // Given two factories that differ in an observable native contract
    const candidates = [original, changed];

    // When the complete factories receive structural signatures
    const observed = candidates.map(signature);

    // Then the changed contract cannot inherit a pinned notification replacement
    assert.notEqual(observed[0], observed[1]);
  });
}

test('user preserves implicit arguments across nested local renames', () => {
  // Given an arrow closure inherits the ordinary function arguments object
  const sources = ['30877(a,b,r){return function(c){return ()=>arguments[0]+c+a}}', '30877(module,exports,require){return function(value){return ()=>arguments[0]+value+module}}'];

  // When only explicit local bindings are renamed
  const observed = sources.map(signature);

  // Then the inherited implicit arguments identity remains unchanged
  assert.equal(observed[0], observed[1]);
});

test('user recognizes an explicitly declared arguments parameter as a local binding', () => {
  // Given an explicit parameter shadows the implicit arguments object
  const sources = [
    '30877(a,b,r){return a+b+r}',
    '30877(arguments,exports,require){return arguments+exports+require}',
    '30877(module,arguments,require){return module+arguments+require}',
    '30877(module,exports,arguments){return module+exports+arguments}',
  ];

  // When equivalent parameter bindings receive structural signatures
  const observed = sources.map(signature);

  // Then the unused implicit arguments variable cannot shift binding identities
  assert.equal(new Set(observed).size, 1);
});

test('user preserves class declaration identities across lexical renames', () => {
  // Given a class declaration defines both an outer binding and a class-local name
  const sources = [
    '30877(a,b,r){class C extends a{method(){return C+b}}return C}',
    '30877(module,exports,require){class Value extends module{method(){return Value+exports}}return Value}',
  ];

  // When the class and enclosing local variables are consistently renamed
  const observed = sources.map(signature);

  // Then references to both class bindings retain their distinct identities
  assert.equal(observed[0], observed[1]);
});

const rejectedSources = [
  ['direct eval', '30877(a,b,r){return eval("a")}', /dynamic scope/],
  ['with scope', '30877(a,b,r){with(a){return value}}', /dynamic scope/],
  ['multiple properties', '30877(a){return a},39116(a){return a}', /one module factory/],
  ['wrong module ID', '39116(a){return a}', /module ID/],
  ['computed module key', '[30877](a){return a}', /module factory/],
  ['non-function module', '30877:30', /module factory/],
  ['getter module', 'get 30877(){return 30}', /module factory/],
  ['invalid syntax', '30877(a){return', SyntaxError],
  ['unsupported syntax', '30877(a){using resource=a;return resource}', SyntaxError],
  ['oversized source', `30877(){/*${'x'.repeat(65536)}*/}`, /64 KiB/],
];

for (const [reason, source, expected] of rejectedSources) {
  test(`user keeps unsupported ${reason} outside notification matching`, () => {
    // Given factory text violates the structural matcher contract
    const candidate = source;

    // When the unsupported source is analyzed
    const analyze = () => signature(candidate);

    // Then the caller receives an explicit error instead of an accepted structure
    assert.throws(analyze, expected);
  });
}

test('user gets an explicit input error without factory source coercion', () => {
  // Given the factory source is a non-string object
  const candidate = { toString() { throw new Error('Source coercion must not run'); } };

  // When a structural signature is requested
  const analyze = () => signature(candidate);

  // Then the source type is rejected before any coercion executes
  assert.throws(analyze, /must be a string/);
});
