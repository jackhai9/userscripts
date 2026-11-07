import { parseFuturesTradingSymbolFromPathname } from '../../shared/binance-futures-route.js';
import { isTopLevelTradingPage } from '../top-trading-page.js';
import { createFillSoundScope } from './fill-sound-scope.js';

const ORDER_UPDATE_MARKER = '"ORDER_TRADE_UPDATE"';
const TRADE_SOUND_PATH = /\/trade-sound\.mp3$/;

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
export function installFillSoundScope(view, observeCancellation = null) {
  const scope = createFillSoundScope({
    now: () => view.Date.now(),
    readCurrentSymbol: () => parseFuturesTradingSymbolFromPathname(view.location.pathname),
  });
  const NativeWebSocket = view.WebSocket;
  const nativeAddEventListener = NativeWebSocket.prototype.addEventListener;
  const playDescriptor = Object.getOwnPropertyDescriptor(view.HTMLMediaElement.prototype, 'play');
  const nativePlay = playDescriptor.value;

  const accountSockets = new Set();
  function observeFrame(event) {
    if (typeof event.data !== 'string' || !event.data.includes(ORDER_UPDATE_MARKER)) return;
    const update = JSON.parse(event.data).data;
    if (update?.e !== 'ORDER_TRADE_UPDATE') return;
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
    if (isTradeSound(this, view) && !scope.allowSound()) return view.Promise.resolve();
    return Reflect.apply(nativePlay, this, arguments);
  }
  Object.defineProperty(view.HTMLMediaElement.prototype, 'play', { ...playDescriptor, value: play });
  return Object.freeze({ snapshot: scope.snapshot, hasAccountStream: () => [...accountSockets].some(socket => socket.readyState === NativeWebSocket.OPEN) });
}

export function installOrderSoundScope(observeCancellation) {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_ORDER_SOUND__')) return;
  const { snapshot, hasAccountStream } = installFillSoundScope(self, observeCancellation);
  Object.defineProperty(self, '__BINANCE_ORDER_SOUND__', { value: Object.freeze({ snapshot }), configurable: true });
  return hasAccountStream;
}
