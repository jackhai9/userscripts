import { canonicalCompoundJson, validateCompoundEnvelope } from './compound-candidate-contract.js';
import { canonicalSymbolToRoute } from './live-event-contract.js';

function check(condition, message) {
  if (!condition) throw new Error(`Strategy 27 compound ${message}`);
}

function freezeRecord(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}

function orderOf(candidate) {
  return { time: candidate.decision.end_ms, id: candidate.candidate_id };
}

function compareOrder(a, b) {
  return a.time - b.time || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
}

/** Bounded immutable observations, independent of ordinary event lifecycles.
 *
 * Retention follows decision time rather than delivery/replay time. A monotonic
 * eviction boundary prevents old replay from resurrecting markers without an
 * unbounded tombstone map. Full payload hashes are validated even after eviction.
 */
export class CompoundCandidateLifecycle {
  #records = new Map();
  #evictionBoundary = null;
  #generation = 0;
  #applying = false;

  constructor(canonicalSymbol, { maxCandidates, maxAgeMs }) {
    canonicalSymbolToRoute(canonicalSymbol);
    check(Number.isSafeInteger(maxCandidates) && maxCandidates >= 1 && maxCandidates <= 80, 'maxCandidates must be 1..80');
    check(Number.isSafeInteger(maxAgeMs) && maxAgeMs >= 1 && maxAgeMs <= 7200000, 'maxAgeMs must be 1..7200000');
    this.canonicalSymbol = canonicalSymbol;
    this.maxCandidates = maxCandidates;
    this.maxAgeMs = maxAgeMs;
    this.reset('initial_cursor');
  }

  reset(reason) {
    check(['initial_cursor', 'stale_cursor', 'route_changed', 'interval_changed', 'unavailable', 'stopped'].includes(reason), 'reset reason is invalid');
    this.#generation += 1;
    this.#records.clear();
    this.#evictionBoundary = null;
    this.runtimeEpoch = null;
    this.lastSequence = null;
  }

  beginBootstrap(runtimeEpoch) {
    check(typeof runtimeEpoch === 'string' && /^[a-f0-9]{32}$/.test(runtimeEpoch), 'bootstrap epoch is invalid');
    this.reset('initial_cursor');
    this.runtimeEpoch = runtimeEpoch;
    this.lastSequence = 0;
  }

  finishBootstrap(lastSequence) {
    check(Number.isSafeInteger(lastSequence) && lastSequence >= 1, 'bootstrap last sequence is invalid');
    check(this.runtimeEpoch !== null && this.lastSequence !== null, 'bootstrap was not started');
    check(lastSequence >= this.lastSequence, 'bootstrap tail sequence precedes restored records');
    this.lastSequence = lastSequence;
  }

  #evict(id) {
    const record = this.#records.get(id);
    const order = orderOf(record.candidate);
    if (this.#evictionBoundary === null || compareOrder(order, this.#evictionBoundary) > 0) this.#evictionBoundary = order;
    this.#records.delete(id);
  }

  prune(nowMs) {
    check(Number.isSafeInteger(nowMs) && nowMs >= 0, 'prune time is invalid');
    const removed = [];
    for (const [id, record] of this.#records) {
      if (nowMs - record.candidate.decision.end_ms > this.maxAgeMs) {
        this.#evict(id);
        removed.push(id);
      }
    }
    return removed;
  }

  async apply(rawEnvelope, nowMs) {
    check(!this.#applying, 'lifecycle applications must be serial');
    check(Number.isSafeInteger(nowMs) && nowMs >= 0, 'application time is invalid');
    this.#applying = true;
    const generation = this.#generation;
    try {
      const envelope = await validateCompoundEnvelope(structuredClone(rawEnvelope));
      if (generation !== this.#generation) return { type: 'cancelled', removedCandidateIds: [] };
      const isState = envelope.message_kind === 'stream_state';
      if (envelope.message_kind === 'candidate') check(envelope.symbol === this.canonicalSymbol, 'symbol does not match requested symbol');
      const changedEpoch = this.runtimeEpoch !== null && envelope.runtime_epoch !== this.runtimeEpoch;
      if (changedEpoch) check(isState, 'epoch changed without stream_state');
      if (this.runtimeEpoch === envelope.runtime_epoch) {
        // Filtering other symbols produces sequence gaps, not discontinuities.
        check(envelope.sequence > this.lastSequence, 'sequence regression');
        check(!isState, 'Unexpected stream_state inside an active epoch');
      }
      this.runtimeEpoch = envelope.runtime_epoch;
      this.lastSequence = envelope.sequence;
      if (isState) {
        const removedCandidateIds = [...this.#records.keys()];
        this.#records.clear();
        this.#evictionBoundary = null;
        return { type: 'stream_reset', removedCandidateIds };
      }
      const removedCandidateIds = this.prune(nowMs);
      if (envelope.message_kind === 'heartbeat') return { type: 'heartbeat', removedCandidateIds };
      const candidate = envelope.payload;
      const id = candidate.candidate_id;
      const canonical = canonicalCompoundJson(candidate);
      const retained = this.#records.get(id);
      if (retained) {
        check(retained.canonical === canonical, 'candidate replay changed immutable content');
        return { type: 'replay', removedCandidateIds };
      }
      if (nowMs - candidate.decision.end_ms > this.maxAgeMs || (this.#evictionBoundary !== null && compareOrder(orderOf(candidate), this.#evictionBoundary) <= 0)) {
        return { type: 'expired', removedCandidateIds };
      }
      freezeRecord(candidate);
      this.#records.set(id, { candidate, canonical });
      if (this.#records.size > this.maxCandidates) {
        const oldest = [...this.#records.values()].sort((a, b) => compareOrder(orderOf(a.candidate), orderOf(b.candidate)))[0].candidate.candidate_id;
        this.#evict(oldest);
        removedCandidateIds.push(oldest);
      }
      return this.#records.has(id)
        ? { type: 'candidate', candidate, observedAtMs: envelope.observed_at_ms, removedCandidateIds }
        : { type: 'expired', removedCandidateIds };
    } finally {
      this.#applying = false;
    }
  }

  get size() {
    return this.#records.size;
  }
}
