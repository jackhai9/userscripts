import { test, expect } from '../test.js';
import { openNotificationScenario, readNotificationEffects } from '../helpers/order-notifications-host.js';
import { readFixtureState } from '../helpers/userscript-page.js';

const panel = '#jh-binance-close-qty-multiplier-panel';
const currentSoundSourceSha256 = '0e53de2a0de8073e445688bdf6b858b9f0eb3c20b49ecda9f230418a7c85a2f8';

test('user keeps symbol-scoped reminders after native factories are independently renamed and formatted', async ({ page }, testInfo) => {
  // Given OUSDT loads the built userscript with independently repacked native modules
  const host = await openNotificationScenario(page, 'OUSDT', {
    soundSourceSha256: currentSoundSourceSha256,
    repackNativeFactories: true,
  });

  // When the native account consumers receive an unrelated USUSDT fill
  await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('USUSDT', 42));
  await page.clock.runFor(500);

  // Then all three renamed consumers are active and produce no foreign reminder
  expect(await page.evaluate(() => self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot())).toMatchObject({
    toastActive: true,
    soundActive: true,
    modules: {
      30877: { status: 'active' },
      39116: { status: 'active' },
      55401: { status: 'active' },
    },
  });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await readNotificationEffects(page)).toEqual({ audio: [], toasts: [] });

  // When the same renamed consumers receive an OUSDT fill on the matching route
  await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('OUSDT', 43));
  await page.clock.runFor(500);

  // Then the native toast and both audio calls remain available without financial actions
  await expect(page.getByRole('alert')).toHaveText('LIMIT BUY Order Filled');
  expect((await readNotificationEffects(page)).audio).toEqual([
    { kind: 'load', pathname: '/zh-CN/futures/OUSDT' },
    { kind: 'play', pathname: '/zh-CN/futures/OUSDT' },
    { kind: 'play', pathname: '/zh-CN/futures/OUSDT' },
  ]);
  await expect(page.locator(panel)).toBeVisible();
  expect(host.errors).toEqual([]);
  expect((await readFixtureState(page)).events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('repacked-ousdt-native-reminder.png'), fullPage: true });
});

for (const foreignSymbol of ['OUSDT', '龙虾USDT']) {
  test(`user hears the current native sound variant only for the matching USUSDT or ${foreignSymbol} tab`, async ({ page, browser }) => {
    // Given USUSDT and a different futures symbol load the current native sound source in isolated pages
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const foreignPage = await otherContext.newPage();
    try {
      const soundOptions = { soundSourceSha256: currentSoundSourceSha256 };
      const usHost = await openNotificationScenario(page, 'USUSDT', soundOptions);
      const foreignHost = await openNotificationScenario(foreignPage, foreignSymbol, soundOptions);
      expect(await foreignPage.evaluate(() => location.pathname)).toBe(`/zh-CN/futures/${encodeURIComponent(foreignSymbol)}`);

      // When both tabs receive the same USUSDT account fill through the real native consumers
      await page.evaluate(() => self.__NOTIFICATION_HOST__.notify('USUSDT', 42));
      await foreignPage.evaluate(() => self.__NOTIFICATION_HOST__.notify('USUSDT', 42));
      await page.clock.runFor(500);
      await foreignPage.clock.runFor(500);

      // Then only USUSDT presents its original native toast and load/play/play sound sequence
      await expect(page.getByRole('alert')).toHaveText('LIMIT BUY Order Filled');
      await expect(foreignPage.getByRole('alert')).toHaveCount(0);
      expect((await readNotificationEffects(page)).audio).toEqual([
        { kind: 'load', pathname: '/zh-CN/futures/USUSDT' },
        { kind: 'play', pathname: '/zh-CN/futures/USUSDT' },
        { kind: 'play', pathname: '/zh-CN/futures/USUSDT' },
      ]);
      expect(await readNotificationEffects(foreignPage)).toEqual({ audio: [], toasts: [] });
      expect(await page.evaluate(() => self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot())).toMatchObject({ toastActive: true, soundActive: true });
      expect(await foreignPage.evaluate(() => self.__BINANCE_ORDER_NOTIFICATIONS__.snapshot())).toMatchObject({ toastActive: true, soundActive: true });

      // When both tabs receive a fill matching the other page after the native cooldown
      await page.clock.runFor(2000);
      await foreignPage.clock.runFor(2000);
      await page.evaluate((symbol) => self.__NOTIFICATION_HOST__.notify(symbol, 43), foreignSymbol);
      await foreignPage.evaluate((symbol) => self.__NOTIFICATION_HOST__.notify(symbol, 43), foreignSymbol);
      await page.clock.runFor(500);
      await foreignPage.clock.runFor(500);

      // Then that page retains its native reminder while USUSDT gains no presentation or financial actions
      await expect(page.getByRole('alert')).toHaveCount(1);
      await expect(foreignPage.getByRole('alert')).toHaveText('LIMIT BUY Order Filled');
      expect((await readNotificationEffects(page)).audio.map((event) => event.kind)).toEqual(['load', 'play', 'play']);
      expect((await readNotificationEffects(foreignPage)).audio).toEqual([
        { kind: 'load', pathname: `/zh-CN/futures/${encodeURIComponent(foreignSymbol)}` },
        { kind: 'play', pathname: `/zh-CN/futures/${encodeURIComponent(foreignSymbol)}` },
        { kind: 'play', pathname: `/zh-CN/futures/${encodeURIComponent(foreignSymbol)}` },
      ]);
      await expect(page.locator(panel)).toBeVisible();
      await expect(foreignPage.locator(panel)).toBeVisible();
      expect(usHost.errors).toEqual([]);
      expect(foreignHost.errors).toEqual([]);
      expect((await readFixtureState(page)).events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
      expect((await readFixtureState(foreignPage)).events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
    } finally {
      await otherContext.close();
    }
  });
}

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
