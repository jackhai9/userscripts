import assert from 'node:assert/strict';

/** Observe native JSDOM intervals while Node owns the actual scheduling clock. */
export function installStrategyClock(t, view, now = 7000) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
  const setInterval = view.setInterval;
  const clearInterval = view.clearInterval;
  const intervals = new Map();
  view.setInterval = function schedule(callback, milliseconds, ...args) {
    const id = Reflect.apply(setInterval, this, [callback, milliseconds, ...args]);
    intervals.set(id, { milliseconds });
    return id;
  };
  view.clearInterval = function cancel(id) {
    Reflect.apply(clearInterval, this, [id]);
    intervals.delete(id);
  };
  return {
    intervals,
    advance: milliseconds => t.mock.timers.tick(milliseconds),
    setTime: milliseconds => t.mock.timers.setTime(milliseconds),
  };
}

/** Count real selector queries without changing native selection or errors. */
export function observeStrategyQueries(document) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(document, 'querySelectorAll');
  const query = document.querySelectorAll;
  const counts = new Map();
  document.querySelectorAll = function querySelectorAll(selector) {
    counts.set(selector, (counts.get(selector) || 0) + 1);
    return Reflect.apply(query, this, [selector]);
  };
  return {
    count: selector => counts.get(selector) || 0,
    reset: () => counts.clear(),
    restore() {
      if (ownDescriptor) Object.defineProperty(document, 'querySelectorAll', ownDescriptor);
      else delete document.querySelectorAll;
    },
  };
}

/** The sandbox cancels each prompt; any page-realm prompt is an explicit failure. */
export function createStrategyPromptBoundary() {
  const messages = [];
  const pageAttempts = [];
  return {
    messages,
    pageAttempts,
    sandboxPrompt(message) { messages.push(message); return null; },
    pagePrompt(...args) {
      pageAttempts.push(args);
      throw new Error('Page prompt must not receive private input');
    },
  };
}

/** Hold one real digest result; algorithm/input validation remains WebCrypto's. */
export function createStrategyDigestGate(subtle, pauseAt) {
  assert.equal(Number.isInteger(pauseAt) && pauseAt > 0, true);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  return {
    calls,
    entered: entered.promise,
    release: () => release.resolve(),
    subtle: {
      async digest(...args) {
        const ordinal = calls.push(args);
        const result = await Reflect.apply(subtle.digest, subtle, args);
        if (ordinal === pauseAt) {
          entered.resolve();
          await release.promise;
        }
        return result;
      },
    },
  };
}

/** Observe completion across host jobs; elapsed time bounds failure only. */
export async function observeStrategyCondition(predicate, description) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Strategy completion deadline exceeded: ${description}`);
    await new Promise(setImmediate);
  }
}

/** Execute a rejecting contract once so its actual error can be asserted in Then. */
export function captureStrategyError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the strategy operation to reject its input');
}

/** Tampermonkey request boundary exposes host callbacks without settling them for the caller. */
export function createStrategyGmBoundary() {
  const requests = [];
  return {
    requests,
    request(options) {
      const record = {
        options,
        abortCalls: 0,
        load: response => options.onload(response),
        error: () => options.onerror(),
        timeout: () => options.ontimeout(),
        abort() { record.abortCalls += 1; options.onabort(); },
      };
      requests.push(record);
      return { abort: () => record.abort() };
    },
  };
}

/** Expose raw native shape outputs, including malformed values, without repairing them. */
export function createStrategyShapeBoundary({
  shapeId = 'native-shape',
  points = [{ time: 10, price: 1.25 }],
  listedShapes = [{ id: shapeId }],
} = {}) {
  const created = [];
  const removed = [];
  const shape = { getPoints: () => points };
  return {
    created,
    removed,
    chart: {
      async createShape(point, options) {
        created.push({ point, options });
        return shapeId;
      },
      getShapeById(id) {
        assert.equal(id, shapeId);
        return shape;
      },
      getAllShapes: () => listedShapes,
      removeEntity: id => removed.push(id),
    },
  };
}
