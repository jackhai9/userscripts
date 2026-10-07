import { observeChartStorageBootstrap } from './bootstrap.js';
import { replaceChartMirrorFactory } from './mirror-module.js';

const INCIDENT_URL = 'https://www.binance.com/zh-CN/futures/USUSDT';
const OBSERVATION_MS = 30_000;

function isIncidentPage() {
  return location.href === INCIDENT_URL && self === top;
}

/**
 * Observe the pinned mirror boundary without inspecting values or adding storage
 * work. Native thunk evaluation stays synchronous, including its array and error
 * identities. The returned dispatcher is for module composition; the userscript
 * publishes only snapshot and stop.
 */
export function startNativeMirrorPreflight() {
  const state = {
    active: true, outcome: 'waiting', stopReason: null, failure: null,
    attempts: 0, matches: 0, executions: 0, completed: false,
    dispatches: 0, entryCount: 0,
  };
  let observer;
  let timer;

  function snapshot() {
    return { ...state, failure: state.failure === null ? null : { ...state.failure } };
  }

  function retire(reason) {
    if (!state.active) return snapshot();
    state.active = false;
    state.stopReason = reason;
    clearTimeout(timer);
    self.removeEventListener('pagehide', onPageHide);
    if (observer) observer.stop();
    return snapshot();
  }

  function fail(code) {
    state.failure = { name: 'PreflightError', code };
    state.outcome = 'failed';
    retire('failure');
  }

  function onPageHide() {
    retire('pagehide');
  }

  function dispatch(_target, entries, nativeThunk) {
    if (state.active) {
      if (!isIncidentPage()) retire('scope_changed');
      else {
        try {
          const count = entries.length;
          if (state.active) {
            state.dispatches += 1;
            state.entryCount += count;
          }
        } catch {
          // Diagnostic metadata failure retires observation, never the native operation.
          fail('entry_count_unavailable');
        }
      }
    }
    return nativeThunk();
  }

  const session = Object.freeze({ snapshot, stop: () => retire('manual'), dispatch });
  if (!isIncidentPage()) {
    fail('unsupported_page');
    return session;
  }

  try {
    observer = observeChartStorageBootstrap({
      replaceMirrorFactory(original) {
        if (!isIncidentPage()) {
          retire('scope_changed');
          return original;
        }
        state.attempts += 1;
        let factory;
        try {
          factory = replaceChartMirrorFactory(original, dispatch);
        } catch {
          fail('source_mismatch');
          return original;
        }
        state.matches += 1;
        return function (...args) {
          if (state.active) {
            if (!isIncidentPage()) retire('scope_changed');
            else state.executions += 1;
          }
          try {
            return Reflect.apply(factory, this, args);
          } catch (error) {
            if (state.active) fail('module_execution_failed');
            throw error;
          }
        };
      },
      onCapture() {
        if (!state.active) return;
        if (!isIncidentPage()) retire('scope_changed');
        else {
          state.completed = true;
          state.outcome = 'captured';
        }
      },
    });
  } catch {
    fail('bootstrap_rejected');
    return session;
  }

  observer.captured.catch(() => {
    if (state.active) fail('observation_failed');
  });
  self.addEventListener('pagehide', onPageHide, { once: true });
  timer = setTimeout(() => retire('deadline'), OBSERVATION_MS);
  return session;
}
