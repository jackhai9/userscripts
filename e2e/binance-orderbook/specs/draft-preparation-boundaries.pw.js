import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

async function beginPlan(page, action) {
  await page.evaluate(action => {
    window.__PLANNER_TEST_RESULT__ = null;
    window.__TM_CLOSE_LONG_DEBUG__.buildLadderPlan(action).then(
      plan => { window.__PLANNER_TEST_RESULT__ = { status: 'planned', orders: plan.orders }; },
      error => { window.__PLANNER_TEST_RESULT__ = {
        status: 'refused', message: error.message, recoveryKind: error.continuousRecoveryKind,
      }; },
    );
  }, action);
}

async function planResult(page) {
  return page.evaluate(() => window.__PLANNER_TEST_RESULT__);
}

async function noOrderActions(page) {
  expect((await readFixtureState(page)).events.filter(({ type }) => /order-submitted|cancel-requested/.test(type))).toEqual([]);
}

for (const mode of ['OPEN', 'CLOSE']) {
  for (const availability of ['missing', 'uncommitted']) {
    test(`user cannot prepare ${mode} orders while its native mode tab is ${availability}`, async ({ page }) => {
      // Given the opposite native mode is active and the requested mode cannot commit.
      await installScenarioClock(page);
      const host = await openUserscriptScenario(page, createCancelScenario({
        positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' }],
        ui: { tradeMode: mode === 'OPEN' ? 'CLOSE' : 'OPEN' },
      }));
      await pauseScenarioClock(page);
      await page.locator(`[data-trade-mode="${mode}"]`).evaluate((tab, availability) => {
        if (availability === 'missing') tab.remove();
        else tab.addEventListener('click', event => event.stopImmediatePropagation(), true);
      }, availability);

      // When the production planner requests that mode and its observed-state deadline elapses.
      await beginPlan(page, `${mode}_LONG`);
      await page.clock.runFor(1100);

      // Then the precise missing mode is reported as a controls readiness failure without a proposed order.
      await expect.poll(() => planResult(page)).toEqual({
        status: 'refused', message: `未能切换至${mode === 'OPEN' ? '开仓' : '平仓'}`, recoveryKind: 'controls_not_ready',
      });
      expect((await readFixtureState(page)).tradeMode).toBe(mode === 'OPEN' ? 'CLOSE' : 'OPEN');
      await noOrderActions(page);
      expect(host.errors).toEqual([]);
    });
  }
}

for (const unavailable of ['missing precision', 'missing Post Only tab', 'uncommitted Post Only tab']) {
  test(`user cannot prepare a ladder with ${unavailable}`, async ({ page }) => {
    // Given native form readiness loses one explicitly required prerequisite.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await pauseScenarioClock(page);
    await page.evaluate(unavailable => {
      if (unavailable === 'missing precision') document.querySelector('#futuresOrderbook .tick-content').remove();
      else if (unavailable === 'missing Post Only tab') document.querySelector('.order-type-tabs').replaceChildren();
      else document.querySelector('[data-tab-key="POST_ONLY"]').setAttribute('aria-selected', 'false');
    }, unavailable);

    // When the real planner attempts to establish a maker-only order draft.
    await beginPlan(page, 'OPEN_LONG');
    await page.clock.runFor(1100);

    // Then the missing prerequisite prevents any plan or order from being accepted.
    const precision = unavailable === 'missing precision';
    await expect.poll(() => planResult(page)).toEqual({
      status: 'refused',
      message: precision ? '未识别价格精度' : '只做 Maker 未生效，请刷新页面后重试',
      recoveryKind: precision ? 'market_data_not_ready' : 'controls_not_ready',
    });
    await noOrderActions(page);
    expect(host.errors).toEqual([]);
  });
}

for (const changed of [
  { name: 'symbol', message: '读取可开数量时交易对已变化，已停止', recoveryKind: undefined },
  { name: 'mode', message: '读取可开数量时下单模式已变化，已停止', recoveryKind: undefined },
  { name: 'precision', message: '读取可开数量时价格精度已变化，已停止', recoveryKind: 'precision_changed' },
  { name: 'order type', message: '读取可开数量时只做 Maker 已失效，请刷新页面后重试', recoveryKind: undefined },
  { name: 'allocation', message: '读取下单数量时比例、笔数或间距已变化', recoveryKind: 'options_changed' },
]) {
  test(`user refuses a ladder draft if its ${changed.name} changes during the native quantity calculation`, async ({ page }) => {
    // Given a native price write triggers a separate, observable form-context update.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await pauseScenarioClock(page);
    await page.locator('#limitPrice-open').evaluate((input, change) => {
      input.addEventListener('input', () => {
        if (change === 'symbol') window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT');
        if (change === 'mode') {
          document.querySelector('[data-trade-mode="OPEN"]').setAttribute('aria-selected', 'false');
          document.querySelector('[data-trade-mode="CLOSE"]').setAttribute('aria-selected', 'true');
        }
        if (change === 'precision') window.__BINANCE_FIXTURE__.replacePrecisionControl({
          scope: 'root', value: '0.01', symbol: 'HYPEUSDT', options: ['0.001', '0.01', '0.1', '1'],
        });
        if (change === 'order type') document.querySelector('[data-tab-key="POST_ONLY"]').setAttribute('aria-selected', 'false');
        if (change === 'allocation') document.querySelector('[data-ladder-group="percent"][data-ladder-value="10"]').click();
      }, { once: true });
    }, changed.name);

    // When the planner writes its reference price before reading the available quantity.
    await beginPlan(page, 'OPEN_LONG');
    await page.clock.runFor(100);

    // Then the captured context is checked again and its exact mismatch prevents an executable order list.
    await expect.poll(() => planResult(page)).toEqual({
      status: 'refused', message: changed.message, recoveryKind: changed.recoveryKind,
    });
    await noOrderActions(page);
    expect(host.errors).toEqual([]);
  });
}

test('user ignores programmatic and unreadable price clicks before accepting one real valid price', async ({ page }) => {
  // Given the complete entrypoint is ready beside a native price whose original text is known.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario());
  const price = page.locator('#futuresOrderbook .bid-light').first();
  await pauseScenarioClock(page);

  // When page code clicks a price and a subsequent trusted click sees a temporary placeholder.
  await price.evaluate(node => node.click());
  await price.evaluate(node => { node.textContent = '--'; });
  await price.click();
  await page.clock.runFor(100);

  // Then neither event can produce a native order.
  await noOrderActions(page);

  // When the native price becomes readable and the user clicks it again.
  await price.evaluate(node => { node.textContent = '81.0'; });
  await price.click();
  await page.clock.runFor(100);

  // Then exactly the real valid click is acknowledged with its concrete fields.
  await expect(page.locator('#jh-binance-ladder-status')).toHaveText('单击开多已提交 · 81.0 × 0.07');
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')
    .map(({ action, price, quantity }) => ({ action, price, quantity })))
    .toEqual([{ action: '开多', price: '81.0', quantity: '0.07' }]);
  expect(host.errors).toEqual([]);
});
