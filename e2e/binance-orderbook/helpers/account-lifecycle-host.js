import { expect } from '../test.js';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../fixtures/account-rebalance-api.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, ORDER_SETS, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from './userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from './scenario-clock.js';

export const LEVERAGE_PATH = '/bapi/futures/v1/private/future/user-data/adjustLeverage';
export const THIRD_SYMBOL = 'ETHUSDT';

/**
 * Hold the native bootstrap before it reaches the installed userscript interceptor.
 * Delaying its HTTP response alone would already have exposed the request headers.
 */
function installAccountLifecycleBoundary() {
  const interceptedFetch = window.fetch;
  const requests = [];
  let bootstrap = null;
  let released = false;
  window.fetch = function (...args) {
    const pathname = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).pathname;
    if (pathname === '/bapi/fixture-bootstrap') {
      if (bootstrap || released) throw new Error('The account bootstrap may be captured only once');
      const completion = Promise.withResolvers();
      bootstrap = { args, completion, receiver: this };
      return completion.promise;
    }
    if (!pathname.startsWith('/bapi/')) return interceptedFetch.apply(this, args);
    const record = {
      pathname,
      symbol: location.pathname.split('/').at(-1),
      at: Date.now(),
      settled: false,
      status: null,
      error: null,
    };
    requests.push(record);
    return interceptedFetch.apply(this, args).then(
      response => {
        record.settled = true;
        record.status = response.status;
        return response;
      },
      error => {
        record.settled = true;
        record.error = error.name;
        throw error;
      },
    );
  };
  window.__ACCOUNT_LIFECYCLE_BOUNDARY__ = {
    releaseHeaders() {
      if (!bootstrap) throw new Error('No native account bootstrap is pending');
      const pending = bootstrap;
      bootstrap = null;
      released = true;
      const request = interceptedFetch.apply(pending.receiver, pending.args);
      request.then(pending.completion.resolve, pending.completion.reject);
      return request.then(response => response.status);
    },
    snapshot() {
      return { bootstrapHeld: bootstrap !== null, released, requests: structuredClone(requests) };
    },
  };
}

/** Offline HTTP responses remain independent of native account counter mutations. */
export async function openAccountLifecycleHost(page, {
  positions = [],
  orders = ORDER_SETS.current,
  apiPositions = [],
  leverage = 2,
  balances = { FUNDING: '100', MAIN: '0', UMFUTURE: '0' },
} = {}) {
  await installScenarioClock(page);
  const loaded = await openUserscriptScenario(page, createCancelScenario({
    positions,
    orders,
    ui: { leverage },
  }), { afterOrderbook: '(' + installAccountLifecycleBoundary.toString() + ')();' });
  await pauseScenarioClock(page);
  const api = createAccountRebalanceApi(balances);
  api.setPositions(apiPositions);
  const plannedHolds = new Set();
  const held = new Map();
  const leverageRequests = [];
  const leverageFailures = [];
  let positionCount = 0;
  await page.route('https://www.binance.com/bapi/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!api.supports(pathname) && pathname !== LEVERAGE_PATH) return route.fallback();
    const body = request.postData() === null ? undefined : request.postDataJSON();
    let response;
    if (pathname === LEVERAGE_PATH) {
      expect(request.method()).toBe('POST');
      expect(Object.keys(body).sort()).toEqual(['leverage', 'symbol']);
      leverageRequests.push(structuredClone(body));
      response = leverageFailures.length > 0
        ? leverageFailures.shift()
        : { status: 200, body: { success: true } };
    } else {
      response = api.handle({ pathname, method: request.method(), body });
    }
    if (pathname === ACCOUNT_PATHS.positions) {
      expect(body).toEqual({});
      positionCount += 1;
      if (plannedHolds.delete(positionCount)) {
        const release = Promise.withResolvers();
        const delivered = Promise.withResolvers();
        held.set(positionCount, { release, delivered, response });
        response = await release.promise;
        await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
        delivered.resolve();
        return;
      }
    }
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo**', async route => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol');
    expect([CURRENT_SYMBOL, OTHER_SYMBOL, THIRD_SYMBOL]).toContain(symbol);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbols: [{
      symbol,
      filters: [
        { filterType: 'LOT_SIZE', minQty: '0.01', stepSize: '0.01' },
        { filterType: 'MARKET_LOT_SIZE', minQty: '0.01', stepSize: '0.01' },
        { filterType: 'MIN_NOTIONAL', notional: '5' },
      ],
    }] }) });
  });

  return {
    ...loaded,
    api,
    leverageRequests,
    async releaseHeaders() {
      return page.evaluate(() => window.__ACCOUNT_LIFECYCLE_BOUNDARY__.releaseHeaders());
    },
    async snapshot() {
      return page.evaluate(() => window.__ACCOUNT_LIFECYCLE_BOUNDARY__.snapshot());
    },
    holdPositionResponse(sequence = positionCount + 1) {
      if (!Number.isInteger(sequence) || sequence <= positionCount || plannedHolds.has(sequence)) {
        throw new Error('A held position response requires an unused future sequence');
      }
      plannedHolds.add(sequence);
      return sequence;
    },
    pendingPositionResponses: () => [...held.keys()],
    async releasePositionResponse(sequence, replacement) {
      const pending = held.get(sequence);
      if (!pending) throw new Error('No position response is held for this sequence');
      held.delete(sequence);
      pending.release.resolve(replacement === undefined ? pending.response : replacement);
      await pending.delivered.promise;
    },
    failNextLeverage(status) {
      if (!Number.isInteger(status) || status < 400) throw new Error('Leverage failure requires an HTTP error status');
      leverageFailures.push({ status, body: { success: false, message: 'Declared leverage rejection' } });
    },
    async waitForPositionResponses(minimum) {
      await expect.poll(async () => {
        const snapshot = await page.evaluate(() => window.__ACCOUNT_LIFECYCLE_BOUNDARY__.snapshot());
        const positions = snapshot.requests.filter(request => request.pathname === ACCOUNT_PATHS.positions);
        return { enough: positions.length >= minimum, pending: snapshot.requests.filter(request => !request.settled).length };
      }).toEqual({ enough: true, pending: 0 });
    },
    async setNativePositions(value) {
      return page.evaluate(positions => {
        window.__BINANCE_FIXTURE__.setPositions(positions);
        return Date.now();
      }, value);
    },
    async setNativeOrders(value) {
      return page.evaluate(orders => {
        window.__BINANCE_FIXTURE__.setOrders(orders);
        return Date.now();
      }, value);
    },
    async expectNoTradingActions() {
      expect((await readFixtureState(page)).events.filter(event => (
        event.type === 'order-submitted' || /cancel-requested/.test(event.type)
      ))).toEqual([]);
      expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
      expect(loaded.errors).toEqual([]);
    },
  };
}
