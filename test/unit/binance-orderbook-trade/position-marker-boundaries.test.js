import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeAutoOpenLeveragePositionState,
  resolveSymbolPositionSideStatus,
  resolveSymbolPositionStatus,
} from '../../../src/binance-orderbook-trade/core/auto-open-leverage.js';
import {
  afterTradingViewMarkerSaves,
  getTradingViewMarkerSaveController,
  installTradingViewMarkerSaveController,
} from '../../../src/shared/chart-marker-save-controller.js';
import {
  classifyOrderFeedback,
  isReduceOnlyOpenOrdersConflictFeedback,
  summarizeBinancePlaceOrderPayload,
} from '../../../src/binance-orderbook-trade/core/order-feedback.js';

const CONTROLLER_SLOT = Symbol.for('jh-userscripts.chart-marker-save-controller');

/** Model only the native serialization API and its synchronous callback contract. */
function nativeMarkerHost() {
  const state = { drawings: [{ id: 'native-order', price: 10 }] };
  const calls = [];
  const api = {
    saveChart(callback, options) {
      calls.push({ receiver: this, options });
      return typeof callback === 'function' ? callback(structuredClone(state)) : undefined;
    },
  };
  return { state, calls, api };
}

test('user receives independent snapshots and synchronous results from the native marker host', () => {
  // Given the native host exposes one serializable chart and a callback-based save.
  const host = nativeMarkerHost();
  const receiver = {};
  const options = { includeDrawings: false };
  let first;

  // When two callers serialize the chart and the first changes its own returned snapshot.
  const result = host.api.saveChart.call(receiver, snapshot => {
    first = snapshot;
    snapshot.drawings[0].price = 20;
    return 'first-result';
  }, options);
  const second = host.api.saveChart(snapshot => snapshot);

  // Then native data, receiver, options, and callback results retain their exact contracts.
  assert.equal(result, 'first-result');
  assert.deepEqual(first, { drawings: [{ id: 'native-order', price: 20 }] });
  assert.deepEqual(second, { drawings: [{ id: 'native-order', price: 10 }] });
  assert.deepEqual(host.state, second);
  assert.notEqual(second, host.state);
  assert.deepEqual(host.calls, [{ receiver, options }, { receiver: host.api, options: undefined }]);
});

for (const variant of [
  { name: 'non-array aggregate data', read: () => resolveSymbolPositionStatus({ success: true, data: {} }, 'BTCUSDT'), message: '持仓接口数据格式异常' },
  { name: 'a missing aggregate symbol', read: () => resolveSymbolPositionStatus({ success: true, data: [] }, ''), message: '持仓接口缺少交易对' },
  { name: 'a rejected directional response', read: () => resolveSymbolPositionSideStatus({ success: false, data: [] }, 'BTCUSDT', 'LONG'), message: '持仓接口返回失败' },
  { name: 'a missing directional symbol', read: () => resolveSymbolPositionSideStatus({ success: true, data: [] }, '', 'SHORT'), message: '持仓接口缺少交易对' },
]) {
  test(`user rejects position evidence containing ${variant.name}`, () => {
    // Given a public position response is missing one required piece of evidence.
    const read = variant.read;

    // When the position resolver handles that response.
    const invoke = () => read();

    // Then the response cannot masquerade as a confirmed flat position.
    assert.throws(invoke, { name: 'PositionPayloadContractError', message: variant.message });
  });
}

for (const variant of [
  { amount: '1.000000000000000001', long: '1.000000000000000001', short: '0' },
  { amount: '-1.000000000000000002', long: '0', short: '1.000000000000000002' },
  { amount: '-0.000', long: '0', short: '0' },
]) {
  test(`user receives exact side quantities and matching-row counts for one-way amount ${variant.amount}`, () => {
    // Given one signed native position and one unrelated-symbol position coexist.
    const payload = {
      success: true,
      data: [
        { symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmount: variant.amount },
        { symbol: 'ETHUSDT', positionSide: 'BOTH', positionAmount: '100' },
      ],
    };

    // When both requested directions read the same authoritative one-way position.
    const long = resolveSymbolPositionSideStatus(payload, 'BTCUSDT', 'LONG');
    const short = resolveSymbolPositionSideStatus(payload, 'BTCUSDT', 'SHORT');

    // Then sign determines quantity while the one matching native row remains visible on both reads.
    assert.deepEqual(long, { status: variant.long === '0' ? 'flat' : 'has_position', matchingPositionCount: 1, positionQty: variant.long });
    assert.deepEqual(short, { status: variant.short === '0' ? 'flat' : 'has_position', matchingPositionCount: 1, positionQty: variant.short });
  });
}

test('user keeps the previous leverage observation when new evidence has no symbol or valid status', () => {
  // Given leverage tracking already knows that the current symbol has a position.
  const previous = { symbol: 'BTCUSDT', lastKnownStatus: 'has_position' };

  // When an incomplete symbol or unknown status reaches the public observation boundary.
  const missingSymbol = () => observeAutoOpenLeveragePositionState(previous, { symbol: '', status: 'flat' });
  const invalidStatus = () => observeAutoOpenLeveragePositionState(previous, { symbol: 'BTCUSDT', status: 'rejected' });

  // Then neither invalid observation starts a flat epoch or overwrites previous evidence.
  assert.throws(missingSymbol, { message: '自动杠杆检查缺少交易对' });
  assert.throws(invalidStatus, { message: '自动杠杆持仓状态无效：rejected' });
  assert.deepEqual(previous, { symbol: 'BTCUSDT', lastKnownStatus: 'has_position' });
});

for (const record of [
  { version: 2, controller: { runAfterIdle: () => 'other-protocol' } },
  { version: 1, controller: {} },
]) {
  test(`user rejects incompatible marker save protocol version ${record.version} without replacing its owner`, () => {
    // Given the chart already carries a different or incomplete shared controller record.
    const host = nativeMarkerHost();
    const original = host.api.saveChart;
    Object.defineProperty(host.api, CONTROLLER_SLOT, { value: record });

    // When reading or installing against that shared controller record.
    const read = () => getTradingViewMarkerSaveController(host.api);
    const install = () => installTradingViewMarkerSaveController(host.api);

    // Then both calls report the protocol mismatch and preserve native saving and the foreign record.
    const message = 'Incompatible TradingView marker save protocol; update both scripts and reload';
    assert.throws(read, { message });
    assert.throws(install, { message });
    assert.equal(host.api.saveChart, original);
    assert.equal(host.api[CONTROLLER_SLOT], record);
    assert.deepEqual(host.calls, []);
  });
}

test('user receives an explicit marker save error when the native serialization API is missing', () => {
  // Given the chart has not published a native serialization method.
  const api = {};

  // When the shared marker controller attempts installation.
  const install = () => installTradingViewMarkerSaveController(api);

  // Then no partial controller or invented save method is installed.
  assert.throws(install, { message: 'TradingView marker save API is unavailable' });
  assert.equal(getTradingViewMarkerSaveController(api), null);
  assert.deepEqual(Object.keys(api), []);
});

test('user retains native marker saving when the host refuses wrapper installation', () => {
  // Given the native host holds its serialization method through an accessor.
  const host = nativeMarkerHost();
  const original = host.api.saveChart;
  const attempts = [];
  Object.defineProperty(host.api, 'saveChart', {
    configurable: true,
    get: () => original,
    set: replacement => { attempts.push(replacement); },
  });

  // When the real installer attempts to acquire the native save method.
  const install = () => installTradingViewMarkerSaveController(host.api);

  // Then refusal is explicit and the original synchronous save API remains usable.
  assert.throws(install, { message: 'TradingView marker save wrapper could not be installed' });
  assert.equal(attempts.length, 1);
  assert.equal(host.api.saveChart, original);
  assert.equal(getTradingViewMarkerSaveController(host.api), null);
  assert.equal(host.api.saveChart(snapshot => snapshot.drawings[0].price), 10);
});

test('user cannot start a marker mutation while a foreign chart save owner is active', () => {
  // Given another chart operation owns the wrapper above the installed marker controller.
  const host = nativeMarkerHost();
  const controller = installTradingViewMarkerSaveController(host.api);
  const markerSave = host.api.saveChart;
  function foreignSave(...args) { return markerSave.apply(this, args); }
  host.api.saveChart = foreignSave;

  // When marker mutation is requested and the native owner makes an explicit save.
  const mutate = () => controller.beginMutation();
  const result = host.api.saveChart(snapshot => snapshot.drawings[0].id, { includeDrawings: true });

  // Then mutation is refused without interrupting the owner's synchronous serialization.
  assert.throws(mutate, { message: 'TradingView marker mutation overlaps a chart save owner' });
  assert.equal(result, 'native-order');
  assert.equal(host.api.saveChart, foreignSave);
  assert.equal(host.calls.length, 1);
  assert.deepEqual(controller.getStats(), {
    busy: false, mutations: 0, draining: 0, saveRequests: 0, serializations: 0,
    callbackCount: 0, failureCount: 0, pendingCallbacks: 0,
  });
});

test('user starts an idle chart operation immediately and holds mutation ownership until its action settles', async () => {
  // Given the marker controller is already idle before a chart operation starts.
  const host = nativeMarkerHost();
  const controller = installTradingViewMarkerSaveController(host.api);
  const gate = Promise.withResolvers();
  let actions = 0;

  // When the public drain enters its asynchronous action without a pending marker burst.
  const completion = afterTradingViewMarkerSaves(host.api, () => {
    actions += 1;
    return gate.promise;
  });

  // Then action startup is immediate and a concurrent marker mutation cannot enter.
  assert.equal(actions, 1);
  assert.equal(controller.getStats().draining, 1);
  assert.equal(controller.canMutate(), false);
  assert.throws(() => controller.beginMutation(), { message: 'TradingView marker mutation overlaps a chart save owner' });

  // When the actual chart action completes.
  gate.resolve('chart-operation-complete');
  const result = await completion;

  // Then the action result is preserved and idle mutation ownership is released.
  assert.equal(result, 'chart-operation-complete');
  assert.equal(controller.canMutate(), true);
  assert.equal(controller.getStats().draining, 0);
  assert.deepEqual(host.calls, []);
});

test('user cannot finish the same marker mutation twice or decrement another mutation count', t => {
  // Given one marker mutation has completed and still owns its native save tail.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = nativeMarkerHost();
  const controller = installTradingViewMarkerSaveController(host.api);
  const finish = controller.beginMutation();
  finish();

  // When a stale completion attempts to finish the same mutation again.
  const repeat = () => finish();

  // Then the duplicate is explicit and the completed mutation count remains zero.
  assert.throws(repeat, { message: 'TradingView marker mutation finished twice' });
  assert.equal(controller.getStats().mutations, 0);
  assert.equal(controller.getStats().busy, true);

  // When the native save tail reaches its full quiet deadline.
  t.mock.timers.tick(150);

  // Then no serialization is invented and the controller becomes idle.
  assert.equal(controller.getStats().busy, false);
  assert.deepEqual(host.calls, []);
});

test('user classifies explicit order success without requiring a submitted synonym', () => {
  // Given the native feedback names an order and successful completion directly.
  const messages = ['订单成功', 'Order success', '价格更新成功', 'Order failed after a success response'];

  // When the real feedback classifier evaluates each message.
  const classifications = messages.map(classifyOrderFeedback);

  // Then only order-specific success is accepted and explicit failure keeps precedence.
  assert.deepEqual(classifications, ['success', 'success', 'unknown', 'failure']);
});

test('user requires a reduce-only rejection before treating each native open-order hint as a conflict', () => {
  // Given native messages name distinct open-order hints and one unrelated margin failure.
  const messages = [
    '只减仓订单失败，请检查当前挂单。',
    '只减仓订单失败，请取消挂单后重试。',
    '只减仓订单失败，请检查未平仓头寸和挂单。',
    '保证金不足，请检查未平仓头寸和挂单。',
  ];

  // When the real classifier evaluates the independent native hints.
  const conflicts = messages.map(isReduceOnlyOpenOrdersConflictFeedback);

  // Then every supported hint requires the same reduce-only failure evidence.
  assert.deepEqual(conflicts, [true, true, true, false]);
});

test('user sees a null order response identified without fabricated success or data fields', () => {
  // Given the native response body is the JSON null value.
  const payload = JSON.parse('null');

  // When the public response summarizer prepares diagnostic evidence.
  const summary = summarizeBinancePlaceOrderPayload(payload);

  // Then the diagnostic retains the exact body type and no invented order fields.
  assert.deepEqual(summary, {
    payloadType: 'null', payloadKeys: [], dataKeys: [], success: null, code: null, message: null,
  });
});
