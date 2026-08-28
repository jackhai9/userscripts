export const CHART_ORDERS_RECOVERY_STORAGE_KEY =
  'binance-orderbook-trade:chart-orders-recovery:v2';

export function createChartOrdersRecoveryRecord(nowMs) {
  if (!Number.isFinite(nowMs)) throw new Error('Chart orders recovery timestamp is invalid');
  return JSON.stringify({ version: 2, originalChecked: true, createdAtMs: nowMs });
}

export function parseChartOrdersRecoveryRecord(rawValue, nowMs) {
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
    keys.join(',') !== 'createdAtMs,originalChecked,version'
    || record.version !== 2
    || record.originalChecked !== true
    || !Number.isFinite(record.createdAtMs)
    || record.createdAtMs > nowMs
  ) {
    return { status: 'invalid', record: null };
  }
  return { status: 'valid', record };
}
