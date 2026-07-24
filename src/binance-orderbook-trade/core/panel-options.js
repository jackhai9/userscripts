export function normalizeSymbolSide(value) {
  return String(value || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
}

export function symbolSideStorageKey(baseKey, symbol) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  return normalizedSymbol ? `${baseKey}:${normalizedSymbol}` : null;
}

export function loadSymbolSide(storage, baseKey, symbol, fallback) {
  const storageKey = symbolSideStorageKey(baseKey, symbol);
  if (!storageKey) return normalizeSymbolSide(fallback);
  const stored = storage.getItem(storageKey);
  return normalizeSymbolSide(stored === null ? fallback : stored);
}

export function saveSymbolSide(storage, baseKey, symbol, value) {
  const storageKey = symbolSideStorageKey(baseKey, symbol);
  if (!storageKey) return false;
  storage.setItem(storageKey, normalizeSymbolSide(value));
  return true;
}

export function isSymbolScopedSideStorageKey(key, baseKeys) {
  return !!key && baseKeys.some((baseKey) => key.startsWith(`${baseKey}:`));
}
