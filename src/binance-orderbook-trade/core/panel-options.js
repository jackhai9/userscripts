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

function normalizePrecisionScopeValue(precision) {
  const normalized = String(precision || '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) && Number(normalized) > 0
    ? normalized
    : null;
}

export function modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision) {
  if (mode !== 'OPEN' && mode !== 'CLOSE') {
    throw new Error(`未知交易模式：${mode}`);
  }
  const baseKey = modeKeys[mode];
  if (!baseKey) throw new Error(`交易模式缺少存储键：${mode}`);
  const normalizedSymbol = String(symbol || '').toUpperCase();
  const normalizedPrecision = normalizePrecisionScopeValue(precision);
  return normalizedSymbol && normalizedPrecision
    ? `${baseKey}:${normalizedSymbol}:${normalizedPrecision}`
    : null;
}

export function loadModeSymbolPrecisionNumberOption(
  storage,
  modeKeys,
  mode,
  symbol,
  precision,
  options,
  fallback,
) {
  const storageKey = modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision);
  if (!storageKey) return null;
  const storedValue = storage.getItem(storageKey);
  if (storedValue === null) return fallback;
  const stored = Number(storedValue);
  return options.includes(stored) ? stored : fallback;
}

export function migrateModeSymbolPrecisionNumberOption(
  storage,
  modeKeys,
  mode,
  symbol,
  precision,
  retiredValue,
  replacementValue,
  options,
) {
  const numericReplacement = Number(replacementValue);
  if (!options.includes(numericReplacement)) {
    throw new Error(`替换选项无效：${replacementValue}`);
  }
  const storageKey = modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision);
  if (!storageKey) return false;
  const storedValue = storage.getItem(storageKey);
  if (storedValue === null || Number(storedValue) !== Number(retiredValue)) return false;
  storage.setItem(storageKey, String(numericReplacement));
  return true;
}

export function saveModeSymbolPrecisionNumberOption(
  storage,
  modeKeys,
  mode,
  symbol,
  precision,
  value,
  options,
) {
  const numericValue = Number(value);
  if (!options.includes(numericValue)) return false;
  const storageKey = modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision);
  if (!storageKey) return false;
  storage.setItem(storageKey, String(numericValue));
  return true;
}

export function isModeSymbolOptionStorageKey(key, baseKeys) {
  if (!key) return false;
  return baseKeys.some((baseKey) => {
    const prefix = `${baseKey}:`;
    if (!key.startsWith(prefix)) return false;
    const [symbol, precision, extra] = key.slice(prefix.length).split(':');
    return Boolean(symbol && normalizePrecisionScopeValue(precision) && extra === undefined);
  });
}
