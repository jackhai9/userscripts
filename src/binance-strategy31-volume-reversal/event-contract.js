export const STRATEGY31_PERIODS = Object.freeze({ '1m': 60, '3m': 180, '5m': 300, '15m': 900,
  '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
  '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800 });

/** Validate server ownership and coordinates before passing events to native drawings. */
export function parseStrategy31Events(payload, symbol, timeframe) {
  const interval = STRATEGY31_PERIODS[timeframe] * 1000;
  if (!interval || payload?.schema_version !== 1 || payload.strategy_id !== '31'
    || payload.spec_version !== '31_2_spec_v1' || payload.symbol !== symbol || payload.timeframe !== timeframe
    || !Number.isSafeInteger(payload.observed_at_ms) || !Array.isArray(payload.events) || payload.events.length > 200) {
    throw new TypeError('Invalid Strategy31 event snapshot');
  }
  let previousOpen = -1;
  return payload.events.map(event => {
    const anchor = timeframe === '1w' ? 345600000 : 0;
    if (event.symbol !== symbol || event.timeframe !== timeframe || !Number.isSafeInteger(event.bar_open_ms)
      || event.bar_open_ms <= previousOpen || (event.bar_open_ms - anchor) % interval !== 0
      || event.bar_close_ms !== event.bar_open_ms + interval || event.bar_close_ms > payload.observed_at_ms
      || event.id !== `31_2_spec_v1:${symbol}:${timeframe}:${event.bar_open_ms}`
      || !['open', 'high', 'low', 'close', 'volume', 'previous_volume'].every(key => Number.isFinite(event[key]))
      || event.low <= 0 || event.low > event.open || event.high < event.close || event.close <= event.open
      || event.previous_volume < 0 || event.volume <= event.previous_volume) {
      throw new TypeError('Invalid Strategy31 event');
    }
    previousOpen = event.bar_open_ms;
    return { id: event.id, direction: 'bullish', type: 'confirmed', time: event.bar_open_ms / 1000, markerPrice: event.low };
  });
}
