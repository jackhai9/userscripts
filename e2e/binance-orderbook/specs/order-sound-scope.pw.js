import { test, expect } from '../test.js';
import { filledOrder, openTradeSoundTab, routeAccountStream } from '../helpers/order-sound-host.js';

async function openTwoTradingTabs(page, context) {
  const stream = await routeAccountStream(context);
  const other = await context.newPage();
  const birb = await openTradeSoundTab(page, 'BIRBUSDT');
  const btc = await openTradeSoundTab(other, 'BTCUSDT');
  expect(stream.connected()).toBe(2);
  return { stream, birb, btc, other };
}

/** Both tabs ran their native player for every queued fill and its play promises settled. */
async function settledSounds(tabs, attempts) {
  for (const tab of tabs) {
    await expect.poll(async () => {
      const { attempts: started, settled } = await tab.sound();
      return { started, settled };
    }).toEqual({ started: attempts, settled: attempts });
  }
  return Promise.all(tabs.map(async tab => (await tab.sound()).plays));
}

test('user hears a fill only in the tab showing its symbol', async ({ page, context }) => {
  // Given BIRBUSDT and BTCUSDT tabs share one account stream with Binance's symbol-less trade sound.
  const { stream, birb, btc, other } = await openTwoTradingTabs(page, context);

  // When a BIRBUSDT order fills.
  stream.publishOrderUpdate(filledOrder('BIRBUSDT'));

  // Then only the BIRBUSDT tab plays the sound, although both native players tried.
  expect(await settledSounds([birb, btc], 1)).toEqual([1, 0]);
  expect([...birb.errors, ...btc.errors]).toEqual([]);
  await other.close();
});

test('user hears each tab\'s own fill after another symbol filled first', async ({ page, context }) => {
  // Given BIRBUSDT and BTCUSDT tabs share one account stream.
  const { stream, birb, btc, other } = await openTwoTradingTabs(page, context);

  // When BIRBUSDT fills and, after its sound, BTCUSDT fills.
  stream.publishOrderUpdate(filledOrder('BIRBUSDT', { X: 'PARTIALLY_FILLED' }));
  await settledSounds([birb, btc], 1);
  stream.publishOrderUpdate(filledOrder('BTCUSDT'));

  // Then each tab played exactly once, for its own symbol.
  expect(await settledSounds([birb, btc], 2)).toEqual([1, 1]);
  await other.close();
});

for (const [label, overrides] of [
  ['a liquidation', { o: 'LIQUIDATION', ot: 'LIQUIDATION', c: 'autoclose-fixture' }],
  ['a system close', { c: 'adl_autoclose-fixture' }],
]) {
  test(`user hears ${label} of another symbol in every tab`, async ({ page, context }) => {
    // Given BIRBUSDT and BTCUSDT tabs share one account stream.
    const { stream, birb, btc, other } = await openTwoTradingTabs(page, context);

    // When the exchange fills a BIRBUSDT order it created itself.
    stream.publishOrderUpdate(filledOrder('BIRBUSDT', overrides));

    // Then both tabs keep Binance's native sound.
    expect(await settledSounds([birb, btc], 1)).toEqual([1, 1]);
    await other.close();
  });
}
