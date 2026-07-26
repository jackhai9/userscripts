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

export function modeSymbolOptionStorageKey(modeKeys, mode, symbol) {
  if (mode !== 'OPEN' && mode !== 'CLOSE') {
    throw new Error(`Unknown trade mode: ${mode}`);
  }
  const baseKey = modeKeys[mode];
  if (!baseKey) throw new Error(`Missing storage key for trade mode: ${mode}`);
  const normalizedSymbol = String(symbol || '').toUpperCase();
  return normalizedSymbol ? `${baseKey}:${normalizedSymbol}` : null;
}

export function loadModeSymbolNumberOption(storage, modeKeys, mode, symbol, options, fallback) {
  const storageKey = modeSymbolOptionStorageKey(modeKeys, mode, symbol);
  if (!storageKey) return fallback;
  const stored = Number(storage.getItem(storageKey));
  return options.includes(stored) ? stored : fallback;
}

export function saveModeSymbolNumberOption(storage, modeKeys, mode, symbol, value, options) {
  const numericValue = Number(value);
  if (!options.includes(numericValue)) return false;
  const storageKey = modeSymbolOptionStorageKey(modeKeys, mode, symbol);
  if (!storageKey) return false;
  storage.setItem(storageKey, String(numericValue));
  return true;
}

export function isModeSymbolOptionStorageKey(key, baseKeys) {
  return !!key && baseKeys.some((baseKey) => key.startsWith(`${baseKey}:`));
}
