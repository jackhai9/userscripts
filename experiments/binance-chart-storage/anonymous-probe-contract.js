import { snapshotJson } from './adapter.js';

/** Host catch may resolve failures, so diagnostic admission must account for its own rejection. */
export function captureAnonymousMirrorBatch(target, entries, state) {
  try {
    if (self !== top || location.href !== 'https://www.binance.com/zh-CN/futures/USUSDT') {
      throw new Error('Anonymous mirror probe left its fixed top-level URL');
    }
    return { target, entries: entries.map(([key, value]) => [key, snapshotJson(value)]) };
  } catch (error) {
    state.failed += 1;
    throw error;
  }
}
