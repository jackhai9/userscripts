import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategy29ChartHost } from '../helpers/strategy29-runtime-boundary-host.js';
import { installStrategy31 } from '../../src/binance-strategy31-volume-reversal/runtime.js';
import { SIGNAL_GATEWAY_BRIDGE } from '../../src/shared/signal-gateway-bridge.js';

function fixture(locale) {
  const host = createStrategy29ChartHost({ resolution: '5', bars: [
    { time: 300, open: 10, high: 13, low: 9, close: 12 },
  ] });
  host.dom.reconfigure({ url: `https://www.binance.com/${locale}/futures/BTRUSDT` });
  const symbol = 'BTR/USDT:USDT';
  const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
    timeframe: '5m', observed_at_ms: 600000, events: [
      { id: `31_2_spec_v1:${symbol}:5m:300000`, symbol, timeframe: '5m', bar_open_ms: 300000,
        bar_close_ms: 600000, open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 },
    ] };
  const requests = [];
  let capabilities = ['strategy31'];
  let state = { available: true, configured: true, settingsRevision: 1 };
  let nextResponse = null;
  host.view[SIGNAL_GATEWAY_BRIDGE] = {
    version: 1,
    get capabilities() { return capabilities; },
    getState: () => state,
    request(path, signal) {
      requests.push({ path, signal });
      return nextResponse ?? Promise.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(payload) });
    },
  };
  host.setHidden(true);
  const runtime = installStrategy31(host.view);
  host.setHidden(false);
  return { ...host, runtime, requests, payload,
    setCapabilities(value) { capabilities = value; },
    setState(value) { state = value; },
    respond(value) { nextResponse = Promise.resolve(value); },
    hold(value) { nextResponse = value; },
  };
}

const states = [
  { name: 'confirmed chart signals', zh: '策略31：1 个图表信号 · 5m', en: 'Strategy31: 1 chart signals · 5m',
    prepare: f => { f.payload.events[0].volume = 102; }, requests: 1, markers: 1 },
  { name: 'unsupported market', zh: '策略31：不支持的交易市场', en: 'Strategy31: unsupported market',
    prepare: f => { f.view.history.replaceState({}, '', f.view.location.pathname.replace('BTRUSDT', 'BTRUSDC')); }, requests: 0, markers: 0 },
  { name: 'unsupported monthly interval', zh: '策略31：不支持的图表周期', en: 'Strategy31: unsupported interval',
    prepare: f => { f.changeInterval('1M'); f.finishData(); }, requests: 0, markers: 0 },
  { name: 'unsupported numeric interval', zh: '策略31：不支持的图表周期', en: 'Strategy31: unsupported interval',
    prepare: f => { f.changeInterval('2'); f.finishData(); }, requests: 0, markers: 0 },
  { name: 'client upgrade requirement', zh: '策略31：请更新 CorsairQuant 信号客户端', en: 'Strategy31: update CorsairQuant signal client',
    prepare: f => { f.setCapabilities([]); }, requests: 0, markers: 0 },
  { name: 'client configuration requirement', zh: '策略31：请配置 CorsairQuant 信号客户端', en: 'Strategy31: configure CorsairQuant signal client',
    prepare: f => { f.setState({ available: true, configured: false, settingsRevision: 1 }); }, requests: 0, markers: 0 },
  { name: 'unavailable client configuration', zh: '策略31：请配置 CorsairQuant 信号客户端', en: 'Strategy31: configure CorsairQuant signal client',
    prepare: f => { f.setState({ available: false, configured: true, settingsRevision: 1 }); }, requests: 0, markers: 0 },
  { name: 'unavailable signal service', zh: '策略31：信号服务不可用', en: 'Strategy31: signal service unavailable',
    prepare: f => { f.respond({ kind: 'response', status: 503, responseText: 'Provider unavailable diagnostic' }); }, requests: 1, markers: 0 },
  { name: 'invalid signal stop', zh: '策略31已停止：图表或信号数据无效', en: 'Strategy31 stopped: invalid chart or signal data',
    prepare: f => { f.payload.schema_version = 0; }, requests: 1, markers: 0 },
];

for (const locale of ['zh-CN', 'en']) {
  for (const state of states) {
    test(`user reads Strategy31 ${state.name} in ${locale}`, async (t) => {
      // Given the native chart and gateway expose the requested external state.
      const f = fixture(locale);
      t.after(() => { f.runtime.dispose(); f.close(); });
      state.prepare(f);

      // When the real observer samples the chart and gateway.
      await f.runtime.sample();

      // Then the route language changes only the displayed status.
      assert.equal(f.document.getElementById('jh-strategy31-status').textContent, locale === 'zh-CN' ? state.zh : state.en);
      assert.equal(f.requests.length, state.requests);
      assert.equal(f.overlay.markers().length, state.markers);
      assert.equal(f.created.length, 0);
    });
  }
}

test('user switches retained Strategy31 status between Chinese and English while a request is pending', async (t) => {
  // Given a Chinese signal status and one existing marker before a pending gateway response.
  const f = fixture('zh-CN');
  t.after(() => { f.runtime.dispose(); f.close(); });
  await f.runtime.sample();
  const marker = f.overlay.markers()[0];
  const response = Promise.withResolvers();
  f.hold(response.promise);
  const sample = f.runtime.sample();
  f.setHidden(true);
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, '策略31：1 个图表信号 · 5m');

  // When the pending hidden page switches to English through native SPA history.
  f.view.history.pushState({}, '', '/en/futures/BTRUSDT');

  // Then the retained status translates immediately without requests or marker replacement.
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31: 1 chart signals · 5m');
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].signal.aborted, false);
  assert.equal(f.overlay.markers()[0], marker);

  // When the route returns to Chinese before the same response completes.
  f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');

  // Then Chinese returns immediately while the interval session and marker layer keep their subscriptions.
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, '策略31：1 个图表信号 · 5m');
  assert.equal(f.requests.length, 2);
  assert.equal(f.overlay.markers()[0], marker);
  assert.equal(f.intervalChanged.size, 2);
  assert.equal(f.dataLoaded.size, 2);

  // When the same gateway response completes after the document becomes visible.
  f.setHidden(false);
  response.resolve({ kind: 'response', status: 200, responseText: JSON.stringify(f.payload) });
  await sample;

  // Then the completed sample retains Chinese and never adds a third request or native drawing.
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, '策略31：1 个图表信号 · 5m');
  assert.equal(f.requests.length, 2);
  assert.equal(f.overlay.markers().length, 1);
  assert.equal(f.created.length, 0);
});

test('user changes the language of a stopped Strategy31 notice without restarting signal work', async (t) => {
  // Given malformed gateway data stopped the real observer on a Chinese route.
  const f = fixture('zh-CN');
  t.after(() => { f.runtime.dispose(); f.close(); });
  f.payload.schema_version = 0;
  await f.runtime.sample();
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, '策略31已停止：图表或信号数据无效');

  // When the stopped account page switches to English.
  f.view.history.pushState({}, '', '/en/futures/BTRUSDT');

  // Then the terminal notice translates without retrying invalid data.
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, 'Strategy31 stopped: invalid chart or signal data');
  assert.equal(f.requests.length, 1);
  assert.equal(f.overlay.markers().length, 0);

  // When the route returns to Chinese with valid server data now available.
  f.payload.schema_version = 1;
  f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');
  await f.runtime.sample();

  // Then the stopped state stays terminal and only its displayed language changes.
  assert.equal(f.document.getElementById('jh-strategy31-status').textContent, '策略31已停止：图表或信号数据无效');
  assert.equal(f.requests.length, 1);
  assert.equal(f.overlay.markers().length, 0);
});
