import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';

/** Separate bundles emulate separate Tampermonkey installations sharing one page. */
async function bundle() {
  const result = await build({
    stdin: { contents: "export * from './src/shared/chart-marker-save-controller.js'; export * from './src/shared/chart-mutation-owners.js';",
      resolveDir: process.cwd(), sourcefile: 'coordination-test.js' },
    bundle: true, write: false, format: 'iife', globalName: 'coordination',
  });
  return vm.runInThisContext(result.outputFiles[0].text + '; coordination;');
}

async function ownerBundle(context) {
  const result = await build({
    stdin: { contents: "export * from './src/shared/chart-mutation-owners.js';",
      resolveDir: process.cwd(), sourcefile: 'coordination-sandbox-test.js' },
    bundle: true, write: false, format: 'iife', globalName: 'coordination',
  });
  return vm.runInContext(`${result.outputFiles[0].text}; coordination;`, context);
}

test('independent bundles share one exact API controller and either order sees the same drain', async () => {
  const a = await bundle(), b = await bundle();
  for (const [first, second] of [[a, b], [b, a]]) {
    let saves = 0;
    const api = { saveChart: callback => { saves += 1; return callback({ drawings: ['user'] }); } };
    assert.equal(second.afterTradingViewMarkerSaves(api, () => 3), 3);
    const controller = first.installTradingViewMarkerSaveController(api);
    const wrapper = api.saveChart;
    assert.equal(second.installTradingViewMarkerSaveController(api), controller);
    assert.equal(api.saveChart, wrapper);
    const finish = controller.beginMutation();
    let started = false;
    const drain = second.afterTradingViewMarkerSaves(api, () => { started = true; return 4; });
    assert.equal(started, false);
    assert.equal(controller.canMutate(), false);
    finish();
    api.saveChart(snapshot => assert.deepEqual(snapshot.drawings, ['user']));
    assert.equal(await drain, 4);
    assert.equal(started, true);
    assert.equal(saves, 1);
  }
});

test('independent bundles expose only a live boolean and unregister their own owner', async () => {
  const a = await bundle(), b = await bundle(), view = { Map };
  assert.equal(b.isChartMutationBlocked(view), false);
  let busy = false;
  const remove = a.registerChartMutationOwner(view, 'orderbook', () => busy);
  assert.equal(b.isChartMutationBlocked(view), false);
  busy = true;
  assert.equal(b.isChartMutationBlocked(view), true);
  assert.throws(() => b.registerChartMutationOwner(view, 'orderbook', () => false), /Duplicate/);
  remove();
  assert.equal(b.isChartMutationBlocked(view), false);
  a.registerChartMutationOwner(view, 'invalid', () => 1);
  assert.throws(() => b.isChartMutationBlocked(view), /boolean/);
});

test('page and userscript realms share the page-owned Map in either load order', async () => {
  for (const strategy29First of [false, true]) {
    const pageContext = vm.createContext({});
    const sandboxContext = vm.createContext({});
    const view = vm.runInContext('globalThis', pageContext);
    const pageBundle = await ownerBundle(pageContext);
    const strategy29Bundle = await ownerBundle(sandboxContext);
    assert.notEqual(view.Map, vm.runInContext('Map', sandboxContext));
    if (strategy29First) {
      assert.equal(strategy29Bundle.isChartMutationBlocked(view), false);
      assert.equal(view[Symbol.for('jh-userscripts.chart-mutation-owners')], undefined);
    }
    let busy = false;
    const remove = pageBundle.registerChartMutationOwner(view, `orderbook-${strategy29First}`, () => busy);
    const record = view[Symbol.for('jh-userscripts.chart-mutation-owners')];
    assert.equal(record.predicates instanceof view.Map, true);
    assert.equal(strategy29Bundle.isChartMutationBlocked(view), false);
    busy = true;
    assert.equal(strategy29Bundle.isChartMutationBlocked(view), true);
    remove();
  }
});

test('incompatible shared protocols fail without overwriting an owner', async () => {
  const a = await bundle();
  const record = { version: 99 };
  const api = { [Symbol.for('jh-userscripts.chart-marker-save-controller')]: record };
  assert.throws(() => a.installTradingViewMarkerSaveController(api), /Incompatible/);
  assert.equal(api[Symbol.for('jh-userscripts.chart-marker-save-controller')], record);
  const view = { Map, [Symbol.for('jh-userscripts.chart-mutation-owners')]: record };
  assert.throws(() => a.isChartMutationBlocked(view), /Incompatible/);
});
