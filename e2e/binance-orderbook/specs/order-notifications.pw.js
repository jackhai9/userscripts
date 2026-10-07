import { test, expect } from '../test.js';
import { openNotificationScenario, readNotificationEffects } from '../helpers/order-notifications-host.js';
import { readFixtureState } from '../helpers/userscript-page.js';

const panel = '#jh-binance-close-qty-multiplier-panel';

test('user sees and hears each ordinary fill only in the matching isolated futures tab', async ({ page, browser }, testInfo) => {
  // Given two isolated Chromium pages load the real generated userscript before their native runtime
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const ethPage = await otherContext.newPage();
  try {
    const btcHost = await openNotificationScenario(page, 'BTCUSDT');
    const ethHost = await openNotificationScenario(ethPage, 'ETHUSDT');

    // When both tabs receive the same synthetic BTC account fill through real native hooks
    await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('BTCUSDT', 42));
    await ethPage.evaluate(() => self.__NOTIFICATION_HOST__.notify('BTCUSDT', 42));
    await page.clock.runFor(500);
    await ethPage.clock.runFor(500);

    // Then only BTC presents the original native toast and audio while both orderbooks remain usable
    await expect(page.getByRole('alert')).toHaveText('LIMIT BUY Order Filled');
    await expect(ethPage.getByRole('alert')).toHaveCount(0);
    expect((await readNotificationEffects(page)).audio.map((event) => event.kind)).toEqual(['load', 'play', 'play']);
    expect(await readNotificationEffects(ethPage)).toEqual({ audio: [], toasts: [] });
    await expect(page.locator(panel)).toBeVisible();
    await expect(ethPage.locator(panel)).toBeVisible();
    expect(await page.evaluate(() => self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot())).toMatchObject({ toastActive: true, soundActive: true });
    expect(await ethPage.evaluate(() => self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot())).toMatchObject({ toastActive: true, soundActive: true });
    expect(await page.evaluate(() => self.__NOTIFICATION_EARLY_ROOT__)).toBe(false);

    // When the same independent pages receive an ETH fill after the original native cooldown
    await page.clock.runFor(2000);
    await ethPage.clock.runFor(2000);
    await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('ETHUSDT', 43));
    await ethPage.evaluate(() => self.__NOTIFICATION_HOST__.notify('ETHUSDT', 43));
    await page.clock.runFor(500);
    await ethPage.clock.runFor(500);

    // Then ETH gets exactly its own reminder and the BTC tab gains no extra presentation
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(ethPage.getByRole('alert')).toHaveText('LIMIT BUY Order Filled');
    expect((await readNotificationEffects(page)).audio.map((event) => event.kind)).toEqual(['load', 'play', 'play']);
    expect((await readNotificationEffects(ethPage)).audio.map((event) => event.kind)).toEqual(['load', 'play', 'play']);
    expect(btcHost.errors).toEqual([]);
    expect(ethHost.errors).toEqual([]);
    expect((await readFixtureState(page)).events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
    expect((await readFixtureState(ethPage)).events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('btc-native-reminder.png'), fullPage: true });
    await ethPage.screenshot({ path: testInfo.outputPath('eth-native-reminder.png'), fullPage: true });
  } finally {
    await otherContext.close();
  }
});

test('user receives only the new-symbol reminder after SPA navigation during native delays', async ({ page }, testInfo) => {
  // Given BTC has queued an ordinary reminder inside the real native toast and audio delays
  const host = await openNotificationScenario(page, 'BTCUSDT');
  await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('BTCUSDT', 42));
  await page.clock.runFor(29);

  // When SPA navigation switches to ETH before either native notification deadline
  await page.evaluate(() => history.replaceState({}, '', '/zh-CN/futures/ETHUSDT'));
  await page.clock.runFor(471);

  // Then the stale BTC reminder has no rendered or audible effect on the new route
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await readNotificationEffects(page)).toEqual({ audio: [], toasts: [] });
  await expect(page.locator(panel)).toBeVisible();

  // When an ETH order completes on the new route without reinjecting the userscript
  await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('ETHUSDT', 43));
  await page.clock.runFor(500);

  // Then ETH receives its original native reminder and the orderbook remains active without page errors
  await expect(page.getByRole('alert')).toHaveText('LIMIT BUY Order Filled');
  expect((await readNotificationEffects(page)).audio).toEqual([
    { kind: 'load', pathname: '/zh-CN/futures/ETHUSDT' },
    { kind: 'play', pathname: '/zh-CN/futures/ETHUSDT' },
    { kind: 'play', pathname: '/zh-CN/futures/ETHUSDT' },
  ]);
  expect(await page.evaluate(() => self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot())).toMatchObject({ toastActive: true, soundActive: true });
  await expect(page.locator(panel)).toBeVisible();
  expect(host.errors).toEqual([]);
  expect((await readFixtureState(page)).events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('spa-eth-native-reminder.png'), fullPage: true });
});
