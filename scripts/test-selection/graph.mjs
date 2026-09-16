import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const VIRTUAL_ROOT = '/__test_selection_repository__/';
const BUILD_FILE = 'scripts/build-userscript.mjs';
const PLAYWRIGHT_FILE = 'playwright.config.js';
const SNAPSHOT_TEMPLATE = '{testDir}/{testFilePath}-snapshots/{arg}{ext}';
const CODE = /\.(?:[cm]?js)$/;
const NODE_TEST = /^test\/(?:unit|dom)\/(?:.*\/)?[^/]+\.test\.js$/;
const BROWSER_TEST = /^e2e\/(?:.*\/)?specs\/(?:.*\/)?[^/]+\.pw\.js$/;
const RUNTIME_MODULES = new Set(['fs', 'fs/promises', 'child_process', 'module']);

export function isProtectedPath(path) {
  return /(?:^|\/)(?:\.codex|\.git|\.ssh|\.aws)(?:\/|$)/.test(path)
    || /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.netrc|credentials(?:\.[^/]*)?|id_rsa|id_ed25519)$/.test(path)
    || /\.(?:pem|key|log)$/.test(path);
}

function isDocumentation(path) {
  return /^(?:docs\/.*\.(?:md|mdx)|(?:README(?:\.[^/]*)?|AGENTS|CHANGELOG|CONTRIBUTING|LICENSE)\.md)$/.test(path);
}

function infrastructure(path) {
  return /^(?:package(?:-lock)?\.json|\.nvmrc|playwright\.config\.[^/]+|eslint\.config\.[^/]+)$/.test(path)
    || path.startsWith('.github/workflows/') || path.startsWith('scripts/test-') || path === BUILD_FILE;
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function propertyName(node) {
  return node.computed ? node.property?.value : node.property?.name;
}

function metaUrl(node) {
  return node?.type === 'MemberExpression' && node.object?.type === 'MetaProperty'
    && node.object.meta.name === 'import' && propertyName(node) === 'url';
}

/** Only syntax-level constants are resolved; identifiers and runtime value flow stay unknown. */
function literalString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = literalString(node.left);
    const right = literalString(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function objectProperties(node) {
  if (node?.type !== 'ObjectExpression') return null;
  const result = new Map();
  for (const entry of node.properties) {
    if (entry.type !== 'Property' || entry.computed || entry.kind !== 'init' || entry.method) return null;
    const name = entry.key.name ?? entry.key.value;
    if (name === '__proto__' || result.has(name)) return null;
    result.set(name, entry.value);
  }
  return result;
}

function safeRepositoryPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.includes('\0') && !path.includes('\\')
    && !posix.isAbsolute(path) && posix.normalize(path) === path && path !== '.'
    && !path.split('/').includes('..') && !isProtectedPath(path);
}

/** Generated artifacts inherit exported build entries; uncertain readers retain their entire test closures. */
export async function buildTestGraph({ files, readText }) {
  const inventory = new Set(files);
  const nodeTests = [...inventory].filter((file) => NODE_TEST.test(file)).sort();
  const browserTests = [...inventory].filter((file) => BROWSER_TEST.test(file)).sort();
  if (!nodeTests.length && !browserTests.length) throw new Error('No test roots were found in the current repository inventory');
  const dependencies = new Map();
  const uncertainties = new Map();
  const artifacts = new Map();
  const queue = [...nodeTests, ...browserTests];
  const visited = new Set();
  const add = (consumer, dependency) => {
    if (!dependencies.has(consumer)) dependencies.set(consumer, new Set());
    dependencies.get(consumer).add(dependency);
    if (CODE.test(dependency)) queue.push(dependency);
  };
  const uncertain = (file, detail, global = false) => {
    const entry = { file, reason: detail, scope: global ? 'global' : 'consumer' };
    uncertainties.set(JSON.stringify(entry), entry);
  };
  async function sourceAst(file, global = false) {
    if (isProtectedPath(file)) { uncertain(file, 'Protected dependency was not read', global); return null; }
    if (!inventory.has(file)) { uncertain(file, 'Referenced file is missing', global); return null; }
    const source = await readText(file);
    try { return parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      uncertain(file, 'Unsupported or invalid JavaScript syntax at line ' + error.loc?.line, global);
      return null;
    }
  }
  const buildAst = await sourceAst(BUILD_FILE, true);
  if (buildAst) {
    const exported = buildAst.body.filter((node) => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration')
      .flatMap((node) => node.declaration.kind === 'const' ? node.declaration.declarations : []);
    const declaration = exported.find((node) => node.id.type === 'Identifier' && node.id.name === 'TARGETS');
    const targets = objectProperties(declaration?.init);
    if (!targets || !targets.size) uncertain(BUILD_FILE, 'Build TARGETS cannot be resolved from an exported object', true);
    else {
      for (const target of targets.values()) {
        const fields = objectProperties(target);
        const entry = literalString(fields?.get('entry'));
        const output = literalString(fields?.get('output'));
        if (!safeRepositoryPath(entry) || !safeRepositoryPath(output) || !CODE.test(entry) || !CODE.test(output)) {
          uncertain(BUILD_FILE, 'Build target lacks a safe supported entry/output pair', true);
        } else if (artifacts.has(output)) {
          uncertain(BUILD_FILE, 'Build output has multiple source entries: ' + output, true);
        } else if (!inventory.has(entry) || !inventory.has(output)) {
          uncertain(BUILD_FILE, 'Build entry or output is unavailable: ' + entry + ' -> ' + output, true);
        } else artifacts.set(output, entry);
      }
    }
  }
  if (browserTests.length) {
    const ast = await sourceAst(PLAYWRIGHT_FILE, true);
    if (ast) {
      const declaration = ast.body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration;
      let config = declaration;
      if (declaration?.type === 'CallExpression') {
        const defineConfig = ast.body.filter((node) => node.type === 'ImportDeclaration' && node.source.value === '@playwright/test')
          .flatMap((node) => node.specifiers)
          .find((node) => node.type === 'ImportSpecifier' && node.imported.name === 'defineConfig')?.local.name;
        config = declaration.callee.type === 'Identifier' && declaration.callee.name === defineConfig && declaration.arguments.length === 1
          ? declaration.arguments[0] : null;
      }
      const properties = objectProperties(config);
      const testDir = literalString(properties?.get('testDir'))?.replace(/^\.\//, '');
      const rootsSupported = testDir && /^e2e\/(?:.*\/)?specs$/.test(testDir)
        && literalString(properties?.get('testMatch')) === '**/*.pw.js'
        && browserTests.every((file) => file.startsWith(testDir + '/'));
      if (!rootsSupported) uncertain(PLAYWRIGHT_FILE, 'Playwright test root configuration cannot be verified', true);
      if (literalString(properties?.get('snapshotPathTemplate')) !== SNAPSHOT_TEMPLATE) {
        uncertain(PLAYWRIGHT_FILE, 'Playwright snapshot layout cannot be verified', true);
      } else if (rootsSupported) {
        for (const file of inventory) {
          const marker = '.pw.js-snapshots/';
          const index = file.indexOf(marker);
          const owner = index < 0 ? null : file.slice(0, index) + '.pw.js';
          if (owner && browserTests.includes(owner)) add(owner, file);
        }
      }
    }
  }
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (artifacts.has(file)) { add(file, artifacts.get(file)); continue; }
    const ast = await sourceAst(file);
    if (!ast) continue;
    function reference(path, strict = true, moduleSpecifier = false) {
      if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
        if (moduleSpecifier && RUNTIME_MODULES.has(path.replace(/^node:/, ''))) uncertain(file, 'Unresolved runtime dependencies from ' + path);
        else if (moduleSpecifier && !path.startsWith('node:')) uncertain(file, 'Unresolved URL module dependency: ' + path.split(':', 1)[0]);
        return;
      }
      if (moduleSpecifier && RUNTIME_MODULES.has(path)) uncertain(file, 'Unresolved runtime dependencies from ' + path);
      if (moduleSpecifier && path.startsWith('#')) { uncertain(file, 'Unresolved package import alias: ' + path); return; }
      if (moduleSpecifier && !path.startsWith('.') && !path.startsWith('/')) return;
      if (moduleSpecifier) {
        const absolute = fileURLToPath(new URL(path, pathToFileURL(VIRTUAL_ROOT + file)));
        if (!absolute.startsWith(VIRTUAL_ROOT)) { uncertain(file, 'Dependency escapes the repository'); return; }
        path = absolute.slice(VIRTUAL_ROOT.length);
      } else if (path.startsWith('.')) path = posix.join(posix.dirname(file), path);
      path = posix.normalize(path).replace(/\/$/, '');
      if (path === '.' || [...inventory].some((entry) => entry.startsWith(path + '/'))) {
        if (strict) uncertain(file, 'Directory input cannot prove a complete dependency set: ' + path);
        return;
      }
      if (isProtectedPath(path)) { if (strict) uncertain(file, 'Protected dependency was not read'); return; }
      if (!safeRepositoryPath(path)) { if (strict) uncertain(file, 'Unsafe dependency was not read'); return; }
      if (inventory.has(path)) {
        add(file, path);
        if (moduleSpecifier && !CODE.test(path) && !path.endsWith('.json')) uncertain(file, 'Unsupported module dependency: ' + path);
      } else if (strict) { add(file, path); uncertain(file, 'Referenced file is missing: ' + path); }
    }
    function moduleReference(node, description) {
      if (node?.type !== 'Literal' || typeof node.value !== 'string') uncertain(file, description + ' at line ' + node?.loc?.start.line);
      else reference(node.value, true, true);
    }
    walk(ast, (node) => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
        moduleReference(node.source, 'Unresolved module dependency');
      } else if (node.type === 'ImportExpression') {
        moduleReference(node.source, 'Unresolved dynamic import');
      } else if (node.type === 'CallExpression' && node.callee.name === 'require') {
        uncertain(file, 'Unresolved runtime dependencies from a CommonJS loader');
        moduleReference(node.arguments[0], 'Unresolved require dependency');
      }
      if (node.type === 'NewExpression' && node.callee.name === 'URL') {
        const path = literalString(node.arguments[0]);
        if (path !== null && /^[a-z][a-z\d+.-]*:/i.test(path) && !path.startsWith('file:')) return;
        if (path === null || !metaUrl(node.arguments[1])) {
          uncertain(file, 'Unresolved URL dependency at line ' + node.loc.start.line);
        } else {
          const url = new URL(path, pathToFileURL(VIRTUAL_ROOT + file));
          const absolute = fileURLToPath(url);
          if (absolute.startsWith(VIRTUAL_ROOT)) reference(absolute.slice(VIRTUAL_ROOT.length));
          else uncertain(file, 'Dependency escapes the repository');
        }
      }
      // Literal path tables retain useful edges without claiming completeness for dynamic readers.
      if (node.type === 'Literal' && typeof node.value === 'string') reference(node.value, false);
    });
  }
  return {
    files: inventory, nodeTests, browserTests, dependencies,
    uncertainties: [...uncertainties.values()].sort((left, right) => left.file.localeCompare(right.file) || left.reason.localeCompare(right.reason)),
  };
}

export function selectTests(graph, changedFiles, { full = false } = {}) {
  const changed = [...new Set(changedFiles)].sort();
  const fullReasons = [];
  const selected = new Set();
  const roots = new Set([...graph.nodeTests, ...graph.browserTests]);
  const reverse = new Map();
  for (const [consumer, dependencies] of graph.dependencies) {
    for (const dependency of dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(consumer);
    }
  }
  function consumers(path) {
    const seen = new Set();
    const found = new Set();
    const pending = [path];
    while (pending.length) {
      const item = pending.pop();
      if (seen.has(item)) continue;
      seen.add(item);
      if (roots.has(item)) found.add(item);
      pending.push(...reverse.get(item) || []);
    }
    return found;
  }
  if (full) fullReasons.push('Full test run explicitly requested');
  const globalUncertainties = graph.uncertainties.filter((entry) => entry.scope === 'global');
  const describe = (entry) => entry.file + ': ' + entry.reason;
  if (globalUncertainties.length) fullReasons.push('Global dependency graph error: ' + globalUncertainties.map(describe).join('; '));
  if (changed.length) {
    for (const file of new Set(graph.uncertainties.filter((entry) => entry.scope === 'consumer').map((entry) => entry.file))) {
      const affected = consumers(file);
      if (!affected.size) fullReasons.push('An unresolved dependency has no provable test owner: ' + file);
      for (const test of affected) selected.add(test);
    }
  }
  for (const path of changed) {
    if (infrastructure(path)) { fullReasons.push('Infrastructure changed: ' + path); continue; }
    if (!graph.files.has(path)) { fullReasons.push('Deleted or unavailable changed path: ' + path); continue; }
    const affected = consumers(path);
    for (const test of affected) selected.add(test);
    if (!affected.size && !isDocumentation(path)) fullReasons.push('Unmapped runtime change: ' + path);
  }
  const mode = fullReasons.length ? 'full' : selected.size ? 'affected' : 'none';
  const reasons = [...fullReasons];
  if (mode === 'none') reasons.push(changed.length ? 'Only documentation without runtime consumers changed' : 'No changed files');
  if (mode === 'affected') {
    reasons.push('Selected complete test files through dependency edges and all unresolved consumers');
    reasons.push(...graph.uncertainties.map(describe));
  }
  return {
    schemaVersion: 1, mode, reasons, changedFiles: changed,
    nodeTests: graph.nodeTests.filter((test) => mode === 'full' || selected.has(test)),
    browserTests: graph.browserTests.filter((test) => mode === 'full' || selected.has(test)),
  };
}
