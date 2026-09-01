function assertFunction(value, field) {
  if (typeof value !== 'function') throw new Error(`Invalid depth profile ${field}`);
  return value;
}

function assertSymbol(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9_]+$/.test(value)) {
    throw new Error('Invalid depth profile session symbol');
  }
  return value;
}

export function createDepthProfileSession(options) {
  const {
    symbol,
    source,
    onProfile,
    onStatus,
  } = options || {};
  const normalizedSymbol = assertSymbol(symbol);
  if (!source || typeof source !== 'object') throw new Error('Invalid depth profile source');
  const subscribe = assertFunction(source.subscribe, 'source subscriber');
  const profileListener = assertFunction(onProfile, 'profile listener');
  const statusListener = assertFunction(onStatus, 'status listener');

  let active = false;
  let unsubscribe = null;

  function assertMatchingSymbol(value, field) {
    if (value?.symbol !== normalizedSymbol) {
      throw new Error(
        `Depth profile ${field} symbol mismatch: expected ${normalizedSymbol}, received ${value?.symbol}`,
      );
    }
  }

  return {
    symbol: normalizedSymbol,
    start() {
      if (active) throw new Error('Depth profile session already started');
      active = true;
      statusListener({ symbol: normalizedSymbol, status: 'connecting', detail: '' });
      unsubscribe = Reflect.apply(subscribe, source, [{
        symbol: normalizedSymbol,
        onProfile(profile) {
          if (!active) return;
          assertMatchingSymbol(profile, 'profile');
          profileListener(profile);
        },
        onStatus(status) {
          if (!active) return;
          assertMatchingSymbol(status, 'status');
          statusListener(status);
        },
      }]);
      assertFunction(unsubscribe, 'unsubscribe function');
    },
    stop() {
      if (!active) return;
      active = false;
      const stopSubscription = unsubscribe;
      unsubscribe = null;
      stopSubscription?.();
    },
    isActive() {
      return active;
    },
  };
}
