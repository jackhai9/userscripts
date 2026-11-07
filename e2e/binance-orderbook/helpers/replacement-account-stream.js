import { once } from 'node:events';
import { wsServer as WebSocketServer } from 'playwright-core/lib/utilsBundle';

const ACCOUNT_STREAM = 'wss://fstream.binance.com/private/stream';

/**
 * Route a native Chromium WebSocket to loopback. Playwright routeWebSocket dispatches
 * synthetic MessageEvents, which a financial confirmation must reject.
 */
export async function routeReplacementAccountStream(page) {
  await page.context().grantPermissions(['local-network-access'], { origin: 'https://www.binance.com' });
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  page.on('close', () => {
    for (const socket of server.clients) socket.terminate();
    server.close();
  });
  await page.addInitScript(({ account, loopback }) => {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args, newTarget) {
        if (args[0] !== account) return Reflect.construct(target, args, newTarget);
        const socket = Reflect.construct(target, [loopback], newTarget);
        Object.defineProperty(socket, 'url', { value: account });
        window.__fixtureReplacementSocket = socket;
        return socket;
      },
    });
  }, { account: ACCOUNT_STREAM, loopback: 'ws://127.0.0.1:' + server.address().port });
  return {
    async connect() {
      await page.evaluate(url => new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('Fixture account stream failed')), { once: true });
      }), ACCOUNT_STREAM);
    },
    publish(order) {
      for (const socket of server.clients) socket.send(JSON.stringify({ data: { e: 'ORDER_TRADE_UPDATE', o: order } }));
    },
  };
}
