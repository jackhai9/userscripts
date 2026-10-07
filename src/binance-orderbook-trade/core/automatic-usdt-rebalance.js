/** Unknown financial outcomes remain terminal even after subsequent account activity. */
export function readAutomaticRebalanceEpisode(serialized) {
  if (serialized === null) return { version: 1, status: 'active' };
  const record = JSON.parse(serialized);
  if (record?.version !== 1 || !['active', 'consumed', 'in_flight', 'blocked'].includes(record.status)) {
    throw new Error('Invalid automatic rebalance episode');
  }
  return record;
}

export function observeAutomaticRebalanceActivity(record, flat) {
  if (!flat && record.status === 'consumed') return { version: 1, status: 'active' };
  return record;
}

/** Both pinned all-symbol BAPI endpoints return the entire order array. */
export function assertCompleteOpenOrders(payload) {
  if (payload?.success !== true || !Array.isArray(payload.data)) {
    throw new Error('Invalid complete open-order response');
  }
  return payload.data.length;
}
