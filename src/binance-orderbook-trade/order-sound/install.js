import { parseFuturesTradingSymbolFromPathname } from '../../shared/binance-futures-route.js';
import { isTopLevelTradingPage } from '../top-trading-page.js';
import { SOUND_STATUSES, createFillSoundScope } from './fill-sound-scope.js';

const ORDER_UPDATE_MARKER = '"ORDER_TRADE_UPDATE"';
const TRADE_SOUND_PATH = /\/trade-sound\.mp3$/;
/** Binance plays a trade sound right after the fill update; its helper calls play() twice. */
const UNATTRIBUTED_PLAY_LIMIT = 3;
const SOUND_AFTER_FILL_MS = 3000;
const RENAMED_SOUND_LIMIT = 3;

function isTradeSound(element, view) {
  return element instanceof view.HTMLAudioElement && TRADE_SOUND_PATH.test(new URL(element.src, view.location.href).pathname);
}

/**
 * Attributes Binance's trade sound through two standard boundaries: the documented
 * account stream event and the audio element's play method. It depends on neither
 * Binance's bundle nor its module names, reads frames without changing them, and only
 * parses frames carrying the order event. A renamed sound or changed stream leaves the
 * native sound in place, heard on every tab. Second `play()` calls from Binance's audio
 * helper reach an element already playing or already silenced, so they are safe either way.
 */
export function installFillSoundScope(view, observeCancellation, onContractBreak) {
  if (typeof onContractBreak !== 'function') throw new Error('Fill sound scope requires a contract break handler');
  const scope = createFillSoundScope({
    now: () => view.Date.now(),
    readCurrentSymbol: () => parseFuturesTradingSymbolFromPathname(view.location.pathname),
  });
  const NativeWebSocket = view.WebSocket;
  const nativeAddEventListener = NativeWebSocket.prototype.addEventListener;
  const playDescriptor = Object.getOwnPropertyDescriptor(view.HTMLMediaElement.prototype, 'play');
  const nativePlay = playDescriptor.value;

  const accountSockets = new Set();
  const breaks = [];
  const reported = new Set();
  let orderUpdates = 0;
  let tradeSoundPlays = 0;
  let lastSoundingFillAt = -Infinity;
  const soundsAfterFills = new Map();

  /** Each mismatch is reported once; the native sound keeps playing in every tab. */
  function report(reason, detail) {
    if (reported.has(reason)) return;
    reported.add(reason);
    const entry = Object.freeze({ reason, detail });
    breaks.push(entry);
    // play() runs inside Binance's audio helper; a failing handler must not change its result.
    queueMicrotask(() => onContractBreak(entry));
  }

  /**
   * The asset path is matched exactly, so a renamed file would silently sound in
   * every tab. Another audio file that keeps following fills while the known one
   * never plays is that renamed file.
   */
  function noteOtherAudio(element) {
    if (tradeSoundPlays > 0 || view.Date.now() - lastSoundingFillAt > SOUND_AFTER_FILL_MS) return;
    const { pathname } = new URL(element.currentSrc || element.src, view.location.href);
    const count = (soundsAfterFills.get(pathname) ?? 0) + 1;
    soundsAfterFills.set(pathname, count);
    if (count === RENAMED_SOUND_LIMIT) {
      report('sound-asset', `${pathname} played after ${count} fills while ${TRADE_SOUND_PATH.source} never played`);
    }
  }

  function observeFrame(event) {
    if (typeof event.data !== 'string' || !event.data.includes(ORDER_UPDATE_MARKER)) return;
    const update = JSON.parse(event.data).data;
    if (update?.e !== 'ORDER_TRADE_UPDATE') return;
    orderUpdates += 1;
    if (SOUND_STATUSES.has(update.o?.X)) lastSoundingFillAt = view.Date.now();
    scope.recordOrderUpdate(update.o);
    if (event.isTrusted && accountSockets.has(this)) observeCancellation?.(update.o);
  }

  view.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      const { origin, pathname } = new URL(socket.url);
      if (origin === 'wss://fstream.binance.com' && pathname === '/private/stream') {
        accountSockets.add(socket);
        Reflect.apply(nativeAddEventListener, socket, ['close', () => accountSockets.delete(socket), { once: true }]);
      }
      Reflect.apply(nativeAddEventListener, socket, ['message', observeFrame]);
      return socket;
    },
  });

  function play() {
    if (isTradeSound(this, view)) {
      tradeSoundPlays += 1;
      // Fills reach every tab through the account stream before the sound plays.
      if (orderUpdates === 0 && tradeSoundPlays === UNATTRIBUTED_PLAY_LIMIT) {
        report('sound-stream', `Trade sound played ${tradeSoundPlays} times, but no page WebSocket carried ${ORDER_UPDATE_MARKER}`);
      }
      if (!scope.allowSound()) return view.Promise.resolve();
    } else if (this instanceof view.HTMLAudioElement) {
      noteOtherAudio(this);
    }
    return Reflect.apply(nativePlay, this, arguments);
  }
  Object.defineProperty(view.HTMLMediaElement.prototype, 'play', { ...playDescriptor, value: play });
  return Object.freeze({
    snapshot: scope.snapshot,
    breaks: () => [...breaks],
    hasAccountStream: () => [...accountSockets].some(socket => socket.readyState === NativeWebSocket.OPEN),
  });
}

export function installOrderSoundScope(observeCancellation, { onContractBreak }) {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_ORDER_SOUND__')) return;
  const { snapshot, breaks, hasAccountStream } = installFillSoundScope(self, observeCancellation, onContractBreak);
  Object.defineProperty(self, '__BINANCE_ORDER_SOUND__', { value: Object.freeze({ snapshot, breaks }), configurable: true });
  return hasAccountStream;
}
