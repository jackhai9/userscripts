import assert from 'node:assert/strict';
import test from 'node:test';

import { NATIVE_SAVE_WINDOW_MS, installUnchangedChartWriteFilter } from '../../src/binance-orderbook-trade/chart-storage/unchanged-write-filter.js';
import { installFillSoundScope } from '../../src/binance-orderbook-trade/order-sound/install.js';

/** Minimal IndexedDB surface: native put records calls; get answers asynchronously like IDBRequest. */
function storageView() {
  const timers = [];
  const nativePuts = [];
  class IDBObjectStore {
    put(value, key) { nativePuts.push(key); return { addEventListener() {} }; }
    get() { return { addEventListener() {} }; }
    getKey() { return { addEventListener() {} }; }
  }
  const view = {
    IDBObjectStore,
    structuredClone: value => structuredClone(value),
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
  };
  const store = (database, name = 'keyvaluepairs') => Object.assign(Object.create(IDBObjectStore.prototype), {
    name, keyPath: null, transaction: { mode: 'readwrite', db: { name: database } },
  });
  const elapse = () => {
    for (const { callback, delay } of timers.splice(0)) {
      assert.equal(delay, NATIVE_SAVE_WINDOW_MS);
      callback();
    }
  };
  return { view, store, elapse, nativePuts };
}

function installWriteFilter(t) {
  const host = storageView();
  const breaks = [];
  const filter = installUnchangedChartWriteFilter(host.view, { onContractBreak: entry => breaks.push(entry) });
  t.after(() => assert.deepEqual(filter.breaks(), breaks));
  return { ...host, filter, breaks };
}

test('user is alerted when chart saves keep writing to a renamed chart database', t => {
  // Given the write filter observes Binance's save requests.
  const { filter, store, elapse, breaks, nativePuts } = installWriteFilter(t);
  const renamed = store('tv_chart_futures');

  // When three separate saves only write layout records into a renamed database.
  for (let save = 0; save < 3; save++) {
    filter.noteNativeSave();
    filter.noteNativeSave();
    renamed.put({ drawings: [] }, '#TV_SYMBOL-BTCUSDT@PRICETYPE=last');
    elapse();
    if (save < 2) assert.deepEqual(breaks, []);
  }

  // Then the writes stay native and the new layout is reported with its target.
  assert.equal(nativePuts.length, 3);
  assert.deepEqual(breaks.map(({ reason }) => reason), ['write-layout']);
  assert.match(breaks[0].detail, /tv_chart_futures\/keyvaluepairs\/#TV_SYMBOL-BTCUSDT@PRIC/);
  assert.deepEqual(filter.snapshot(), { compared: 0, skipped: 0, written: 0, unreadable: 0 });
});

test('user sees no layout alert while recognized chart writes still occur or nothing is written', t => {
  // Given saves whose windows contain a recognized write, no write at all, or unrelated writes.
  const { filter, store, elapse, breaks } = installWriteFilter(t);
  const windows = [
    () => store('chart_futures').put({ drawings: [] }, 'myTradingView.layout'),
    () => {},
    () => store('market_cache', 'ticks').put({ price: 1 }, 'BTCUSDT'),
    () => store('tv_chart_futures').put({ drawings: [] }, '#TV_SYMBOL-A'),
    () => store('tv_chart_futures').put({ drawings: [] }, '#TV_SYMBOL-A'),
    () => store('chart_futures').put({ drawings: [] }, '#TV_SYMBOL-A'),
    () => store('tv_chart_futures').put({ drawings: [] }, '#TV_SYMBOL-A'),
  ];

  // When each window closes.
  for (const write of windows) {
    filter.noteNativeSave();
    write();
    elapse();
  }

  // Then stalled or unrelated windows do not count, and a recognized write resets the misses.
  assert.deepEqual(breaks, []);
  assert.equal(filter.snapshot().compared, 2);
});

/** Minimal page surface for the sound hooks: sockets deliver frames, media elements count real plays. */
function soundView(t) {
  class WebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = []; }
    addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
  }
  class HTMLMediaElement { play() { this.played = (this.played ?? 0) + 1; return Promise.resolve('native'); } }
  class HTMLAudioElement extends HTMLMediaElement { constructor(src) { super(); this.src = src; this.currentSrc = src; } }
  let now = 0;
  const view = {
    WebSocket, HTMLMediaElement, HTMLAudioElement, Promise,
    Date: { now: () => now },
    location: { href: 'https://www.binance.com/en/futures/BIRBUSDT', pathname: '/en/futures/BIRBUSDT' },
  };
  const breaks = [];
  const scope = installFillSoundScope(view, null, entry => breaks.push(entry));
  t.after(async () => {
    await Promise.resolve();
    assert.deepEqual(scope.breaks(), breaks);
  });
  const socket = new view.WebSocket('wss://fstream.binance.com/private/stream');
  return {
    view, scope, breaks,
    advance(ms) { now += ms; },
    fill(symbol) {
      const data = JSON.stringify({ data: { e: 'ORDER_TRADE_UPDATE', o: { s: symbol, c: 'web', o: 'LIMIT', ot: 'LIMIT', x: 'TRADE', X: 'FILLED' } } });
      for (const listener of socket.listeners) listener.call(socket, { data, isTrusted: true });
    },
    audio: src => new view.HTMLAudioElement(src),
  };
}

const TRADE_SOUND = 'https://bin.bnbstatic.com/static/trade-sound.mp3';

test('user is alerted when trade sounds play but no page WebSocket carries order updates', async t => {
  // Given a tab whose account stream no longer uses the recognized order event.
  const host = soundView(t);
  const sound = host.audio(TRADE_SOUND);

  // When Binance plays the trade sound twice, each with its second play() call.
  await sound.play();
  await sound.play();
  assert.deepEqual(host.breaks, []);
  await sound.play();
  await Promise.resolve();

  // Then every sound still plays and the missing order stream is reported once.
  assert.equal(sound.played, 3);
  assert.deepEqual(host.breaks.map(({ reason }) => reason), ['sound-stream']);
});

test('user sees no stream alert when the trade sound follows observed order updates', async t => {
  // Given a tab that observed its own fill.
  const host = soundView(t);
  host.fill('BIRBUSDT');
  const sound = host.audio(TRADE_SOUND);

  // When many trade sounds play.
  for (let play = 0; play < 5; play++) await sound.play();
  await Promise.resolve();

  // Then no break is reported.
  assert.deepEqual(host.breaks, []);
});

test('user is alerted when another sound file keeps following fills while the trade sound never plays', async t => {
  // Given fills whose sound now uses a renamed file, plus an unrelated sound long after a fill.
  const host = soundView(t);
  const renamed = host.audio('https://bin.bnbstatic.com/static/fill-sound-v2.mp3?x=1');
  const notice = host.audio('https://bin.bnbstatic.com/static/notice.mp3');
  for (let fill = 0; fill < 3; fill++) {
    host.fill('ETHUSDT');
    host.advance(4000);
    await notice.play();
  }
  assert.deepEqual(host.breaks, []);

  // When the renamed sound plays shortly after three fills.
  for (let fill = 0; fill < 3; fill++) {
    host.fill('ETHUSDT');
    host.advance(600);
    await renamed.play();
  }
  await Promise.resolve();

  // Then it still plays natively and the renamed file is reported by path.
  assert.equal(renamed.played, 3);
  assert.deepEqual(host.breaks.map(({ reason }) => reason), ['sound-asset']);
  assert.match(host.breaks[0].detail, /^\/static\/fill-sound-v2\.mp3 played after 3 fills/);
});

test('user sees no asset alert once the recognized trade sound has played', async t => {
  // Given the recognized trade sound has played on this page.
  const host = soundView(t);
  host.fill('BIRBUSDT');
  await host.audio(TRADE_SOUND).play();

  // When other audio follows later fills.
  for (let fill = 0; fill < 3; fill++) {
    host.fill('BIRBUSDT');
    await host.audio('https://bin.bnbstatic.com/static/notice.mp3').play();
  }
  await Promise.resolve();

  // Then nothing is reported.
  assert.deepEqual(host.breaks, []);
});

test('user is alerted when Binance renames its chart keys inside the same database', t => {
  // Given the chart database and store are unchanged.
  const { filter, store, elapse, breaks } = installWriteFilter(t);

  // When three saves write only keys of a new naming scheme.
  for (let save = 0; save < 3; save++) {
    filter.noteNativeSave();
    store('chart_futures').put({ lines: [] }, 'v2:BTCUSDT');
    elapse();
  }

  // Then the renamed keys are reported from the database name alone.
  assert.deepEqual(breaks.map(({ reason }) => reason), ['write-layout']);
  assert.match(breaks[0].detail, /chart_futures\/keyvaluepairs\/v2:BTCUSDT/);
});
