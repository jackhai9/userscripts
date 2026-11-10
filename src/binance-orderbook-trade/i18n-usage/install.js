import { isTopLevelTradingPage } from '../top-trading-page.js';

export const USAGE_DATABASE = 'pika-i18n-usage';
/** Other names that still look like the usage telemetry database. */
const USAGE_LIKE = /i18n[-_]?usage/i;
/** Binance opens the database about 5 s after its i18n instance starts; hidden tabs throttle timers. */
export const USAGE_OPEN_EXPECTED_MS = 120000;

/**
 * Binance's i18next post-processor records every translation key the page uses
 * into the `pika-i18n-usage` IndexedDB database, purely to report key usage back
 * to Binance. Records accumulate across tabs and sessions until a page load, which
 * then marks each unreported record with its own readwrite transaction. After a
 * long trading session that is thousands of transactions at once, queued in front
 * of every other request on that database. Translations themselves live in other
 * databases and are returned unchanged by the post-processor.
 *
 * Opening that one database throws synchronously. Binance opens it inside a
 * Promise executor, so the throw becomes a rejection; it caches the rejected
 * connection and never retries, and catches its insert errors. Every other open
 * calls the native method unchanged. Depends only on the database name; a
 * usage-like database under another name, or no blocked open within
 * USAGE_OPEN_EXPECTED_MS, is reported as a dependency break.
 */
export function installI18nUsageBlock(view, { onContractBreak, setTimeout }) {
  if (typeof onContractBreak !== 'function' || typeof setTimeout !== 'function') {
    throw new Error('I18n usage block requires a contract break handler and setTimeout');
  }
  const prototype = view.IDBFactory.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'open');
  const nativeOpen = descriptor.value;
  if (typeof nativeOpen !== 'function') throw new Error('I18n usage block requires the native IndexedDB open method');
  const stats = { blocked: 0 };
  const breaks = [];
  const reported = new Set();

  function report(key, reason, detail) {
    if (reported.has(key)) return;
    reported.add(key);
    const entry = Object.freeze({ reason, detail });
    breaks.push(entry);
    // open() runs inside Binance code; a failing handler must not change its result.
    queueMicrotask(() => onContractBreak(entry));
  }

  function open(name) {
    if (name === USAGE_DATABASE) {
      stats.blocked += 1;
      // Native-looking error: Binance's error reporting must not name the userscript.
      throw new view.DOMException('', 'NotAllowedError');
    }
    if (typeof name === 'string' && USAGE_LIKE.test(name)) {
      report(name, 'usage-db-name', `Usage-like database opened under a new name: ${name}`);
    }
    return Reflect.apply(nativeOpen, this, arguments);
  }

  setTimeout(() => {
    if (stats.blocked > 0) return;
    const module = typeof view.__getActiveI18nKeys === 'function' ? 'present' : 'absent';
    report('missing', 'usage-db-missing', `No ${USAGE_DATABASE} open within ${USAGE_OPEN_EXPECTED_MS / 1000} s (Binance usage debug hook ${module})`);
  }, USAGE_OPEN_EXPECTED_MS);

  Object.defineProperty(prototype, 'open', { ...descriptor, value: open });
  return Object.freeze({ snapshot: () => ({ ...stats }), breaks: () => [...breaks] });
}

/** Run before Binance code so its first usage database open is already blocked. */
export function installBinanceI18nUsageBlock({ onContractBreak }) {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_I18N_USAGE__')) return;
  const block = installI18nUsageBlock(self, { onContractBreak, setTimeout: self.setTimeout.bind(self) });
  Object.defineProperty(self, '__BINANCE_I18N_USAGE__', { value: block, configurable: true });
}
