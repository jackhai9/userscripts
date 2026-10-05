import assert from 'node:assert/strict';

/** The inspected Binance save API invokes a callback synchronously with JSON chart state. */
export function createTradingViewApi() {
  const listeners = new Map();
  const calls = [];
  const snapshot = { drawings: [{ id: 'user-line', points: [1, 2] }] };
  const tools = new Map();
  let failure = null;
  const api = {
    activeChart() { return { getShapeById(id) {
      if (!tools.has(id)) throw new Error('There is no such shape');
      return { lineDataSource: () => ({ toolname: tools.get(id) }) };
    } }; },
    saveChart(callback, options) {
      calls.push({ receiver: this, args: [...arguments] });
      if (failure) throw failure;
      if (typeof callback !== 'function') throw new TypeError('Native callback required');
      return callback(JSON.parse(JSON.stringify(options?.includeDrawings === false ? { drawings: [] } : snapshot)));
    },
    subscribe(name, callback) {
      assert.equal(name, 'drawing_event');
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    unsubscribe(name, callback) { listeners.get(name).delete(callback); },
    emit(name, ...args) { for (const callback of [...(listeners.get(name) || [])]) callback(...args); },
  };
  return {
    api, calls, saved: calls, snapshot, listeners,
    setSaveFailure(error) { failure = error; },
    setDrawingToolName(id, name) { tools.set(id, name); },
    event(type = 'remove') { api.emit('drawing_event', 'order-1', type); },
  };
}

export function createManualTimers() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const setTimeoutFn = (callback, delayMs) => {
    sequence += 1;
    timers.set(sequence, { callback, at: now + delayMs });
    return sequence;
  };
  const clearTimeoutFn = (timerId) => timers.delete(timerId);
  const advance = (elapsedMs) => {
    const deadline = now + elapsedMs;
    while (true) {
      const next = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= deadline)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [timerId, timer] = next;
      timers.delete(timerId);
      now = timer.at;
      timer.callback();
    }
    now = deadline;
  };
  return { advance, clearTimeoutFn, setTimeoutFn, timers };
}

