import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  createTradingViewEventLayer,
  findStrategy27ChartTarget,
} from '../../../src/binance-strategy27-events/dom/tradingview-event-layer.js';

function createChartDom({ resolution = '1S', symbol = 'BTRUSDT@PRICETYPE=LAST', shiftSeconds = 0 } = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><div><iframe></iframe></div></div>');
  const shapes = new Map();
  const removed = [];
  let nextId = 1;
  const chart = {
    resolution: () => resolution,
    symbol: () => symbol,
    async createShape(point, properties) {
      const id = `shape-${nextId++}`;
      let points = [{ ...point, time: point.time + shiftSeconds }];
      let currentProperties = { ...properties, text: properties.text ?? '' };
      shapes.set(id, {
        id,
        getPoints: () => points,
        setPoints: (value) => { points = value; },
        getProperties: () => currentProperties,
        setProperties: (value) => { currentProperties = { ...currentProperties, ...value }; },
      });
      return id;
    },
    getShapeById: (id) => shapes.get(id),
    removeEntity(id) { removed.push(id); shapes.delete(id); },
  };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = {
    activeChart: () => chart,
  };
  return { dom, chart, shapes, removed };
}

function annotation(overrides = {}) {
  return {
    markerShape: 'arrow_up',
    markerColor: '#0ECB81',
    markerTime: 10,
    markerPrice: 1.25,
    noteText: 'Strategy 27 event',
    noteTime: 10,
    notePrice: 1.25,
    ...overrides,
  };
}

test('requires an exact matching one-second TradingView chart', () => {
  const { dom } = createChartDom();
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  assert.equal(target.routeSymbol, 'BTRUSDT');
  assert.equal(target.resolution, '1S');

  const minute = createChartDom({ resolution: '1' });
  assert.throws(
    () => findStrategy27ChartTarget(minute.dom.window.document, 'BTRUSDT'),
    /one-second chart/,
  );
  const wrongSymbol = createChartDom({ symbol: 'BTCUSDT@PRICETYPE=LAST' });
  assert.throws(
    () => findStrategy27ChartTarget(wrongSymbol.dom.window.document, 'BTRUSDT'),
    /chart symbol/,
  );
});

test('one event owns one marker and one note that outcomes update in place', async () => {
  const { dom, shapes, removed } = createChartDom();
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await layer.renderOpened('event-a', annotation({ noteText: '' }), 10_000);
  assert.equal(shapes.size, 1);
  await layer.renderUpdated('event-a', annotation({ noteText: '' }), 11_000);
  assert.equal(shapes.size, 1);
  await layer.renderClosed('event-a', annotation({ noteText: 'closed' }), 12_000);
  assert.equal(shapes.size, 2);
  const ids = [...shapes.keys()];
  await layer.renderOutcome('event-a', annotation({ noteText: '5 秒：延续' }), 13_000);
  assert.deepEqual([...shapes.keys()], ids);
  assert.equal(shapes.get(ids[1]).getProperties().text, '5 秒：延续');

  layer.remove('event-a');
  assert.equal(shapes.size, 0);
  assert.equal(layer.size, 0);

  await layer.renderOpened('event-b', annotation(), 14_000);

  layer.clear();
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 3);
});

test('removes a shifted entity and reports chart alignment failure', async () => {
  const { dom, shapes, removed } = createChartDom({ shiftSeconds: -1 });
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await assert.rejects(
    layer.renderOpened('event-a', annotation(), 10_000),
    /chart time alignment/,
  );
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 1);
});
