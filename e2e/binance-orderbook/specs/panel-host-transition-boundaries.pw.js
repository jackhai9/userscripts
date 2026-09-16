import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import {
  DEPTH_LABEL_LEVELS,
  DEPTH_LABEL_SYMBOL,
  DEPTH_PROFILE_SELECTOR,
  emitDepthLabelUpdate,
  openDepthLabelScenario,
  readDepthDrawing,
} from '../helpers/depth-profile-fixture.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const SPACER = '#jh-binance-close-qty-multiplier-spacer';
const INPUT = '#jh-binance-close-qty-multiplier-input';
const DEPTH_KEY = 'jh_binance_depth_profile_enabled_v1';

async function openReadyPanel(page) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario());
  await expect(page.locator('[data-orderbook-precision-value="0.01"]')).toBeEnabled();
  await pauseScenarioClock(page);
  return host;
}

async function expectNoFinancialActions(page) {
  expect((await readFixtureState(page)).events.filter(event => [
    'order-submitted', 'cancel-requested', 'row-cancel-requested',
  ].includes(event.type))).toEqual([]);
}

async function publishDepthPreference(page, value) {
  await page.evaluate(({ key, value }) => {
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value }));
  }, { key: DEPTH_KEY, value });
}

test('user keeps the panel hidden until the native form restores its missing placement anchor', async ({ page }) => {
  // Given the rendered panel retains a user multiplier beside the native trade tabs.
  const host = await openReadyPanel(page);
  await page.locator(INPUT).fill('4');
  await page.locator(INPUT).blur();
  const panel = await page.locator(PANEL).elementHandle();

  // When native reconciliation detaches the trade tabs before a window resize.
  await page.evaluate(() => {
    const node = document.querySelector('#position-direction');
    window.__DETACHED_TRADE_ANCHOR__ = { node, parent: node.parentElement, next: node.nextSibling };
    node.remove();
    window.dispatchEvent(new Event('resize'));
  });
  await page.clock.runFor(100);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.clock.runFor(100);

  // Then the spacer is removed and the existing panel cannot intercept pointer events without an anchor.
  await expect(page.locator(SPACER)).toHaveCount(0);
  await expect(page.locator(PANEL)).toHaveCSS('visibility', 'hidden');
  await expect(page.locator(PANEL)).toHaveCSS('pointer-events', 'none');
  expect(await panel.evaluate(node => node === document.querySelector('#jh-binance-close-qty-multiplier-panel'))).toBe(true);

  // When the same native tabs mount again and layout is observed.
  await page.evaluate(() => {
    const { node, parent, next } = window.__DETACHED_TRADE_ANCHOR__;
    parent.insertBefore(node, next);
    delete window.__DETACHED_TRADE_ANCHOR__;
    window.dispatchEvent(new Event('resize'));
  });
  await page.clock.runFor(100);

  // Then one anchored panel restores the user's setting and its pointer interaction.
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator(SPACER)).toHaveCount(1);
  await expect(page.locator(INPUT)).toHaveValue('4');
  expect(await panel.evaluate(node => node === document.querySelector('#jh-binance-close-qty-multiplier-panel'))).toBe(true);
  await panel.dispose();
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

test('user cannot interact with the floating panel while its native form has no visible layout area', async ({ page }) => {
  // Given the native order form provides the panel's measured placement rectangle.
  const host = await openReadyPanel(page);

  // When the native page hides its form column during a layout transition.
  await page.locator('#trade-form').evaluate(node => { node.style.display = 'none'; });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.clock.runFor(100);

  // Then the zero-area anchor keeps the overlay hidden and unable to receive pointer events.
  await expect(page.locator(PANEL)).toHaveCSS('visibility', 'hidden');
  await expect(page.locator(PANEL)).toHaveCSS('pointer-events', 'none');
  expect(await page.locator(SPACER).evaluate(node => {
    const { width, height } = node.getBoundingClientRect();
    return { width, height };
  })).toEqual({ width: 0, height: 0 });

  // When the native form becomes visible again and the browser publishes its resize.
  await page.locator('#trade-form').evaluate(node => node.style.removeProperty('display'));
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.clock.runFor(100);

  // Then the panel becomes available at the restored native anchor without a new action.
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator(INPUT)).toHaveValue('1');
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

test('user keeps one correctly owned floating panel after the host reparents its DOM during layout', async ({ page }) => {
  // Given a ready floating panel has an established native form anchor.
  const host = await openReadyPanel(page);
  const panel = await page.locator(PANEL).elementHandle();

  // When the page reparents that panel into a temporary layout container and resizes.
  await page.evaluate(() => {
    const temporary = document.createElement('div');
    temporary.id = 'native-temporary-layout';
    document.body.append(temporary);
    temporary.append(document.querySelector('#jh-binance-close-qty-multiplier-panel'));
    window.dispatchEvent(new Event('resize'));
  });
  await page.clock.runFor(100);

  // Then the original panel returns to body ownership and the temporary container is empty.
  expect(await panel.evaluate(node => node.parentElement === document.body)).toBe(true);
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('#native-temporary-layout > *')).toHaveCount(0);
  await panel.dispose();
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

test('user synchronizes depth visibility from another browser context without opening another depth stream', async ({ page }) => {
  // Given a real native depth snapshot is rendered through the complete userscript entrypoint.
  const host = await openDepthLabelScenario(page);
  const root = page.locator(DEPTH_PROFILE_SELECTOR);
  const expectedLabels = ['1.3 · 620K', '1.8 · 3.8M', '2 · 2.4M'];
  await expect.poll(async () => (await readDepthDrawing(page)).texts.map(({ text }) => text).sort())
    .toEqual(expectedLabels);

  // When another browser context disables the depth profile through its shared preference.
  await publishDepthPreference(page, '0');

  // Then the canvas is collapsed without disconnecting or replacing the page-owned stream.
  await expect(root).toHaveAttribute('data-expanded', 'false');
  await expect(root.locator('canvas')).toBeHidden();
  await expect.poll(async () => (await readDepthDrawing(page)).texts).toEqual([]);
  expect(await page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.socketCount)).toBe(1);

  // When that browser context enables the preference again.
  await publishDepthPreference(page, '1');

  // Then the cached native snapshot is rendered again without a second snapshot or stream.
  await expect(root).toHaveAttribute('data-expanded', 'true');
  await expect.poll(async () => (await readDepthDrawing(page)).texts.map(({ text }) => text).sort())
    .toEqual(expectedLabels);
  expect(host.snapshotRequests).toHaveLength(1);
  expect(await page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.socketCount)).toBe(1);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

test('user sees invalid native depth clear the canvas and recovers only from valid native data', async ({ page }) => {
  // Given the depth profile is showing current native quantities.
  const host = await openDepthLabelScenario(page);
  const root = page.locator(DEPTH_PROFILE_SELECTOR);
  await expect.poll(async () => (await readDepthDrawing(page)).texts.length).toBeGreaterThan(0);

  // When the native stream publishes an invalid negative quantity.
  await emitDepthLabelUpdate(page, { asks: [['1.8', '-1']], bids: [] });

  // Then the native failure is visible and no stale or negative quantity remains painted.
  await expect(root.locator('.jh-depth-profile-status')).toHaveText('深度数据不可用');
  await expect(root.locator('.jh-depth-profile-status')).toHaveAttribute('title', /Invalid depth profile .* quantity/);
  await expect.poll(async () => (await readDepthDrawing(page)).texts).toEqual([]);
  expect(await root.locator('canvas').evaluate(canvas => (
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.every(value => value === 0)
  ))).toBe(true);

  // When the user disables and enables the view before the native stream recovers.
  await publishDepthPreference(page, '0');
  await expect(root).toHaveAttribute('data-expanded', 'false');
  await publishDepthPreference(page, '1');
  await expect(root).toHaveAttribute('data-expanded', 'true');

  // Then enabling alone cannot replace the native error with invented depth.
  await expect(root.locator('.jh-depth-profile-status')).toHaveText('深度数据不可用');
  await expect.poll(async () => (await readDepthDrawing(page)).texts).toEqual([]);

  // When the next valid native update follows the rejected sequence number.
  await emitDepthLabelUpdate(page, { asks: DEPTH_LABEL_LEVELS.asks, bids: [] });

  // Then the missing accepted sequence requires a fresh native snapshot instead of invented continuity.
  await expect(root.locator('.jh-depth-profile-status')).toHaveText('重新同步深度');
  await expect(root.locator('.jh-depth-profile-status')).toHaveAttribute('title',
    '重新同步深度: Depth update sequence gap: expected pu 102, received 103');
  await expect.poll(async () => (await readDepthDrawing(page)).texts).toEqual([]);
  expect(host.snapshotRequests).toHaveLength(1);

  // When the native page fetches a fresh snapshot with an overlapping stream update.
  const recoveryRequests = [];
  await page.route('https://www.binance.com/fapi/v1/rpiDepth**', async route => {
    const url = new URL(route.request().url());
    recoveryRequests.push({ symbol: url.searchParams.get('symbol'), limit: url.searchParams.get('limit') });
    await route.fulfill({ json: { lastUpdateId: 105, ...DEPTH_LABEL_LEVELS } });
  });
  await page.evaluate(async symbol => {
    const state = window.__DEPTH_LABEL_FIXTURE__;
    const snapshot = fetch(`/fapi/v1/rpiDepth?${new URLSearchParams({ symbol, limit: '1000' })}`);
    state.updateId = 105;
    state.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      stream: `${symbol.toLowerCase()}@rpiDepth@500ms`,
      data: { e: 'depthUpdate', s: symbol, st: 1, U: 105, u: 105, pu: 104, b: [], a: [] },
    }) }));
    await (await snapshot).json();
  }, DEPTH_LABEL_SYMBOL);

  // Then only validated depth returns through the original stream and the error text is cleared.
  await expect(root.locator('.jh-depth-profile-status')).toHaveText('');
  await expect.poll(async () => (await readDepthDrawing(page)).texts.map(({ text }) => text).sort())
    .toEqual(['1.3 · 620K', '1.8 · 3.8M', '2 · 2.4M']);
  expect(host.snapshotRequests).toHaveLength(1);
  expect(recoveryRequests).toEqual([{ symbol: DEPTH_LABEL_SYMBOL, limit: '1000' }]);
  expect(await page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.socketCount)).toBe(1);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});
