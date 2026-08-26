import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW_PATH = new URL('../../.github/workflows/binance-orderbook-ui.yml', import.meta.url);

test('Binance UI workflow gates the complete deterministic and live test toolchain', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');

  for (const pathPattern of [
    'scripts/binance-*.mjs',
    'test/unit/binance-*.test.js',
    'test/unit/binance-orderbook-trade/**',
    'test/dom/binance-orderbook-trade/**',
  ]) {
    assert.ok(workflow.includes(`- "${pathPattern}"`), `Missing workflow path: ${pathPattern}`);
  }
  assert.match(workflow, /- run: npm run test:binance-orderbook-ui-toolchain\n/);
  assert.doesNotMatch(workflow, /- run: npm test\n/);
  assert.match(workflow, /- run: npm run test:ui\n/);
});
