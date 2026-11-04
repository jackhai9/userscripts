import { isBinanceSymbol } from '../../shared/binance-symbol.js';

/** Order statuses for which Binance plays its trade sound. */
const SOUND_STATUSES = new Set(['FILLED', 'PARTIALLY_FILLED', 'EXPIRED']);
const ORDINARY_TYPES = new Set([
  'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT',
  'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET',
]);
const ORDINARY_EXECUTIONS = new Set(['NEW', 'CANCELED', 'EXPIRED', 'TRADE', 'AMENDMENT']);
const SYSTEM_CLIENT_ID_PREFIXES = ['autoclose-', 'adl_autoclose', 'settlement_autoclose-'];

/** Binance debounces a sound by 500 ms and keeps at most two entries, 2 s apart. */
const OWN_SOUND_WINDOW_MS = 10_000;
/** Hidden tabs can delay that debounce, so a foreign fill stays attributable for longer. */
const FOREIGN_SOUND_WINDOW_MS = 120_000;

/**
 * Only ordinary orders are scoped to a symbol. Liquidations, system closes and
 * unknown shapes return null so every tab keeps sounding for them.
 */
function readOrdinaryOrderSymbol(order) {
  if (!isBinanceSymbol(order.s) || !ORDINARY_TYPES.has(order.o) || !ORDINARY_TYPES.has(order.ot)
      || !ORDINARY_EXECUTIONS.has(order.x) || typeof order.c !== 'string' || order.c.length === 0
      || SYSTEM_CLIENT_ID_PREFIXES.some(prefix => order.c.startsWith(prefix))) return null;
  return order.s;
}

/**
 * Binance's trade sound carries no symbol and every tab receives the same account
 * stream, so a sound is attributed from the fills this tab has observed: it plays
 * when a matching fill arrived since the last sound, and stays silent when only
 * other symbols filled. With no recent fill evidence the sound keeps native behavior.
 */
export function createFillSoundScope({ now, readCurrentSymbol }) {
  let ownFillAt = null;
  let foreignFillAt = null;
  const stats = { ownFills: 0, foreignFills: 0, allowed: 0, suppressed: 0, unattributed: 0 };

  function within(time, windowMs) {
    return time !== null && now() - time <= windowMs;
  }

  return Object.freeze({
    recordOrderUpdate(order) {
      if (!SOUND_STATUSES.has(order.X)) return;
      const symbol = readOrdinaryOrderSymbol(order);
      const currentSymbol = readCurrentSymbol();
      if (symbol === null || currentSymbol === null || symbol === currentSymbol) {
        ownFillAt = now();
        stats.ownFills += 1;
        return;
      }
      foreignFillAt = now();
      stats.foreignFills += 1;
    },
    allowSound() {
      if (within(ownFillAt, OWN_SOUND_WINDOW_MS)) {
        ownFillAt = null;
        stats.allowed += 1;
        return true;
      }
      if (within(foreignFillAt, FOREIGN_SOUND_WINDOW_MS)) {
        stats.suppressed += 1;
        return false;
      }
      stats.unattributed += 1;
      return true;
    },
    snapshot: () => ({ ...stats }),
  });
}
