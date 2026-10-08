import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategy29ChartHost, exportStrategyBars } from '../helpers/strategy29-runtime-boundary-host.js';
import { installStrategy31 } from '../../src/binance-strategy31-volume-reversal/runtime.js';
import { SIGNAL_GATEWAY_BRIDGE } from '../../src/shared/signal-gateway-bridge.js';
import { registerChartMutationOwner } from '../../src/shared/chart-mutation-owners.js';

function fixture({ pathname = '/en/futures/BTRUSDT', hiddenDuringInstall = true, preferences = new Map() } = {}) {
  const host = createStrategy29ChartHost({ resolution: '5', bars: [
    { time: 300, open: 10, high: 13, low: 9, close: 12 },
  ] });
  host.dom.reconfigure({ url: `https://www.binance.com${pathname}` });
  const symbol = 'BTR/USDT:USDT';
  const event = { id: `31_2_spec_v1:${symbol}:5m:300000`, symbol, timeframe: '5m', bar_open_ms: 300000,
    bar_close_ms: 600000, open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 };
  const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
    timeframe: '5m', observed_at_ms: 600000, events: [event] };
  let nextResponse = null, revision = 0;
  const requests = [];
  const preferenceReads = [];
  const preferenceWrites = [];
  const storage = {
    getValue(key, initial) {
      preferenceReads.push({ key, initial });
      return preferences.has(key) ? structuredClone(preferences.get(key)) : initial;
    },
    setValue(key, value) {
      preferenceWrites.push({ key, value: structuredClone(value) });
      preferences.set(key, structuredClone(value));
    },
  };
  host.view[SIGNAL_GATEWAY_BRIDGE] = { version: 1, capabilities: ['strategy31'],
    getState: () => ({ available: true, configured: true, settingsRevision: revision }),
    request: (path, signal) => {
      requests.push({ path, signal });
      return nextResponse ?? Promise.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(payload) });
    } };
  host.setHidden(hiddenDuringInstall);
  const runtime = installStrategy31(host.view, storage);
  host.setHidden(false);
  return { ...host, runtime, requests, preferences, preferenceReads, preferenceWrites,
    hold(promise) { nextResponse = promise; }, changeSettings() { revision += 1; }, payload };
}

/** JSDOM supplies pointer events but has no layout engine or native pointer capture. */
function attachStatusPointerHost(f) {
  const node = f.document.getElementById('jh-strategy31-status');
  const captured = new Set();
  node.setPointerCapture = pointerId => captured.add(pointerId);
  node.hasPointerCapture = pointerId => captured.has(pointerId);
  node.releasePointerCapture = pointerId => captured.delete(pointerId);
  node.getBoundingClientRect = () => new f.view.DOMRect(
    Number.parseFloat(node.style.left), Number.parseFloat(node.style.top), 320, 24,
  );
  return {
    node, captured,
    fire(type, clientX, clientY) {
      const event = new f.view.PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 31, isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX, clientY,
      });
      node.dispatchEvent(event);
    },
  };
}

test('user restores Strategy31 status from its private position without writing during status updates', async (t) => {
  // Given separate stored coordinates for Strategy31 and an unrelated strategy panel
  const preferences = new Map([
    ['strategy31StatusPosition', { left: 120, top: 100 }],
    ['strategy27StatusPosition', { left: 600, top: 400 }],
  ]);
  const f = fixture({ preferences });
  t.after(() => { f.runtime.dispose(); f.close(); });

  // When the runtime renders signals and then an unsupported interval in another language
  await f.runtime.sample();
  const status = f.document.getElementById('jh-strategy31-status');
  f.changeInterval('1M');
  f.finishData();
  await f.runtime.sample();
  f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');

  // Then its position loads once and the same independent status changes without persisting anything
  assert.deepEqual(f.preferenceReads, [{ key: 'strategy31StatusPosition', initial: null }]);
  assert.equal(f.document.getElementById('jh-strategy31-status'), status);
  assert.equal(status.style.left, '120px');
  assert.equal(status.style.top, '100px');
  assert.equal(status.textContent, '策略31：不支持的图表周期');
  assert.equal(status.dataset.state, 'normal');
  assert.equal(f.view.getComputedStyle(status).backgroundColor, 'rgb(24, 26, 32)');
  assert.equal(f.view.getComputedStyle(status).color, 'rgb(221, 221, 221)');
  assert.deepEqual(f.preferenceWrites, []);
  assert.deepEqual(preferences.get('strategy27StatusPosition'), { left: 600, top: 400 });
  assert.equal(f.requests.length, 1);
});

test('user remembers a completed Strategy31 status drag after the script is recreated', async (t) => {
  // Given a live status restored from its script-local preference store
  const preferences = new Map([['strategy31StatusPosition', { left: 120, top: 100 }]]);
  const f = fixture({ preferences });
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const pointer = attachStatusPointerHost(f);

  // When a primary pointer moves the status and finishes the drag
  pointer.fire('pointerdown', 130, 110);
  pointer.fire('pointermove', 220, 170);
  pointer.fire('pointermove', 250, 190);
  assert.equal(pointer.captured.size, 1);
  assert.deepEqual(f.preferenceWrites, []);
  pointer.fire('pointerup', 250, 190);

  // Then one completed position is stored with no retained pointer capture
  assert.equal(pointer.node.style.left, '240px');
  assert.equal(pointer.node.style.top, '180px');
  assert.equal(pointer.captured.size, 0);
  assert.deepEqual(f.preferenceWrites, [{ key: 'strategy31StatusPosition', value: { left: 240, top: 180 } }]);

  // When a new script instance starts with the same private GM preferences
  f.runtime.dispose();
  const restored = fixture({ preferences });
  t.after(() => { restored.runtime.dispose(); restored.close(); });
  await restored.runtime.sample();

  // Then it restores the dragged coordinates without performing another preference write
  const status = restored.document.getElementById('jh-strategy31-status');
  assert.equal(status.style.left, '240px');
  assert.equal(status.style.top, '180px');
  assert.deepEqual(restored.preferenceReads, [{ key: 'strategy31StatusPosition', initial: null }]);
  assert.deepEqual(restored.preferenceWrites, []);
});

test('user leaves a Strategy31 drag without storing it or reviving the removed status on a language change', async (t) => {
  // Given a visible status with an unfinished primary pointer drag
  const f = fixture({ preferences: new Map([['strategy31StatusPosition', { left: 120, top: 100 }]]) });
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const pointer = attachStatusPointerHost(f);
  pointer.fire('pointerdown', 130, 110);
  pointer.fire('pointermove', 250, 190);
  assert.equal(pointer.captured.size, 1);

  // When SPA navigation leaves the chart and returns in another language before any sample
  f.view.history.pushState({}, '', '/en/futures/');
  pointer.fire('pointerup', 250, 190);
  f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');

  // Then detached drag handlers cannot save and a language-only update does not revive the status
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  assert.equal(pointer.captured.size, 0);
  assert.deepEqual(f.preferenceWrites, []);
  assert.equal(f.requests.length, 1);

  // When normal chart sampling resumes on the trading route
  await f.runtime.sample();

  // Then the retained in-page position returns with no storage reread or implicit write
  const status = f.document.getElementById('jh-strategy31-status');
  assert.equal(status.style.left, '240px');
  assert.equal(status.style.top, '180px');
  assert.equal(status.textContent, '策略31：1 个图表信号 · 5m');
  assert.deepEqual(f.preferenceReads, [{ key: 'strategy31StatusPosition', initial: null }]);
  assert.deepEqual(f.preferenceWrites, []);
});

for (const shutdown of ['dispose', 'beforeunload']) {
  test(`user releases Strategy31 drag and pending signals on ${shutdown}`, async (t) => {
    // Given a visible status drag and a signal request still waiting at the gateway boundary
    const f = fixture({ preferences: new Map([['strategy31StatusPosition', { left: 120, top: 100 }]]) });
    t.after(() => { f.runtime.dispose(); f.close(); });
    await f.runtime.sample();
    const pointer = attachStatusPointerHost(f);
    pointer.fire('pointerdown', 130, 110);
    pointer.fire('pointermove', 250, 190);
    assert.equal(pointer.captured.size, 1);
    const response = Promise.withResolvers();
    f.hold(response.promise);
    const sample = f.runtime.sample();

    // When disposal or browser unload retires the runtime before drag and request completion
    if (shutdown === 'dispose') f.runtime.dispose();
    else f.view.dispatchEvent(new f.view.Event('beforeunload'));
    pointer.fire('pointerup', 250, 190);
    response.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(f.payload) });
    await sample;
    f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');
    await f.runtime.sample();

    // Then owned UI and capture are removed without saving or restarting signal work
    assert.equal(f.document.getElementById('jh-strategy31-status'), null);
    assert.equal(pointer.captured.size, 0);
    assert.deepEqual(f.preferenceWrites, []);
    assert.equal(f.requests[1].signal.aborted, true);
    assert.equal(f.requests.length, 2);
    assert.equal(f.overlay.markers().length, 0);
    assert.equal(f.intervalChanged.size, 0);
    assert.equal(f.dataLoaded.size, 0);
  });
}

test('user rejects an invalid Strategy31 stored position before starting chart sampling', (t) => {
  // Given an invalid value returned by this script's private GM position preference
  const host = createStrategy29ChartHost();
  host.setHidden(true);
  const writes = [];
  t.after(() => { host.view[Symbol.for('jh-userscripts.strategy31')]?.dispose(); host.close(); });
  const storage = {
    getValue: () => ({ left: '120', top: 100 }),
    setValue: (key, value) => writes.push({ key, value }),
  };

  // When installation reads the preference outside the asynchronous signal failure boundary
  assert.throws(() => installStrategy31(host.view, storage), /position/i);

  // Then no status, marker owner, or preference write is created from the invalid contract
  assert.equal(host.document.getElementById('jh-strategy31-status'), null);
  assert.equal(host.intervalChanged.size, 0);
  assert.equal(host.dataLoaded.size, 0);
  assert.deepEqual(writes, []);
});

test('user sees no Strategy31 status or signal requests on a non-trading page', async (t) => {
  // Given the observer starts on a visible futures landing page
  const f = fixture({ pathname: '/en/futures/', hiddenDuringInstall: false });
  t.after(() => { f.runtime.dispose(); f.close(); });
  // When the observer samples the non-trading route again
  await f.runtime.sample();
  // Then it stays absent without acquiring the native chart or requesting signals
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  assert.equal(f.requests.length, 0);
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.intervalChanged.size, 0);
  assert.equal(f.dataLoaded.size, 0);
});

test('user clears a stopped Strategy31 notice after SPA navigation without restarting signals', async (t) => {
  // Given invalid server data has stopped the observer and exposed its failure status
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  f.payload.schema_version = 0;
  await f.runtime.sample();
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31 stopped: invalid chart or signal data');
  assert.equal(f.requests.length, 1);
  // When SPA navigation leaves the trading page after the sampling timer has stopped
  f.view.history.pushState({}, '', '/en/futures/');
  // Then route observation removes the failure status without another sample or request
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.requests.length, 1);
  // When valid data becomes available and navigation returns to a supported chart
  f.payload.schema_version = 1;
  f.view.history.pushState({}, '', '/en/futures/BTRUSDT');
  await f.runtime.sample();
  // Then the failed observer remains stopped instead of implicitly retrying
  assert.equal(f.requests.length, 1);
  assert.equal(f.overlay.markers().length, 0);
});

test('user sees no late failure notice when native chart export fails after leaving the trading page', async (t) => {
  // Given a native candle export remains pending after a valid signal response
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const gate = f.holdNextExport();
  const sample = f.runtime.sample();
  await gate.entered;
  // When navigation leaves the chart before the native export rejects
  f.view.history.pushState({}, '', '/en/futures/');
  gate.reject(new TypeError('Invalid native chart export'));
  await sample;
  // Then the late failure keeps all Strategy31 UI absent on the landing page
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.requests.length, 2);
  // When navigation returns to the supported trading page
  f.view.history.pushState({}, '', '/en/futures/BTRUSDT');
  await f.runtime.sample();
  // Then the invalid native contract has stopped further signal requests
  assert.equal(f.requests.length, 2);
  assert.equal(f.overlay.markers().length, 0);
});

test('user clears Strategy31 from the futures landing page and resumes on a trading page', async (t) => {
  // Given one native signal and a visible observer status on a supported market
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  assert.equal(f.overlay.markers().length, 1);
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: 1 chart signals · 5m');
  // When navigation leaves the trading route while its native chart remains mounted
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/' });
  await f.runtime.sample();
  // Then the observer clears its UI and subscriptions without another gateway request
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.intervalChanged.size, 0);
  assert.equal(f.dataLoaded.size, 0);
  // When navigation returns to the supported trading route
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTRUSDT' });
  await f.runtime.sample();
  // Then the observer acquires fresh signals and restores its overlay arrow
  assert.equal(f.requests.length, 2);
  assert.equal(f.overlay.markers().length, 1);
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: 1 chart signals · 5m');
});

test('user aborts pending signals on leaving a trading page without late UI resurrection', async (t) => {
  // Given an existing arrow and a second gateway response still pending
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const response = Promise.withResolvers();
  f.hold(response.promise);
  const sample = f.runtime.sample();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].signal.aborted, false);
  // When the observer samples navigation away before the response completes
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/' });
  await f.runtime.sample();
  // Then the pending transport is cancelled and previous UI is removed immediately
  assert.equal(f.requests[1].signal.aborted, true);
  assert.equal(f.requests.length, 2);
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  // When the cancelled request still delivers its old response
  response.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(f.payload) });
  await sample;
  // Then neither drawings nor status return on the non-trading route
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.created.length, 0);
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  // When the user returns to a supported route after the old request finishes
  f.hold(null);
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTRUSDT' });
  await f.runtime.sample();
  // Then a new request restores observation without restarting the script
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].signal.aborted, false);
  assert.equal(f.overlay.markers().length, 1);
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: 1 chart signals · 5m');
});

test('user clears the landing-page overlay immediately while a chart owner is busy', async (t) => {
  // Given an existing signal and another script holding chart mutation ownership
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const release = registerChartMutationOwner(f.view, 'fixture-trading-owner', () => true);
  t.after(release);
  // When navigation leaves the trading route before ownership is released
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/' });
  await f.runtime.sample();
  // Then owned overlay and status disappear without waiting for native chart ownership.
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.requests.length, 1);
  // When the chart owner releases its mutation reservation
  release();
  await f.runtime.sample();
  // Then no observer arrow or new request appears after ownership is released
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.requests.length, 1);
});

test('user sees one green overlay arrow across repeated server snapshots', async (t) => {
  // Given the existing native-chart fixture and one confirmed server event
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  // When the observer reconciles the same snapshot twice
  await f.runtime.sample();
  await f.runtime.sample();
  // Then it owns one upward arrow at the server coordinate
  assert.equal(f.overlay.markers().length, 1);
  assert.equal(f.overlay.markers()[0].getAttribute('fill'), '#0ECB81');
  assert.equal(f.overlay.markers()[0].getAttribute('d'), 'M 0 0 L -6 8 L -2 8 L -2 18 L 2 18 L 2 8 L 6 8 Z');
  assert.equal(f.overlay.markers()[0].getAttribute('transform'), 'translate(0 491)');
  f.runtime.dispose();
  assert.equal(f.overlay.markers().length, 0);
  f.close();
});

test('user resumes signals after returning from an unsupported monthly interval', async (t) => {
  // Given a supported chart and its installed observer
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  // When the chart visits a monthly interval and returns to five minutes
  f.changeInterval('1M');
  f.finishData();
  await f.runtime.sample();
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: unsupported interval');
  f.changeInterval('5');
  f.finishData();
  await f.runtime.sample();
  // Then the observer resumes one correctly anchored arrow
  assert.equal(f.overlay.markers().length, 1);
  assert.equal(f.overlay.markers()[0].getAttribute('transform'), 'translate(0 491)');
  f.runtime.dispose();
  f.close();
});

test('user waits for native data completion even when old chart data remains ready', async (t) => {
  // Given an observer that already owns the chart interval session
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
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
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.created.length, 0);
  f.finishData();
  await f.runtime.sample();
  assert.equal(f.overlay.markers().length, 1);
  f.runtime.dispose();
  f.close();
});

test('user sees retained signals only after their exact chart candles load', async (t) => {
  // Given a retained server signal older than the currently loaded chart
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  f.setBars([{ time: 900, open: 10, high: 13, low: 9, close: 12 }]);
  // When the observer receives history outside the loaded candle times
  await f.runtime.sample();
  // Then no native drawing is created at an unavailable coordinate
  assert.equal(f.created.length, 0);
  assert.equal(f.overlay.markers().length, 0);
  // When loading earlier chart history exposes the exact green candle
  f.setBars([{ time: 300, open: 10, high: 13, low: 9, close: 12 }]);
  f.finishData();
  await f.runtime.sample();
  // Then the same retained signal is displayed without restarting
  assert.equal(f.overlay.markers()[0].getAttribute('transform'), 'translate(0 491)');
  assert.equal(f.overlay.markers().length, 1);
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
  assert.equal(f.requests.length, 0);
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: unsupported market');
  f.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTRUSDT' });
  f.setSymbol('BTRUSDT@PRICETYPE=LAST');
  await f.runtime.sample();
  assert.equal(f.overlay.markers().length, 1);
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
  assert.equal(f.overlay.markers().length, 1);
  await f.runtime.sample();
  assert.equal(f.exports.length, 3);
  assert.equal(f.overlay.markers().length, 1);
});

test('user never receives a late arrow from the previous chart interval', async (t) => {
  // Given a request held at the gateway boundary
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  const response = Promise.withResolvers();
  f.hold(response.promise);
  // When the interval changes before the request completes
  const sample = f.runtime.sample();
  f.changeInterval('15');
  response.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(f.payload) });
  await sample;
  // Then the stale event does not create any native drawing
  assert.equal(f.overlay.markers().length, 0);
  f.runtime.dispose();
  f.close();
});

test('user never sees an old arrow finish after gateway settings change', async (t) => {
  // Given native candle export is still pending
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  const gate = f.holdNextExport();
  const sample = f.runtime.sample();
  await gate.entered;
  // When gateway settings change before the native operation completes
  f.changeSettings();
  gate.resolve(exportStrategyBars([{ time: 300, open: 10, high: 13, low: 9, close: 12 }]));
  await sample;
  // Then no old-settings arrow remains visible
  assert.equal(f.overlay.markers().length, 0);
  f.runtime.dispose();
  f.close();
});

test('user removes its overlay immediately when stopped during trading drawing work', async (t) => {
  // Given an arrow and a busy shared chart mutation owner
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const release = registerChartMutationOwner(f.view, 'fixture-trading-owner', () => true);
  // When stopping removes only private overlay resources
  f.runtime.dispose();
  assert.equal(f.overlay.markers().length, 0);
  release();
  await f.runtime.sample();
  // Then the observer stays empty without native chart mutations
  assert.equal(f.overlay.markers().length, 0);
  f.close();
});

test('user sees no resurrected status after stopping during native candle export', async (t) => {
  // Given native candle export is pending
  const f = fixture();
  t.after(() => { f.runtime.dispose(); f.close(); });
  const gate = f.holdNextExport();
  const sample = f.runtime.sample();
  await gate.entered;
  // When the observer stops before export completes
  f.runtime.dispose();
  gate.resolve(exportStrategyBars([{ time: 300, open: 10, high: 13, low: 9, close: 12 }]));
  await sample;
  await f.runtime.sample();
  // Then neither a drawing nor a success message reappears
  assert.equal(f.overlay.markers().length, 0);
  assert.equal(f.document.getElementById('jh-strategy31-status'), null);
  f.close();
});
