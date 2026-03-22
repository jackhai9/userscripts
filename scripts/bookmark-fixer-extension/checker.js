/* checker.js — URL checking engine for bookmark scanner */

const CHECK_TIMEOUT = 10000;
const MAX_CONCURRENCY = 20;
const MAX_PER_HOST = 3;
const RETRY_DELAY = 2000;
const RETRY_TIMEOUTS = false;
const HOST_TIMEOUT_BREAKER_THRESHOLD = 2;
// Only these status codes are confirmed dead — everything else goes to review
const CONFIRMED_DEAD_CODES = new Set([404, 410]);

/**
 * Check a single bookmark URL.
 * @param {string} url
 * @param {AbortSignal} signal — shared abort signal for cancellation
 * @returns {Promise<object>} check result
 */
async function checkUrl(url, signal) {
  // Scheme filter
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'invalid_url', classification: 'skipped', reason: 'invalid_url', final_url: '', https_status: '', https_upgradable: false, https_url: '', https_final_url: '', recommendation: 'review' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 'skipped', classification: 'skipped', reason: `unsupported_scheme:${parsed.protocol}`, final_url: '', https_status: '', https_upgradable: false, https_url: '', https_final_url: '', recommendation: 'keep' };
  }

  // Check cancellation before starting
  if (signal && signal.aborted) {
    return { status: 'cancelled', classification: 'skipped', reason: 'cancelled', final_url: '', https_status: '', https_upgradable: false, https_url: '', https_final_url: '', recommendation: 'keep' };
  }

  // Primary check
  let result = await fetchWithRetry(url, signal);

  // Redirect analysis
  if (result.ok && result.finalUrl) {
    try {
      const origHost = new URL(url).host;
      const finalHost = new URL(result.finalUrl).host;
      if (origHost !== finalHost) {
        result.redirectDomain = true;
      }
    } catch { /* ignore parse errors on final URL */ }
  }

  // Classify
  const classified = classify(url, result);

  // HTTPS upgrade probe (only for http:// URLs that are alive or uncertain)
  if (parsed.protocol === 'http:' && (classified.classification === 'alive' || classified.classification === 'uncertain')) {
    // Check cancellation before HTTPS probe
    if (signal && signal.aborted) return classified;

    const httpsUrl = url.replace(/^http:/, 'https:');
    const httpsResult = await fetchWithRetry(httpsUrl, signal);
    if (httpsResult.ok && httpsResult.status >= 200 && httpsResult.status < 400) {
      classified.https_status = httpsResult.status;
      classified.https_url = httpsUrl;
      classified.https_final_url = httpsResult.finalUrl || httpsUrl;

      // Check if HTTPS response itself redirected to a different host
      let httpsRedirectDomain = false;
      if (httpsResult.finalUrl) {
        try {
          const httpsOrigHost = new URL(httpsUrl).host;
          const httpsFinalHost = new URL(httpsResult.finalUrl).host;
          if (httpsOrigHost !== httpsFinalHost) httpsRedirectDomain = true;
        } catch { /* ignore */ }
      }

      if (!classified.redirectDomain && !httpsRedirectDomain) {
        classified.https_upgradable = true;
        classified.recommendation = 'upgrade_https';
        // If HTTP was uncertain but HTTPS works, promote to alive
        if (classified.classification === 'uncertain') {
          classified.classification = 'alive';
          classified.reason = 'https_ok_http_' + classified.reason;
        }
      } else {
        // HTTPS works but redirects to different host — not safe to auto-upgrade
        classified.https_upgradable = false;
      }
    } else {
      classified.https_status = httpsResult.status;
      classified.https_upgradable = false;
    }
  }

  return classified;
}

/**
 * Fetch with timeout, retry on transport error.
 * credentials:'omit' — don't send cookies to avoid triggering side effects on
 * logout/unsubscribe/admin URLs. Some 401/403 results are acceptable trade-off.
 */
async function fetchWithRetry(url, signal, attempt = 0) {
  // Check cancellation before starting
  if (signal && signal.aborted) {
    return { ok: false, status: 'cancelled', finalUrl: '' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

  // Link to parent signal for cancellation
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      return { ok: false, status: 'cancelled', finalUrl: '' };
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);

    return {
      ok: true,
      status: resp.status,
      finalUrl: resp.url,
    };
  } catch (e) {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);

    if (signal && signal.aborted) {
      return { ok: false, status: 'cancelled', finalUrl: '' };
    }
    if (e.name === 'AbortError') {
      // Timeout is already classified as uncertain/review, so don't spend
      // another full timeout budget retrying unless explicitly enabled.
      if (attempt === 0 && RETRY_TIMEOUTS) {
        await abortableSleep(RETRY_DELAY, signal);
        if (signal && signal.aborted) return { ok: false, status: 'cancelled', finalUrl: '' };
        return fetchWithRetry(url, signal, 1);
      }
      return { ok: false, status: 'timeout', finalUrl: '' };
    }
    // Network/DNS/cert error — retry once
    if (attempt === 0) {
      await abortableSleep(RETRY_DELAY, signal);
      if (signal && signal.aborted) return { ok: false, status: 'cancelled', finalUrl: '' };
      return fetchWithRetry(url, signal, 1);
    }
    return { ok: false, status: `error:${e.message}`, finalUrl: '' };
  }
}

function classify(url, result) {
  const base = {
    status: result.status,
    final_url: result.finalUrl || '',
    https_status: '',
    https_upgradable: false,
    https_url: '',
    https_final_url: '',
    redirectDomain: result.redirectDomain || false,
  };

  if (!result.ok) {
    const reason = String(result.status);
    if (reason === 'cancelled') {
      return { ...base, classification: 'skipped', reason: 'cancelled', recommendation: 'keep' };
    }
    if (reason === 'timeout') {
      return { ...base, classification: 'uncertain', reason: 'timeout', recommendation: 'review' };
    }
    return { ...base, classification: 'uncertain', reason: `transport_error:${reason}`, recommendation: 'review' };
  }

  const status = result.status;

  if (status >= 200 && status < 400) {
    if (result.redirectDomain) {
      return { ...base, classification: 'alive', reason: 'redirect_domain', recommendation: 'review' };
    }
    return { ...base, classification: 'alive', reason: 'ok', recommendation: 'keep' };
  }

  // White-list approach: only 404/410 are confirmed dead
  // But if the response has substantial HTML body, it's likely a soft 404 (SPA) — downgrade to review
  if (CONFIRMED_DEAD_CODES.has(status)) {
    return { ...base, classification: 'dead', reason: `http_${status}`, recommendation: 'delete' };
  }

  // All other non-2xx/3xx → uncertain, needs human review
  return { ...base, classification: 'uncertain', reason: `http_${status}`, recommendation: 'review' };
}

/**
 * Scan a list of bookmark nodes with concurrency control.
 */
async function scanBookmarks(nodes, onProgress, signal) {
  const results = [];
  let completed = 0;
  let nextIndex = 0;
  const hostCounts = new Map();
  const hostState = new Map();

  function getHost(url) {
    try { return new URL(url).host; } catch { return '__unknown__'; }
  }

  function getHostState(host) {
    if (!hostState.has(host)) {
      hostState.set(host, { timeoutCount: 0, shortCircuitReason: '' });
    }
    return hostState.get(host);
  }

  function makeShortCircuitResult(node, host) {
    const state = getHostState(host);
    return {
      ...node,
      status: 'host_short_circuit',
      classification: 'uncertain',
      reason: state.shortCircuitReason || 'host_timeout_short_circuit',
      final_url: '',
      https_status: '',
      https_upgradable: false,
      https_url: '',
      https_final_url: '',
      recommendation: 'review',
    };
  }

  function updateHostState(host, result) {
    const state = getHostState(host);
    if (result.classification === 'uncertain' && result.reason === 'timeout') {
      state.timeoutCount += 1;
      if (state.timeoutCount >= HOST_TIMEOUT_BREAKER_THRESHOLD) {
        state.shortCircuitReason = 'host_timeout_short_circuit';
      }
      return;
    }
    if (result.classification === 'uncertain' && String(result.reason || '').startsWith('transport_error:')) {
      state.timeoutCount += 1;
      if (state.timeoutCount >= HOST_TIMEOUT_BREAKER_THRESHOLD) {
        state.shortCircuitReason = 'host_transport_short_circuit';
      }
      return;
    }
    state.timeoutCount = 0;
    state.shortCircuitReason = '';
  }

  async function acquireHostSlot(host) {
    while ((hostCounts.get(host) || 0) >= MAX_PER_HOST) {
      if (signal && signal.aborted) return false;
      await abortableSleep(50, signal);
    }
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    return true;
  }

  function releaseHostSlot(host) {
    const c = hostCounts.get(host) || 1;
    hostCounts.set(host, c - 1);
  }

  async function processOne() {
    while (nextIndex < nodes.length) {
      if (signal && signal.aborted) return;

      const idx = nextIndex++;
      const node = nodes[idx];
      const host = getHost(node.url);

      if (getHostState(host).shortCircuitReason) {
        const result = makeShortCircuitResult(node, host);
        results.push(result);
        completed++;
        if (onProgress) onProgress(completed, nodes.length, result);
        continue;
      }

      if (!(await acquireHostSlot(host))) return;

      try {
        if (getHostState(host).shortCircuitReason) {
          const result = makeShortCircuitResult(node, host);
          results.push(result);
          completed++;
          if (onProgress) onProgress(completed, nodes.length, result);
          continue;
        }
        const checkResult = await checkUrl(node.url, signal);
        const result = {
          ...node,
          ...checkResult,
        };
        delete result.redirectDomain;
        updateHostState(host, result);
        results.push(result);
        completed++;
        if (onProgress) onProgress(completed, nodes.length, result);
      } finally {
        releaseHostSlot(host);
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(MAX_CONCURRENCY, nodes.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(processOne());
  }
  await Promise.all(workers);

  return results;
}

/** Sleep that resolves early if signal is aborted */
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    }
  });
}
