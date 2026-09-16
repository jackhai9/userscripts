import { test, expect } from '../test.js';
import {
  CURRENT_SYMBOL,
  OTHER_SYMBOL,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const NATIVE_ROOT = '#futuresOrderbook .orderbook-tickSize';
const SHORTCUTS = `${PANEL} [data-orderbook-precision-value]`;
const PRECISION_STATUS = `${PANEL} [data-orderbook-precision-status]`;
const REFRESH = `${PANEL} [data-orderbook-precision-refresh]`;
const OTHER_OPTIONS = ['1', '10', '100', '1000'];

/** Record native clicks and rendered option sets without changing either controller. */
function installBootstrapObservation() {
  const clicks = [];
  const panels = [];
  const readSymbol = () => location.pathname.split('/').at(-1);
  const onClick = (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('#futuresOrderbook .orderbook-tickSize .bn-select-trigger')) return;
    clicks.push({
      symbol: readSymbol(),
      precision: document.querySelector('#futuresOrderbook .tick-content').textContent,
    });
  };
  let lastPanel = '';
  const observer = new MutationObserver(() => {
    const panel = {
      symbol: readSymbol(),
      options: Array.from(document.querySelectorAll(
        '#jh-binance-close-qty-multiplier-panel [data-orderbook-precision-value]',
      ), (node) => node.dataset.orderbookPrecisionValue),
    };
    const signature = JSON.stringify(panel);
    if (signature === lastPanel) return;
    lastPanel = signature;
    panels.push(panel);
  });
  document.addEventListener('click', onClick, true);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__PRECISION_BOOTSTRAP_OBSERVATION__ = { clicks, panels, observer, onClick };
}

test.afterEach(async ({ page }, testInfo) => {
  const observation = await page.evaluate(() => {
    const probe = window.__PRECISION_BOOTSTRAP_OBSERVATION__;
    if (!probe) return { clicks: [], panels: [] };
    probe.observer.disconnect();
    document.removeEventListener('click', probe.onClick, true);
    delete window.__PRECISION_BOOTSTRAP_OBSERVATION__;
    const latePortal = window.__PRECISION_BOOTSTRAP_LATE_PORTAL__;
    if (latePortal) {
      latePortal.bubble.remove();
      delete window.__PRECISION_BOOTSTRAP_LATE_PORTAL__;
    }
    return { clicks: probe.clicks, panels: probe.panels };
  });
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('precision-bootstrap-observation.json', {
      body: Buffer.from(JSON.stringify(observation, null, 2)),
      contentType: 'application/json',
    });
  }
});

async function expectPrecisionOptions(page, options, current) {
  await expect.poll(() => page.locator(SHORTCUTS).evaluateAll((nodes) => (
    nodes.map((node) => node.dataset.orderbookPrecisionValue)
  ))).toEqual(options);
  await expect(page.locator(`${PANEL} [data-orderbook-precision-value="${current}"]`))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(SHORTCUTS).first()).toBeEnabled();
}

async function openReadyPrecision(page) {
  await installScenarioClock(page);
  const scenario = createCancelScenario();
  const host = await openUserscriptScenario(page, scenario, {
    beforeOrderbook: `(${installBootstrapObservation.toString()})();`,
  });
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);
  await pauseScenarioClock(page);
  return { ...host, scenario };
}

async function readNativeClicks(page, symbol) {
  return page.evaluate((symbol) => window.__PRECISION_BOOTSTRAP_OBSERVATION__.clicks
    .filter((entry) => entry.symbol === symbol), symbol);
}

async function expectNoSelectionOrFinancialAction(page) {
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => [
    'precision-selected', 'order-submitted', 'cancel-requested', 'row-cancel-requested',
  ].includes(type))).toEqual([]);
}

for (const unavailable of ['bid quotes', 'ask quotes', 'precision field']) {
  test(`user waits for ${unavailable} before reading a new symbol's precision menu`, async ({ page }) => {
    // Given the original symbol has finished reading its own native precision options.
    const host = await openReadyPrecision(page);

    // When the host switches symbol before one required field or book side is ready.
    const replacement = await page.evaluate(({ unavailable, symbol, options }) => {
      const replacement = window.__BINANCE_FIXTURE__.replacePrecisionControl({
        scope: 'root', symbol, value: '10', options,
      });
      if (unavailable === 'precision field') {
        document.querySelector('#futuresOrderbook .tick-content').textContent = '';
      } else {
        const side = unavailable === 'bid quotes' ? 'bid' : 'ask';
        document.querySelectorAll(`#futuresOrderbook .${side}-light`).forEach((node) => {
          node.closest('.row-content').style.display = 'none';
        });
      }
      return replacement;
    }, { unavailable, symbol: OTHER_SYMBOL, options: OTHER_OPTIONS });
    if (unavailable !== 'precision field') {
      const side = unavailable === 'bid quotes' ? 'bid' : 'ask';
      expect(await page.locator(`#futuresOrderbook .${side}-light`).evaluateAll((nodes) => (
        nodes.map((node) => node.getClientRects().length)
      ))).toEqual([0, 0, 0, 0, 0, 0]);
    }
    await page.clock.runFor(1000);

    // Then bootstrap exposes a waiting state and never toggles the new symbol's native menu.
    await expect(page).toHaveURL(`https://www.binance.com/zh-CN/futures/${OTHER_SYMBOL}`);
    await expect(page.locator(SHORTCUTS)).toHaveCount(0);
    await expect(page.locator(PRECISION_STATUS)).toHaveText(
      unavailable === 'precision field' ? '等待精度档位' : '读取精度档位',
    );
    expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual([]);
    expect((await readFixtureState(page)).events.filter(({ type, symbol }) => (
      type === 'precision-overlay-opened' && symbol === OTHER_SYMBOL
    ))).toEqual([]);
    await expectNoSelectionOrFinancialAction(page);

    // When the missing field or quote side becomes available within the bootstrap deadline.
    await page.evaluate((unavailable) => {
      if (unavailable === 'precision field') {
        document.querySelector('#futuresOrderbook .tick-content').textContent = '10';
      } else {
        const side = unavailable === 'bid quotes' ? 'bid' : 'ask';
        document.querySelectorAll(`#futuresOrderbook .${side}-light`).forEach((node) => {
          node.closest('.row-content').style.removeProperty('display');
        });
      }
    }, unavailable);
    await page.clock.runFor(250);

    // Then bootstrap reads the new owned portal once and closes it without selecting a precision.
    await expectPrecisionOptions(page, OTHER_OPTIONS, '10');
    await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
    expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual([
      { symbol: OTHER_SYMBOL, precision: '10' },
      { symbol: OTHER_SYMBOL, precision: '10' },
    ]);
    expect((await readFixtureState(page)).events
      .filter(({ type, symbol }) => symbol === OTHER_SYMBOL && [
        'precision-overlay-opened', 'precision-overlay-closed',
      ].includes(type))
      .map(({ type, listboxId }) => ({ type, listboxId })))
      .toEqual([
        { type: 'precision-overlay-opened', listboxId: replacement.listboxId },
        { type: 'precision-overlay-closed', listboxId: replacement.listboxId },
      ]);
    await expectNoSelectionOrFinancialAction(page);
    expect(host.errors).toEqual([]);
  });
}

for (const menuState of ['missing', 'malformed']) {
  test(`user recovers a ${menuState} precision menu only by refreshing after the failed automatic attempt`, async ({ page }) => {
    // Given the original symbol's precision menu is healthy and its automatic bootstrap has completed.
    const host = await openReadyPrecision(page);

    // When the next symbol has either an unbound menu trigger or a malformed owned portal.
    await page.evaluate(({ menuState, symbol, options }) => {
      window.__BINANCE_FIXTURE__.replacePrecisionControl({
        scope: 'root', symbol, value: '10', options,
      });
      const trigger = document.querySelector('#futuresOrderbook .bn-select-trigger');
      if (menuState === 'missing') {
        trigger.replaceWith(trigger.cloneNode(true));
      } else {
        trigger.addEventListener('click', () => {
          const listbox = document.querySelector('.bn-select-bubble [role="listbox"]');
          listbox.parentElement.classList.remove('bn-select-overlay');
        }, { once: true });
      }
    }, { menuState, symbol: OTHER_SYMBOL, options: OTHER_OPTIONS });
    await page.clock.runFor(8000);

    // Then the bounded bootstrap reports failure without retaining old-symbol shortcuts or changing precision.
    await expect(page.locator(PRECISION_STATUS)).toHaveText('档位读取失败，请刷新');
    await expect(page.locator(SHORTCUTS)).toHaveCount(0);
    await expect(page.locator(REFRESH)).toBeEnabled();
    const failedClicks = await readNativeClicks(page, OTHER_SYMBOL);
    expect(failedClicks).toEqual(Array.from({ length: menuState === 'missing' ? 3 : 2 }, () => ({
      symbol: OTHER_SYMBOL, precision: '10',
    })));
    expect((await readFixtureState(page)).orderbookPrecision).toBe('10');
    await expectNoSelectionOrFinancialAction(page);

    // When the first five-second route watchdog runs after the failure.
    await page.clock.runFor(5000);

    // Then that watchdog does not start another automatic menu attempt.
    expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual(failedClicks);
    await expect(page.locator(PRECISION_STATUS)).toHaveText('档位读取失败，请刷新');

    // When a second five-second watchdog runs with the same failed symbol.
    await page.clock.runFor(5000);

    // Then the failed attempt remains final until the user explicitly asks for another read.
    expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual(failedClicks);
    await expect(page.locator(SHORTCUTS)).toHaveCount(0);

    // When the host repairs its native Select and another watchdog runs before any user refresh.
    const repaired = await page.evaluate(({ symbol, options }) => (
      window.__BINANCE_FIXTURE__.replacePrecisionControl({
        scope: 'select', symbol, value: '10', options,
      })
    ), { symbol: OTHER_SYMBOL, options: OTHER_OPTIONS });
    await page.clock.runFor(5000);

    // Then host repair alone does not bypass the symbol's one automatic-attempt contract.
    expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual(failedClicks);
    await expect(page.locator(SHORTCUTS)).toHaveCount(0);
    await expect(page.locator(PRECISION_STATUS)).toHaveText('档位读取失败，请刷新');

    // When the user presses the real precision refresh button against the repaired host.
    await page.locator(REFRESH).click();
    await page.clock.runFor(250);

    // Then one forced read installs the new symbol's exact options and closes only its repaired portal.
    await expectPrecisionOptions(page, OTHER_OPTIONS, '10');
    await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
    expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual([
      ...failedClicks,
      { symbol: OTHER_SYMBOL, precision: '10' },
      { symbol: OTHER_SYMBOL, precision: '10' },
    ]);
    expect((await readFixtureState(page)).events
      .filter(({ type, listboxId }) => listboxId === repaired.listboxId && [
        'precision-overlay-opened', 'precision-overlay-closed',
      ].includes(type))
      .map(({ type, symbol }) => ({ type, symbol })))
      .toEqual([
        { type: 'precision-overlay-opened', symbol: OTHER_SYMBOL },
        { type: 'precision-overlay-closed', symbol: OTHER_SYMBOL },
      ]);
    await expectNoSelectionOrFinancialAction(page);
    expect(host.errors).toEqual([]);
  });
}

test('user keeps current-symbol shortcuts when the previous symbol portal arrives after a pending read', async ({ page }) => {
  // Given the first symbol is ready before the other symbol opens a portal whose options have not mounted.
  const host = await openReadyPrecision(page);
  const pending = await page.evaluate(({ symbol, options }) => {
    const replacement = window.__BINANCE_FIXTURE__.replacePrecisionControl({
      scope: 'root', symbol, value: '10', options,
    });
    const trigger = document.querySelector('#futuresOrderbook .bn-select-trigger');
    trigger.addEventListener('click', () => {
      const listbox = document.querySelector('.bn-select-bubble [role="listbox"]');
      const options = Array.from(listbox.children);
      window.__PRECISION_BOOTSTRAP_LATE_PORTAL__ = {
        bubble: listbox.closest('.bn-select-bubble'), listbox, options,
      };
      options.forEach((option) => option.remove());
    }, { once: true });
    return replacement;
  }, { symbol: OTHER_SYMBOL, options: OTHER_OPTIONS });
  await page.clock.runFor(100);
  await expect(page.getByRole('listbox')).toHaveAttribute('id', pending.listboxId);
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.locator(PRECISION_STATUS)).toHaveText('读取精度档位');
  expect(await readNativeClicks(page, OTHER_SYMBOL)).toEqual([
    { symbol: OTHER_SYMBOL, precision: '10' },
  ]);

  // When the user returns to the first symbol and the detached old-symbol portal publishes its late options.
  const restored = await page.evaluate(({ symbol, value, options }) => {
    const panelStart = window.__PRECISION_BOOTSTRAP_OBSERVATION__.panels.length;
    const replacement = window.__BINANCE_FIXTURE__.replacePrecisionControl({
      scope: 'root', symbol, value, options,
    });
    const latePortal = window.__PRECISION_BOOTSTRAP_LATE_PORTAL__;
    latePortal.listbox.append(...latePortal.options);
    document.body.append(latePortal.bubble);
    return { ...replacement, panelStart };
  }, {
    symbol: CURRENT_SYMBOL,
    value: host.scenario.ui.orderbookPrecision,
    options: host.scenario.host.precisionOptions,
  });
  await page.clock.runFor(1500);

  // Then the stale portal remains separate while the current symbol installs only its own native options.
  await expect(page).toHaveURL(`https://www.binance.com/zh-CN/futures/${CURRENT_SYMBOL}`);
  await expectPrecisionOptions(page, host.scenario.host.precisionOptions, host.scenario.ui.orderbookPrecision);
  const lateOptions = page.locator(`[id="${pending.listboxId}"]`).getByRole('option');
  await expect(lateOptions).toHaveText(OTHER_OPTIONS);
  await expect(page.locator(`[id="${pending.listboxId}"]`)).toBeVisible();
  await expect(page.locator(`[id="${restored.listboxId}"]`)).toHaveCount(0);
  expect(await page.evaluate(({ symbol, panelStart }) => (
    window.__PRECISION_BOOTSTRAP_OBSERVATION__.panels.slice(panelStart)
      .filter((panel) => panel.symbol === symbol && panel.options.length > 0)
  ), { symbol: CURRENT_SYMBOL, panelStart: restored.panelStart }))
    .toEqual([{ symbol: CURRENT_SYMBOL, options: host.scenario.host.precisionOptions }]);
  expect((await readFixtureState(page)).events
    .filter(({ type, listboxId }) => listboxId === restored.listboxId && [
      'precision-overlay-opened', 'precision-overlay-closed',
    ].includes(type))
    .map(({ type, symbol }) => ({ type, symbol })))
    .toEqual([
      { type: 'precision-overlay-opened', symbol: CURRENT_SYMBOL },
      { type: 'precision-overlay-closed', symbol: CURRENT_SYMBOL },
    ]);
  await expectNoSelectionOrFinancialAction(page);
  expect(host.errors).toEqual([]);
});
