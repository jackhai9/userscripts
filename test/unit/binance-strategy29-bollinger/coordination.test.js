import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';

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

for (const reversed of [false, true]) {
  test(`user shares one exact save controller and drain across independently loaded bundles (reversed=${reversed})`, async () => {
    // Given independent bundles loaded against the same native chart API
    const a = await bundle(), b = await bundle();
    const [first, second] = reversed ? [b, a] : [a, b];
    let saves = 0;
    const api = { saveChart: callback => { saves += 1; return callback({ drawings: ['user'] }); } };
    assert.equal(second.afterTradingViewMarkerSaves(api, () => 3), 3);
    // When the first installation acquires the shared controller
    const controller = first.installTradingViewMarkerSaveController(api);
    const wrapper = api.saveChart;
    // Then both installations preserve the controller, user drawings and active drain
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
  });
}

test('user observes that independent bundles expose only a live boolean and unregister their own owner', async () => {
  // Given the independent script bundles and shared page ownership
  const a = await bundle(), b = await bundle(), view = { Map };
  // When b.isChartMutationBlocked processes the configured inputs
  const observedResult = b.isChartMutationBlocked(view);
  // Then user observes that independent bundles expose only a live boolean and unregister their own owner
  assert.equal(observedResult, false);
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

for (const strategy29First of [false, true]) {
  test(`user observes that page and userscript realms share the page-owned Map in either load order (strategy29First=${JSON.stringify(strategy29First)})`, async () => {
    // Given the independent script bundles and shared page ownership
    const pageContext = vm.createContext({});
    // When vm.createContext processes the configured inputs
    const sandboxContext = vm.createContext({});
    const view = vm.runInContext('globalThis', pageContext);
    const pageBundle = await ownerBundle(pageContext);
    const strategy29Bundle = await ownerBundle(sandboxContext);
    // Then user observes that page and userscript realms share the page-owned Map in either load order (strategy29First=the selected case)
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

  });
}

test('user observes that incompatible shared protocols fail without overwriting an owner', async () => {
  // Given a native API already owned by an incompatible protocol version
  const a = await bundle();
  const record = { version: 99 };
  const api = { [Symbol.for('jh-userscripts.chart-marker-save-controller')]: record };
  // When the current bundle attempts to install its shared controller
  const failure = captureStrategyError(() => a.installTradingViewMarkerSaveController(api));
  // Then the conflict is explicit and the existing protocol record remains intact
  assert.match(failure.message, /Incompatible/);
  assert.equal(api[Symbol.for('jh-userscripts.chart-marker-save-controller')], record);
  const view = { Map, [Symbol.for('jh-userscripts.chart-mutation-owners')]: record };
  assert.throws(() => a.isChartMutationBlocked(view), /Incompatible/);
});
