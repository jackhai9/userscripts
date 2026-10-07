import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { createOrderNotificationFactorySignature } from '../src/binance-orderbook-trade/order-notifications/factory-structure.js';

const fixtureRoot = new URL('../test/fixtures/binance-order-notifications/', import.meta.url);
const sourceFile = new URL('native-factories.json', fixtureRoot);
const snapshot = await readFile(sourceFile, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(snapshot), '6abce8ab71349c94c786b0d628844d21224018e8cb1f4f43f4441428b9312f33',
  'The native capture changed; inspect and repin its public-source evidence first');
const { factories } = JSON.parse(snapshot);
const notificationIds = new Set(['30877', '39116', '55401']);

function visit(node, action) {
  if (!node || typeof node !== 'object') return;
  action(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, action));
    else if (value?.type) visit(value, action);
  }
}

function matching(root, predicate) {
  const found = [];
  visit(root, node => { if (predicate(node)) found.push(node); });
  return found;
}

function one(values, label) {
  assert.equal(values.length, 1, `Expected one ${label}`);
  return values[0];
}

function declarations(fn) {
  return fn.body.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
}

function declaration(fn, name) {
  return one(declarations(fn).filter(node => node.id.name === name), `declaration ${name}`);
}

function member(node, object, property) {
  return node.type === 'MemberExpression' && !node.computed
    && node.object.name === object && node.property.name === property;
}

function calleeMember(node, object, property) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  return callee.type === 'SequenceExpression' && callee.expressions.length === 2
    && callee.expressions[0].value === 0 && member(callee.expressions[1], object, property);
}

function exportedFunction(factory, exportName) {
  const property = one(matching(factory, node => node.type === 'Property'
    && node.key.name === exportName && node.value.type === 'ArrowFunctionExpression'), `export ${exportName}`);
  return declaration(factory.value, property.value.body.name).init;
}

function importedModule(factory, id) {
  const requireName = factory.value.params[2].name;
  return one(declarations(factory.value).filter(node => node.init.type === 'CallExpression'
    && node.init.callee.name === requireName && node.init.arguments.length === 1
    && node.init.arguments[0].value === id), `module ${id} import`).id.name;
}

/** Every patch is an exact AST slice; reversing all patches must reproduce the capture byte for byte. */
function transform(record) {
  const original = record.source;
  const ast = parse(`({${original}})`, { ecmaVersion: 'latest' });
  const factory = ast.body[0].expression.properties[0];
  assert.equal(String(factory.key.value), record.id);
  const reserved = new Set(['__notify', '__token', '__args', '__event', 'Reflect']);
  visit(factory, node => {
    assert(node.type !== 'Identifier' || !reserved.has(node.name), 'Injected bridge or runtime identifier is shadowed');
  });
  const replacements = [];
  const replace = (start, end, inserted, purpose) => replacements.push({
    factory_utf16_range: [start - 2, end - 2],
    original: original.slice(start - 2, end - 2), inserted, purpose,
  });
  const guard = (fn, expression, purpose) => {
    assert.equal(fn.type, 'FunctionExpression');
    replace(fn.body.start + 1, fn.body.start + 1, `if(!${expression})return;`, purpose);
  };

  if (record.id === '30877') {
    const hook = exportedFunction(factory, 'F');
    const throttleModule = importedModule(factory, 40477);
    const throttle = one(declarations(hook).filter(node => calleeMember(node.init, throttleModule, 'A')
      && node.init.arguments[1].value === 30), '30ms toast throttle');
    const enqueue = throttle.init.arguments[0];
    assert.equal(enqueue.type, 'Identifier');
    replace(enqueue.start, enqueue.end,
      `function(__token,...__args){if(__notify.allowToken(__token))return Reflect.apply(${enqueue.name},this,__args)}`,
      'Recheck the captured symbol token when the native toast throttle executes');
    const run = one(declarations(hook).filter(node => member(node.init, throttle.id.name, 'run')), 'toast throttle run').id.name;
    for (const key of ['cancelOrderNotify', 'fillOrderNotify', 'fillOrderPartNotify']) {
      const output = one(matching(hook, node => node.type === 'Property' && node.key.name === key), key);
      const callback = declaration(hook, output.value.name).init.arguments[0];
      assert.equal(callback.params.length, 1);
      const order = callback.params[0].name;
      guard(callback, `__notify.allowOrder(${order})`, `Scope ${key} before native toast logic`);
      const call = one(matching(callback, node => node.type === 'CallExpression' && node.callee.name === run), `${key} enqueue`);
      replace(call.arguments[0].start, call.arguments[0].start, `__notify.token(${order}),`, `Carry the ${key} symbol token`);
    }
    assert.equal(replacements.length, 7);
  } else if (record.id === '39116') {
    const throttleModule = importedModule(factory, 40477);
    const throttle = one(matching(factory, node => calleeMember(node, throttleModule, 'A')
      && node.arguments[1].value === 500), '500ms sound throttle');
    const callback = throttle.arguments[0];
    assert.equal(callback.type, 'Identifier');
    replace(callback.start, callback.end,
      `function(__event){if(__notify.allowSoundInput(__event))return Reflect.apply(${callback.name},this,[__event])}`,
      'Recheck a ready sound token before the native throttle callback enqueues it');
    const streamHook = one(declarations(factory.value).filter(node => node.init.type === 'FunctionExpression'
      && node.init.start < throttle.start && node.init.end > throttle.end), 'sound stream hook').init;
    const throttleDeclaration = one(declarations(streamHook).filter(node => node.init === throttle), 'sound throttle declaration');
    const run = one(declarations(streamHook).filter(node => member(node.init, throttleDeclaration.id.name, 'run')), 'sound throttle run').id.name;
    const calls = matching(streamHook, node => node.type === 'CallExpression' && node.callee.name === run);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.arguments.length, 1);
      const stringify = call.arguments[0];
      assert.equal(stringify.callee.name, 'String');
      assert.equal(stringify.arguments.length, 1);
      const orderId = stringify.arguments[0];
      assert.equal(orderId.type, 'MemberExpression');
      assert.equal(orderId.property.name, 'orderId');
      const order = orderId.object.name;
      replace(call.start, call.end,
        `((!__notify.soundReady()||__notify.allowOrder(${order}))&&${run}(__notify.soundInput(${order})))`,
        'Keep unready native order IDs; otherwise scope and capture the stream order symbol');
    }
    assert.equal(replacements.length, 3);
  } else {
    assert.equal(record.id, '55401');
    const player = one(declarations(factory.value).filter(node => node.init.type === 'FunctionExpression'
      && matching(node.init, child => child.type === 'MemberExpression' && child.property.name === 'load').length === 1), 'native audio player');
    const play = player.init;
    assert.equal(play.params.length, 1);
    replace(play.params[0].end, play.params[0].end, ',__event', 'Capture one symbol token for both native play calls');
    guard(play, '__notify.canPlay(__event)', 'Recheck symbol immediately before audio load and play');
    const then = one(matching(play, node => node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression' && node.callee.property.name === 'then'), 'native audio promise continuation');
    guard(then.arguments[0], '__notify.canPlay(__event)', 'Recheck the same symbol token before the second native play');
    const provider = exportedFunction(factory, 'SoundNotificationProvider');
    const queue = one(declarations(provider).filter(node => node.init.type === 'MemberExpression'
      && node.init.property.name === 'notifications'), 'native notification queue').id.name;
    const callback = one(matching(provider, node => node.type === 'FunctionExpression'
      && matching(node, child => child.type === 'CallExpression' && child.callee.name === player.id.name).length === 1)
      .filter(node => node !== provider), 'native playback callback');
    guard(callback, `__notify.prepareSound(${queue})`, 'Drop stale queued symbols only when the native playback entrypoint is ready');
    const call = one(matching(callback, node => node.type === 'CallExpression' && node.callee.name === player.id.name), 'native playback invocation');
    assert.equal(call.arguments.length, 1);
    replace(call.arguments[0].end, call.arguments[0].end, `,${queue}.current[0]`, 'Retain the active queue token across the audio promise');
    assert.equal(replacements.length, 5);
  }

  replacements.sort((a, b) => a.factory_utf16_range[0] - b.factory_utf16_range[0]);
  let transformed = '';
  let previousEnd = 0;
  for (const replacement of replacements) {
    const [start, end] = replacement.factory_utf16_range;
    assert(start >= previousEnd, 'Overlapping native notification replacements');
    transformed += original.slice(previousEnd, start);
    replacement.transformed_utf16_range = [transformed.length, transformed.length + replacement.inserted.length];
    transformed += replacement.inserted;
    previousEnd = end;
  }
  transformed += original.slice(previousEnd);
  let restored = transformed;
  for (const replacement of [...replacements].reverse()) {
    const [start, end] = replacement.transformed_utf16_range;
    assert.equal(restored.slice(start, end), replacement.inserted);
    restored = restored.slice(0, start) + replacement.original + restored.slice(end);
  }
  assert.equal(restored, original, 'Inverse replacement must exactly restore native source');
  parse(`({${transformed}})`, { ecmaVersion: 'latest' });
  return { ...record, transformed, replacements };
}

for (const record of factories) assert.equal(sha(record.source), record.sha256);
const modified = factories.filter(record => notificationIds.has(record.id)).map(transform);
assert.equal(modified.length, 9);
assert.equal(modified.filter(record => record.id === '39116').length, 2);
assert.equal(modified.filter(record => record.id === '30877').length, 6);

const templates = new Map();
for (const record of modified) {
  const signature = createOrderNotificationFactorySignature(record.source, record.id);
  const transformedSignature = createOrderNotificationFactorySignature(record.transformed, record.id);
  const previous = templates.get(signature);
  if (previous) {
    assert.equal(transformedSignature, previous.transformedSignature,
      'Equivalent native factories must produce equivalent notification replacements');
  } else {
    templates.set(signature, { ...record, signature, transformedSignature });
  }
}
assert.equal(templates.size, 3, 'The captured notifications have three distinct behavioral structures');

const moduleSource = `/* Generated by scripts/generate-order-notification-modules.mjs; see notification-manifest.json. */
import { createOrderNotificationFactorySignature } from './factory-structure.js';

const verifiedFactories = [
${[...templates.values()].map(record => `  {
    id: ${JSON.stringify(record.id)},
    signature: ${JSON.stringify(record.signature)},
    create(__notify) { return {${record.transformed}}[${record.id}]; },
  }`).join(',\n')}
];

/** Accept local renaming and formatting while preserving the verified native behavior. */
export function replaceOrderNotificationFactory(id, originalFactory, bridge) {
  if (typeof originalFactory !== 'function') throw new TypeError('Native notification factory must be a function');
  const source = Function.prototype.toString.call(originalFactory);
  const signature = createOrderNotificationFactorySignature(source, String(id));
  const verified = verifiedFactories.find(entry => entry.id === String(id) && entry.signature === signature);
  if (!verified) throw new Error('Native notification factory behavior does not match a verified structure');
  return verified.create(bridge);
}
`;

const fixtureSource = `/* Complete native factory sources, unchanged from the public runtime capture. */
export const nativeOrderNotificationSources = ${JSON.stringify(factories.map(({ id, chunks, source, sha256 }) => ({ id, chunks, source, sha256 })), null, 2)};

const nativeFactories = [
${factories.map(({ id, chunks, source, sha256 }) => `  { sourceSha256: ${JSON.stringify(sha256)}, id: ${JSON.stringify(id)}, chunkId: ${JSON.stringify(chunks[0])}, factory: {${source}}[${id}] }`).join(',\n')}
];

/** Select a captured factory without evaluating source strings. */
export function createNativeOrderNotificationFactory(id, chunkId, sourceSha256) {
  const matches = nativeFactories.filter(entry => entry.id === String(id) && (chunkId === undefined || entry.chunkId === String(chunkId))
    && (sourceSha256 === undefined || entry.sourceSha256 === sourceSha256));
  if (matches.length !== 1) throw new Error('Native notification fixture needs one exact module source');
  return matches[0].factory;
}
`;
parse(moduleSource, { ecmaVersion: 'latest', sourceType: 'module' });
parse(fixtureSource, { ecmaVersion: 'latest', sourceType: 'module' });
const output = new URL('../src/binance-orderbook-trade/order-notifications/native-modules.js', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, moduleSource);
await writeFile(new URL('original-factories.js', fixtureRoot), fixtureSource);
const manifest = {
  schema_version: 1,
  capture_date: '2026-10-07',
  source_snapshot: { file: 'native-factories.json', sha256: sha(snapshot) },
  parser: 'acorn@8.18.0',
  scope_analyzer: 'eslint-scope@9.1.2',
  runtime_matching: 'Lexical binding equivalence; property names, globals, constants, directives and all other behavior remain exact.',
  runtime_templates: templates.size,
  offsets: 'Zero-based UTF-16 offsets; end is exclusive. Factory ranges refer to exact Function.prototype.toString sources.',
  scope: 'Only native order toast and sound side effects are scoped. Native subscriptions, event emitters, preferences, queue limit, throttles, cooldown, JSX and other factory behavior remain unchanged.',
  factories: factories.map(record => {
    const patch = modified.find(candidate => candidate.id === record.id && candidate.sha256 === record.sha256);
    return {
      id: record.id, chunks: record.chunks, evidence: record.evidence, bundle: record.bundle,
      original_sha256: record.sha256,
      ...(patch ? { transformed_sha256: sha(patch.transformed), inverse_replacement_verified: true, replacements: patch.replacements }
        : { transformation: 'None; retained as an independent native dependency fixture.' }),
    };
  }),
  outputs: { module_sha256: sha(moduleSource), fixture_sha256: sha(fixtureSource) },
};
await writeFile(new URL('notification-manifest.json', fixtureRoot), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ captured_factories: modified.length, runtime_templates: templates.size, native_fixtures: factories.length, inverse_replacement_verified: true, outputs: manifest.outputs }));
