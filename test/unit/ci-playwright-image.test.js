import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);
const BROWSER_COMMAND = /npm run test:(?:ui|affected|coverage)\b|playwright test\b/;

async function readWorkflows() {
  const names = (await readdir(WORKFLOWS)).filter(name => name.endsWith('.yml')).sort();
  return Promise.all(names.map(async name => ({ name, text: await readFile(new URL(name, WORKFLOWS), 'utf8') })));
}

test('user runs every CI browser workflow in the Playwright image of the locked version', async () => {
  // Given the locked Playwright test runner, whose browser revisions the image must provide.
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const expected = 'mcr.microsoft.com/playwright:v' + lock.packages['node_modules/@playwright/test'].version + '-noble';

  // When each workflow is classified by whether it starts browser tests.
  const workflows = (await readWorkflows()).map(({ name, text }) => ({
    name,
    browser: BROWSER_COMMAND.test(text),
    images: [...text.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map(match => match[1]),
    installsBrowsers: /playwright install\b/.test(text),
  }));

  // Then both browser workflows use exactly that image and no workflow downloads browsers itself.
  assert.deepEqual(workflows.filter(workflow => workflow.browser).map(workflow => workflow.name),
    ['binance-orderbook-ui.yml', 'userscript-tests.yml']);
  for (const workflow of workflows) {
    assert.deepEqual(workflow.images, workflow.browser ? [expected] : [], workflow.name);
    assert.equal(workflow.installsBrowsers, false, workflow.name);
  }
});
