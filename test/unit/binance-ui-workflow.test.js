import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW_PATH = new URL('../../.github/workflows/binance-orderbook-ui.yml', import.meta.url);

test('user observes that Binance UI workflow gates the complete deterministic and live test toolchain', async () => {
  // Given the checked-in workflow defines the deterministic and live toolchain
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');

  // When the workflow trigger paths and commands are inspected
  for (const pathPattern of [
    'scripts/binance-*.mjs',
    'test/unit/binance-*.test.js',
    'test/unit/binance-orderbook-trade/**',
    'test/dom/binance-orderbook-trade/**',
    'src/binance-strategy29-bollinger/**',
    'test/unit/binance-strategy29-bollinger/**',
    'test/dom/binance-strategy29-bollinger/**',
    'src/shared/chart-marker-save-controller.js',
    'src/shared/chart-mutation-owners.js',
  ]) {
    assert.ok(workflow.includes(`- "${pathPattern}"`), `Missing workflow path: ${pathPattern}`);
  }
  // Then Binance UI workflow gates the complete deterministic and live test toolchain
  assert.match(workflow, /- run: npm run test:binance-orderbook-ui-toolchain\n/);
  assert.doesNotMatch(workflow, /- run: npm test\n/);
  assert.match(workflow, /- run: npm run test:ui\n/);
});
