export const TRADINGVIEW_ORDERS_RECOVERY_STORAGE_KEY =
  'binance-orderbook-trade:tradingview-orders-recovery:v1';

export function createTradingViewOrdersRecoveryRecord(nowMs) {
  if (!Number.isFinite(nowMs)) throw new Error('Chart orders recovery timestamp is invalid');
  return JSON.stringify({ version: 1, originalVisible: true, createdAtMs: nowMs });
}

export function parseTradingViewOrdersRecoveryRecord(rawValue, nowMs) {
  if (rawValue === null) return { status: 'missing', record: null };
  if (!Number.isFinite(nowMs)) throw new Error('Chart orders recovery current time is invalid');

  let record;
  try {
    record = JSON.parse(rawValue);
  } catch {
    return { status: 'invalid', record: null };
  }
  const keys = record && typeof record === 'object' ? Object.keys(record).sort() : [];
  if (
    keys.join(',') !== 'createdAtMs,originalVisible,version'
    || record.version !== 1
    || record.originalVisible !== true
    || !Number.isFinite(record.createdAtMs)
    || record.createdAtMs > nowMs
  ) {
    return { status: 'invalid', record: null };
  }
  return { status: 'valid', record };
}
