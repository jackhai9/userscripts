const nativeObjectSource = Function.prototype.toString.call(Object);
// Function source text is immutable, so each realm's Object constructor needs one check.
const nativeObjectConstructors = new WeakSet();

function isNativeObjectConstructor(candidate) {
  if (nativeObjectConstructors.has(candidate)) return true;
  if (Function.prototype.toString.call(candidate) !== nativeObjectSource) return false;
  nativeObjectConstructors.add(candidate);
  return true;
}

/** Structured clones may come from an iframe realm with a different Object prototype. */
function isPlainJsonObject(value) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!constructor || !Object.hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return false;
  if (!isNativeObjectConstructor(constructor.value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
  return !!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === prototype;
}

/**
 * Compare two structured clones as JSON trees. Only primitives, arrays and plain
 * objects can be equal; dates, maps, blobs, holes or extra array properties never
 * are, so such records are always rewritten. Signed zero and property insertion
 * order stay significant because native reads expose both.
 */
export function equalJsonClones(first, second) {
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') {
    return Object.is(first, second);
  }
  const array = Array.isArray(first);
  if (Array.isArray(second) !== array) return false;
  if (!array && (!isPlainJsonObject(first) || !isPlainJsonObject(second))) return false;
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length || (array && firstKeys.length !== first.length)) return false;
  for (let index = 0; index < firstKeys.length; index += 1) {
    const key = firstKeys[index];
    if (secondKeys[index] !== key || !equalJsonClones(first[key], second[key])) return false;
  }
  return true;
}
