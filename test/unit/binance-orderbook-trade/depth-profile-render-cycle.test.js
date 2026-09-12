import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');

function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail('function declaration must be complete');
}

function harness() {
  const view = { isConnected: true };
  const frame = {};
  const geometryReads = [];
  const painted = [];
  let nextHeight = 400;
  const context = vm.createContext({
    document: { hidden: false },
    depthProfileView: view, depthProfileFrame: frame,
    depthProfileEnabled: true, depthProfileData: { symbol: '4USDT', bids: [], asks: [] },
    depthProfileSession: { symbol: '4USDT', isActive: () => true },
    depthProfileFailedSymbol: null,
    isFuturesTradingPage: () => true,
    ensureDepthProfileObserver() {},
    findDepthProfileHost: () => ({ frame, host: {} }),
    getTradingViewDepthProfileGeometry: receivedFrame => {
      assert.equal(receivedFrame, frame);
      const geometry = nextHeight === null ? null : { height: nextHeight, top: 0, rightInset: 60 };
      geometryReads.push(geometry);
      return geometry;
    },
    ensureDepthProfileView: () => view,
    setDepthProfileGeometry() {},
    depthProfileStatusPresentation: () => ({ text: '', title: '' }),
    localizedText: (_zh, en) => en,
    ui: value => value,
    setDepthProfileViewState() {},
    getCurrentDepthProfilePrice: () => 42,
    renderDepthProfile: (receivedView, data, geometry, price) => {
      assert.equal(receivedView, view);
      assert.equal(data.symbol, '4USDT');
      assert.equal(price, 42);
      painted.push(geometry);
    },
    clearDepthProfile() {},
    scheduleDepthProfileSync() {},
    getCurrentSymbol: () => '4USDT',
    stopDepthProfileSession() {},
    removeDepthProfileRuntimeView: () => { context.depthProfileView = null; },
    err: (_label, error) => { throw error; },
  });
  const renderStart = source.indexOf('  function renderDepthProfileUi(');
  const renderEnd = source.indexOf('  function scheduleDepthProfileRender(', renderStart);
  vm.runInContext(source.slice(renderStart, renderEnd), context);
  vm.runInContext(declaration('syncDepthProfile'), context);
  return { context, geometryReads, painted, view, setHeight: height => { nextHeight = height; } };
}

test('depth synchronization measures geometry once and paints that exact snapshot', () => {
  const h = harness();
  h.context.syncDepthProfile();
  assert.equal(h.geometryReads.length, 1);
  assert.equal(h.painted.length, 1);
  assert.equal(h.painted[0], h.geometryReads[0]);
  assert.equal(h.painted[0].height, 400);
});

test('the next independent depth render samples changed geometry again', () => {
  const h = harness();
  h.context.syncDepthProfile();
  h.setHeight(600);
  h.context.renderDepthProfileUi();
  assert.equal(h.geometryReads.length, 2);
  assert.deepEqual(h.painted.map(geometry => geometry.height), [400, 600]);
  assert.equal(h.painted[1], h.geometryReads[1]);
});

test('unavailable geometry, detached view and hidden documents do not paint', () => {
  const h = harness();
  h.setHeight(null);
  h.context.syncDepthProfile();
  assert.equal(h.geometryReads.length, 1);
  assert.equal(h.context.depthProfileView, null);
  assert.equal(h.painted.length, 0);
  h.context.renderDepthProfileUi();
  assert.equal(h.geometryReads.length, 1);
  h.context.document.hidden = true;
  h.context.syncDepthProfile();
  assert.equal(h.geometryReads.length, 1);
});
