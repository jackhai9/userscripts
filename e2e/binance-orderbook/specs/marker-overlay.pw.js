import { build } from 'esbuild';
import { test, expect } from '../test.js';
import { installMarkerOverlayHost } from '../helpers/marker-overlay-host.js';

const bundle = await build({ entryPoints: ['src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js'],
  bundle: true, write: false, format: 'iife', globalName: 'markerApi' });

test('user keeps chart markers out of native drawing saves while another page reads persisted drawings', async ({ page, context }) => {
  // Given two pages share an isolated database and a chart with a user drawing.
  await context.route('http://marker.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('http://marker.test/chart');
  const reader = await context.newPage();
  await reader.goto('http://marker.test/reader');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({ content: `window.installMarkerOverlayHost = ${installMarkerOverlayHost.toString()};` });
  await page.evaluate(async () => {
    const subscription = () => {
      const listeners = new Map();
      return { subscribe: (owner, fn) => listeners.set(fn, owner),
        unsubscribe: (owner, fn) => { if (listeners.get(fn) === owner) listeners.delete(fn); } };
    };
    const intervals = subscription(), loaded = subscription();
    window.nativeCalls = { create: 0, remove: 0, save: 0 };
    const chart = { hasModel: () => true, dataReady: () => true, resolution: () => '1', symbol: () => 'OPNUSDT',
      onIntervalChanged: () => intervals, onDataLoaded: () => loaded,
      createShape() { window.nativeCalls.create += 1; }, removeEntity() { window.nativeCalls.remove += 1; } };
    const api = { activeChart: () => chart, saveChart() { window.nativeCalls.save += 1; } };
    const rows = Array.from({ length: 2000 }, (_, i) => [(i + 1) * 60, 100, 110, 90, 105]);
    window.host = window.installMarkerOverlayHost({ document, chart, rows });
    window.layer = window.markerApi.createBollingerMarkerLayer({ chart, chartRoot: document.body,
      tradingViewApi: api, resolution: '1', routeSymbol: 'OPNUSDT' });
    window.signals = rows.map((row, i) => ({ id: `s-${i}`, time: row[0], markerPrice: 90 + i % 30,
      direction: i % 2 ? 'bearish' : 'bullish', type: i % 3 === 0 ? 'warning' : 'confirmed' }));
    window.openDrawingDatabase = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('marker-fixture', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drawings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await window.openDrawingDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('drawings', 'readwrite');
      tx.objectStore('drawings').put({ id: 'user-line', price: 123 }, 'user-line');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  // When all markers render and the viewport pans without changing native drawings.
  await page.evaluate(() => window.layer.render(window.signals, { isCurrent: () => true }));
  await expect(page.locator('[data-marker-id="s-0"]')).toHaveAttribute('transform', 'translate(10 220)');
  await page.evaluate(() => window.host.pan(20));
  await expect(page.locator('[data-marker-id="s-0"]')).toHaveAttribute('transform', 'translate(30 220)');
  await page.screenshot({ path: 'test-results/ui/marker-overlay.png' });

  // Then markers are clipped to the pane and the persisted user drawing remains readable from another page.
  expect(await page.evaluate(() => window.nativeCalls)).toEqual({ create: 0, remove: 0, save: 0 });
  expect(await page.locator('[data-marker-id]').count()).toBe(436);
  expect(await page.locator('[data-strategy-marker-overlay]').evaluate(svg => getComputedStyle(svg).pointerEvents)).toBe('none');
  expect(await reader.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('marker-fixture', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('drawings', 'readonly');
      const read = tx.objectStore('drawings').get('user-line');
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }))).toEqual({ id: 'user-line', price: 123 });

  // When the layer is cleared after an update.
  await page.evaluate(async () => { await window.layer.render(window.signals.slice(0, 100), { isCurrent: () => true }); window.layer.clear(); });

  // Then only script-owned presentation disappears and no native persistence call occurred.
  await expect(page.locator('[data-strategy-marker-overlay]')).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeCalls)).toEqual({ create: 0, remove: 0, save: 0 });
  await reader.close();
});

const observers = await build({ stdin: { contents: `
  export { createTradingViewEventLayer } from './src/binance-strategy27-events/dom/tradingview-event-layer.js';
  export { createTradingViewCompoundLayer } from './src/binance-strategy27-events/dom/tradingview-compound-layer.js';
  export { parseStrategy31Events } from './src/binance-strategy31-volume-reversal/event-contract.js';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'observerApi' });

test('user gets exact and prior candle coordinates from the inspected browser host boundary', async ({ page }) => {
  // Given the host exposes two candles separated by a no-trade second
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: `window.installMarkerOverlayHost = ${installMarkerOverlayHost.toString()};` });
  // When exact and previous lookups and inverse price coordinates are read
  const coordinates = await page.evaluate(() => {
    const chart = {};
    const host = window.installMarkerOverlayHost({ document, chart, rows: [[120, 100, 110, 90, 105], [122, 100, 110, 90, 105]] });
    const model = chart._chartWidget.model().model();
    const time = model.timeScale(), price = model.mainSeries().priceScale();
    host.setSpacing(100, 60);
    return { exact: time.timePointToIndex(120, 0), gap: time.timePointToIndex(121, 0),
      prior: time.timePointToIndex(121, 1), beforeFirst: time.timePointToIndex(119, 1),
      x: time.indexToCoordinate(1), y: price.priceToCoordinate(90),
      shiftedPrice: price.coordinateToPrice(price.priceToCoordinate(90) + 8) };
  });
  // Then gaps stay absent in exact mode and previous mode never selects a future candle
  expect(coordinates).toEqual({ exact: 0, gap: null, prior: 0, beforeFirst: null, x: 160, y: 220, shiftedPrice: 86 });
});

test('user sees independent Strategy27 arrows and labels beside Strategy29 and Strategy31 marker projections without native saves', async ({ page }, testInfo) => {
  // Given four renderer instances share a controlled pane while retaining an unrelated drawing
  await page.setContent('<!doctype html><body style="margin:32px;background:#101218;color:#d8dce5;font:14px Arial"><h2>Strategy27, Strategy29 and Strategy31 overlay ownership</h2><p>Controlled chart fixture · independent SVG layers · no native drawing writes</p></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({ content: observers.outputFiles[0].text });
  await page.addScriptTag({ content: `window.installMarkerOverlayHost = ${installMarkerOverlayHost.toString()};` });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    const delegate = () => {
      const listeners = new Map();
      return { subscribe(owner, callback) { listeners.set(callback, owner); },
        unsubscribe(owner, callback) { if (listeners.get(callback) !== owner) throw new Error('Wrong delegate owner'); listeners.delete(callback); } };
    };
    const interval = delegate(), loaded = delegate();
    window.nativeCalls = { create: 0, remove: 0, save: 0 };
    window.foreignDrawing = Object.freeze({ id: 'user-line', price: 123 });
    const chart = { hasModel: () => true, dataReady: () => true, resolution: () => '1S', symbol: () => 'OPNUSDT',
      onIntervalChanged: () => interval, onDataLoaded: () => loaded,
      getAllShapes: () => [window.foreignDrawing],
      createShape() { window.nativeCalls.create += 1; throw new Error('Native creation is forbidden'); },
      removeEntity() { window.nativeCalls.remove += 1; throw new Error('Native removal is forbidden'); } };
    const api = { activeChart: () => chart, saveChart() { window.nativeCalls.save += 1; throw new Error('Native save is forbidden'); } };
    const rows = Array.from({ length: 8 }, (_, index) => [120 + index * 60, 100, 110, index === 7 ? 95 : 90, 105]);
    const host = window.installMarkerOverlayHost({ document, chart, rows });
    host.setSpacing(100, 60);
    const target = { chart, chartRoot: document.body, tradingViewApi: api, resolution: '1S', routeSymbol: 'OPNUSDT' };
    const ordinary = window.observerApi.createTradingViewEventLayer(target, { maxEvents: 80, maxAgeMs: 7200000 });
    const compound = window.observerApi.createTradingViewCompoundLayer(target, { maxCandidates: 80, locale: 'en' });
    const strategy29 = window.markerApi.createBollingerMarkerLayer(target);
    const strategy31 = window.markerApi.createBollingerMarkerLayer(target);
    // This tests renderer ownership; production Strategy31's interval activation is tested separately.
    const strategy31Signals = window.observerApi.parseStrategy31Events({ schema_version: 1, strategy_id: '31',
      spec_version: '31_2_spec_v1', symbol: 'OPN/USDT:USDT', timeframe: '1m', observed_at_ms: 660000,
      events: [{ id: '31_2_spec_v1:OPN/USDT:USDT:1m:540000', symbol: 'OPN/USDT:USDT', timeframe: '1m',
        bar_open_ms: 540000, bar_close_ms: 600000, open: 100, high: 110, low: 95, close: 105, volume: 2, previous_volume: 1 }] }, 'OPN/USDT:USDT', '1m');
    window.scene = { chart, host, ordinary, compound, strategy29, strategy31, strategy31Signals };
  });

  // When ordinary directions, compound slots, Bollinger states and parsed server markers render
  await page.evaluate(async () => {
    const { ordinary, compound, strategy29, strategy31, strategy31Signals } = window.scene;
    await ordinary.renderOpened('ordinary-up', { markerTime: 120, markerShape: 'arrow_up', markerColor: '#0ECB81' }, 660000);
    await ordinary.renderOpened('ordinary-down', { markerTime: 180, markerShape: 'arrow_down', markerColor: '#F6465D' }, 660000);
    const high = { markerTime: 240, markerShape: 'arrow_down', markerColor: '#B71C3B', markerLabel: 'High candidate' };
    await compound.renderCandidate('high', high, 660000);
    await compound.renderCandidate('high-second', high, 660001);
    await compound.renderCandidate('low', { markerTime: 300, markerShape: 'arrow_up', markerColor: '#087F5B', markerLabel: 'Low candidate' }, 660002);
    await strategy29.render([
      { id: 'strategy29-warning', time: 360, markerPrice: 105, type: 'warning', direction: 'bullish' },
      { id: 'strategy29-confirmed', time: 420, markerPrice: 100, type: 'confirmed', direction: 'bearish' },
      { id: 'strategy29-reversal', time: 480, markerPrice: 100, type: 'reversal', direction: 'bearish' },
    ], { isCurrent: () => true });
    await strategy31.render(strategy31Signals, { isCurrent: () => true });
  });

  // Then each marker has its intended candle anchor, color, arrow geometry or localized label
  await expect(page.locator('[data-strategy-marker-overlay]')).toHaveCount(4);
  await expect(page.locator('[data-marker-id]')).toHaveCount(12);
  for (const [id, transform] of [
    ['event:ordinary-up', 'translate(60 228)'], ['event:ordinary-down', 'translate(160 172)'],
    ['candidate:high:icon', 'translate(260 154)'], ['candidate:high:label', 'translate(260 114)'],
    ['candidate:high-second:icon', 'translate(260 90)'], ['candidate:high-second:label', 'translate(260 50)'],
    ['candidate:low:icon', 'translate(360 246)'], ['candidate:low:label', 'translate(360 264)'],
    ['strategy29-warning', 'translate(460 190)'], ['31_2_spec_v1:OPN/USDT:USDT:1m:540000', 'translate(760 210)'],
  ]) await expect(page.locator(`[data-marker-id="${id}"]`)).toHaveAttribute('transform', transform);
  await expect(page.locator('[data-marker-id="candidate:high:icon"]')).toHaveAttribute('d', 'M 0 18 L -12 2 L -4 2 L -4 -18 L 4 -18 L 4 2 L 12 2 Z');
  await expect(page.locator('[data-marker-id="candidate:high:icon"]')).toHaveAttribute('fill', '#B71C3B');
  await expect(page.locator('[data-marker-id="candidate:low:icon"]')).toHaveAttribute('fill', '#087F5B');
  await expect(page.locator('[data-marker-id="candidate:high:label"]')).toHaveText('High candidate');
  await expect(page.locator('[data-marker-id="candidate:low:label"]')).toHaveText('Low candidate');
  await expect(page.locator('[data-marker-id="candidate:high:label"]')).toHaveAttribute('font-size', '12');
  await expect(page.locator('[data-marker-id="strategy29-warning"]')).toHaveAttribute('r', '5');
  expect(await page.locator('[data-strategy-marker-overlay]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).pointerEvents))).toEqual(['none', 'none', 'none', 'none']);
  await page.screenshot({ path: testInfo.outputPath('strategy27-29-31-overlays.png') });

  // When the pane pans and compound labels switch language before individual layers clear
  await page.evaluate(() => { window.scene.host.pan(20); window.scene.compound.setLocale('zh-CN'); });
  await expect(page.locator('[data-marker-id="event:ordinary-up"]')).toHaveAttribute('transform', 'translate(80 228)');
  await expect(page.locator('[data-marker-id="candidate:high:label"]')).toHaveText('候选高');
  await expect(page.locator('[data-marker-id="candidate:low:label"]')).toHaveText('候选低');
  await page.evaluate(() => window.scene.compound.clear());

  // Then clearing one layer preserves the other three and every native drawing/save counter remains zero
  await expect(page.locator('[data-strategy-marker-overlay]')).toHaveCount(3);
  await expect(page.locator('[data-marker-id]')).toHaveCount(6);
  await expect(page.locator('[data-marker-id="31_2_spec_v1:OPN/USDT:USDT:1m:540000"]')).toHaveAttribute('transform', 'translate(780 210)');
  expect(await page.evaluate(() => ({ calls: window.nativeCalls, drawings: window.scene.chart.getAllShapes() }))).toEqual({ calls: { create: 0, remove: 0, save: 0 }, drawings: [{ id: 'user-line', price: 123 }] });
  await page.evaluate(() => { window.scene.ordinary.clear(); window.scene.strategy29.clear(); window.scene.strategy31.clear(); });
  await expect(page.locator('[data-strategy-marker-overlay]')).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeCalls)).toEqual({ create: 0, remove: 0, save: 0 });
  expect(errors).toEqual([]);
});
