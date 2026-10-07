import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '../test.js';
import { STORAGE_LAB_ORIGIN } from '../helpers/chart-storage-lab.js';
import { openChartMirrorScoped } from '../helpers/chart-storage-mirror-scoped.js';

const deletedSymbol = 'MUBARAKUSDT';
const otherSymbol = 'ETHUSDT';
const drawingKey = `#TV_SYMBOL-${deletedSymbol}`;

function chart(chartId, symbol, count, mainSourceId = `main-${symbol}`) {
  return {
    chartId,
    panes: [{
      mainSourceId,
      sources: [
        { id: mainSourceId, type: 'MainSeries', state: { symbol } },
        ...Array.from({ length: count }, (_, index) => ({
          id: `manual-${symbol}-${index}`, type: 'LineToolTrendLine', ownerSource: mainSourceId,
          state: { symbol }, points: [{ time: 1000, price: index + 20 }, { time: 2000, price: index + 25 }],
        })),
      ],
    }],
  };
}

const snapshot = (chartId, symbol, count) => ({ layout: 's', charts: [chart(chartId, symbol, count)] });

/** Use the verified native callback fixture with the current production destination writer. */
async function openDrawingHost(page, mode, namespace = 'chart_futures') {
  await openChartMirrorScoped(page, { mode: 'native' });
  if (mode !== 'native') {
    await page.route(`${STORAGE_LAB_ORIGIN}/{production-writer,json}.js`, async route => {
      const filename = new URL(route.request().url()).pathname === '/production-writer.js'
        ? 'mirror-writer.js' : 'json.js';
      await route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(new URL(`../../../src/binance-orderbook-trade/chart-storage/${filename}`, import.meta.url), 'utf8'),
      });
    });
  }
  if (mode === 'scoped-production') {
    const manifest = JSON.parse(await readFile(new URL('../../../test/fixtures/binance-chart-storage/drawing-save-manifest.json', import.meta.url), 'utf8'));
    for (const [asset, path] of [
      ['drawing-save-scope.js', '../../../src/binance-orderbook-trade/chart-storage/drawing-save-scope.js'],
      ['drawing-save-scoped.js', '../../../test/fixtures/binance-chart-storage/drawing-save-scoped.js'],
    ]) {
      const source = await readFile(new URL(path, import.meta.url), 'utf8');
      if (asset === 'drawing-save-scoped.js') {
        assert.equal(createHash('sha256').update(source).digest('hex'), manifest.outputs.fixture, 'Drawing save fixture hash changed');
      }
      await page.route(`${STORAGE_LAB_ORIGIN}/${asset}`, route => route.fulfill({
        contentType: 'text/javascript', body: source,
      }));
    }
  }
  await page.evaluate(async ({ mode, namespace }) => {
    const state = window.__MIRROR_SCOPED__;
    let api = window.__CHART_HOST__.tradingView;
    if (mode !== 'native') {
      const { createChartMirrorWriter } = await import('/production-writer.js');
      const { createMirrorCallbacks } = await import('/mirror-scoped-callback.js');
      let runtimeRequire;
      self.webpackChunkfutures_trade_ui.push([['drawing-regression'], {}, require => { runtimeRequire = require; }]);
      state.writer = createChartMirrorWriter();
      const callbacks = createMirrorCallbacks(runtimeRequire, (target, entries, nativeThunk) => {
        state.dispatches += 1;
        return state.writer.dispatch(target, entries, nativeThunk);
      });
      state.create = callbacks.patched;
      if (mode === 'scoped-production') {
        const { scopeChartDrawingSnapshot } = await import('/drawing-save-scope.js');
        const { createDrawingSaveCallbacks } = await import('/drawing-save-scoped.js');
        api = createDrawingSaveCallbacks(runtimeRequire, scopeChartDrawingSnapshot);
      }
    }
    const storage = state.localforage.createInstance({ name: namespace });
    await storage.ready();
    window.__DRAWING_HOST__ = {
      storage, api,
      save: api.createSaveCallback(storage, 'myTradingView', {}, state.create(namespace)),
    };
  }, { mode, namespace });
}

async function saveDrawingSnapshot(page, value) {
  await page.evaluate(value => window.__DRAWING_HOST__.save(value), value);
}

async function readDrawingState(page) {
  return page.evaluate(async ({ drawingKey, deletedSymbol }) => {
    const read = async name => {
      const storage = window.__STORAGE_LAB__.localforage.createInstance({ name });
      const loaded = await window.__DRAWING_HOST__.api.load({ storage, key: 'myTradingView' });
      return {
        stored: await storage.getItem(drawingKey),
        loaded: loaded.chartSave.charts.flatMap(chart => chart.panes.flatMap(pane => pane.sources))
          .filter(source => source.type.startsWith('LineTool') && source.state.symbol === deletedSymbol),
      };
    };
    const state = window.__MIRROR_SCOPED__;
    return {
      futures: await read('chart_futures'), delivery: await read('chart_delivery'),
      writer: state.writer ? state.writer.getStats() : null,
    };
  }, { drawingKey, deletedSymbol });
}

async function attachResult(testInfo, mode, scenario, result) {
  const evidence = { mode, scenario, ...result };
  await testInfo.attach(`drawing-deletion-${mode}-${scenario}.json`, {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  console.info(JSON.stringify({
    mode, scenario,
    states: Object.fromEntries(Object.entries(result)
      .filter(([, value]) => value && typeof value === 'object' && Object.hasOwn(value, 'futures'))
      .map(([stage, value]) => [stage, {
        futuresStored: value.futures.stored.length, futuresLoaded: value.futures.loaded.length,
        deliveryStored: value.delivery.stored.length, deliveryLoaded: value.delivery.loaded.length,
        writer: value.writer,
      }])),
  }));
}

for (const mode of ['native', 'production', 'scoped-production']) {
  test(`user keeps twenty deleted drawings absent after another symbol saves and a new page opens with ${mode}`, async ({ page, context }, testInfo) => {
    // Given the complete host save and mirror persist twenty manual drawings in both databases.
    await openDrawingHost(page, mode);
    const other = await context.newPage();
    await openDrawingHost(other, mode);
    await saveDrawingSnapshot(page, snapshot('0', deletedSymbol, 20));
    const initial = await readDrawingState(page);
    expect(initial.futures.stored).toHaveLength(20);
    expect(initial.delivery.loaded).toHaveLength(20);

    // When deletion fully commits and another same-namespace symbol saves before the deleting page closes.
    await saveDrawingSnapshot(page, snapshot('0', deletedSymbol, 0));
    const deleted = await readDrawingState(page);
    await saveDrawingSnapshot(other, snapshot('1', otherSymbol, 1));
    const afterOtherSave = await readDrawingState(other);
    await page.close();
    const reopened = await context.newPage();
    await openDrawingHost(reopened, mode);
    const reloaded = await readDrawingState(reopened);
    await attachResult(testInfo, mode, 'completed-save', {
      initialCount: initial.futures.stored.length, deleted, afterOtherSave, reloaded,
    });

    // Then both actual stored arrays and host load results stay empty after the original page is destroyed.
    for (const state of [deleted, afterOtherSave, reloaded]) {
      expect(state.futures).toEqual({ stored: [], loaded: [] });
      expect(state.delivery).toEqual({ stored: [], loaded: [] });
    }
    if (mode !== 'native') {
      expect(deleted.writer).toMatchObject({ acceptedBatches: 2, committedTransactions: 2, pendingBatches: 0, failedBatches: 0 });
      expect(afterOtherSave.writer).toMatchObject({ acceptedBatches: 1, committedTransactions: 1, pendingBatches: 0, failedBatches: 0 });
    } else {
      expect(deleted.writer).toBe(null);
    }
    await other.close();
    await reopened.close();
  });

  test(`user receives stale opposite-namespace drawings after a source-only deletion with ${mode}`, async ({ page, context }, testInfo) => {
    // Given both namespaces retain the complete initial twenty-drawing save.
    await openDrawingHost(page, mode);
    const other = await context.newPage();
    await openDrawingHost(other, mode, 'chart_delivery');
    await saveDrawingSnapshot(page, snapshot('0', deletedSymbol, 20));
    const drawings = chart('0', deletedSymbol, 20).panes[0].sources.slice(1);
    const initial = await readDrawingState(page);
    expect(initial.futures).toEqual({ stored: drawings, loaded: drawings });
    expect(initial.delivery).toEqual({ stored: drawings, loaded: drawings });

    // When only the public source-save stage commits deletion before close and the other namespace later mirrors.
    await page.evaluate(save => window.__DRAWING_HOST__.api.save({
      storage: window.__DRAWING_HOST__.storage, save, key: 'myTradingView', widget: {},
    }), snapshot('0', deletedSymbol, 0));
    const deleted = await readDrawingState(page);
    await page.close();
    await saveDrawingSnapshot(other, snapshot('1', otherSymbol, 1));
    const afterOtherSave = await readDrawingState(other);
    const reopened = await context.newPage();
    await openDrawingHost(reopened, mode);
    const reloaded = await readDrawingState(reopened);
    await attachResult(testInfo, mode, 'source-only-save', {
      scope: 'Separate from the retained-snapshot incident: the public source-save stage is invoked directly; no interrupted callback or live close timing is inferred.',
      initial, deleted, afterOtherSave, reloaded,
    });

    // Then an actual old mirror restores all twenty drawings while both modes expose the same overwrite behavior.
    expect(deleted.futures).toEqual({ stored: [], loaded: [] });
    expect(deleted.delivery).toEqual({ stored: drawings, loaded: drawings });
    expect(afterOtherSave.futures).toEqual({ stored: drawings, loaded: drawings });
    expect(reloaded.futures).toEqual({ stored: drawings, loaded: drawings });
    expect(reloaded.delivery).toEqual({ stored: drawings, loaded: drawings });
    if (mode !== 'native') {
      expect(deleted.writer).toMatchObject({ acceptedBatches: 1, committedTransactions: 1, pendingBatches: 0, failedBatches: 0 });
      expect(afterOtherSave.writer).toMatchObject({ acceptedBatches: 1, committedTransactions: 1, pendingBatches: 0, failedBatches: 0 });
    } else {
      expect(afterOtherSave.writer).toBe(null);
    }
    await reopened.close();
    await other.close();
  });

  const retainedOutcome = mode === 'scoped-production' ? 'keeps deleted drawings absent' : 'receives deleted drawings';
  test(`user ${retainedOutcome} after another symbol saves its retained same-namespace snapshot with ${mode}`, async ({ page, context }, testInfo) => {
    // Given the native loader retains historical drawings sharing the current chart's ownerSource across symbols.
    await openDrawingHost(page, mode);
    const other = await context.newPage();
    await openDrawingHost(other, mode);
    const mainSourceId = 'ZmamTt';
    const initialChart = chart('0', deletedSymbol, 20, mainSourceId);
    const drawings = initialChart.panes[0].sources.slice(1);
    await saveDrawingSnapshot(page, { layout: 's', charts: [initialChart] });
    await saveDrawingSnapshot(other, { layout: 's', charts: [chart('0', otherSymbol, 0, mainSourceId)] });
    const retained = await other.evaluate(async () => {
      const state = window.__DRAWING_HOST__;
      const loaded = await state.api.load({ storage: state.storage, key: 'myTradingView' });
      state.retainedSnapshot = JSON.parse(JSON.stringify(loaded.chartSave));
      return state.retainedSnapshot;
    });
    expect(retained).toEqual({
      layout: 's',
      charts: [{
        chartId: '0', panes: [{
          mainSourceId,
          sources: [{ id: mainSourceId, type: 'MainSeries', state: { symbol: otherSymbol } }, ...drawings],
        }],
      }],
    });

    // When deletion commits in both databases before the other symbol saves its previously loaded hidden drawings.
    await saveDrawingSnapshot(page, { layout: 's', charts: [chart('0', deletedSymbol, 0, mainSourceId)] });
    const deleted = await readDrawingState(page);
    await page.close();
    await other.evaluate(() => window.__DRAWING_HOST__.save(window.__DRAWING_HOST__.retainedSnapshot));
    const afterOtherSave = await readDrawingState(other);
    const reopened = await context.newPage();
    await openDrawingHost(reopened, mode);
    const reloaded = await readDrawingState(reopened);
    await attachResult(testInfo, mode, 'retained-same-namespace-snapshot', {
      scope: 'Both tabs use chart_futures. A native load supplies the hidden historical drawings; every save awaits its complete native source and mirror workflow.',
      retained, deleted, afterOtherSave, reloaded,
    });

    // Then the scoped save preserves deletion while both unchanged baselines restore the exact old drawings.
    expect(deleted.futures).toEqual({ stored: [], loaded: [] });
    expect(deleted.delivery).toEqual({ stored: [], loaded: [] });
    const expectedDrawings = mode === 'scoped-production' ? [] : drawings;
    expect(afterOtherSave.futures).toEqual({ stored: expectedDrawings, loaded: expectedDrawings });
    expect(afterOtherSave.delivery).toEqual({ stored: expectedDrawings, loaded: expectedDrawings });
    expect(reloaded.futures).toEqual({ stored: expectedDrawings, loaded: expectedDrawings });
    expect(reloaded.delivery).toEqual({ stored: expectedDrawings, loaded: expectedDrawings });
    if (mode !== 'native') {
      expect(deleted.writer).toMatchObject({ acceptedBatches: 2, committedTransactions: 2, pendingBatches: 0, failedBatches: 0 });
      expect(afterOtherSave.writer).toMatchObject({ acceptedBatches: 2, committedTransactions: 2, pendingBatches: 0, failedBatches: 0 });
    } else {
      expect(afterOtherSave.writer).toBe(null);
    }
    await reopened.close();
    await other.close();
  });
}

test('user saves each chart current drawings before deduplication and preserves newer unrelated drawings', async ({ page, context }, testInfo) => {
  // Given native loads populate both charts with historical drawings sharing one owner and repeated drawing IDs.
  const mode = 'scoped-production';
  const historicalSymbol = 'BTCUSDT';
  const mainSourceId = 'ZmamTt';
  await openDrawingHost(page, mode);
  const other = await context.newPage();
  await openDrawingHost(other, mode);
  await saveDrawingSnapshot(page, { layout: '2h', charts: [chart('0', historicalSymbol, 1, mainSourceId)] });
  await saveDrawingSnapshot(page, {
    layout: '2h', charts: [chart('0', deletedSymbol, 1, mainSourceId), chart('1', otherSymbol, 1, mainSourceId)],
  });
  const retained = await page.evaluate(async () => {
    const { api, storage } = window.__DRAWING_HOST__;
    const loaded = await api.load({ storage, key: 'myTradingView' });
    return JSON.parse(JSON.stringify(loaded.chartSave));
  });
  const mainDrawing = (value, symbol) => value.panes[0].sources
    .find(source => source.type === 'LineToolTrendLine' && source.state.symbol === symbol);
  for (const value of retained.charts) {
    expect(value.panes[0].sources.filter(source => source.type === 'LineToolTrendLine')
      .map(source => source.state.symbol).sort()).toEqual([historicalSymbol, otherSymbol, deletedSymbol].sort());
  }
  mainDrawing(retained.charts[0], deletedSymbol).points[1].price = 101;
  mainDrawing(retained.charts[1], otherSymbol).points[1].price = 202;
  expect(mainDrawing(retained.charts[0], otherSymbol).points[1].price).toBe(25);
  const study = { id: 'rsi-study', type: 'Study', state: { studyId: 'RSI@tv-basicstudies', length: 14 } };
  const indicatorDrawing = {
    ...chart('0', deletedSymbol, 1, 'rsi-owner').panes[0].sources[1], id: 'manual-MUBARAKUSDT-rsi',
  };
  retained.charts[0].panes.push({ mainSourceId: 'rsi-owner', sources: [study, indicatorDrawing] });
  const latestHistorical = chart('0', historicalSymbol, 1, mainSourceId);
  latestHistorical.panes[0].sources[1].points[1].price = 303;

  // When another tab updates the historical symbol before both current charts save their retained serialized state.
  await saveDrawingSnapshot(other, { layout: 's', charts: [latestHistorical] });
  await saveDrawingSnapshot(page, retained);
  const readPersisted = async () => page.evaluate(async symbols => {
    const read = async name => {
      const storage = window.__STORAGE_LAB__.localforage.createInstance({ name });
      return {
        drawings: Object.fromEntries(await Promise.all(symbols.map(async symbol => [symbol, await storage.getItem(`#TV_SYMBOL-${symbol}`)]))),
        snapshot: await storage.getItem('myTradingView'),
        loaded: await window.__DRAWING_HOST__.api.load({ storage, key: 'myTradingView' }),
      };
    };
    return { futures: await read('chart_futures'), delivery: await read('chart_delivery') };
  }, [deletedSymbol, otherSymbol, historicalSymbol]);
  const saved = await readPersisted();

  // Then each current chart keeps its edited value and indicator drawing while the historical database value stays newer.
  const expectedDrawings = {
    [deletedSymbol]: [mainDrawing(retained.charts[0], deletedSymbol), indicatorDrawing],
    [otherSymbol]: [mainDrawing(retained.charts[1], otherSymbol)],
    [historicalSymbol]: [latestHistorical.panes[0].sources[1]],
  };
  for (const database of [saved.futures, saved.delivery]) {
    expect(database.drawings).toEqual(expectedDrawings);
    expect(database.snapshot.charts[0].panes[1]).toEqual({ mainSourceId: 'rsi-owner', sources: [study] });
    expect(database.loaded.chartSave.charts[0].panes[1]).toEqual({ mainSourceId: 'rsi-owner', sources: [study, indicatorDrawing] });
  }

  // When the first chart removes all its current drawings while the other chart still carries their hidden old copies.
  const cleared = JSON.parse(JSON.stringify(retained));
  for (const pane of cleared.charts[0].panes) {
    pane.sources = pane.sources.filter(source => !source.type.startsWith('LineTool') || source.state.symbol !== deletedSymbol);
  }
  await saveDrawingSnapshot(page, cleared);
  const deleted = await readPersisted();
  await testInfo.attach('drawing-multichart-scoped-production.json', {
    body: JSON.stringify({ retained, saved, deleted }, null, 2), contentType: 'application/json',
  });

  // Then an explicit empty array survives hidden duplicate IDs without changing the other current or historical symbols.
  for (const database of [deleted.futures, deleted.delivery]) {
    expect(database.drawings).toEqual({ ...expectedDrawings, [deletedSymbol]: [] });
    expect(database.loaded.chartSave.charts[0].panes[1]).toEqual({ mainSourceId: 'rsi-owner', sources: [study] });
  }
  await other.close();
});

test('user keeps persisted drawings when an entire saved chart lacks its MainSeries symbol', async ({ page }) => {
  // Given a valid saved chart has drawing records and a malformed replacement retains drawings without any MainSeries.
  await openDrawingHost(page, 'scoped-production');
  await saveDrawingSnapshot(page, snapshot('0', deletedSymbol, 2));
  const before = await readDrawingState(page);
  const malformed = await page.evaluate(async () => {
    const { api, storage } = window.__DRAWING_HOST__;
    const loaded = await api.load({ storage, key: 'myTradingView' });
    const value = JSON.parse(JSON.stringify(loaded.chartSave));
    for (const pane of value.charts[0].panes) {
      pane.sources = pane.sources.filter(source => source.type !== 'MainSeries');
    }
    return value;
  });

  // When the public save callback receives the unsupported whole-chart shape.
  await expect(saveDrawingSnapshot(page, malformed)).rejects.toThrow('Drawing save requires a MainSeries symbol for its chart');
  const after = await readDrawingState(page);

  // Then the error leaves both databases and the committed mirror counters exactly as they were before the save.
  expect(after).toEqual(before);
  expect(after.futures.stored).toEqual(chart('0', deletedSymbol, 2).panes[0].sources.slice(1));
  expect(after.writer).toMatchObject({ acceptedBatches: 1, committedTransactions: 1, pendingBatches: 0, failedBatches: 0 });
});
