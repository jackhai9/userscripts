import { createStrategy27Translator, localizeAnnotation } from './ui-copy.js';
import { buildCompoundCandidateAnnotation } from './compound-candidate-annotation.js';
import { createCompoundCandidateClient } from './compound-candidate-client.js';
import { CompoundCandidateLifecycle } from './compound-candidate-lifecycle.js';

/** Own the optional compound job, never the ordinary client's state.
 *
 * The lifecycle accepts immutable records before asynchronous drawing. A view
 * generation separately invalidates pending presentation on manual clear or
 * eviction without erasing sequence/replay bookkeeping. The chart layer must
 * cancel pending owned entities on remove/clear, including late create results.
 */
export function createCompoundCandidateController({
  request, gatewayBaseUrl, authSecret, canonicalSymbol, panel, createLayer,
  locale = 'zh-CN', isCurrent, maxCandidates, maxAgeMs, nowMs = Date.now, reconnectDelayMs = 2000,
}) {
  let currentLocale = locale;
  let t = createStrategy27Translator(locale);
  let connectionState = 'connecting';
  function connectionStatus() {
    const CONNECTION_STATUS = Object.freeze({
      connected: [t('复合候选数据：已连接。接口连通不代表该币种仍在监控中。', 'Compound data: connected. Connection does not confirm symbol monitoring.'), 'normal'],
      reconnecting: [t('复合候选数据连接中断，正在重连。', 'Compound data connection lost; reconnecting.'), 'inactive'],
      unavailable: [t('复合候选数据暂不可用，正在重连。', 'Compound data temporarily unavailable; reconnecting.'), 'inactive'],
      connecting: [t('复合候选正在连接', 'Connecting to compound data'), 'inactive'],
      unsupported: [t('网关尚未启用复合候选', 'Compound candidates are not enabled on the gateway'), 'inactive'],
    });
    return CONNECTION_STATUS;
  }
  function renderStatus() {
    if (lastError) panel.setCompoundStatus(t('复合候选已停止：', 'Compound candidates stopped: ') + lastError.message, 'error');
    else panel.setCompoundStatus(...connectionStatus()[connectionState]);
  }
  const lifecycle = new CompoundCandidateLifecycle(canonicalSymbol, { maxCandidates, maxAgeMs });
  const abortController = new AbortController();
  let layer = null;
  let started = false;
  let viewGeneration = 0;
  let pendingCandidateId = null;
  let lastError = null;
  const current = () => !abortController.signal.aborted && isCurrent();

  function clearView() {
    viewGeneration += 1;
    pendingCandidateId = null;
    let cleanupError = null;
    try {
      layer?.clear();
    } catch (error) {
      cleanupError = error;
    }
    panel.clearCompound();
    return cleanupError;
  }

  function remove(ids) {
    for (const id of ids) {
      if (id === pendingCandidateId) viewGeneration += 1;
      layer?.remove(id);
      panel.removeCompound(id);
    }
  }

  function prune(observedAtMs = nowMs()) {
    if (current()) remove(lifecycle.prune(observedAtMs));
  }

  function failJob(error, { clear = true } = {}) {
    lastError = error;
    if (!current()) return;
    abortController.abort();
    lifecycle.reset('stopped');
    const cleanupError = clear ? clearView() : null;
    if (cleanupError) lastError = new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`);
    renderStatus();
  }

  function onConnectionStateChange(state) {
    if (!current()) return;
    const status = connectionStatus()[state];
    if (!status) throw new Error(`Unknown compound connection state: ${state}`);
    if (state === 'unavailable' || state === 'unsupported') {
      lifecycle.reset('unavailable');
      const error = clearView();
      if (error) { failJob(error, { clear: false }); return; }
    }
    connectionState = state;
    renderStatus();
  }

  async function onResponse(response) {
    if (!current()) return;
    if (response.status === 'reset') {
      lifecycle.reset(response.reason);
      const error = clearView();
      if (error) failJob(error, { clear: false });
      return;
    }
    let messages = response.messages;
    const applicationNowMs = response.status === 'bootstrap'
      ? response.bootstrap_observed_at_ms
      : nowMs();
    if (response.status === 'bootstrap') {
      lifecycle.beginBootstrap(response.runtime_epoch);
      const error = clearView();
      if (error) { failJob(error, { clear: false }); return; }
      messages = [...response.records].sort((left, right) => left.sequence - right.sequence);
    }
    for (const message of messages) {
      if (!current()) return;
      const applicationGeneration = viewGeneration;
      const action = await lifecycle.apply(message, applicationNowMs);
      if (!current()) return;
      remove(action.removedCandidateIds);
      if (action.type === 'stream_reset') {
        // apply() already accepted the epoch and sequence. Only clear the view.
        const error = clearView();
        if (error) { failJob(error, { clear: false }); return; }
        continue;
      }
      if (action.type !== 'candidate' || applicationGeneration !== viewGeneration) continue;
      const id = action.candidate.candidate_id;
      const annotation = buildCompoundCandidateAnnotation(action.candidate, { locale: currentLocale });
      // Optional chart capabilities are tested inside this job's error boundary.
      if (layer === null) layer = createLayer();
      const renderGeneration = viewGeneration;
      pendingCandidateId = id;
      try {
        const rendered = await layer.renderCandidate(id, annotation, action.candidate.decision.end_ms);
        if (typeof rendered !== 'boolean') throw new Error('Compound renderer must return a boolean');
        if (!current()) return;
        prune();
        if (rendered && renderGeneration === viewGeneration) {
          panel.upsertCompound(id, localizeAnnotation(annotation, currentLocale), action.observedAtMs);
        }
      } finally {
        pendingCandidateId = null;
      }
    }
    if (response.status === 'bootstrap' && current()) {
      lifecycle.finishBootstrap(response.last_sequence);
    }
  }

  return Object.freeze({
    setLocale(nextLocale) {
      t = createStrategy27Translator(nextLocale);
      currentLocale = nextLocale;
      renderStatus();
      try {
        layer?.setLocale(nextLocale);
      } catch (error) {
        failJob(error);
      }
    },
    run() {
      if (started) throw new Error('Compound controller already started');
      started = true;
      return (async () => {
        if (!current()) return;
        try {
          renderStatus();
          const client = createCompoundCandidateClient({
            request, gatewayBaseUrl, authSecret, canonicalSymbol, reconnectDelayMs,
            onResponse, onConnectionStateChange,
          });
          await client.run(abortController.signal);
        } catch (error) {
          // Contract/render failures stop this optional job, not ordinary events.
          if (abortController.signal.aborted && error.name === 'AbortError') return;
          failJob(error);
        }
      })();
    },
    clear() {
      if (!current()) return;
      const error = clearView();
      if (error) failJob(error, { clear: false });
    },
    prune() {
      // The shared context timer is a second entry into this optional job.
      try {
        prune();
      } catch (error) {
        failJob(error);
      }
    },
    async reconcile() {
      // Recovery belongs to the same optional-job boundary as incoming draws.
      try {
        prune();
        if (current() && layer !== null) await layer.reconcile();
      } catch (error) {
        failJob(error);
      }
    },
    stop(reason) {
      if (abortController.signal.aborted) return;
      abortController.abort();
      lifecycle.reset(reason);
      const error = clearView();
      if (error) {
        lastError = error;
        renderStatus();
      }
    },
    // A late drawing rejection remains inspectable without touching a retired panel.
    get lastError() { return lastError; },
  });
}
