import { test, expect } from '../test.js';
import { openChartHostWorkflows } from '../helpers/chart-storage-host-workflows.js';

function chart(chartId, symbol, drawing = true) {
  const mainId = `main-${symbol}`;
  return {
    chartId,
    panes: [{
      mainSourceId: mainId,
      sources: [
        { id: mainId, type: 'MainSeries', state: { symbol } },
        ...(drawing ? [{
          id: `drawing-${symbol}`, type: 'LineToolTrendLine', ownerSource: mainId,
          state: { symbol }, points: [{ time: 1000, price: 20 }, { time: 2000, price: 25 }],
        }] : []),
      ],
    }],
  };
}

for (const install of [false, true]) {
  const mode = install ? 'adapter' : 'native';

  test(`user restores staged chart saves and their native cross-database mirror with ${mode}`, async ({ page }, testInfo) => {
    // Given both databases have independent settings and the source retains an older layout chart.
    await openChartHostWorkflows(page, { install });
    const oldChart = chart('1', 'SOLUSDT', false);
    const first = { layout: '2h', revision: 1, charts: [chart('2', 'ETHUSDT'), chart('0', 'BTCUSDT')] };
    await page.evaluate(async ({ oldChart, first }) => {
      const { localforage } = window.__STORAGE_LAB__;
      const storage = localforage.createInstance({ name: 'chart_futures' });
      const delivery = localforage.createInstance({ name: 'chart_delivery' });
      await storage.setItem('myTradingView.layout', [oldChart]);
      await storage.setItem('candlestick-setting', { theme: 'source-basic' });
      await delivery.setItem('candlestick-setting', { theme: 'delivery-basic' });
      await delivery.setItem('#TV_SYMBOL-DESTINATION-ONLY', []);
      const widget = { activeChartIndex: () => 1 };
      await window.__CHART_HOST__.tradingView.saveCustomSettings({ storage, key: 'myTradingView', widget });
      const mirror = window.__CHART_HOST__.mirror.create('chart_futures');
      window.__HOST_SCENARIO__ = {
        storage, delivery, first,
        save: window.__CHART_HOST__.tradingView.createSaveCallback(storage, 'myTradingView', widget, mirror),
      };
      window.__STORAGE_NATIVE__.reset();
    }, { oldChart, first });

    // When the original host callback saves four iframe snapshots and awaits its original mirror callback.
    const result = await page.evaluate(async () => {
      const state = window.__HOST_SCENARIO__;
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      try {
        for (const revision of [1, 1, 2, 2]) {
          const snapshot = iframe.contentWindow.JSON.parse(JSON.stringify({ ...state.first, revision }));
          await state.save(snapshot);
        }
      } finally {
        iframe.remove();
      }
      const metrics = window.__STORAGE_NATIVE__.snapshot();
      const { localforage, controller } = window.__STORAGE_LAB__;
      const source = localforage.createInstance({ name: 'chart_futures' });
      const target = localforage.createInstance({ name: 'chart_delivery' });
      const load = storage => window.__CHART_HOST__.tradingView.load({ storage, key: 'myTradingView' });
      return {
        source: await load(source), target: await load(target),
        sourceBasic: await source.getItem('candlestick-setting'), targetBasic: await target.getItem('candlestick-setting'),
        targetOnly: await target.getItem('#TV_SYMBOL-DESTINATION-ONLY'),
        sourceKeys: (await source.keys()).sort(), targetKeys: (await target.keys()).sort(),
        snapshot: await source.getItem('myTradingView'), metrics,
        sourceDriver: source.driver(), targetDriver: target.driver(),
        pending: controller ? controller.getStats().pendingOperations : null,
      };
    });
    await testInfo.attach(`host-save-mirror-${mode}.json`, {
      body: JSON.stringify(result.metrics, null, 2), contentType: 'application/json',
    });

    // Then rebuilt instances restore charts and drawings while unrelated settings remain local to each database.
    const expected = {
      chartSave: { layout: '2h', revision: 2, charts: [chart('0', 'BTCUSDT'), oldChart, chart('2', 'ETHUSDT')] },
      customSettings: { activeChartIndex: 1 },
    };
    expect(result.source).toEqual(expected);
    expect(result.target).toEqual(expected);
    expect(result.snapshot).toEqual({ layout: '2h', revision: 2, charts: [chart('2', 'ETHUSDT', false), chart('0', 'BTCUSDT', false)] });
    expect(result.sourceBasic).toEqual({ theme: 'source-basic' });
    expect(result.targetBasic).toEqual({ theme: 'delivery-basic' });
    expect(result.targetOnly).toEqual([]);
    const sourceKeys = ['#TV_SYMBOL-BTCUSDT', '#TV_SYMBOL-ETHUSDT', 'candlestick-setting', 'myTradingView', 'myTradingView.customSettings', 'myTradingView.layout'];
    expect(result.sourceKeys).toEqual(sourceKeys);
    expect(result.targetKeys).toEqual([...sourceKeys, '#TV_SYMBOL-DESTINATION-ONLY'].sort());
    expect(result.sourceDriver).toBe('asyncStorage');
    expect(result.targetDriver).toBe('asyncStorage');
    expect(result.metrics.transactions).toBe(install ? 28 : 64);
    expect(result.metrics.puts).toBe(install ? 11 : 36);
    expect(result.metrics.aborted).toBe(0);
    expect(result.metrics.pending).toBe(0);
    expect(result.pending).toBe(install ? 0 : null);
  });

  test(`user removes a symbol's last drawing without reviving it on load with ${mode}`, async ({ page }) => {
    // Given the original save workflow has persisted a drawing for each of two symbols.
    await openChartHostWorkflows(page, { install });
    await page.evaluate(async save => {
      const storage = window.__STORAGE_LAB__.localforage.createInstance({ name: 'chart_futures' });
      window.__HOST_SCENARIO__ = { storage };
      await window.__CHART_HOST__.tradingView.save({ storage, save, key: 'myTradingView', widget: {} });
    }, { layout: '2h', charts: [chart('0', 'BTCUSDT'), chart('1', 'ETHUSDT')] });

    // When a new snapshot contains no BTC drawing and a newly created instance loads the saved layout.
    const snapshot = { layout: '2h', charts: [chart('0', 'BTCUSDT', false), chart('1', 'ETHUSDT')] };
    const result = await page.evaluate(async save => {
      const storage = window.__HOST_SCENARIO__.storage;
      await window.__CHART_HOST__.tradingView.save({ storage, save, key: 'myTradingView', widget: {} });
      const reopened = window.__STORAGE_LAB__.localforage.createInstance({ name: 'chart_futures' });
      return {
        btc: await reopened.getItem('#TV_SYMBOL-BTCUSDT'), eth: await reopened.getItem('#TV_SYMBOL-ETHUSDT'),
        loaded: await window.__CHART_HOST__.tradingView.load({ storage: reopened, key: 'myTradingView' }),
      };
    }, snapshot);

    // Then an explicit empty drawing list prevents resurrection while the other symbol's drawing survives.
    expect(result.btc).toEqual([]);
    expect(result.eth).toEqual([chart('1', 'ETHUSDT').panes[0].sources[1]]);
    expect(result.loaded).toEqual({ chartSave: snapshot, customSettings: null });
  });

  test(`user restores all six Basic storage categories through original host functions with ${mode}`, async ({ page }) => {
    // Given a fresh Basic storage instance receives the JSON values produced at its host storage boundary.
    await openChartHostWorkflows(page, { install });
    const values = {
      annotations: [{ id: 'CANDLE', annotations: [{
        id: 'basic-line', type: 'trend', data: [{ time: 1000, value: 20 }, { time: 2000, value: 25 }],
      }] }],
      indicators: [{ id: 'CANDLE', indicators: [{ id: 'MA', categories: ['main'] }], weight: 1 }],
      indicatorSettings: { MA: { lengths: [7, 25, 99] } },
      settings: { '@colorTable': { 'candle.upBarColor': '#00ff00' }, '@watermark': 'test-watermark', background: '#101010', grid: { show: true } },
      annotationConfig: { trend: { lineWidth: 2, color: '#ffffff' } },
      compareSymbolSettings: { ETHUSDT: { color: '#ff9900', visible: true } },
    };

    // When all original Basic save methods persist their categories and a new instance loads them.
    const result = await page.evaluate(async values => {
      const create = () => window.__CHART_HOST__.basic.create({ namespace: 'chart_futures', symbol: 'BTCUSDT' });
      const storage = create();
      await Promise.all([
        storage.saveAnnotations(values.annotations, { interval: '15m' }),
        storage.saveIndicators(values.indicators), storage.saveIndicatorSettings(values.indicatorSettings),
        storage.saveSettings(values.settings), storage.saveAnnotationConfig(values.annotationConfig),
        storage.saveCompareSymbolSettings(values.compareSymbolSettings),
      ]);
      const raw = window.__STORAGE_LAB__.localforage.createInstance({ name: 'chart_futures' });
      return {
        loaded: await create().load({ interval: '15m' }), keys: (await raw.keys()).sort(),
        annotations: await raw.getItem('BASIC_KLINE_BTCUSDT'), settings: await raw.getItem('candlestick-setting'),
      };
    }, values);

    // Then actual annotation conversion and settings exclusions survive a complete six-category reload.
    const annotations = [{ id: 'CANDLE', annotations: [{
      id: 'basic-line', type: 'trend', data: { p1: { time: 1000, value: 20 }, p2: { time: 2000, value: 25 } },
    }] }];
    expect(result.annotations).toEqual(annotations);
    expect(result.settings).toEqual({ background: '#101010', grid: { show: true } });
    expect(result.keys).toEqual([
      'BASIC_KLINE_BTCUSDT', 'BASIC_KLINE_COMPARE_SYMBOL_SETTINGS', 'BASIC_KLINE_INDICATOR',
      'candlestick-indicator-setting', 'candlestick-setting', 'original-candlestick',
    ]);
    expect(result.loaded).toEqual({
      storeData: [{ ...values.indicators[0], annotations: annotations[0].annotations }],
      indicatorSetting: values.indicatorSettings, setting: { background: '#101010', grid: { show: true } },
      annotationConfig: values.annotationConfig, compareSymbolSettings: values.compareSymbolSettings,
    });
  });

  test(`user loads original Basic JSON symbol keys through the native migration with ${mode}`, async ({ page }) => {
    // Given the real store contains only the host's legacy JSON symbol key and explicit indicator data.
    await openChartHostWorkflows(page, { install });
    const oldKey = 'BASIC_KLINE_{"pair":"SOLUSDT","contractType":"PERPETUAL"}';
    const annotations = [{ type: 'CANDLE', annotations: [{ type: 'trend', data: { time: 1000, value: 20 } }] }];
    await page.evaluate(async ({ oldKey, annotations }) => {
      const raw = window.__STORAGE_LAB__.native;
      await raw.setItem(oldKey, annotations);
      await raw.setItem('BASIC_KLINE_INDICATOR', [{ id: 'CANDLE', indicators: [] }]);
    }, { oldKey, annotations });

    // When the original Basic load discovers a missing current key and executes Lc before reading settings.
    const result = await page.evaluate(async oldKey => {
      const storage = window.__CHART_HOST__.basic.create({ namespace: 'chart_futures', symbol: 'SOLUSDT' });
      const loaded = await storage.load({ interval: '15m' });
      const raw = window.__STORAGE_LAB__.native;
      return { loaded, old: await raw.getItem(oldKey), current: await raw.getItem('BASIC_KLINE_SOLUSDT'), keys: (await raw.keys()).sort() };
    }, oldKey);

    // Then migration copies the stored value without deleting its original identity and normalizes the loaded panel.
    expect(result.old).toEqual(annotations);
    expect(result.current).toEqual(annotations);
    expect(result.keys).toEqual(['BASIC_KLINE_INDICATOR', 'BASIC_KLINE_SOLUSDT', oldKey].sort());
    expect(result.loaded).toEqual({
      storeData: [{ id: 'CANDLE', type: 'CANDLE', indicators: [], annotations: annotations[0].annotations }],
      indicatorSetting: null, setting: null, annotationConfig: null, compareSymbolSettings: null,
    });
  });

  test(`user clears the shared chart store through Basic while preserving the other database with ${mode}`, async ({ page }) => {
    // Given Basic and TradingView share one initialized store while delivery retains an independent record.
    await openChartHostWorkflows(page, { install });
    await page.evaluate(async () => {
      const { localforage } = window.__STORAGE_LAB__;
      const tv = localforage.createInstance({ name: 'chart_futures' });
      const delivery = localforage.createInstance({ name: 'chart_delivery' });
      const basic = window.__CHART_HOST__.basic.create({ namespace: 'chart_futures', symbol: 'BTCUSDT' });
      await basic.saveSettings({ background: 'initial' });
      await tv.setItem('myTradingView', { revision: 0 });
      await delivery.setItem('myTradingView', { revision: 'delivery' });
      window.__HOST_SCENARIO__ = { basic, tv, delivery };
    });

    // When completed chart and Basic saves are cleared before another chart save starts.
    const result = await page.evaluate(async () => {
      const { basic, tv, delivery } = window.__HOST_SCENARIO__;
      await Promise.all([
        tv.setItem('#TV_SYMBOL-BEFORE', []), basic.saveSettings({ background: 'before-clear' }),
      ]);
      await basic.clear();
      await tv.setItem('#TV_SYMBOL-AFTER', []);
      return {
        keys: await tv.keys(), after: await tv.getItem('#TV_SYMBOL-AFTER'),
        snapshot: await tv.getItem('myTradingView'), settings: await tv.getItem('candlestick-setting'),
        delivery: await delivery.getItem('myTradingView'),
      };
    });

    // Then shared-store clear removes both chart types in call order and leaves the other database untouched.
    expect(result).toEqual({ keys: ['#TV_SYMBOL-AFTER'], after: [], snapshot: null, settings: null, delivery: { revision: 'delivery' } });
  });

  test(`user observes the documented concurrent Basic clear ordering boundary with ${mode}`, async ({ page }) => {
    // Given retained host instances have finished initialization with one committed chart and Basic setting.
    await openChartHostWorkflows(page, { install });
    await page.evaluate(async () => {
      const tv = window.__STORAGE_LAB__.localforage.createInstance({ name: 'chart_futures' });
      const basic = window.__CHART_HOST__.basic.create({ namespace: 'chart_futures', symbol: 'BTCUSDT' });
      await tv.setItem('myTradingView', { revision: 0 });
      await basic.saveSettings({ background: 'initial' });
      window.__HOST_SCENARIO__ = { tv, basic };
    });

    // When saves and the original Basic clear are issued together without awaiting earlier saves.
    const result = await page.evaluate(async () => {
      const { tv, basic } = window.__HOST_SCENARIO__;
      await Promise.all([
        tv.setItem('#TV_SYMBOL-BEFORE', []), basic.saveSettings({ background: 'before-clear' }),
        basic.clear(), tv.setItem('#TV_SYMBOL-AFTER', []),
      ]);
      return {
        keys: (await tv.keys()).sort(), snapshot: await tv.getItem('myTradingView'),
        settings: await tv.getItem('candlestick-setting'),
      };
    });

    // Then native set preparation runs after clear while the adapter enforces its stronger issue-order contract.
    expect(result).toEqual(install
      ? { keys: ['#TV_SYMBOL-AFTER'], snapshot: null, settings: null }
      : { keys: ['#TV_SYMBOL-AFTER', '#TV_SYMBOL-BEFORE', 'candlestick-setting'], snapshot: null, settings: { background: 'before-clear' } });
  });

  test(`user preserves 290 historical drawings through 32 bounded concurrent host save chains with ${mode}`, async ({ page }, testInfo) => {
    // Given both databases contain identical historical drawings and one fully saved and mirrored initial snapshot.
    test.setTimeout(30_000);
    await openChartHostWorkflows(page, { install });
    const history = Array.from({ length: 290 }, (_, index) => {
      const symbol = `LAB${String(index).padStart(3, '0')}USDT`;
      return { key: `#TV_SYMBOL-${symbol}`, value: [chart(String(index), symbol).panes[0].sources[1]] };
    });
    const initial = { layout: 's', revision: 0, charts: [chart('0', 'BTCUSDT')] };
    await page.evaluate(async ({ history, initial }) => {
      const { localforage } = window.__STORAGE_LAB__;
      const source = localforage.createInstance({ name: 'chart_futures' });
      const target = localforage.createInstance({ name: 'chart_delivery' });
      await Promise.all(history.flatMap(({ key, value }) => [source.setItem(key, value), target.setItem(key, value)]));
      const save = window.__CHART_HOST__.tradingView.createSaveCallback(
        source, 'myTradingView', {}, window.__CHART_HOST__.mirror.create('chart_futures'),
      );
      await save(initial);
      const controller = window.__STORAGE_LAB__.controller;
      window.__HOST_SCENARIO__ = {
        source, target, save, initial, history, statsBefore: controller ? controller.getStats() : null,
      };
      window.__STORAGE_NATIVE__.reset();
    }, { history, initial });

    // When eight successive revisions each run four original save and mirror chains concurrently to completion.
    const result = await page.evaluate(async () => {
      const state = window.__HOST_SCENARIO__;
      const startedAt = performance.now();
      let completed = 0;
      for (let revision = 1; revision <= 8; revision += 1) {
        const snapshot = structuredClone(state.initial);
        snapshot.revision = revision;
        snapshot.charts[0].panes[0].sources[1].points[1].price = 25 + revision;
        const results = await Promise.all(Array.from({ length: 4 }, () => state.save(snapshot)));
        completed += results.length;
      }
      const elapsedMs = performance.now() - startedAt;
      const metrics = window.__STORAGE_NATIVE__.snapshot();
      const controller = window.__STORAGE_LAB__.controller;
      let stats = null;
      let peaks = null;
      if (controller) {
        const current = controller.getStats();
        const counters = [
          'acceptedOperations', 'rejectedOperations', 'failedOperations', 'transactions',
          'committedTransactions', 'abortedTransactions', 'committedWrites', 'skippedWrites', 'barriers',
        ];
        stats = {
          ...Object.fromEntries(counters.map(name => [name, current[name] - state.statsBefore[name]])),
          pendingOperations: current.pendingOperations, pendingBytes: current.pendingBytes,
        };
        peaks = {
          scope: 'Since installation, including setup.',
          pendingOperations: current.peakPendingOperations, pendingBytes: current.peakPendingBytes,
          setupPendingOperations: state.statsBefore.peakPendingOperations, setupPendingBytes: state.statsBefore.peakPendingBytes,
        };
      }
      const read = async storage => ({
        keys: (await storage.keys()).sort(),
        snapshot: await storage.getItem('myTradingView'), layout: await storage.getItem('myTradingView.layout'),
        drawing: await storage.getItem('#TV_SYMBOL-BTCUSDT'),
        historical: await Promise.all(state.history.map(async ({ key }) => ({ key, value: await storage.getItem(key) }))),
        loaded: await window.__CHART_HOST__.tradingView.load({ storage, key: 'myTradingView' }),
      });
      return { completed, elapsedMs, metrics, stats, peaks, source: await read(state.source), target: await read(state.target) };
    });
    const measurement = {
      mode, historicalKeysPerDatabase: 290, rounds: 8, concurrentChainsPerRound: 4,
      completed: result.completed, elapsedMs: result.elapsedMs, metrics: result.metrics, stats: result.stats, peaks: result.peaks,
      scope: 'Isolated fixture workload only; setup and final verification IO excluded from IDB metrics and controller counters. Peaks include setup.',
    };
    await testInfo.attach(`host-bounded-load-${mode}.json`, {
      body: JSON.stringify(measurement, null, 2), contentType: 'application/json',
    });
    console.info(JSON.stringify(measurement));

    // Then every chain completes and both complete databases retain all historical values plus the final changed snapshot and drawing.
    const finalChart = chart('0', 'BTCUSDT');
    finalChart.panes[0].sources[1].points[1].price = 33;
    const expectedKeys = [...history.map(({ key }) => key), '#TV_SYMBOL-BTCUSDT', 'myTradingView', 'myTradingView.layout'].sort();
    const expected = {
      keys: expectedKeys,
      snapshot: { layout: 's', revision: 8, charts: [chart('0', 'BTCUSDT', false)] },
      layout: [chart('0', 'BTCUSDT', false)], drawing: [finalChart.panes[0].sources[1]], historical: history,
      loaded: { chartSave: { layout: 's', revision: 8, charts: [finalChart] }, customSettings: null },
    };
    expect(result.completed).toBe(32);
    expect(result.source).toEqual(expected);
    expect(result.target).toEqual(expected);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.metrics.pending).toBe(0);
    expect(result.metrics.aborted).toBe(0);
    expect(result.metrics.completed).toBe(result.metrics.transactions);
    expect(result.metrics.puts).toBe(install ? 32 : 296 * 32);
    if (install) {
      expect(result.metrics.transactions).toBeLessThan(591 * 32);
      expect(result.stats.pendingOperations).toBe(0);
      expect(result.stats.pendingBytes).toBe(0);
      expect(result.stats.failedOperations).toBe(0);
      expect(result.stats.rejectedOperations).toBe(0);
      expect(result.stats.acceptedOperations).toBe(591 * 32);
      expect(result.stats.committedWrites).toBe(32);
      expect(result.stats.skippedWrites).toBe(296 * 32 - 32);
    } else {
      expect(result.metrics.transactions).toBe(591 * 32);
      expect(result.stats).toBe(null);
    }
  });
}
