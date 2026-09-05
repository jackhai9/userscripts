import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadFixtureDom } from '../../helpers/dom.js';
import { createCompoundCandidateController } from '../../../src/binance-strategy27-events/core/compound-candidate-controller.js';
import { createStrategy27EventPanel } from '../../../src/binance-strategy27-events/dom/strategy27-event-panel.js';
import { Strategy27GatewayTransportError } from '../../../src/binance-strategy27-events/core/live-event-client.js';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-compound-candidates.json', import.meta.url), 'utf8'));
const EPOCH = 'a'.repeat(32);
const response = (body, status = 200) => ({ status, responseText: JSON.stringify(body) });
const bootstrap = (next = '1-0', epoch = EPOCH) => response({
  schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates',
  requested_cursor: null, next_cursor: next, runtime_epoch: epoch,
  last_sequence: 1, bootstrap_observed_at_ms: 7000, records: [],
});
const batch = (messages, from = '1-0', to = '2-0') => response({ schema_version: 1, status: 'ok', requested_cursor: from, next_cursor: to, messages });
const envelope = (payload = fixtures[0], sequence = 2, epoch = EPOCH) => ({
  schema_version: 1, projection_kind: 'compound_candidate', runtime_epoch: epoch,
  sequence, message_kind: 'candidate', symbol: payload.symbol, observed_at_ms: payload.decision.end_ms, payload,
});
const state = (sequence, epoch = EPOCH) => ({
  ...envelope(fixtures[0], sequence, epoch), message_kind: 'stream_state', symbol: null,
  payload: { state: 'ready', reason: 'startup' },
});
const deferred = () => Promise.withResolvers();

function harness(t, steps, { render, reconcile, createError, removeError, clearError, maxAgeMs = 7200000, maxCandidates = 80 } = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const panel = createStrategy27EventPanel(dom.window.document, dom.window.document.querySelector('.chart-widget-root'), {
    maxEvents: 8, maxCompoundEvents: 8, loadPosition: () => null, savePosition: () => {},
  });
  panel.upsert('ordinary-owned', {
    title: '订单流观察', eventTimeMs: 1, markerColor: '#0ECB81', summary: 'ordinary sentinel',
    forceRows: [], notices: [], closeText: null, triggerText: '',
  }, 1);
  const parked = deferred();
  const shapes = new Map();
  const renders = [];
  const removed = [];
  const calls = [];
  let layerCreates = 0;
  let layerClears = 0;
  let generation = 0;
  let pending = null;
  let clock = 7000;
  let current = true;
  let running;
  const controller = createCompoundCandidateController({
    gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'fixture-only-not-a-credential',
    canonicalSymbol: 'BTC/USDT:USDT', maxCandidates, maxAgeMs, reconnectDelayMs: 0,
    panel, isCurrent: () => current, nowMs: () => clock,
    request: async ({ url, signal }) => {
      calls.push(new URL(url));
      if (!steps.length) {
        parked.resolve();
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ status: 404, responseText: 'late response' }), { once: true }));
      }
      const step = steps.shift();
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step({ controller, panel, shapes, calls }) : step;
    },
    createLayer: () => {
      layerCreates += 1;
      if (createError) throw createError;
      return {
        async reconcile() { if (reconcile) await reconcile(); },
        async renderCandidate(id, annotation, decisionAtMs) {
          const token = { id, generation, cancelled: false };
          pending = token;
          renders.push({ id, annotation, decisionAtMs });
          if (render) await render({ controller, id, annotation });
          pending = null;
          if (token.cancelled || token.generation !== generation) return false;
          shapes.set(id, annotation);
          return true;
        },
        remove(id) {
          if (removeError) throw removeError;
          if (pending?.id === id) pending.cancelled = true;
          removed.push(id);
          shapes.delete(id);
        },
        clear() {
          layerClears += 1;
          generation += 1;
          shapes.clear();
          if (clearError) throw clearError;
        },
      };
    },
  });
  t.after(async () => {
    controller.stop('stopped');
    if (running) await running;
    dom.window.close();
  });
  return {
    controller, panel, shapes, renders, removed, calls,
    run: () => { running = controller.run(); return running; },
    parked: parked.promise,
    status: () => dom.window.document.querySelector('[data-role="compound-status"]').textContent,
    statusKind: () => dom.window.document.querySelector('[data-role="compound-status"]').dataset.state,
    compoundRows: () => [...dom.window.document.querySelectorAll('[data-role="compound-row"]')].map((row) => row.dataset.eventId),
    setClock: (value) => { clock = value; },
    setCurrent: (value) => { current = value; },
    get layerCreates() { return layerCreates; },
    get layerClears() { return layerClears; },
  };
}

test('controller composes real protocol/lifecycle/panel and renders each independent candidate once', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope(fixtures[0], 2), envelope(fixtures[1], 3), envelope(fixtures[0], 4)])]);
  h.run();
  await h.parked;
  assert.equal(h.panel.size, 1);
  assert.equal(h.panel.compoundSize, 2);
  assert.deepEqual([...h.shapes.keys()], fixtures.map((item) => item.candidate_id));
  assert.deepEqual(h.renders.map((item) => item.decisionAtMs), [7000, 7000]);
  assert.deepEqual(h.renders.map((item) => item.annotation.markerShape), ['arrow_down', 'arrow_up']);
  assert.equal(h.layerCreates, 1);
  assert.equal(h.status(), '复合候选已连接');
  assert.throws(() => h.controller.run(), /already started/);
  h.controller.stop('route_changed');
  assert.equal(h.shapes.size, 0);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.panel.size, 1);
});

test('unsupported gateways never construct a chart layer and leave ordinary data intact', async (t) => {
  const h = harness(t, [{ status: 404, responseText: '<html>old gateway</html>' }]);
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.layerCreates, 0);
  assert.equal(h.panel.size, 1);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.status(), '网关尚未启用复合候选');
  assert.equal(h.statusKind(), 'inactive');
});

test('same-decision panel ordering uses publication time without extending chart retention time', async (t) => {
  const high = { ...envelope(fixtures[0], 2), observed_at_ms: 7010 };
  const low = { ...envelope(fixtures[1], 3), observed_at_ms: 7020 };
  const h = harness(t, [bootstrap(), batch([high, low])]);
  h.setClock(7030);
  h.run();
  await h.parked;
  assert.deepEqual(h.compoundRows(), [fixtures[1].candidate_id, fixtures[0].candidate_id]);
  assert.deepEqual(h.renders.map((item) => item.decisionAtMs), [7000, 7000]);
});

test('503 clears compound state and recovers with a new cursor without clearing ordinary data', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()]), response({ schema_version: 1, status: 'error', error_code: 'compound_unavailable' }, 503),
    ({ panel, shapes, calls }) => {
      assert.equal(panel.size, 1);
      assert.equal(panel.compoundSize, 0);
      assert.equal(shapes.size, 0);
      assert.equal(calls.at(-1).searchParams.has('cursor'), false);
      return bootstrap('5-0', 'b'.repeat(32));
    }, batch([envelope(fixtures[1], 2, 'b'.repeat(32))], '5-0', '6-0')]);
  h.run();
  await h.parked;
  assert.equal(h.panel.compoundSize, 1);
  assert.deepEqual([...h.shapes.keys()], [fixtures[1].candidate_id]);
  assert.equal(h.status(), '复合候选已连接');
});

test('network reconnect retains compound history and original cursor', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()]), new Strategy27GatewayTransportError('fixture connection failure'),
    ({ panel, shapes, calls }) => {
      assert.equal(panel.compoundSize, 1);
      assert.equal(shapes.size, 1);
      assert.equal(calls.at(-1).searchParams.get('cursor'), '2-0');
      return batch([envelope(fixtures[0], 3)], '2-0', '3-0');
    }]);
  h.run();
  await h.parked;
  assert.equal(h.renders.length, 1);
  assert.equal(h.panel.size, 1);
});

test('stream reset clears compound view but preserves the newly accepted epoch sequence', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope(), state(1, 'b'.repeat(32)), envelope(fixtures[1], 2, 'b'.repeat(32))]),
    batch([envelope(fixtures[0], 2, 'b'.repeat(32))], '2-0', '3-0')]);
  await h.run();
  assert.equal(h.renders.length, 2);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.panel.size, 1);
  assert.match(h.status(), /sequence regression/);
  assert.equal(h.statusKind(), 'error');
});

test('contract and lazy renderer failures are terminal only for the compound job', async (t) => {
  for (const mode of ['protocol', 'renderer']) {
    const h = harness(t, mode === 'protocol' ? [{ status: 200, responseText: 'invalid JSON' }] : [bootstrap(), batch([envelope()])],
      mode === 'renderer' ? { createError: new Error('fixture chart capability missing') } : {});
    await h.run();
    assert.equal(h.panel.size, 1);
    assert.equal(h.panel.compoundSize, 0);
    assert.equal(h.statusKind(), 'error');
    assert.match(h.status(), mode === 'renderer' ? /fixture chart capability missing/ : /JSON/);
    assert.equal(h.calls.length, mode === 'renderer' ? 2 : 1);
  }
});

test('manual clear suppresses pending render and exact replay without restarting the stream', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope(), envelope(fixtures[0], 3), envelope(fixtures[1], 4)])], {
    render: ({ controller, id }) => { if (id === fixtures[0].candidate_id) controller.clear(); },
  });
  h.run();
  await h.parked;
  assert.equal(h.renders.length, 2);
  assert.deepEqual([...h.shapes.keys()], [fixtures[1].candidate_id]);
  assert.equal(h.panel.compoundSize, 1);
  assert.equal(h.panel.size, 1);
  assert.equal(h.calls.length, 3);
});

test('ordinary clear does not reset compound replay bookkeeping', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()]), ({ panel }) => {
    panel.clear();
    return batch([envelope(fixtures[0], 3)], '2-0', '3-0');
  }]);
  h.run();
  await h.parked;
  assert.equal(h.panel.size, 0);
  assert.equal(h.panel.compoundSize, 1);
  assert.equal(h.renders.length, 1);
});

test('manual clear during lifecycle hash validation suppresses late display and later exact replay', async (t) => {
  const validating = deferred();
  const release = deferred();
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let digestCalls = 0;
  t.mock.method(globalThis.crypto.subtle, 'digest', async (...args) => {
    digestCalls += 1;
    // Two gateway hashes precede the lifecycle's independent profile hash.
    if (digestCalls === 3) { validating.resolve(); await release.promise; }
    return digest(...args);
  });
  const h = harness(t, [bootstrap(), batch([envelope()]), batch([envelope(fixtures[0], 3)], '2-0', '3-0')]);
  h.run();
  await validating.promise;
  h.controller.clear();
  release.resolve();
  await h.parked;
  assert.equal(digestCalls, 8);
  assert.equal(h.renders.length, 0);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.panel.size, 1);
  assert.equal(h.calls.length, 4);
});

test('stale cursor reset removes old compound history and accepts the new stream', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()]),
    response({ schema_version: 1, status: 'reset', reason: 'stale_cursor', requested_cursor: '2-0', next_cursor: '7-0', messages: [] }, 409),
    ({ panel, shapes }) => {
      assert.equal(panel.compoundSize, 0);
      assert.equal(shapes.size, 0);
      assert.equal(panel.size, 1);
      return bootstrap('7-0', 'b'.repeat(32));
    }, batch([envelope(fixtures[1], 2, 'b'.repeat(32))], '7-0', '8-0')]);
  h.run();
  await h.parked;
  assert.deepEqual([...h.shapes.keys()], [fixtures[1].candidate_id]);
  assert.equal(h.panel.compoundSize, 1);
  assert.equal(h.statusKind(), 'normal');
});

test('stop during an asynchronous draw prevents late shapes and panel publication', async (t) => {
  const drawing = deferred();
  const release = deferred();
  const h = harness(t, [bootstrap(), batch([envelope()])], { render: async () => { drawing.resolve(); await release.promise; } });
  const done = h.run();
  await drawing.promise;
  h.setCurrent(false);
  h.controller.stop('interval_changed');
  release.resolve();
  await done;
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.shapes.size, 0);
  assert.equal(h.panel.size, 1);
  assert.equal(h.calls.length, 2);
});

test('age eviction during a pending draw prevents late publication and needs no new timer', async (t) => {
  const drawing = deferred();
  const release = deferred();
  const h = harness(t, [bootstrap(), batch([envelope()])], { maxAgeMs: 1000, render: async () => { drawing.resolve(); await release.promise; } });
  h.run();
  await drawing.promise;
  h.setClock(8001);
  h.controller.prune();
  release.resolve();
  await h.parked;
  assert.deepEqual(h.removed, [fixtures[0].candidate_id]);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.shapes.size, 0);
  assert.equal(h.panel.size, 1);
});

test('post-draw age check rejects a candidate that expired while rendering', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()])], { maxAgeMs: 1000, render: () => h.setClock(8001) });
  h.run();
  await h.parked;
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.shapes.size, 0);
  assert.deepEqual(h.removed, [fixtures[0].candidate_id]);
});

test('timer-driven prune failures stop only the optional job and do not escape to the shared context timer', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()])], { maxAgeMs: 1000, removeError: new Error('fixture removal failure') });
  const done = h.run();
  await h.parked;
  h.setClock(8001);
  assert.doesNotThrow(() => h.controller.prune());
  await done;
  assert.equal(h.panel.size, 1);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.shapes.size, 0);
  assert.equal(h.statusKind(), 'error');
  assert.match(h.status(), /fixture removal failure/);
});

test('capacity evictions remove only the evicted compound marker', async (t) => {
  const sorted = [...fixtures].sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
  const h = harness(t, [bootstrap(), batch(sorted.map((item, index) => envelope(item, index + 2)))], { maxCandidates: 1 });
  h.run();
  await h.parked;
  assert.deepEqual([...h.shapes.keys()], [sorted[1].candidate_id]);
  assert.deepEqual(h.removed, [sorted[0].candidate_id]);
  assert.equal(h.panel.compoundSize, 1);
  assert.equal(h.panel.size, 1);
});

test('manual clear and stop contain native cleanup failures without retrying removal', async (t) => {
  for (const action of ['clear', 'stop']) {
    const h = harness(t, [bootstrap(), batch([envelope()])], { clearError: new Error('fixture native cleanup failure') });
    const done = h.run();
    await h.parked;
    assert.doesNotThrow(() => h.controller[action]('route_changed'));
    await done;
    assert.equal(h.layerClears, 1);
    assert.equal(h.panel.size, 1);
    assert.equal(h.panel.compoundSize, 0);
    assert.equal(h.statusKind(), 'error');
    assert.match(h.status(), /fixture native cleanup failure/);
  }
});

test('terminal protocol failure preserves both the original and cleanup errors', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()]), { status: 200, responseText: 'invalid JSON' }], {
    clearError: new Error('fixture native cleanup failure'),
  });
  await assert.doesNotReject(h.run());
  assert.equal(h.layerClears, 1);
  assert.equal(h.panel.size, 1);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.statusKind(), 'error');
  assert.match(h.status(), /JSON/);
  assert.match(h.status(), /fixture native cleanup failure/);
});

test('late drawing failure after context retirement remains inspectable without updating the old panel', async (t) => {
  const drawing = deferred();
  const release = deferred();
  const failure = new Error('fixture late cleanup failure');
  const h = harness(t, [bootstrap(), batch([envelope()])], {
    render: async () => { drawing.resolve(); await release.promise; throw failure; },
  });
  const done = h.run();
  await drawing.promise;
  h.setCurrent(false);
  h.controller.stop('route_changed');
  const retiredStatus = h.status();
  release.resolve();
  await assert.doesNotReject(done);
  assert.equal(h.controller.lastError, failure);
  assert.equal(h.status(), retiredStatus);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.panel.size, 1);
});

test('timer repair failures stop only the compound job and retain ordinary history', async (t) => {
  const h = harness(t, [bootstrap(), batch([envelope()])], {
    reconcile: async () => { throw new Error('fixture native repair failure'); },
  });
  h.run();
  await h.parked;
  await h.controller.reconcile();
  assert.equal(h.panel.size, 1);
  assert.equal(h.panel.compoundSize, 0);
  assert.equal(h.shapes.size, 0);
  assert.equal(h.statusKind(), 'error');
  assert.match(h.status(), /fixture native repair failure/);
  assert.match(h.controller.lastError.message, /fixture native repair failure/);
});
