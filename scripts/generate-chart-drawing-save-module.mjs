import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'acorn';

const input = process.argv[2];
assert(input, 'Supply the verified public 36648.dd8ae7dc.js response');
const source = await readFile(input, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(source), '8191b50fb47212425d03146834207645c0e89b8ce623e23a71477194ee9a60ff');
const ast = parse(source, { ecmaVersion: 'latest' });
function visit(node, action) {
  if (!node || typeof node !== 'object') return;
  action(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, action));
    else if (value?.type) visit(value, action);
  }
}
const factories = [];
visit(ast, node => {
  if (node.type === 'Property' && node.method && node.key.value === 76535) factories.push(node);
});
assert.equal(factories.length, 1);
const factory = factories[0];
const original = source.slice(factory.start, factory.end);
const targets = [];
visit(factory, node => {
  assert(node.type !== 'Identifier' || node.name !== '__scopeChartDrawingSnapshot', 'Scope helper is shadowed');
  if (node.type === 'CallExpression' && node.callee.name === 'kt'
    && source.slice(node.start, node.end) === 'kt({save:n})') targets.push(node);
});
assert.equal(targets.length, 1);
const target = targets[0];
const raw = source.slice(target.start, target.end);
const inserted = 'kt({save:__scopeChartDrawingSnapshot(n)})';
const first = target.start - factory.start;
const last = target.end - factory.start;
const transformed = original.slice(0, first) + inserted + original.slice(last);
assert.equal(transformed.slice(0, first) + raw + transformed.slice(first + inserted.length), original);
const moduleSource = `/* Generated from the pinned native 76535 factory; see drawing-save-manifest.json. */
import { scopeChartDrawingSnapshot } from './drawing-save-scope.js';
const originalFactorySource = ${JSON.stringify(original)};

/** Preserve native initialization, event subscriptions and storage except snapshot ownership. */
export function createChartDrawingSaveFactory(__scopeChartDrawingSnapshot = scopeChartDrawingSnapshot) {
  return {${transformed}}[76535];
}

/** Unknown host source must remain native rather than accepting an approximate patch. */
export function replaceChartDrawingSaveFactory(originalFactory) {
  if (typeof originalFactory !== 'function' || Function.prototype.toString.call(originalFactory) !== originalFactorySource) {
    throw new Error('Drawing save factory source does not match the pinned public module');
  }
  return createChartDrawingSaveFactory();
}
`;
const fixtureRoot = new URL('../test/fixtures/binance-chart-storage/', import.meta.url);
const hostManifest = JSON.parse(await readFile(new URL('host-persistence-manifest.json', fixtureRoot), 'utf8'));
const declarations = hostManifest.fragments.filter(fragment => fragment.label.startsWith('declaration:76535:'));
assert(declarations.length > 0);
let replacementCount = 0;
const slices = declarations.map(fragment => {
  const raw = source.slice(...fragment.source_utf16_range);
  assert.equal(sha(raw), fragment.sha256, fragment.label);
  if (fragment.source_utf16_range[0] <= target.start && fragment.source_utf16_range[1] >= target.end) {
    replacementCount += 1;
    return raw.slice(0, target.start - fragment.source_utf16_range[0]) + inserted
      + raw.slice(target.end - fragment.source_utf16_range[0]);
  }
  return raw;
});
assert.equal(replacementCount, 1);
const callback = hostManifest.fragments.find(fragment => fragment.label === 'callback:76535:Tt');
assert(callback);
const callbackSource = source.slice(...callback.source_utf16_range);
assert.equal(sha(callbackSource), callback.sha256);
const fixtureSource = `/* Exact native dependencies and save callback, with the same sole production replacement. */
export function createNativeDrawingSaveFactory() { return {${original}}[76535]; }
export function createDrawingSaveCallbacks(r,__scopeChartDrawingSnapshot) {
${slices.map(raw => `var ${raw};`).join('\n')}
return { save: xt, load: zt, createSaveCallback(storage,key,widget,onSave) {
const et={current:storage},st={current:key},p={current:widget},t={initialConfig:{onSave}};
return ${callbackSource};
} };
}
`;
parse(moduleSource, { ecmaVersion: 'latest', sourceType: 'module' });
parse(fixtureSource, { ecmaVersion: 'latest', sourceType: 'module' });
await writeFile(new URL('../src/binance-orderbook-trade/chart-storage/drawing-save-module.js', import.meta.url), moduleSource);
await writeFile(new URL('drawing-save-scoped.js', fixtureRoot), fixtureSource);
const manifest = {
  source: { url: 'https://bin.bnbstatic.com/static/chunks/36648.dd8ae7dc.js', sha256: sha(source) },
  originalFactory: { range: [factory.start, factory.end], sha256: sha(original) },
  replacement: { range: [target.start, target.end], original: raw, inserted },
  outputs: { module: sha(moduleSource), fixture: sha(fixtureSource) },
  scope: 'Only xt calls kt with a snapshot restricted to each chart\'s current MainSeries symbols. Other native methods and events are unchanged.',
};
await writeFile(new URL('drawing-save-manifest.json', fixtureRoot), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
