import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = process.argv[2];
if (process.argv.length !== 3) {
  throw new Error('Usage: node test/manual/binance-depth-performance-benchmark.mjs <baseline-revision>');
}
const entry = 'src/binance-orderbook-trade/core/binance-native-depth-source.js';

async function bundle(revision) {
  const result = await build({
    entryPoints: [join(root, entry)], bundle: true, write: false,
    format: 'iife', globalName: 'DepthSource', platform: 'browser',
    plugins: [{ name: 'revision-source', setup(builder) {
      builder.onLoad({ filter: /\.js$/ }, ({ path }) => {
        const name = relative(root, path);
        assert.ok(name.startsWith('src/'), 'Benchmark imports only repository source');
        return { loader: 'js', contents: revision === null
          ? readFileSync(path, 'utf8')
          : execFileSync('git', ['show', `${revision}:${name}`], {
            cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
          }) };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

function fixture(visible) {
  return `
    const counts = { sorts: 0, sortedLevels: 0, profiles: 0, sockets: 0, fetches: 0 };
    const nativeSort = Array.prototype.sort;
    Array.prototype.sort = function(compare) {
      counts.sorts += 1; counts.sortedLevels += this.length;
      return nativeSort.call(this, compare);
    };
    const snapshot = { lastUpdateId: 101,
      bids: Array.from({length: 1000}, (_, i) => [String(100 - i / 100), '1']),
      asks: Array.from({length: 1000}, (_, i) => [String(101 + i / 100), '1']) };
    class NativeSocket {
      constructor() { counts.sockets++; this.listeners = new Map(); }
      addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(callback);
      }
      update(id) {
        const data = JSON.stringify({ stream:'btcusdt@rpiDepth@500ms', data:{
          e:'depthUpdate', s:'BTCUSDT', st:1,
          U:id === 102 ? 100 : id, u:id, pu:id === 102 ? 99 : id-1,
          b:[['100', String(id)]], a:[['101', String(id+1)]] } });
        for (const callback of this.listeners.get('message')) callback({data});
      }
    }
    const page = { location:{href:'https://www.binance.com/en/futures/BTCUSDT'},
      WebSocket:NativeSocket,
      fetch() { counts.fetches++; return Promise.resolve({ok:true,
        clone() { return {json:()=>Promise.resolve(snapshot)}; } }); }
    };
    const source = DepthSource.installBinanceNativeDepthSource(page);
    let latest = null;
    function subscribe() { return source.subscribe({symbol:'BTCUSDT',
      onStatus() {}, onProfile(profile) { counts.profiles++; latest = profile; } }); }
    const unsubscribe = ${visible} ? subscribe() : null;
    const socket = new page.WebSocket('wss://native-depth.example/ws');
    const response = page.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
    socket.update(102);
    async function run() {
      await response;
      await new Promise(resolve => setImmediate(resolve));
      const start = performance.now();
      for (let id=103; id<=302; id++) socket.update(id);
      const elapsedMs = performance.now()-start;
      const throughUpdates = {...counts};
      const resume = ${visible} ? null : subscribe();
      const final = {bids:latest.bids.length, asks:latest.asks.length,
        bidQuantity:latest.bids[0].quantity, askQuantity:latest.asks[0].quantity,
        bidCumulative:latest.bids.at(-1).cumulative,
        askCumulative:latest.asks.at(-1).cumulative};
      unsubscribe?.(); resume?.(); source.restore();
      return {elapsedMs, throughUpdates, final, profile:latest};
    }
    run();
  `;
}

async function measure(source, visible) {
  const context = vm.createContext({ URL, performance, setImmediate });
  vm.runInContext(source, context);
  const result = await vm.runInContext(fixture(visible), context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.final)), {
    bids: 1000, asks: 1000, bidQuantity: 302, askQuantity: 303,
    bidCumulative: 1301, askCumulative: 1302,
  });
  assert.equal(result.throughUpdates.sockets, 1);
  assert.equal(result.throughUpdates.fetches, 1);
  return JSON.parse(JSON.stringify(result));
}

const oldSource = await bundle(baseline);
const newSource = await bundle(null);
const report = { scope: 'Synthetic native transport; operation counts and local Node time, not live Chrome CPU.',
  countersScope: 'Initialization and 200 subsequent updates, before a hidden display resubscribes.',
  timingScope: 'The 200 subsequent updates only; initialization and resubscription are excluded.',
  profileEquality: 'Every final level and cumulative quantity is deep-equal in all before/after samples.',
  baselineRevision: baseline, levelsPerSide: 1000, updates: 200, samples: [] };
for (const visible of [false, true]) {
  const before = [], after = [];
  for (let sample = 0; sample < 3; sample++) {
    before.push(await measure(oldSource, visible));
    after.push(await measure(newSource, visible));
    assert.deepEqual(after[sample].profile, before[sample].profile);
  }
  const summarize = values => ({
    ...values[0].throughUpdates,
    medianMs: values.map(x => x.elapsedMs).sort((a, b) => a-b)[1],
    final: values[0].final,
  });
  report.samples.push({visible, before:summarize(before), after:summarize(after)});
}
assert.equal(report.samples[0].before.sorts, 402);
assert.equal(report.samples[0].after.sorts, 0);
console.log(JSON.stringify(report, null, 2));
