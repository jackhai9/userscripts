const encoder = new TextEncoder();
const nativeObjectSource = Function.prototype.toString.call(Object);
// Function source text is immutable, so each realm's Object constructor needs one check.
const nativeObjectConstructors = new WeakSet();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isNativeObjectConstructor(candidate) {
  if (nativeObjectConstructors.has(candidate)) return true;
  if (Function.prototype.toString.call(candidate) !== nativeObjectSource) return false;
  nativeObjectConstructors.add(candidate);
  return true;
}

/** TradingView snapshots may originate in an iframe with a different Object prototype. */
function isPlainJsonObject(value) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!constructor || !Object.hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return false;
  if (!isNativeObjectConstructor(constructor.value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
  return !!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === prototype;
}

export function byteLength(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * Exact UTF-8 size of `JSON.stringify(text)`. Short strings, which dominate chart
 * state, are counted without building the escaped text; at 256 code units native
 * encoding becomes faster for ASCII and still defines the exact same size. Well-formed
 * stringify uses two-byte escapes for quote, backslash and \b\t\n\f\r, six-byte \u
 * escapes for other controls and lone surrogates, and raw UTF-8 otherwise.
 */
function jsonStringByteLength(text) {
  if (text.length >= 256) return byteLength(text);
  let bytes = 2;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      if (code === 0x22 || code === 0x5c) bytes += 2;
      else if (code >= 0x20) bytes += 1;
      else bytes += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Finite numbers stringify exactly as `String(number)`, which is ASCII. */
function primitiveJsonByteLength(value) {
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return String(value).length;
  return jsonStringByteLength(value);
}

/**
 * Snapshot only JSON trees without invoking getters or changing structured-clone
 * identity. A global seen set rejects aliases as well as cycles. The shared byte
 * budget bounds traversal before cloning the rest of an oversized snapshot and
 * consumes the exact UTF-8 JSON size. Objects are built with data-property
 * creation, so a `__proto__` key stays an own value.
 */
export function snapshotJson(value, budget = { remaining: Infinity }, seen = new Set()) {
  function consume(bytes) {
    budget.remaining -= bytes;
    assert(budget.remaining >= 0, 'Chart JSON byte limit exceeded');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    assert(typeof value !== 'number' || Number.isFinite(value), 'Chart JSON numbers must be finite');
    consume(primitiveJsonByteLength(value));
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
  // A plain loop keeps one stack frame per nesting level, as the native depth limit expects.
  const copies = [];
  for (const key of keys) {
    const descriptor = descriptors[key];
    assert(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Chart JSON requires enumerable data properties');
    if (array) {
      copies.push(snapshotJson(descriptor.value, budget, seen));
      continue;
    }
    consume(jsonStringByteLength(key) + 1);
    copies.push([key, snapshotJson(descriptor.value, budget, seen)]);
  }
  return array ? copies : Object.fromEntries(copies);
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
