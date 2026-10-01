import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategy29ChartHost, exportStrategyBars } from '../helpers/strategy29-runtime-boundary-host.js';
import { installStrategy31 } from '../../src/binance-strategy31-volume-reversal/runtime.js';
import { SIGNAL_GATEWAY_BRIDGE } from '../../src/shared/signal-gateway-bridge.js';
import { registerChartMutationOwner } from '../../src/shared/chart-mutation-owners.js';

function fixture() {
  const host = createStrategy29ChartHost({ resolution: '5', bars: [
    { time: 300, open: 10, high: 13, low: 9, close: 12 },
  ] });
  host.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTRUSDT' });
  const symbol = 'BTR/USDT:USDT';
  const event = { id: `31_2_spec_v1:${symbol}:5m:300000`, symbol, timeframe: '5m', bar_open_ms: 300000,
    bar_close_ms: 600000, open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 };
  const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
    timeframe: '5m', observed_at_ms: 600000, events: [event] };
  let nextResponse = null, revision = 0;
  host.view[SIGNAL_GATEWAY_BRIDGE] = { version: 1, capabilities: ['strategy31'],
    getState: () => ({ available: true, configured: true, settingsRevision: revision }),
    request: () => nextResponse ?? Promise.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(payload) }) };
  host.setHidden(true);
  const runtime = installStrategy31(host.view);
  host.setHidden(false);
  return { ...host, runtime, hold(promise) { nextResponse = promise; }, changeSettings() { revision += 1; }, payload };
}

test('user sees one native green arrow across repeated server snapshots', async () => {
  // Given the existing native-chart fixture and one confirmed server event
  const f = fixture();
  // When the observer reconciles the same snapshot twice
  await f.runtime.sample();
  await f.runtime.sample();
  // Then it owns one upward arrow at the server coordinate
  assert.equal(f.shapes.size, 1);
  assert.equal(f.created[0].options.shape, 'arrow_up');
  assert.deepEqual(f.created[0].point, { time: 300, price: 9 });
  f.runtime.dispose();
  assert.equal(f.shapes.size, 0);
  f.close();
});

test('user resumes signals after returning from an unsupported monthly interval', async () => {
  // Given a supported chart and its installed observer
  const f = fixture();
  // When the chart visits a monthly interval and returns to five minutes
  f.changeInterval('1M');
  f.finishData();
  await f.runtime.sample();
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: unsupported interval');
  f.changeInterval('5');
  f.finishData();
  await f.runtime.sample();
  // Then the observer resumes one correctly anchored arrow
  assert.equal(f.shapes.size, 1);
  assert.deepEqual(f.created[0].point, { time: 300, price: 9 });
  f.runtime.dispose();
  f.close();
});

test('user waits for native data completion even when old chart data remains ready', async () => {
  // Given an observer that already owns the chart interval session
  const f = fixture();
  await f.runtime.sample();
  const response = Promise.withResolvers();
  f.hold(response.promise);
  // When interval invalidation precedes the native data-completed event
  f.changeInterval('15');
  f.changeInterval('5');
  f.setDataReady(true);
  const sample = f.runtime.sample();
  response.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(f.payload) });
  await sample;
  // Then old readiness cannot recreate drawings before completion
  assert.equal(f.shapes.size, 0);
  assert.equal(f.created.length, 1);
  f.finishData();
  await f.runtime.sample();
  assert.equal(f.shapes.size, 1);
  f.runtime.dispose();
  f.close();
});

test('user sees retained signals only after their exact chart candles load', async () => {
  // Given a retained server signal older than the currently loaded chart
  const f = fixture();
  f.setBars([{ time: 900, open: 10, high: 13, low: 9, close: 12 }]);
  // When the observer receives history outside the loaded candle times
  await f.runtime.sample();
  // Then no native drawing is created at an unavailable coordinate
  assert.equal(f.created.length, 0);
  assert.equal(f.shapes.size, 0);
  // When loading earlier chart history exposes the exact green candle
  f.setBars([{ time: 300, open: 10, high: 13, low: 9, close: 12 }]);
  f.finishData();
  await f.runtime.sample();
  // Then the same retained signal is displayed without restarting
  assert.deepEqual(f.created[0].point, { time: 300, price: 9 });
  assert.equal(f.shapes.size, 1);
  f.runtime.dispose();
  f.close();
});

test('user sees no USDT signals on a USDC chart and can resume a supported market', async (t) => {
  // Given the observer on a USDC chart, outside its market contract
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTRUSDC' });
  f.setSymbol('BTRUSDC@PRICETYPE=LAST');
  // When the observer samples and later returns to its supported market
  await f.runtime.sample();
  // Then no USDT event is drawn on the unsupported market
  assert.equal(f.created.length, 0);
  assert.equal(f.exports.length, 0);
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTRUSDT' });
  f.setSymbol('BTRUSDT@PRICETYPE=LAST');
  await f.runtime.sample();
  assert.equal(f.shapes.size, 1);
});

test('user keeps arrows through one transient native candle update', async (t) => {
  // Given a drawn signal followed by an inconsistent native feed snapshot
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const bar = { time: 300, open: 10, high: 13, low: 9, close: 12 };
  f.exportNext(exportStrategyBars([bar, bar]));
  // When one sample races the native feed update
  await f.runtime.sample();
  // Then the existing arrow remains and valid subsequent data resumes sampling
  assert.equal(f.shapes.size, 1);
  await f.runtime.sample();
  assert.equal(f.exports.length, 3);
  assert.equal(f.shapes.size, 1);
});

test('user never receives a late arrow from the previous chart interval', async () => {
  // Given a request held at the gateway boundary
  const f = fixture();
  const response = Promise.withResolvers();
  f.hold(response.promise);
  // When the interval changes before the request completes
  const sample = f.runtime.sample();
  f.changeInterval('15');
  response.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(f.payload) });
  await sample;
  // Then the stale event does not create any native drawing
  assert.equal(f.shapes.size, 0);
  f.runtime.dispose();
  f.close();
});

test('user never sees an old arrow finish after gateway settings change', async () => {
  // Given native shape creation is still pending
  const f = fixture();
  const gate = f.holdNextCreation();
  const sample = f.runtime.sample();
  await gate.entered;
  // When gateway settings change before the native operation completes
  f.changeSettings();
  gate.release();
  await sample;
  // Then no old-settings arrow remains visible
  assert.equal(f.shapes.size, 0);
  f.runtime.dispose();
  f.close();
});

test('user gets safe deferred arrow cleanup after stopping during trading drawing work', async () => {
  // Given an arrow and a busy shared chart mutation owner
  const f = fixture();
  await f.runtime.sample();
  const release = registerChartMutationOwner(f.view, 'fixture-trading-owner', () => true);
  // When stopping must wait for the owner to finish
  f.runtime.dispose();
  assert.equal(f.shapes.size, 1);
  release();
  await f.runtime.sample();
  // Then deferred cleanup removes only the observer's arrow
  assert.equal(f.shapes.size, 0);
  f.close();
});

test('user sees no resurrected status after stopping during native shape creation', async () => {
  // Given native shape creation is pending
  const f = fixture();
  const gate = f.holdNextCreation();
  const sample = f.runtime.sample();
  await gate.entered;
  // When the observer stops before creation completes
  f.runtime.dispose();
  gate.release();
  await sample;
  await f.runtime.sample();
  // Then neither a drawing nor a success message reappears
  assert.equal(f.shapes.size, 0);
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  f.close();
});
