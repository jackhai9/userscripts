import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertProjectNodeVersion } from '../../scripts/node-runtime.mjs';

const pinned = (await readFile(new URL('../../.nvmrc', import.meta.url), 'utf8')).trim();

test('user cannot start an npm entry point on a Node version other than .nvmrc', async () => {
  // Given the repository manifest that npm reads before install, run, test, and exec.
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

  // When npm resolves the runtime it must enforce.
  const runtime = manifest.devEngines.runtime;

  // Then npm fails on every runtime except the exact version CI installs from .nvmrc.
  assert.deepEqual(runtime, { name: 'node', version: pinned, onFail: 'error' });
});

test('user sees a repository CLI reject the previous Node line instead of exiting successfully', async () => {
  // Given a Node 22 runtime, where import.meta.main is undefined.
  const outdated = '22.17.0';

  // When the repository CLI runtime contract checks that version.
  const check = assertProjectNodeVersion(outdated);

  // Then the CLI stops and names both the pinned and the received version.
  await assert.rejects(check, new Error(
    'Use the project Node version ' + pinned + ' from .nvmrc (nvm use); received 22.17.0',
  ));
});
