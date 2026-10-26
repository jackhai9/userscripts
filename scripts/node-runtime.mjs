import { readFile } from 'node:fs/promises';

/**
 * Repository CLIs run only on the exact `.nvmrc` runtime. Call this at module load,
 * before any `if (import.meta.main)` guard: older Node versions leave
 * `import.meta.main` undefined, so the guard alone would skip all work and exit 0.
 */
export async function assertProjectNodeVersion(actual = process.versions.node) {
  const expected = (await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim();
  if (actual !== expected) {
    throw new Error('Use the project Node version ' + expected + ' from .nvmrc (nvm use); received ' + actual);
  }
}
