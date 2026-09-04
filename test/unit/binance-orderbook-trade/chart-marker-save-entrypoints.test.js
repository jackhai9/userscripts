import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { throwIfAborted } from '../../../src/binance-orderbook-trade/core/abort.js';
import {
  afterTradingViewMarkerSaves,
  installTradingViewMarkerSaveController,
} from '../../../src/binance-orderbook-trade/core/chart-marker-save-controller.js';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');

/** Execute the production startup boundary without bootstrapping trading UI. */
function startupFixture() {
  const api = { saveChart: (callback) => callback({ drawings: [] }) };
  const controller = installTradingViewMarkerSaveController(api);
  let currentApi = api;
  let symbolCurrent = true;
  let starts = 0;
  const warnings = [];
  const dependencies = {
    document: {}, afterTradingViewMarkerSaves, throwIfAborted,
    findBinanceTradingViewTarget: () => ({ tradingViewApi: currentApi }),
    isCurrentObservedSymbol: () => symbolCurrent,
    createLadderStoppedError: () => Object.assign(new Error('Stopped'), { name: 'LadderStoppedError' }),
    isLadderStoppedError: (error) => error.name === 'LadderStoppedError',
    createTradingViewContinuousSaveController: () => { starts += 1; return 'outer-owner'; },
    warn: (...args) => warnings.push(args),
    CONTINUOUS_CHART_REMOVE_SAVE_QUIET_MS: 120,
    CONTINUOUS_CHART_REMOVE_SAVE_MAX_WAIT_MS: 400,
    CONTINUOUS_CHART_SUBMIT_EVENT_WAIT_MS: 250,
  };
  const start = source.indexOf('  async function startContinuousChartSaveCoalescing(');
  const end = source.indexOf('  function stopContinuousChartSaveCoalescing(', start);
  assert.ok(start > 0 && end > start);
  const run = new Function(...Object.keys(dependencies), `${source.slice(start, end)}; return startContinuousChartSaveCoalescing;`)(...Object.values(dependencies));
  return { controller, run, warnings,
    replaceChart() { currentApi = {}; },
    changeSymbol() { symbolCurrent = false; },
    get starts() { return starts; } };
}

test('production continuous startup waits for marker creation before installing its owner', async () => {
  const f = startupFixture();
  const finish = f.controller.beginMutation();
  const task = f.run(new AbortController().signal, 'BTRUSDT');
  assert.equal(f.starts, 0);
  finish();
  assert.equal(await task, 'outer-owner');
  assert.equal(f.starts, 1);
  assert.deepEqual(f.warnings, []);
});

for (const change of ['changeSymbol', 'replaceChart']) {
  test(`production continuous startup rejects ${change} during marker drain`, async () => {
    const f = startupFixture();
    const finish = f.controller.beginMutation();
    const task = f.run(new AbortController().signal, 'BTRUSDT');
    f[change]();
    finish();
    await assert.rejects(task, { name: 'LadderStoppedError' });
    assert.equal(f.starts, 0);
    assert.deepEqual(f.warnings, []);
  });
}

test('production continuous startup propagates Stop without optional-optimization fallback', async () => {
  const f = startupFixture();
  const finish = f.controller.beginMutation();
  const abort = new AbortController();
  const reason = Object.assign(new Error('Stopped'), { name: 'LadderStoppedError' });
  const task = f.run(abort.signal, 'BTRUSDT');
  abort.abort(reason);
  await assert.rejects(task, (error) => error === reason);
  assert.equal(f.starts, 0);
  assert.deepEqual(f.warnings, []);
  finish();
});
