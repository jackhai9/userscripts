import assert from 'node:assert/strict';
import test from 'node:test';
import { createTradingViewCompoundLayer } from '../../../src/binance-strategy27-events/dom/tradingview-compound-layer.js';
import { createTradingViewEventLayer } from '../../../src/binance-strategy27-events/dom/tradingview-event-layer.js';

const annotation = (overrides = {}) => ({ markerShape: 'arrow_down', markerLabel: '候选高', markerColor: '#B71C3B', markerTime: 10, markerPrice: 1.25, ...overrides });
const deferred = () => Promise.withResolvers();

function fixture({ bars = [[10, 1.25, 1.3, 1.2, 1.25]], beforeCreate, shiftSeconds = 0, wrongProperties = false, removeError } = {}) {
  const candles = new Map(bars.map((bar) => [bar[0], bar]));
  const shapes = new Map([['user-owned', { untouched: true }]]);
  const listeners = new Set();
  const created = [];
  const removed = [];
  let counter = 0;
  const chart = {
    async createShape(point, options) {
      counter += 1;
      const id = `owned-${counter}`;
      if (beforeCreate) await beforeCreate(counter);
      const properties = { ...options.overrides, ...(options.icon === undefined ? {} : { icon: options.icon }), ...(options.text === undefined ? {} : { text: options.text }) };
      if (wrongProperties) properties.color = '#000000';
      const shape = { getPoints: () => [{ ...point, time: point.time + shiftSeconds }], getProperties: () => properties };
      shapes.set(id, shape);
      created.push({ id, point, options });
      return id;
    },
    getShapeById: (id) => shapes.get(id),
    removeEntity(id) {
      assert.notEqual(id, 'user-owned');
      removed.push(id);
      if (removeError) throw removeError;
      assert.equal(shapes.delete(id), true, `duplicate/foreign removal: ${id}`);
    },
    getSeries: () => ({ data: () => ({ valueAt: (index) => candles.get(index) ?? null }) }),
    _chartWidget: { model: () => ({ model: () => ({
      timeScale: () => ({ timePointToIndex: (time, mode) => mode === 0 ? (candles.has(time) ? time : null) : ([...candles.keys()].filter((t) => t <= time).sort((a, b) => b - a)[0] ?? null) }),
      mainSeries: () => ({
        firstValue: () => 1,
        priceScale: () => ({ priceToCoordinate: (p) => 2000 - p * 1000, coordinateToPrice: (y) => (2000 - y) / 1000 }),
        dataUpdated: () => ({ subscribe: (_, callback) => listeners.add(callback), unsubscribe: (_, callback) => listeners.delete(callback) }),
      }),
    }) }) },
  };
  return { chart, shapes, listeners, created, removed, layer: (maxCandidates = 80) => createTradingViewCompoundLayer({ chart }, { maxCandidates, candleWaitMs: 1 }) };
}

test('native compound arrows are larger, centered outside the candle and own a separate short label', async () => {
  const f = fixture();
  const layer = f.layer();
  await layer.renderCandidate('high', annotation(), 11000);
  await layer.renderCandidate('low', annotation({ markerShape: 'arrow_up', markerLabel: '候选低', markerColor: '#087F5B' }), 11000);
  assert.equal(layer.size, 2);
  assert.equal(f.shapes.size, 5);
  assert.deepEqual(f.created.map((item) => item.point), [
    { time: 10, price: 1.326 }, { time: 10, price: 1.366 },
    { time: 10, price: 1.174 }, { time: 10, price: 1.156 },
  ]);
  assert.deepEqual(f.created.map((item) => item.options.shape), ['icon', 'text', 'icon', 'text']);
  assert.deepEqual(f.created.filter((item) => item.options.shape === 'icon').map((item) => [item.options.icon, item.options.overrides.size]), [[0xf063, 36], [0xf062, 36]]);
  assert.deepEqual(f.created.filter((item) => item.options.shape === 'text').map((item) => item.options.text), ['候选高', '候选低']);
  for (const { options } of f.created) {
    assert.equal(options.disableSave, true);
    assert.equal(options.disableUndo, true);
    assert.equal(options.disableSelection, true);
    assert.equal(options.showInObjectsTree, false);
    assert.equal(options.lock, true);
  }
  layer.clear();
  assert.deepEqual([...f.shapes.keys()], ['user-owned']);
  assert.equal(f.removed.length, 4);
});

test('same-time rules own independent fixed slots and eviction never moves surviving entities', async () => {
  const f = fixture();
  const layer = f.layer();
  await layer.renderCandidate('impact', annotation(), 11000);
  await layer.renderCandidate('passive', annotation(), 11000);
  await layer.renderCandidate('impact', annotation(), 11000);
  const survivor = f.created.slice(2).map((item) => ({ ...item.point }));
  assert.deepEqual(survivor, [{ time: 10, price: 1.39 }, { time: 10, price: 1.43 }]);
  layer.remove('impact');
  await layer.renderCandidate('reinforcement', annotation(), 11000);
  assert.deepEqual(f.created.slice(2, 4).map((item) => item.point), survivor);
  assert.deepEqual(f.created.slice(4).map((item) => item.point), f.created.slice(0, 2).map((item) => item.point));
  assert.equal(layer.size, 2);
  assert.equal(f.created.length, 6);
  assert.deepEqual(f.removed, ['owned-1', 'owned-2']);
});

test('different no-trade decision seconds sharing a prior candle receive distinct slots', async () => {
  const f = fixture();
  const layer = f.layer();
  await layer.renderCandidate('second-11', annotation({ markerTime: 11 }), 12000);
  await layer.renderCandidate('second-12', annotation({ markerTime: 12 }), 13000);
  assert.deepEqual(f.created.map((item) => item.point.time), [10, 10, 10, 10]);
  assert.deepEqual(f.created.filter((item) => item.options.shape === 'icon').map((item) => item.point.price), [1.326, 1.39]);
  assert.equal(f.listeners.size, 0);
});

test('remove cancels a pending candle wait without waiting for its deadline', async () => {
  const f = fixture({ bars: [] });
  const layer = f.layer();
  const result = layer.renderCandidate('waiting', annotation(), 11000);
  assert.equal(f.listeners.size, 1);
  layer.remove('waiting');
  assert.equal(await result, false);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.created.length, 0);
});

test('clear removes a native icon that finishes creation late and never creates its label', async () => {
  const entered = deferred();
  const release = deferred();
  const f = fixture({ beforeCreate: async () => { entered.resolve(); await release.promise; } });
  const layer = f.layer();
  const result = layer.renderCandidate('late', annotation(), 11000);
  await entered.promise;
  layer.clear();
  release.resolve();
  assert.equal(await result, false);
  assert.equal(layer.size, 0);
  assert.deepEqual(f.removed, ['owned-1']);
  assert.deepEqual([...f.shapes.keys()], ['user-owned']);
});

test('remove cancels a pending label and removes each part of the pair exactly once', async () => {
  const entered = deferred();
  const release = deferred();
  const f = fixture({ beforeCreate: async (count) => { if (count === 2) { entered.resolve(); await release.promise; } } });
  const layer = f.layer();
  const result = layer.renderCandidate('late-label', annotation(), 11000);
  await entered.promise;
  layer.remove('late-label');
  assert.deepEqual(f.removed, ['owned-1']);
  release.resolve();
  assert.equal(await result, false);
  assert.deepEqual(f.removed, ['owned-1', 'owned-2']);
  assert.deepEqual([...f.shapes.keys()], ['user-owned']);
});

test('partial label failure rolls back the already-created icon', async () => {
  const f = fixture({ beforeCreate: (count) => { if (count === 2) throw new Error('fixture label failure'); } });
  const layer = f.layer();
  await assert.rejects(layer.renderCandidate('partial', annotation(), 11000), /fixture label failure/);
  assert.deepEqual(f.removed, ['owned-1']);
  assert.equal(layer.size, 0);
  assert.deepEqual([...f.shapes.keys()], ['user-owned']);
});

test('shifted times and unsupported drawing properties roll back their own entity', async () => {
  for (const options of [{ shiftSeconds: 1 }, { wrongProperties: true }]) {
    const f = fixture(options);
    const layer = f.layer();
    await assert.rejects(layer.renderCandidate('bad', annotation(), 11000), options.shiftSeconds ? /time alignment failed/ : /drawing properties/);
    assert.equal(layer.size, 0);
    assert.deepEqual(f.removed, ['owned-1']);
    assert.deepEqual([...f.shapes.keys()], ['user-owned']);
  }
});

test('cleanup attempts both owned entities and reports failures without touching user drawings', async () => {
  const f = fixture({ removeError: new Error('fixture removal failure') });
  const layer = f.layer();
  await layer.renderCandidate('high', annotation(), 11000);
  assert.throws(() => layer.clear(), (error) => error instanceof AggregateError && error.errors.length === 2);
  assert.equal(layer.size, 0);
  assert.deepEqual(f.removed, ['owned-1', 'owned-2']);
  assert.equal(f.shapes.get('user-owned').untouched, true);
  layer.clear();
  assert.equal(f.removed.length, 2, 'unknown removals are not automatically retried');
});

test('80 compound pairs plus 80 ordinary markers have a strict 240-entity budget', async () => {
  const f = fixture();
  const ordinary = createTradingViewEventLayer({ chart: f.chart }, { maxEvents: 80, maxAgeMs: 7200000 });
  const layer = f.layer();
  for (let i = 0; i < 80; i += 1) {
    await ordinary.renderOpened(`ordinary-${i}`, annotation(), 11000);
    await layer.renderCandidate(`compound-${i}`, annotation(), 11000);
  }
  assert.equal(f.shapes.size, 241);
  assert.equal(layer.size, 80);
  assert.equal(ordinary.size, 80);
  await assert.rejects(layer.renderCandidate('over-budget', annotation(), 11000), /capacity exceeded/);
  layer.clear();
  assert.equal(f.shapes.size, 81);
  assert.equal(f.removed.length, 160);
  ordinary.clear();
  assert.deepEqual([...f.shapes.keys()], ['user-owned']);
});
