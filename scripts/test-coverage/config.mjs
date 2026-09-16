import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const COVERAGE_DIRECTORY = resolve(ROOT, 'test-results/coverage');
export const BRANCH_TARGET = 90;
// This spec validates the collector with virtual code, not production behavior.
export const COVERAGE_SELF_TEST_FILES = ['e2e/binance-orderbook/specs/coverage-merge.pw.js'];
export const HAND_MAINTAINED_SCRIPTS = [
  'scripts/auto_refresh.user.js',
  'scripts/coinmarketcap-valuation-helper.user.js',
];

export function relativeSourcePath(value) {
  const path = value.startsWith('file:') ? fileURLToPath(value) : value;
  return (isAbsolute(path) ? relative(ROOT, path) : path).split(sep).join('/');
}

export function isProductionSource(value) {
  const path = relativeSourcePath(value);
  return (path.startsWith('src/') && path.endsWith('.js'))
    || HAND_MAINTAINED_SCRIPTS.includes(path);
}

export async function productionSourceFiles() {
  async function walk(directory) {
    const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => {
      const path = directory + '/' + entry.name;
      return entry.isDirectory() ? walk(path) : [path];
    }));
    return files.flat();
  }
  return [...await walk('src'), ...HAND_MAINTAINED_SCRIPTS]
    .filter(isProductionSource).sort();
}

export async function assertProjectNodeVersion() {
  const expected = (await readFile(resolve(ROOT, '.nvmrc'), 'utf8')).trim();
  if (process.versions.node !== expected) {
    throw new Error('Use the project Node version ' + expected + '; received ' + process.versions.node);
  }
}
