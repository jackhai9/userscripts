import { readFile } from 'node:fs/promises';
import { test, expect } from '../test.js';
import { installMarkerOverlayHost } from '../helpers/marker-overlay-host.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const source = await readFile(new URL('../../../scripts/binance-strategy31-volume-reversal.user.js', import.meta.url), 'utf8');
const origin = 'https://strategy31-periods.example.test';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:24px; background:#101218; color:#d8dce5; font:14px Arial; }
  iframe { width:940px; height:580px; border:0; }
</style></head><body><h1>Strategy31 signal periods</h1>
<p>Controlled chart and gateway boundaries · generated userscript · no native drawing writes</p>
<div class="chart-widget-root"><iframe title="Native chart fixture" srcdoc='<!doctype html><html><body style="margin:16px;background:#101218;color:#d8dce5;font:14px Arial"><p id="period-label">BTRUSDT</p></body></html>'></iframe></div>
</body></html>`;

/** Model only the chart and public gateway boundary; the generated observer owns all business decisions. */
function installPeriodBoundary(initialResolution) {
  const periods = {
    1: { timeframe: '1m', seconds: 60 }, 3: { timeframe: '3m', seconds: 180 },
    5: { timeframe: '5m', seconds: 300 }, 15: { timeframe: '15m', seconds: 900 },
    30: { timeframe: '30m', seconds: 1800 }, 60: { timeframe: '1h', seconds: 3600 },
    240: { timeframe: '4h', seconds: 14400 },
  };
  function subscription() {
    const callbacks = new Map();
    return {
      subscribe(owner, callback) { callbacks.set(callback, owner); },
      unsubscribe(owner, callback) {
        if (callbacks.get(callback) !== owner) throw new Error('Native subscription owner mismatch');
        callbacks.delete(callback);
      },
      emit() { for (const callback of [...callbacks.keys()]) callback(); },
    };
  }
  const interval = subscription(), loaded = subscription();
  const requests = [], exports = [], rows = [];
  const nativeCalls = { create: 0, remove: 0, save: 0 };
  let resolution = initialResolution, ready = true, holdNext = false, pending = null;
  function setRows() {
    const period = periods[resolution];
    if (!period) throw new Error('Unsupported fixture resolution');
    rows.splice(0, rows.length, [period.seconds, 100, 110, 90, 105]);
    document.querySelector('iframe').contentDocument.getElementById('period-label').textContent = `BTRUSDT · ${period.timeframe}`;
  }
  setRows();
  const chart = {
    hasModel: () => true, dataReady: () => ready,
    resolution: () => resolution, symbol: () => 'BTRUSDT@PRICETYPE=LAST',
    onIntervalChanged: () => interval, onDataLoaded: () => loaded,
    async exportData(options) {
      exports.push(structuredClone(options));
      return { schema: ['time', 'open', 'high', 'low', 'close'].map(type => ({ type })),
        data: rows.map(row => ({ 0: row[0], 1: row[1], 2: row[2], 3: row[3], 4: row[4] })) };
    },
    createShape() { nativeCalls.create += 1; throw new Error('Unexpected native drawing creation'); },
    removeEntity() { nativeCalls.remove += 1; throw new Error('Unexpected native drawing removal'); },
  };
  const frame = document.querySelector('iframe');
  frame.contentWindow.tradingViewApi = { activeChart: () => chart,
    saveChart() { nativeCalls.save += 1; throw new Error('Unexpected native drawing save'); } };
  const host = window.installMarkerOverlayHost({ document: frame.contentDocument, chart, rows });
  host.setSpacing(100, 120);
  const provider = {
    version: 1, capabilities: ['strategy31'],
    getState: () => ({ available: true, configured: true, settingsRevision: 1 }),
    request(path, signal) {
      const url = new URL(path, window.location.origin);
      const timeframe = url.searchParams.get('timeframe');
      const period = Object.values(periods).find(value => value.timeframe === timeframe);
      if (url.pathname !== '/v1/strategy31/events' || url.searchParams.get('symbol') !== 'BTR/USDT:USDT'
        || url.searchParams.get('limit') !== '200' || !period) throw new Error('Unexpected fixture gateway query');
      const symbol = 'BTR/USDT:USDT';
      const open = period.seconds * 1000;
      const event = { id: `31_2_spec_v1:${symbol}:${timeframe}:${open}`, symbol, timeframe,
        bar_open_ms: open, bar_close_ms: open * 2,
        open: 100, high: 110, low: 90, close: 105, volume: 130, previous_volume: 100 };
      const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1',
        symbol, timeframe, observed_at_ms: event.bar_close_ms, events: [event] };
      const response = { kind: 'response', status: 200, responseText: JSON.stringify(payload) };
      requests.push({ timeframe, signal });
      if (!holdNext) return Promise.resolve(response);
      if (pending) throw new Error('Only one fixture response may remain pending');
      holdNext = false;
      const gate = Promise.withResolvers();
      pending = { response, gate };
      return gate.promise;
    },
  };
  window[Symbol.for('jh-userscripts.signal-gateway')] = provider;
  window.__STRATEGY31_PERIOD_FIXTURE__ = {
    chart, provider,
    changeInterval(value) {
      resolution = value; ready = false; interval.emit();
      setRows(); host.pan(0);
    },
    finishData() { ready = true; loaded.emit(); },
    holdNextResponse() { holdNext = true; },
    resolvePending() {
      if (!pending) throw new Error('No fixture response is pending');
      const held = pending;
      pending = null;
      held.gate.resolve(held.response);
    },
    visibility() { return getComputedStyle(host.pane.querySelector('[data-strategy-marker-overlay]')).visibility; },
    snapshot() { return { requests: requests.map(request => request.timeframe), exports: exports.length, nativeCalls: { ...nativeCalls } }; },
  };
}

async function openHost(page, resolution) {
  const errors = [], unexpectedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await installScenarioClock(page);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/en/futures/BTRUSDT') {
      await route.fulfill({ contentType: 'text/html', body: html });
    } else {
      unexpectedRequests.push(url.href);
      await route.abort();
    }
  });
  await page.goto(`${origin}/en/futures/BTRUSDT`);
  await expect(page.frameLocator('iframe').getByText('BTRUSDT', { exact: true })).toBeVisible();
  await pauseScenarioClock(page);
  await page.addScriptTag({ content: `window.installMarkerOverlayHost = ${installMarkerOverlayHost.toString()};` });
  await page.evaluate(installPeriodBoundary, resolution);
  return { errors, unexpectedRequests };
}

async function installScript(page) {
  await page.addScriptTag({ content: `{
    const unsafeWindow = window;
    const GM_getValue = (key, initial) => {
      if (key !== 'strategy31StatusPosition') throw new Error('Unexpected private fixture read');
      return initial;
    };
    const GM_setValue = () => { throw new Error('Unexpected private fixture write'); };
    ${source}
  }` });
}

test('user observes independent native readiness and a frozen pending gateway response in the period fixture', async ({ page }) => {
  // Given the shared coordinate fixture and public provider start on fifteen minutes
  const evidence = await openHost(page, '15');

  // When a held fifteen-minute response spans a native five-minute interval change
  const result = await page.evaluate(async () => {
    const fixture = window.__STRATEGY31_PERIOD_FIXTURE__;
    const events = [], owner = {};
    const onInterval = () => events.push('interval');
    const onLoaded = () => events.push('loaded');
    fixture.chart.onIntervalChanged().subscribe(owner, onInterval);
    fixture.chart.onDataLoaded().subscribe(owner, onLoaded);
    fixture.holdNextResponse();
    let settled = false;
    const response = fixture.provider.request('/v1/strategy31/events?symbol=BTR%2FUSDT%3AUSDT&timeframe=15m&limit=200', new AbortController().signal)
      .then(value => { settled = true; return value; });
    fixture.changeInterval('5');
    const beforeCompletion = { ready: fixture.chart.dataReady(), settled, events: [...events] };
    fixture.finishData();
    fixture.resolvePending();
    const payload = JSON.parse((await response).responseText);
    const candles = await fixture.chart.exportData({});
    fixture.chart.onIntervalChanged().unsubscribe(owner, onInterval);
    fixture.chart.onDataLoaded().unsubscribe(owner, onLoaded);
    return { beforeCompletion, ready: fixture.chart.dataReady(), events,
      timeframe: payload.timeframe, close: payload.events[0].bar_close_ms, candleTime: candles.data[0][0] };
  });

  // Then native completion changes readiness while the already-requested server period stays frozen
  expect(result).toEqual({ beforeCompletion: { ready: false, settled: false, events: ['interval'] },
    ready: true, events: ['interval', 'loaded'], timeframe: '15m', close: 1800000, candleTime: 300 });
  expect(evidence).toEqual({ errors: [], unexpectedRequests: [] });
});

for (const resolution of ['1', '3', '5']) {
  test(`user gets no Strategy31 request or arrow on an initial ${resolution}m chart`, async ({ page }) => {
    // Given a native short-period chart and an available public gateway boundary
    const evidence = await openHost(page, resolution);

    // When the generated userscript starts and two complete polling intervals pass
    await installScript(page);
    await page.clock.runFor(10000);

    // Then the observer remains unsupported without any gateway, candle export or drawing operation
    await expect(page.locator('#jh-strategy31-status')).toHaveText('Strategy31: unsupported interval');
    await expect(page.frameLocator('iframe').locator('[data-marker-id]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__STRATEGY31_PERIOD_FIXTURE__.snapshot())).toEqual({
      requests: [], exports: 0, nativeCalls: { create: 0, remove: 0, save: 0 },
    });
    expect(evidence).toEqual({ errors: [], unexpectedRequests: [] });
  });
}

test('user hides a fifteen-minute Strategy31 arrow on five minutes and resumes only supported chart periods', async ({ page }, testInfo) => {
  // Given the generated observer has rendered a fifteen-minute signal before a held second response
  const evidence = await openHost(page, '15');
  await installScript(page);
  const markers = page.frameLocator('iframe').locator('[data-marker-id]');
  await expect(page.locator('#jh-strategy31-status')).toHaveText('Strategy31: 1 chart signals · 15m');
  await expect(markers).toHaveAttribute('data-marker-id', '31_2_spec_v1:BTR/USDT:USDT:15m:900000');
  await expect(markers).toHaveAttribute('transform', 'translate(120 220)');
  await page.screenshot({ path: testInfo.outputPath('strategy31-fifteen-minute.png') });
  await page.evaluate(() => {
    window.__STRATEGY31_PERIOD_FIXTURE__.holdNextResponse();
    window.pendingStrategy31Sample = window[Symbol.for('jh-userscripts.strategy31')].sample();
  });

  // When the native interval changes to five minutes while the gateway response is still pending
  const visibility = await page.evaluate(() => {
    const fixture = window.__STRATEGY31_PERIOD_FIXTURE__;
    fixture.changeInterval('5');
    return fixture.visibility();
  });

  // Then the existing SVG is hidden synchronously before the old response or the next poll
  expect(visibility).toBe('hidden');
  await expect(markers).toBeHidden();
  expect((await page.evaluate(() => window.__STRATEGY31_PERIOD_FIXTURE__.snapshot())).requests).toEqual(['15m', '15m']);

  // When the old response arrives and five-minute data completes before later polls
  await page.evaluate(async () => {
    const fixture = window.__STRATEGY31_PERIOD_FIXTURE__;
    fixture.finishData(); fixture.resolvePending();
    await window.pendingStrategy31Sample;
    await window[Symbol.for('jh-userscripts.strategy31')].sample();
  });
  await page.clock.runFor(10000);

  // Then no late arrow or five-minute request returns and the existing unsupported status is visible
  await expect(markers).toHaveCount(0);
  await expect(page.locator('#jh-strategy31-status')).toHaveText('Strategy31: unsupported interval');
  expect((await page.evaluate(() => window.__STRATEGY31_PERIOD_FIXTURE__.snapshot())).requests).toEqual(['15m', '15m']);
  await page.screenshot({ path: testInfo.outputPath('strategy31-five-minute-unsupported.png') });

  // When the user selects each configured supported period with its own native completion event
  for (const resolution of ['15', '30', '60', '240']) {
    await page.evaluate(async value => {
      const fixture = window.__STRATEGY31_PERIOD_FIXTURE__;
      fixture.changeInterval(value); fixture.finishData();
      await window[Symbol.for('jh-userscripts.strategy31')].sample();
    }, resolution);
    await expect(markers).toBeVisible();
  }

  // Then every supported period produces a fresh request and the final arrow stays on its exact candle
  await expect(page.locator('#jh-strategy31-status')).toHaveText('Strategy31: 1 chart signals · 4h');
  await expect(markers).toHaveAttribute('data-marker-id', '31_2_spec_v1:BTR/USDT:USDT:4h:14400000');
  await expect(markers).toHaveAttribute('transform', 'translate(120 220)');
  expect(await page.evaluate(() => window.__STRATEGY31_PERIOD_FIXTURE__.snapshot())).toEqual({
    requests: ['15m', '15m', '15m', '30m', '1h', '4h'], exports: 5, nativeCalls: { create: 0, remove: 0, save: 0 },
  });
  expect(evidence).toEqual({ errors: [], unexpectedRequests: [] });
});
