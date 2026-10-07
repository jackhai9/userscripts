import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const roots = process.argv.slice(2);
assert(roots.length > 0, 'Supply directories containing the public Binance source chunks');
const modules = new Map();
const sources = new Map();
const sha = value => createHash('sha256').update(value).digest('hex');

function visit(node, action) {
  if (!node || typeof node !== 'object') return;
  action(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, action));
    else if (value?.type) visit(value, action);
  }
}

for (const root of roots) {
  for (const file of (await readdir(root)).filter(name => name.endsWith('.js')).sort()) {
    const source = await readFile(path.join(root, file), 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', ranges: true });
    const record = { file, source, sha256: sha(source) };
    sources.set(file, record);
    visit(ast, node => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression'
        || node.callee.property.name !== 'push'
        || !source.slice(node.callee.object.start, node.callee.object.end).includes('webpackChunkfutures_trade_ui')
        || node.arguments[0]?.type !== 'ArrayExpression'
        || node.arguments[0].elements[1]?.type !== 'ObjectExpression') return;
      for (const property of node.arguments[0].elements[1].properties) {
        if (property.type === 'Property' && typeof property.key.value === 'number') {
          if (!modules.has(property.key.value)) modules.set(property.key.value, { ...record, property });
        }
      }
    });
  }
}

function freeNames(source) {
  const ast = parse(source, { ecmaVersion: 'latest', ranges: true });
  return new Set(analyze(ast, { ecmaVersion: 2024, sourceType: 'script' })
    .globalScope.through.map(reference => reference.identifier.name));
}

/** Select complete original declarations, recursively retaining their lexical dependencies. */
function declarations(moduleId, names) {
  const module = modules.get(moduleId);
  assert(module, `Missing source module ${moduleId}`);
  const available = new Map();
  for (const statement of module.property.value.body.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        if (declaration.id.type === 'Identifier') available.set(declaration.id.name, { node: declaration, kind: statement.kind });
      }
    } else if (statement.type === 'FunctionDeclaration') {
      available.set(statement.id.name, { node: statement, kind: null });
    }
  }
  const selected = new Map();
  function add(name) {
    if (selected.has(name)) return;
    const declaration = available.get(name);
    assert(declaration, `Missing declaration ${moduleId}:${name}`);
    selected.set(name, declaration);
    const raw = module.source.slice(declaration.node.start, declaration.node.end);
    const wrapped = declaration.kind ? `${declaration.kind} ${raw};` : raw;
    for (const dependency of freeNames(wrapped)) if (available.has(dependency)) add(dependency);
  }
  names.forEach(add);
  return [...selected].sort((first, second) => first[1].node.start - second[1].node.start)
    .map(([name, declaration]) => ({ ...module, ...declaration, name, moduleId }));
}

function nestedDeclarator(moduleId, name, predicate) {
  const module = modules.get(moduleId);
  const candidates = [];
  visit(module.property.value.body, node => {
    if (node.type === 'VariableDeclarator' && node.id.name === name && predicate(node)) candidates.push(node);
  });
  assert.equal(candidates.length, 1, `Expected exactly one ${moduleId}:${name}`);
  return { ...module, node: candidates[0], moduleId };
}

const tv = declarations(76535, ['kt', 'wt', 'xt', 'zt', 'Wt']);
const basic = declarations(15426, ['Wo', 'Dc']);
const saveCallback = nestedDeclarator(76535, 'Tt', node => node.init.arguments?.[0]?.type === 'ArrowFunctionExpression');
saveCallback.node = saveCallback.node.init.arguments[0];

const mirrorModule = [...modules].find(([, module]) => module.file === 'TradingView.99bc5074.js'
  && module.source.slice(module.property.start, module.property.end).includes('Tn=[Qe.ZE,Qe.F3]'));
assert(mirrorModule, 'Missing original TradingView mirror module');
const mirrorCallback = nestedDeclarator(mirrorModule[0], 'z', node => {
  const raw = mirrorModule[1].source.slice(node.start, node.end);
  return raw.includes('De.keys()') && raw.includes('Sr.setItem(Ot,At)');
});
mirrorCallback.node = mirrorCallback.node.init.arguments[0];
const mirrorNames = [...freeNames(`const callback=${mirrorCallback.source.slice(mirrorCallback.node.start, mirrorCallback.node.end)};`)]
  .filter(name => !['a', 'Cr', '_r', 'Promise', 'console'].includes(name));
const mirror = declarations(mirrorModule[0], mirrorNames);

const dependencies = new Set();
function requiredModules(node, parameter) {
  const found = new Set();
  visit(node, child => {
    if (child.type === 'CallExpression' && child.callee.type === 'Identifier'
      && child.callee.name === parameter && child.arguments[0]?.type === 'Literal'
      && typeof child.arguments[0].value === 'number') found.add(child.arguments[0].value);
  });
  return found;
}
function addModule(id) {
  if (id === 43917 || dependencies.has(id)) return;
  const module = modules.get(id);
  assert(module, `Missing original dependency module ${id}`);
  dependencies.add(id);
  for (const child of requiredModules(module.property.value.body, module.property.value.params[2]?.name)) addModule(child);
}
for (const declaration of [...tv, ...basic, ...mirror]) {
  for (const id of requiredModules(declaration.node, declaration.property.value.params[2].name)) addModule(id);
}

let fixture = '/* Exact public host persistence fragments; see host-persistence-manifest.json. */\n'
  + '(self.webpackChunkfutures_trade_ui=self.webpackChunkfutures_trade_ui||[]).push([["codex-chart-host-persistence-fixture"],{\n';
const fragments = [];
function appendOriginal(record, node, label) {
  const raw = record.source.slice(node.start, node.end);
  const start = fixture.length;
  fixture += raw;
  fragments.push({
    label, source_file: record.file, source_utf16_range: [node.start, node.end],
    fixture_utf16_range: [start, fixture.length], sha256: sha(raw),
  });
}
for (const id of [...dependencies].sort((first, second) => first - second)) {
  const module = modules.get(id);
  appendOriginal(module, module.property, `module:${id}`);
  fixture += ',\n';
}
function appendDeclarations(items) {
  for (const item of items) {
    if (item.kind) fixture += `${item.kind} `;
    appendOriginal(item, item.node, `declaration:${item.moduleId}:${item.name}`);
    fixture += item.kind ? ';\n' : '\n';
  }
}
fixture += '"codex-chart-host-tv"(module,exports,r){\n';
appendDeclarations(tv);
fixture += 'r.d(exports,{save:()=>xt,load:()=>zt,saveCustomSettings:()=>Wt,createSaveCallback:()=>createSaveCallback});\n'
  + 'function createSaveCallback(storage,key,widget,onSave){const et={current:storage},st={current:key},p={current:widget},t={initialConfig:{onSave}};return ';
appendOriginal(saveCallback, saveCallback.node, 'callback:76535:Tt');
fixture += ';}\n},\n"codex-chart-host-basic"(module,exports,a){\n';
appendDeclarations(basic);
fixture += 'a.d(exports,{create:()=>Dc});\n},\n"codex-chart-host-mirror"(module,exports,e){\n';
appendDeclarations(mirror);
fixture += 'e.d(exports,{create:()=>createMirror});\n'
  + 'function createMirror(namespace){const a=namespace,Cr={current:false},_r={current:true};return ';
appendOriginal(mirrorCallback, mirrorCallback.node, `callback:${mirrorModule[0]}:z`);
fixture += ';}\n}}]);\n';

const usedFiles = [...new Set(fragments.map(fragment => fragment.source_file))].sort();
const manifest = {
  description: 'Exact source fragments from the public Binance chart persistence implementation, with original dependency factories.',
  generated_at: new Date().toISOString(),
  offset_contract: 'Zero-based UTF-16 String.slice offsets; exclusive ends; SHA-256 uses UTF-8 bytes.',
  extraction: { parser: 'acorn', declarations: 'Lexical dependency closure; exact original declarator/function slices.', dependency_module_count: dependencies.size },
  wrapper_contract: {
    runtime: 'Existing captured Rspack runtime; localForage module 43917 comes from the existing fixture.',
    tv: 'Only original persistence helpers and save callback; storage/key/widget/onSave references are supplied by the test.',
    basic: 'Original Wo/Dc and their helpers; React subscriptions, debounce and Ec JSON serialization are not executed.',
    mirror: 'Original async callback and original SWC/lodash dependencies; namespace is supplied, Cr.current=false and _r.current=true select the native enabled branch.',
    exclusions: 'No chart rendering, exchange requests, login, production records, or real-page adapter installation.',
  },
  sources: usedFiles.map(file => ({
    file, source_url: `https://bin.bnbstatic.com/static/${file.startsWith('main.') ? '' : 'chunks/'}${file}`,
    sha256: sources.get(file).sha256, bytes: Buffer.byteLength(sources.get(file).source),
  })),
  fixture: { file: 'host-persistence.js', sha256: sha(fixture), bytes: Buffer.byteLength(fixture) },
  fragments,
};
await writeFile(new URL('host-persistence.js', import.meta.url), fixture);
await writeFile(new URL('host-persistence-manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ fixtureBytes: Buffer.byteLength(fixture), dependencyModules: dependencies.size, fragments: fragments.length, sourceFiles: usedFiles }));
