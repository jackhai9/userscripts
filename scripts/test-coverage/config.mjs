import { readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const COVERAGE_DIRECTORY = resolve(ROOT, 'test-results/coverage');
export const BRANCH_TARGET = 90;
// These specs validate the collector with virtual code, not production behavior.
export const COVERAGE_SELF_TEST_FILES = [
  'e2e/binance-orderbook/specs/coverage-merge.pw.js',
  'e2e/binance-orderbook/specs/coverage-pages.pw.js',
];
export const HAND_MAINTAINED_SCRIPTS = [
  'scripts/auto_refresh.user.js',
  'scripts/coinmarketcap-valuation-helper.user.js',
];
/**
 * Byte-pinned copies of Binance's native webpack factories. Their bodies are host code
 * that controlled fixtures cannot execute, so coverage maps them like bundled
 * dependencies; the hand-written chart-storage modules that install them stay in scope.
 */
export const GENERATED_HOST_FACTORIES = [
  'src/binance-orderbook-trade/chart-storage/drawing-save-module.js',
  'src/binance-orderbook-trade/chart-storage/mirror-module.js',
];

export function relativeSourcePath(value) {
  const path = value.startsWith('file:') ? fileURLToPath(value) : value;
  return (isAbsolute(path) ? relative(ROOT, path) : path).split(sep).join('/');
}

export function isProductionSource(value) {
  const path = relativeSourcePath(value);
  return (path.startsWith('src/') && path.endsWith('.js') && !GENERATED_HOST_FACTORIES.includes(path))
    || HAND_MAINTAINED_SCRIPTS.includes(path);
}

/** Bundled code that artifacts may contain but production coverage never credits. */
export function isVendoredSource(path) {
  return path.startsWith('node_modules/') || GENERATED_HOST_FACTORIES.includes(path);
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
