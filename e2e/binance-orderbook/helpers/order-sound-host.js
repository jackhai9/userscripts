import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from './userscript-page.js';

const ACCOUNT_STREAM = 'wss://fstream.binance.com/pm/ws/fixture-listen-key';
const TRADE_SOUND = 'https://bin.bnbstatic.com/static/spot-trade-ui/trade-sound.mp3';

/** A 0.2 s silent 8 kHz mono PCM WAV, enough for Chromium to start real playback. */
function silentWav() {
  const samples = 1600;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(8000, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

/**
 * Serve one account stream to every tab of the context, as Binance opens one
 * account connection per tab and each receives every symbol's order updates.
 */
export async function routeAccountStream(context) {
  const sockets = new Set();
  await context.routeWebSocket(ACCOUNT_STREAM, socket => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
  });
  await context.route(TRADE_SOUND, route => route.fulfill({ contentType: 'audio/wav', body: silentWav() }));
  return {
    connected: () => sockets.size,
    publishOrderUpdate(order) {
      const frame = JSON.stringify({ stream: 'fixture-listen-key', data: { e: 'ORDER_TRADE_UPDATE', E: 1, T: 1, o: order } });
      for (const socket of sockets) socket.send(frame);
    },
  };
}

/**
 * Reproduces Binance's captured trade-sound path without symbol information:
 * the order producer (FILLED, PARTIALLY_FILLED or EXPIRED, 500 ms trailing debounce,
 * at most two queued entries) and the `29042` player (2 s spacing, `load()` then
 * `play()` and a second `play()` once the first resolves). Counts real `play` events.
 */
function installNativeTradeSound({ streamUrl, soundUrl }) {
  const audio = document.createElement('audio');
  document.body.append(audio);
  const state = { attempts: 0, settled: 0, plays: 0 };
  audio.addEventListener('play', () => { state.plays += 1; });
  const queue = [];
  let spacing = null;
  let debounce = null;
  function playNext() {
    if (spacing !== null || queue.length === 0) return;
    queue.shift();
    audio.src = soundUrl;
    audio.load();
    state.attempts += 1;
    const first = audio.play();
    first.then(() => audio.play()).catch(() => {}).finally(() => { state.settled += 1; });
    spacing = setTimeout(() => { spacing = null; playNext(); }, 2000);
  }
  const socket = new WebSocket(streamUrl);
  socket.addEventListener('message', event => {
    const order = JSON.parse(event.data).data.o;
    if (!['FILLED', 'PARTIALLY_FILLED', 'EXPIRED'].includes(order.X)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (queue.length < 2) queue.push('fill');
      playNext();
    }, 500);
  });
  window.__TRADE_SOUND__ = state;
  return new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
}

/** Open a futures tab running the generated orderbook userscript with Binance's trade sound. */
export async function openTradeSoundTab(page, symbol) {
  const host = await openUserscriptScenario(page, createCancelScenario({ currentSymbol: symbol }));
  // Chromium allows media playback after the user has interacted with the page.
  await page.mouse.click(1, 1);
  await page.evaluate(installNativeTradeSound, { streamUrl: ACCOUNT_STREAM, soundUrl: TRADE_SOUND });
  return {
    errors: host.errors,
    sound: () => page.evaluate(() => ({ ...window.__TRADE_SOUND__ })),
  };
}

export function filledOrder(symbol, overrides = {}) {
  return { s: symbol, c: 'web_fixture_client_id', S: 'SELL', o: 'LIMIT', ot: 'LIMIT', x: 'TRADE', X: 'FILLED', ...overrides };
}
