import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { createAnimationFrameBoundary } from '../helpers/orderbook-migration-frames.js';

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

function fixture({ visible, updatesPerFrame }) {
  return `
    const counts = { sorts: 0, sortMs: 0, sortedLevels: 0, profiles: 0,
      sockets: 0, fetches: 0, messages: 0 };
    const nativeSort = Array.prototype.sort;
    Array.prototype.sort = function(compare) {
      counts.sorts += 1; counts.sortedLevels += this.length;
      const start = performance.now();
      const result = nativeSort.call(this, compare);
      counts.sortMs += performance.now() - start;
      return result;
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
        counts.messages++;
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
    const frames = createAnimationFrameBoundary(page);
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
      frames.runFrame(0);
      const initial = {...counts};
      let messageHandlingMs = 0;
      let framePublicationMs = 0;
      let frameOpportunities = 0;
      let frameCallbacks = 0;
      for (let first=103; first<=302; first+=${updatesPerFrame}) {
        const messageStart = performance.now();
        for (let id=first; id<first+${updatesPerFrame}; id++) socket.update(id);
        messageHandlingMs += performance.now()-messageStart;
        frameCallbacks += frames.pendingCount;
        const frameStart = performance.now();
        frames.runFrame(++frameOpportunities * 16);
        framePublicationMs += performance.now()-frameStart;
      }
      const updates = Object.fromEntries(Object.entries(counts).map(([key,value]) => [key,value-initial[key]]));
      const resumeStart = performance.now();
      const resume = ${visible} ? null : subscribe();
      const resubscriptionMs = ${visible} ? 0 : performance.now()-resumeStart;
      const resubscription = Object.fromEntries(Object.entries(counts).map(([key,value]) => [key,value-initial[key]-updates[key]]));
      const final = {bids:latest.bids.length, asks:latest.asks.length,
        bidQuantity:latest.bids[0].quantity, askQuantity:latest.asks[0].quantity,
        bidCumulative:latest.bids.at(-1).cumulative,
        askCumulative:latest.asks.at(-1).cumulative};
      unsubscribe?.(); resume?.(); source.restore();
      return {messageHandlingMs, framePublicationMs, resubscriptionMs,
        completedWorkMs:messageHandlingMs+framePublicationMs+resubscriptionMs,
        frameOpportunities, frameCallbacks, pendingFrames:frames.pendingCount,
        initial, updates, resubscription, totals:{...counts}, final, profile:latest};
    }
    run();
  `;
}

async function measure(source, workload) {
  const context = vm.createContext({ URL, performance, setImmediate, createAnimationFrameBoundary });
  vm.runInContext(source, context);
  const result = await vm.runInContext(fixture(workload), context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.final)), {
    bids: 1000, asks: 1000, bidQuantity: 302, askQuantity: 303,
    bidCumulative: 1301, askCumulative: 1302,
  });
  assert.equal(result.totals.sockets, 1);
  assert.equal(result.totals.fetches, 1);
  assert.equal(result.updates.messages, 200);
  assert.equal(result.pendingFrames, 0);
  return JSON.parse(JSON.stringify(result));
}

const oldSource = await bundle(baseline);
const newSource = await bundle(null);
const report = { scope: 'Synthetic native transport; operation counts and local Node time, not live Chrome CPU.',
  countersScope: 'Initialization, 200 subsequent messages, and hidden-display resubscription are reported separately.',
  timingScope: 'Real Node elapsed time. Message handling includes encoding, parsing, validation, book writes and any synchronous publication; frame publication includes all pending callbacks. Sort time is a subset of those phases. Completed work includes resubscription, excludes initialization.',
  frameScope: 'Explicit simulated frame opportunities; no elapsed frame interval or live burst frequency is claimed. Every input message is processed, and final materialization is included.',
  profileEquality: 'Every final level and cumulative quantity is deep-equal in all before/after samples.',
  baselineRevision: baseline, levelsPerSide: 1000, updates: 200, samples: [] };
for (const workload of [
  { name: 'hidden', visible: false, updatesPerFrame: 20 },
  { name: 'visible one message per frame', visible: true, updatesPerFrame: 1 },
  { name: 'visible twenty messages per frame', visible: true, updatesPerFrame: 20 },
]) {
  const before = [], after = [];
  for (let sample = 0; sample < 3; sample++) {
    before.push(await measure(oldSource, workload));
    after.push(await measure(newSource, workload));
    assert.deepEqual(after[sample].profile, before[sample].profile);
    const publications = workload.visible ? 200 / workload.updatesPerFrame : 0;
    assert.equal(after[sample].updates.sorts, publications * 2);
    assert.equal(after[sample].updates.profiles, publications);
    assert.equal(after[sample].frameCallbacks, publications);
    assert.equal(after[sample].resubscription.sorts, workload.visible ? 0 : 2);
  }
  const median = (values, read) => values.map(read).sort((a, b) => a-b)[1];
  const summarizePhase = (values, phase) => ({
    ...values[0][phase], sortMs: median(values, value => value[phase].sortMs),
  });
  const summarize = values => ({
    initial: summarizePhase(values, 'initial'),
    updates: summarizePhase(values, 'updates'),
    resubscription: summarizePhase(values, 'resubscription'),
    frameOpportunities: values[0].frameOpportunities,
    frameCallbacks: values[0].frameCallbacks,
    medianMessageHandlingMs: median(values, value => value.messageHandlingMs),
    medianFramePublicationMs: median(values, value => value.framePublicationMs),
    medianResubscriptionMs: median(values, value => value.resubscriptionMs),
    medianCompletedWorkMs: median(values, value => value.completedWorkMs),
    final: values[0].final,
  });
  report.samples.push({...workload, before:summarize(before), after:summarize(after)});
}
console.log(JSON.stringify(report, null, 2));
