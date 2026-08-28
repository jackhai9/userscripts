import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ensureSpaRouteChangePatched,
  installSpaRouteChangeListener,
} from '../../src/shared/spa-route-change.js';

test('SPA route listener observes changed pushState and replaceState URLs', () => {
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  const events = [];
  const dispose = installSpaRouteChangeListener(dom.window, () => {
    events.push(dom.window.location.pathname);
  });

  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  dom.window.history.replaceState({}, '', '/zh-CN/futures/ETHUSDT');

  assert.deepEqual(events, [
    '/zh-CN/futures/BTCUSDT',
    '/zh-CN/futures/ETHUSDT',
  ]);
  dispose();
});

test('SPA route listener ignores same-URL history writes and patches once', () => {
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  let firstCount = 0;
  let secondCount = 0;
  const disposeFirst = installSpaRouteChangeListener(dom.window, () => { firstCount += 1; });
  const patchedPushState = dom.window.history.pushState;
  const disposeSecond = installSpaRouteChangeListener(dom.window, () => { secondCount += 1; });

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

test('SPA route patch is restored when an application replaces a history method', () => {
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  let count = 0;
  const dispose = installSpaRouteChangeListener(dom.window, () => { count += 1; });
  const applicationPushState = function (...args) {
    return Reflect.apply(dom.window.History.prototype.pushState, this, args);
  };
  dom.window.history.pushState = applicationPushState;

  ensureSpaRouteChangePatched(dom.window);
  assert.notEqual(dom.window.history.pushState, applicationPushState);
  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  assert.equal(count, 1);
  dispose();
});

test('nested application wrappers dispatch one route event per URL change', () => {
  const dom = new JSDOM('', { url: 'https://www.binance.com/zh-CN/futures/HYPEUSDT' });
  let count = 0;
  const dispose = installSpaRouteChangeListener(dom.window, () => { count += 1; });
  const patchedPushState = dom.window.history.pushState;
  dom.window.history.pushState = function (...args) {
    return Reflect.apply(patchedPushState, this, args);
  };

  ensureSpaRouteChangePatched(dom.window);
  dom.window.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
  assert.equal(count, 1);
  dispose();
});
