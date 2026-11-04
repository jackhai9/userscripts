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
export function installFillSoundScope(view) {
  const scope = createFillSoundScope({
    now: () => view.Date.now(),
    readCurrentSymbol: () => parseFuturesTradingSymbolFromPathname(view.location.pathname),
  });
  const NativeWebSocket = view.WebSocket;
  const nativeAddEventListener = NativeWebSocket.prototype.addEventListener;
  const playDescriptor = Object.getOwnPropertyDescriptor(view.HTMLMediaElement.prototype, 'play');
  const nativePlay = playDescriptor.value;

  function observeFrame(event) {
    if (typeof event.data !== 'string' || !event.data.includes(ORDER_UPDATE_MARKER)) return;
    const update = JSON.parse(event.data).data;
    if (update?.e === 'ORDER_TRADE_UPDATE') scope.recordOrderUpdate(update.o);
  }

  view.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      Reflect.apply(nativeAddEventListener, socket, ['message', observeFrame]);
      return socket;
    },
  });

  function play() {
    if (isTradeSound(this, view) && !scope.allowSound()) return view.Promise.resolve();
    return Reflect.apply(nativePlay, this, arguments);
  }
  Object.defineProperty(view.HTMLMediaElement.prototype, 'play', { ...playDescriptor, value: play });
  return Object.freeze({ snapshot: scope.snapshot });
}

export function installOrderSoundScope() {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_ORDER_SOUND__')) return;
  Object.defineProperty(self, '__BINANCE_ORDER_SOUND__', { value: installFillSoundScope(self), configurable: true });
}
