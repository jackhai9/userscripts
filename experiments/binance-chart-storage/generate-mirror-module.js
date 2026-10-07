import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'acorn';

const input = process.argv[2];
const moduleOutput = process.argv[3] || new URL('mirror-module.js', import.meta.url);
assert(input, 'Supply the public TradingView.99bc5074.js response file');
const source = await readFile(input, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(source), 'b6a2cddd017fb4517abb4ea458e19905c59f955a3f99efa18beb1e82f3938c1c', 'Public TradingView source changed');
const ast = parse(source, { ecmaVersion: 'latest', ranges: true });
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
  if (node.type === 'Property' && node.key.value === 70940 && node.method) factories.push(node);
});
assert.equal(factories.length, 1, 'Expected one 70940 method factory');
const factory = factories[0];
assert.deepEqual([factory.start, factory.end], [6665, 36819]);
const original = source.slice(factory.start, factory.end);
assert.equal(sha(original), '37d249d1ceec4a41b54a959c1ab2c4b52b3061e504cf8cd81a824962af8c6c88');
const targets = [];
visit(factory, node => {
  assert(node.type !== 'Identifier' || node.name !== '__dispatchChartMirror', 'Dispatch service name is shadowed');
  if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.name === 'Wr'
    && node.right.type === 'CallExpression' && node.right.callee.type === 'MemberExpression'
    && node.right.callee.object.name === 'fr' && node.right.callee.property.name === 'map'
    && source.slice(node.right.start, node.right.end).includes('Sr.setItem(Ot,At)')) targets.push(node.right);
});
assert.equal(targets.length, 1, 'Expected one original mirror write map');
const target = targets[0];
assert.deepEqual([target.start, target.end], [33783, 34025]);
const raw = source.slice(target.start, target.end);
const inserted = `__dispatchChartMirror(Sr,fr,()=>${raw})`;
const first = target.start - factory.start;
const last = target.end - factory.start;
const transformed = original.slice(0, first) + inserted + original.slice(last);
assert.equal(transformed.slice(0, first) + raw + transformed.slice(first + inserted.length), original, 'Reverse replacement must reproduce the whole factory');
parse(`({${transformed}})`, { ecmaVersion: 'latest' });

const moduleSource = `/* Generated from the pinned public 70940 factory; see mirror-scoped-manifest.json. */
const originalFactorySource = ${JSON.stringify(original)};

/** Static factory generation preserves the host lexical body except its mirror write expression. */
export function createMirrorFactory(__dispatchChartMirror) {
  if (typeof __dispatchChartMirror !== 'function') throw new Error('Mirror dispatch must be a function');
  return {${transformed}}[70940];
}

/** Registration rejects source drift before any replacement can reach the runtime cache. */
export function replaceChartMirrorFactory(originalFactory, dispatch) {
  if (typeof originalFactory !== 'function' || Function.prototype.toString.call(originalFactory) !== originalFactorySource) {
    throw new Error('Mirror factory source does not match the pinned public module');
  }
  return createMirrorFactory(dispatch);
}
`;
const fixtureRoot = new URL('../../test/fixtures/binance-chart-storage/', import.meta.url);
const hostManifest = JSON.parse(await readFile(new URL('host-persistence-manifest.json', fixtureRoot), 'utf8'));
const declarations = hostManifest.fragments.filter(fragment => fragment.label.startsWith('declaration:70940:'));
const callbackFragment = hostManifest.fragments.find(fragment => fragment.label === 'callback:70940:z');
assert(callbackFragment, 'Missing original mirror callback provenance');
for (const fragment of [...declarations, callbackFragment]) {
  assert.equal(sha(source.slice(...fragment.source_utf16_range)), fragment.sha256, fragment.label);
}
const callback = source.slice(...callbackFragment.source_utf16_range);
const callbackStart = target.start - callbackFragment.source_utf16_range[0];
const callbackEnd = target.end - callbackFragment.source_utf16_range[0];
const patchedCallback = callback.slice(0, callbackStart) + inserted + callback.slice(callbackEnd);
assert.equal(transformed.slice(callbackFragment.source_utf16_range[0] - factory.start,
  callbackFragment.source_utf16_range[1] - factory.start + inserted.length - raw.length), patchedCallback);
const fixtureSource = `/* Exact native and single-expression transformed mirror callbacks. Dependencies come from host-persistence.js. */
export function createNativeMirrorFactory() { return {${original}}[70940]; }
export function createMirrorCallbacks(e,__dispatchChartMirror) {
${declarations.map(fragment => `var ${source.slice(...fragment.source_utf16_range)};`).join('\n')}
return {
native(a,Cr={current:false},_r={current:true}) { return ${callback}; },
patched(a,Cr={current:false},_r={current:true}) { return ${patchedCallback}; }
};
}
`;
parse(moduleSource, { ecmaVersion: 'latest', sourceType: 'module' });
parse(fixtureSource, { ecmaVersion: 'latest', sourceType: 'module' });
const manifest = {
  description: 'Static 70940 factory with one pinned mirror-write RHS replacement; exact original callback fixture uses original host dependencies.',
  source: { file: 'TradingView.99bc5074.js', url: 'https://bin.bnbstatic.com/static/chunks/TradingView.99bc5074.js', sha256: sha(source) },
  offset_contract: 'Zero-based UTF-16 String.slice offsets; exclusive ends; SHA-256 uses UTF-8 bytes.',
  original_factory: { source_utf16_range: [factory.start, factory.end], sha256: sha(original) },
  replacement: { source_utf16_range: [target.start, target.end], factory_utf16_range: [first, last], original_sha256: sha(raw), inserted_sha256: sha(inserted) },
  original_callback: callbackFragment,
  transformed_callback_sha256: sha(patchedCallback),
  outputs: Object.fromEntries([['mirror-module.js', moduleSource], ['mirror-scoped-callback.js', fixtureSource]]
    .map(([file, value]) => [file, { sha256: sha(value), bytes: Buffer.byteLength(value) }])),
  evidence_limits: 'Whole module source and inverse replacement are statically verified. Offline behavior executes exact callbacks with original dependency factories; full React module initialization is not executed.',
};
await writeFile(moduleOutput, moduleSource);
await writeFile(new URL('mirror-scoped-callback.js', fixtureRoot), fixtureSource);
await writeFile(new URL('mirror-scoped-manifest.json', fixtureRoot), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ originalFactorySha256: sha(original), replacementRange: [target.start, target.end], outputs: manifest.outputs }));
