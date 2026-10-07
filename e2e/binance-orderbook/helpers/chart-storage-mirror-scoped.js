import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openEmptyStorageLab, STORAGE_LAB_ORIGIN } from './chart-storage-lab.js';
import { openChartHostWorkflows } from './chart-storage-host-workflows.js';

const fixtureRoot = new URL('../../../test/fixtures/binance-chart-storage/', import.meta.url);
const experimentRoot = new URL('../../../experiments/binance-chart-storage/', import.meta.url);

/** The existing lab route owns and blocks every request outside these exact assets. */
async function addScopedAssets(context, includeWriter) {
  const manifest = JSON.parse(await readFile(new URL('mirror-scoped-manifest.json', fixtureRoot), 'utf8'));
  for (const [asset, root] of [
    ['mirror-module.js', experimentRoot], ['mirror-scoped-callback.js', fixtureRoot],
    ...(includeWriter ? [['mirror-writer.js', experimentRoot]] : []),
  ]) {
    const source = await readFile(new URL(asset, root), 'utf8');
    if (asset !== 'mirror-writer.js') {
      assert.equal(createHash('sha256').update(source).digest('hex'), manifest.outputs[asset].sha256, `${asset} hash changed`);
    }
    await context.route(`${STORAGE_LAB_ORIGIN}/${asset}`, route => route.fulfill({ contentType: 'text/javascript', body: source }));
  }
}

export async function openMirrorBootstrapLab(page) {
  await openEmptyStorageLab(page);
  await addScopedAssets(page.context(), false);
}

/** Execute original host storage business functions against unmodified localForage instances. */
export async function openChartMirrorScoped(page, { mode = 'scoped' } = {}) {
  await openChartHostWorkflows(page, { install: false });
  await addScopedAssets(page.context(), mode === 'scoped');
  await page.evaluate(async mode => {
    const { createMirrorCallbacks } = await import('/mirror-scoped-callback.js');
    let runtimeRequire;
    self.webpackChunkfutures_trade_ui.push([['mirror-scoped-callback-entry'], {}, require => { runtimeRequire = require; }]);
    const localforage = window.__STORAGE_LAB__.localforage;
    const state = { localforage, nativeCreateInstance: localforage.createInstance, writer: null, dispatches: 0 };
    if (mode === 'scoped') state.writer = (await import('/mirror-writer.js')).createChartMirrorWriter();
    const callbacks = createMirrorCallbacks(runtimeRequire, (target, entries, nativeThunk) => {
      state.dispatches += 1;
      return state.writer.dispatch(target, entries, nativeThunk);
    });
    state.create = mode === 'native' ? callbacks.native : callbacks.patched;
    window.__MIRROR_SCOPED__ = state;
  }, mode);
}
