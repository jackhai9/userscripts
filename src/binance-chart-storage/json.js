const encoder = new TextEncoder();
const nativeObjectSource = Function.prototype.toString.call(Object);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** TradingView snapshots may originate in an iframe with a different Object prototype. */
function isPlainJsonObject(value) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!constructor || !Object.hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return false;
  if (Function.prototype.toString.call(constructor.value) !== nativeObjectSource) return false;
  const descriptor = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
  return !!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === prototype;
}

export function byteLength(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * Snapshot only JSON trees without invoking getters or changing structured-clone
 * identity. A global seen set rejects aliases as well as cycles. The shared byte
 * budget bounds traversal before cloning the rest of an oversized snapshot.
 */
export function snapshotJson(value, budget = { remaining: Infinity }, seen = new Set()) {
  function consume(bytes) {
    budget.remaining -= bytes;
    assert(budget.remaining >= 0, 'Chart JSON byte limit exceeded');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    assert(typeof value !== 'number' || Number.isFinite(value), 'Chart JSON numbers must be finite');
    consume(byteLength(value));
    return value;
  }
  assert(typeof value === 'object', 'Chart values must be JSON');
  assert(!seen.has(value), 'Chart JSON must not contain shared references or cycles');
  const array = Array.isArray(value);
  assert(array || isPlainJsonObject(value), 'Chart values must be plain JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert(Object.getOwnPropertySymbols(value).length === 0, 'Chart JSON must not contain symbol properties');
  const keys = Object.keys(descriptors).filter(key => !(array && key === 'length'));
  if (array) assert(keys.length === value.length && keys.every((key, index) => key === String(index)), 'Chart JSON arrays must be dense');
  seen.add(value);
  consume(2 + Math.max(0, keys.length - 1));
  const result = array ? [] : {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    assert(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Chart JSON requires enumerable data properties');
    if (!array) consume(byteLength(key) + 1);
    Object.defineProperty(result, key, {
      value: snapshotJson(descriptor.value, budget, seen), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

/** Signed zero and property insertion order remain observable through native reads. */
export function equalJson(first, second) {
  if (Object.is(first, second)) return true;
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return firstKeys.length === secondKeys.length
    && firstKeys.every((key, index) => key === secondKeys[index] && equalJson(first[key], second[key]));
}
