import assert from 'node:assert/strict';
import test from 'node:test';
import { createTradingViewCompoundLayer } from '../../../src/binance-strategy27-events/dom/tradingview-compound-layer.js';
import { createTradingViewEventLayer } from '../../../src/binance-strategy27-events/dom/tradingview-event-layer.js';
import { createStrategy27OverlayHost } from '../../helpers/strategy27-overlay-host.js';

const annotation = (overrides = {}) => ({ markerShape: 'arrow_down', markerLabel: '候选高', markerColor: '#B71C3B', markerTime: 10, markerPrice: 1.25, ...overrides });
const fixture = options => createStrategy27OverlayHost(options);
const compound = (host, options = {}) => createTradingViewCompoundLayer(host.target, { maxCandidates: 80, ...options });
const coordinate = node => node.getAttribute('transform');

test('user cannot resurrect a failed compound overlay by changing language', async () => {
  // Given a valid candidate whose native projection later fails
  const host = fixture();
  const errors = [];
  const layer = compound(host, { onRenderError: error => errors.push(error.message) });
  await layer.renderCandidate('first', annotation(), 11000);
  host.overlay.setProjection({ price: () => NaN });
  host.overlay.events.priceRangeChanged.emit();
  host.overlay.flushFrames();
  assert.equal(host.markers().length, 0);
  // When language changes after the native projection becomes valid again
  host.overlay.setProjection({ price: price => 2000 - price * 1000 });
  layer.setLocale('en');
  // Then terminal rendering failure cannot recreate any overlay or subscription
  assert.equal(errors.length, 1);
  assert.equal(host.markers().length, 0);
  assert.equal(host.overlay.subscriptions, 0);
  layer.clear();
  host.close();
});

test('user renders ordinary and compound markers without mutating native drawings', async () => {
  // Given independent ordinary and compound layers beside a user drawing
  const host = fixture();
  const ordinary = createTradingViewEventLayer(host.target, { maxEvents: 80, maxAgeMs: 60000 });
  const layer = compound(host);
  // When both types render update reconcile and clear their owned presentation
  await ordinary.renderOpened('ordinary', annotation(), 11000);
  await layer.renderCandidate('candidate', annotation(), 11000);
  assert.equal(host.markers().length, 3);
  await ordinary.renderUpdated('ordinary', annotation(), 12000);
  await layer.reconcile();
  layer.setLocale('en');
  ordinary.clear();
  assert.equal(host.markers().length, 2);
  layer.clear();
  // Then no native shape or save API was called and the user drawing is unchanged
  assert.deepEqual([host.created.length, host.removed.length, host.saves.length], [0, 0, 0]);
  assert.deepEqual([...host.shapes.entries()], [['user-owned', { untouched: true }]]);
  assert.equal(host.markers().length, 0);
  assert.equal(host.overlay.subscriptions, 0);
  host.close();
});

test('user sees compound arrows centered outside candle edges with separate localized labels', async () => {
  // Given opposite compound candidates on one candle
  const host = fixture();
  const layer = compound(host);
  // When high and low candidate pairs are rendered
  await layer.renderCandidate('high', annotation(), 11000);
  await layer.renderCandidate('low', annotation({ markerShape: 'arrow_up', markerLabel: '候选低', markerColor: '#087F5B' }), 11000);
  // Then centered arrows and labels keep their original price anchors and styles
  assert.equal(layer.size, 2);
  assert.deepEqual(host.markers().map(coordinate), ['translate(100 674)', 'translate(100 634)', 'translate(100 826)', 'translate(100 844)']);
  assert.deepEqual(host.markers().map(node => [node.tagName, node.dataset.markerType, node.getAttribute('fill')]), [
    ['path', 'compound-icon', '#B71C3B'], ['text', 'compound-label', '#B71C3B'],
    ['path', 'compound-icon', '#087F5B'], ['text', 'compound-label', '#087F5B'],
  ]);
  assert.deepEqual(host.markers().filter(node => node.tagName === 'text').map(node => node.textContent), ['候选高', '候选低']);
  const original = host.markers();
  layer.setLocale('en');
  assert.deepEqual(host.markers(), original);
  assert.deepEqual(host.markers().filter(node => node.tagName === 'text').map(node => node.textContent), ['High candidate', 'Low candidate']);
  assert.equal(host.markers()[1].getAttribute('font-size'), '12');
  assert.equal(host.markers()[1].getAttribute('font-weight'), '700');
  layer.clear();
  host.close();
});

test('user retains compound slots when another candidate is removed and reuses the freed slot', async () => {
  // Given two independent high candidates on the same resolved candle
  const host = fixture();
  const layer = compound(host);
  await layer.renderCandidate('first', annotation(), 11000);
  await layer.renderCandidate('second', annotation(), 11001);
  const second = host.markers().filter(node => node.dataset.markerId.includes(':second:'));
  // When the first candidate is removed and replaced
  layer.remove('first');
  await layer.renderCandidate('third', annotation(), 11002);
  await layer.renderCandidate('second', annotation({ markerColor: '#000000' }), 11003);
  // Then surviving nodes stay fixed and the new candidate occupies slot zero
  assert.deepEqual(second.map(coordinate), ['translate(100 610)', 'translate(100 570)']);
  assert.deepEqual(host.markers().filter(node => node.dataset.markerId.includes(':second:')), second);
  assert.deepEqual(host.markers().filter(node => node.dataset.markerId.includes(':third:')).map(coordinate), ['translate(100 674)', 'translate(100 634)']);
  assert.equal(second[0].getAttribute('fill'), '#B71C3B');
  assert.equal(layer.size, 2);
  layer.clear();
  host.close();
});

test('user assigns separate slots when distinct no-trade seconds resolve to the same prior candle', async t => {
  // Given two decision seconds missing from the native candle series
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = fixture();
  const layer = compound(host);
  // When each candidate reaches its exact three second deadline
  const first = layer.renderCandidate('first', annotation({ markerTime: 11 }), 12000);
  t.mock.timers.tick(2999);
  assert.equal(host.markers().length, 0);
  t.mock.timers.tick(1);
  assert.equal(await first, true);
  const second = layer.renderCandidate('second', annotation({ markerTime: 12 }), 13000);
  t.mock.timers.tick(3000);
  // Then both candidates share candle time but keep distinct sixty-four pixel slots
  assert.equal(await second, true);
  assert.deepEqual(host.markers().map(coordinate), ['translate(100 674)', 'translate(100 634)', 'translate(100 610)', 'translate(100 570)']);
  assert.equal(host.overlay.events.dataUpdated.size, 1);
  layer.clear();
  assert.equal(host.overlay.events.dataUpdated.size, 0);
  host.close();
});

for (const reason of ['remove', 'clear', 'suspend', 'symbol']) {
  test(`user cancels an unfinished compound candidate after ${reason}`, async () => {
    // Given one completed candidate and a second awaiting candle data
    const host = fixture();
    const layer = compound(host);
    await layer.renderCandidate('first', annotation(), 11000);
    const pending = layer.renderCandidate('pending', annotation({ markerTime: 11 }), 12000);
    // When its lifecycle changes before the exact candle arrives
    if (reason === 'remove') layer.remove('pending');
    if (reason === 'clear') layer.clear();
    if (reason === 'suspend') layer.suspend();
    if (reason === 'symbol') host.setSymbol('ETHUSDT');
    host.candles.set(11, [11, 1.25, 1.3, 1.2, 1.25]);
    host.fireDataUpdated();
    // Then no incomplete pair is published and owned cleanup remains isolated
    assert.equal(await pending, false);
    assert.equal(host.markers().some(node => node.dataset.markerId.includes(':pending:')), false);
    assert.equal(layer.size, reason === 'clear' ? 0 : 1);
    layer.clear();
    assert.equal(host.overlay.subscriptions, 0);
    assert.deepEqual([...host.shapes.keys()], ['user-owned']);
    host.close();
  });
}

test('user preserves suspended compound history through zoom and language updates without accepting new candidates', async () => {
  // Given one completed candidate before a transport failure suspends presentation
  const host = fixture();
  const layer = compound(host);
  await layer.renderCandidate('first', annotation(), 11000);
  const original = host.markers();
  // When the suspended chart is zoomed and its display language changes
  layer.suspend();
  host.overlay.setProjection({ price: price => 2000 - price * 500 });
  host.overlay.events.modeChanged.emit();
  host.overlay.flushFrames();
  layer.setLocale('en');
  // Then existing history stays visible at its original prices and no candidate is added
  assert.deepEqual(host.markers(), original);
  assert.deepEqual(host.markers().map(coordinate), ['translate(100 1337)', 'translate(100 1317)']);
  assert.equal(original[1].textContent, 'High candidate');
  assert.equal(await layer.renderCandidate('second', annotation(), 12000), false);
  assert.equal(layer.size, 1);
  layer.remove('first');
  assert.equal(host.markers().length, 0);
  layer.clear();
  host.close();
});

test('user accepts eighty compound pairs and eighty ordinary arrows without native entity growth', async () => {
  // Given the maximum supported compound and ordinary capacities
  const host = fixture();
  const layer = compound(host);
  const ordinary = createTradingViewEventLayer(host.target, { maxEvents: 80, maxAgeMs: 60000 });
  // When all available candidate slots and ordinary events are filled
  for (let index = 0; index < 80; index += 1) {
    await layer.renderCandidate(String(index), annotation(), 11000 + index);
    await ordinary.renderOpened(String(index), annotation(), 11000 + index);
  }
  // Then bounded logical history is retained and offscreen pairs create no native entities
  assert.equal(layer.size, 80);
  assert.equal(ordinary.size, 80);
  assert.equal(host.overlay.pane.querySelectorAll('svg').length, 2);
  assert.equal(host.markers().length, 101);
  await assert.rejects(layer.renderCandidate('overflow', annotation(), 12000), /capacity exceeded/);
  assert.deepEqual([host.created.length, host.removed.length, host.saves.length], [0, 0, 0]);
  ordinary.clear();
  layer.clear();
  host.close();
});

for (const maxCandidates of [0, 81, 1.5]) {
  test(`user rejects unsupported compound capacity ${maxCandidates}`, () => {
    // Given a chart and an invalid retention capacity
    const host = fixture();
    // When compound presentation initializes
    const action = () => compound(host, { maxCandidates });
    // Then no layer or native entity is installed
    assert.throws(action, /capacity must be 1..80/);
    assert.equal(host.overlay.pane.querySelectorAll('svg').length, 0);
    host.close();
  });
}

for (const invalid of ['id', 'time', 'shape', 'label']) {
  test(`user rejects invalid compound ${invalid} before publishing presentation`, async () => {
    // Given a malformed candidate at the presentation boundary
    const host = fixture();
    const layer = compound(host);
    const id = invalid === 'id' ? '' : 'candidate';
    const time = invalid === 'time' ? 0 : 11000;
    const value = annotation(invalid === 'shape' ? { markerShape: 'triangle' } : invalid === 'label' ? { markerLabel: 'Unknown' } : {});
    // When that candidate is submitted
    const rendering = layer.renderCandidate(id, value, time);
    // Then its invalid contract fails before any visual ownership is accepted
    await assert.rejects(rendering, /identity\/time is invalid|direction\/label is invalid/);
    assert.equal(layer.size, 0);
    assert.equal(host.markers().length, 0);
    layer.clear();
    host.close();
  });
}

test('user rejects overlapping compound placement and resumes after the earlier wait is cancelled', async () => {
  // Given a candidate still waiting for its exact candle
  const host = fixture({ bars: [] });
  const layer = compound(host);
  const pending = layer.renderCandidate('waiting', annotation(), 11000);
  // When another caller attempts concurrent compound placement
  const concurrent = layer.renderCandidate('other', annotation(), 11001);
  // Then serialization is enforced and cancellation permits a subsequent valid candidate
  await assert.rejects(concurrent, /rendering must be serial/);
  layer.remove('waiting');
  assert.equal(await pending, false);
  host.candles.set(10, [10, 1.25, 1.3, 1.2, 1.25]);
  assert.equal(await layer.renderCandidate('fresh', annotation(), 11002), true);
  assert.deepEqual(host.markers().map(node => node.dataset.markerId), ['candidate:fresh:icon', 'candidate:fresh:label']);
  layer.clear();
  host.close();
});
