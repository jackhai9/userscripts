import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ensureSpaRouteChangePatched,
  installSpaRouteChangeListener,
} from '../../src/shared/spa-route-change.js';

test('user observes that SPA route listener observes changed pushState and replaceState URLs', () => {
  // Given the SPA page has a route listener attached to its history methods
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  const events = [];
  const dispose = installSpaRouteChangeListener(dom.window, () => {
    events.push(dom.window.location.pathname);
  });

  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  // When the page performs the specified history transition
  dom.window.history.replaceState({}, '', '/zh-CN/futures/ETHUSDT');

  // Then SPA route listener observes changed pushState and replaceState URLs
  assert.deepEqual(events, [
    '/zh-CN/futures/BTCUSDT',
    '/zh-CN/futures/ETHUSDT',
  ]);
  dispose();
});

test('user observes that SPA route listener ignores same-URL history writes and patches once', () => {
  // Given the SPA page has a route listener attached to its history methods
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  let firstCount = 0;
  let secondCount = 0;
  const disposeFirst = installSpaRouteChangeListener(dom.window, () => { firstCount += 1; });
  const patchedPushState = dom.window.history.pushState;
  // When the page performs the specified history transition
  const disposeSecond = installSpaRouteChangeListener(dom.window, () => { secondCount += 1; });

  // Then SPA route listener ignores same-URL history writes and patches once
  assert.equal(dom.window.history.pushState, patchedPushState);
  dom.window.history.pushState({}, '', dom.window.location.href);
  assert.equal(firstCount, 0);
  assert.equal(secondCount, 0);

  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  assert.equal(firstCount, 1);
  assert.equal(secondCount, 1);

  disposeFirst();
  disposeSecond();
});

test('user observes that SPA route patch is restored when an application replaces a history method', () => {
  // Given the SPA page has a route listener attached to its history methods
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  let count = 0;
  const dispose = installSpaRouteChangeListener(dom.window, () => { count += 1; });
  const applicationPushState = function (...args) {
    return Reflect.apply(dom.window.History.prototype.pushState, this, args);
  };
  dom.window.history.pushState = applicationPushState;

  // When the page performs the specified history transition
  ensureSpaRouteChangePatched(dom.window);
  // Then SPA route patch is restored when an application replaces a history method
  assert.notEqual(dom.window.history.pushState, applicationPushState);
  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  assert.equal(count, 1);
  dispose();
});

test('user observes that nested application wrappers dispatch one route event per URL change', () => {
  // Given the SPA page has a route listener attached to its history methods
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  let count = 0;
  const dispose = installSpaRouteChangeListener(dom.window, () => { count += 1; });
  const patchedPushState = dom.window.history.pushState;
  dom.window.history.pushState = function (...args) {
    return Reflect.apply(patchedPushState, this, args);
  };

  ensureSpaRouteChangePatched(dom.window);
  // When the page performs the specified history transition
  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  // Then nested application wrappers dispatch one route event per URL change
  assert.equal(count, 1);
  dispose();
});
