import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

const PLAN_DIRECTIONS = [
  { action: 'OPEN_LONG', mode: 'OPEN', side: 'LONG', orderSide: 'BUY', prices: ['80.9', '80.4', '79.9', '79.4', '78.9'] },
  { action: 'OPEN_SHORT', mode: 'OPEN', side: 'SHORT', orderSide: 'SELL', prices: ['81.03', '81.08', '81.13', '81.18', '81.23'] },
  { action: 'CLOSE_LONG', mode: 'CLOSE', side: 'LONG', orderSide: 'SELL', prices: ['81.03', '81.08', '81.13', '81.18', '81.23'] },
  { action: 'CLOSE_SHORT', mode: 'CLOSE', side: 'SHORT', orderSide: 'BUY', prices: ['80.9', '80.4', '79.9', '79.4', '78.9'] },
];

/** Exercise the production planner without sending its proposed orders. */
async function buildPlan(page, action, context = null) {
  return page.evaluate(async ({ action, context }) => {
    try {
      const plan = await window.__TM_CLOSE_LONG_DEBUG__.buildLadderPlan(action, context);
      return {
        status: 'planned', symbol: plan.symbol, precision: plan.precision,
        mode: plan.spec.mode, side: plan.spec.side, orderSide: plan.spec.orderSide,
        baseQty: plan.baseQty, totalQty: plan.totalQty, minRequiredQty: plan.minRequiredQty,
        percent: plan.percent, autoFitPercent: plan.autoFitPercent, autoFitLevels: plan.autoFitLevels,
        levels: plan.levels, optionContext: plan.optionContext, orders: plan.orders,
      };
    } catch (error) {
      return {
        status: 'refused', message: error.message, title: error.statusTitle,
        safeNoSubmit: error.safeNoSubmit, recoveryKind: error.continuousRecoveryKind,
        replacement: error.openOrdersReplacementPlan && {
          symbol: error.openOrdersReplacementPlan.symbol,
          precision: error.openOrdersReplacementPlan.precision,
          mode: error.openOrdersReplacementPlan.spec.mode,
          side: error.openOrdersReplacementPlan.spec.side,
          totalQty: error.openOrdersReplacementPlan.totalQty,
          optionContext: error.openOrdersReplacementPlan.optionContext,
        },
      };
    }
  }, { action, context });
}

for (const direction of PLAN_DIRECTIONS) {
  test(`user previews ${direction.action} with exact prices and quantities from the live form`, async ({ page }) => {
    // Given the current form has sufficient directional quantity and the native book has six prices per side.
    const scenario = createCancelScenario({
      positions: [{ symbol: CURRENT_SYMBOL, side: direction.side, quantity: '100' }],
      ui: { tradeMode: direction.mode },
    });
    const { errors } = await openUserscriptScenario(page, scenario);
    const optionButtons = page.locator('[data-ladder-group]');
    await expect(optionButtons).toHaveCount(14);
    const originalOptions = await optionButtons.evaluateAll(elements => elements.map(element => element.outerHTML));

    // When the actual entrypoint builds the selected directional plan.
    const plan = await buildPlan(page, direction.action);

    // Then the plan preserves context and obeys the per-mode minimum without submitting or changing the saved controls.
    const opening = direction.mode === 'OPEN';
    expect(plan).toEqual({
      status: 'planned', symbol: CURRENT_SYMBOL, precision: '0.1',
      mode: direction.mode, side: direction.side, orderSide: direction.orderSide,
      baseQty: opening ? '10' : '100', totalQty: opening ? '0.35' : '0.3',
      minRequiredQty: opening ? '0.07' : '0.01', percent: opening ? '3.5' : 0.3,
      autoFitPercent: opening ? '3.5' : null, autoFitLevels: opening ? 5 : null,
      levels: 5,
      optionContext: { percent: opening ? 2 : 0.3, levels: 5, ladderStep: 5 },
      orders: direction.prices.map(price => ({ price, qty: opening ? '0.07' : '0.06' })),
    });
    expect(await optionButtons.evaluateAll(elements => elements.map(element => element.outerHTML)))
      .toEqual(originalOptions);
    expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const [label, action, context, message] of [
  ['unknown action', 'UNKNOWN', null, '未知阶梯动作'],
  ['captured symbol', 'OPEN_LONG', { symbol: 'BTCUSDT' }, '重挂前交易对已变化，已停止'],
  ['captured mode', 'OPEN_LONG', { mode: 'CLOSE' }, '重挂前开仓/平仓模式已变化，已停止'],
  ['captured precision', 'OPEN_LONG', { precision: '1' }, '重挂前价格精度已变化，已停止'],
  ['captured options', 'OPEN_LONG', { optionContext: { percent: 10, levels: 5, ladderStep: 5 } }, 'Ladder settings changed during reduce-only recovery'],
]) {
  test(`user gets a precise refusal for a changed ${label} before a replacement plan can submit`, async ({ page }) => {
    // Given the production planner is attached to the current HYPE open form.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());

    // When the caller presents the stale captured context or an unsupported action.
    const result = await buildPlan(page, action, context);

    // Then the matching contract fails and no order or cancellation is issued.
    expect(result.status).toBe('refused');
    expect(result.message).toBe(message);
    expect((await readFixtureState(page)).events.filter(({ type }) => /order-submitted|cancel-requested/.test(type)))
      .toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const direction of PLAN_DIRECTIONS) {
  test(`user receives safe minimum-quantity guidance when ${direction.action} cannot fit even one order`, async ({ page }) => {
    // Given the actual quantity is below the exchange minimum even at a full allocation.
    const opening = direction.mode === 'OPEN';
    const { errors } = await openUserscriptScenario(page, createCancelScenario({
      positions: [{ symbol: CURRENT_SYMBOL, side: direction.side, quantity: '0.001' }],
      ui: { tradeMode: direction.mode },
    }));
    if (opening) await page.locator('[data-testid^="max-"]').evaluateAll(elements => {
      elements.forEach(element => { element.textContent = '可开 0.04 HYPE'; });
    });

    // When the real planner tries its documented ratio and order-count adjustment.
    const result = await buildPlan(page, direction.action);

    // Then refusal explains the minimum and manual choices without changing orders.
    expect(result.status).toBe('refused');
    expect(result.message).toContain(opening ? '数量低于最小下单量 0.07' : '数量低于最小下单量 0.01');
    expect(result.title).toContain('自动上限 100%');
    expect(result.title).toContain('已尝试自动提高比例和自动降档');
    expect(result.title).toContain(opening ? '同向开仓基础单，不会自动全撤' : '脚本不会自动撤单');
    if (opening) {
      expect(result.replacement).toEqual({
        symbol: CURRENT_SYMBOL, precision: '0.1', mode: 'OPEN', side: direction.side,
        totalQty: '0.35', optionContext: { percent: 2, levels: 5, ladderStep: 5 },
      });
    } else {
      expect(result.safeNoSubmit).toBe(true);
      expect(result.recoveryKind).toBe('position_quantity_not_ready');
      expect(result.replacement).toBeUndefined();
    }
    expect((await readFixtureState(page)).events.filter(({ type }) => /order-submitted|cancel-requested/.test(type)))
      .toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user caps a recovered close plan at the freshly confirmed position and retains the original form quantity', async ({ page }) => {
  // Given the page still displays 100 long units while a fresh position response confirmed only 2.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' }],
    ui: { tradeMode: 'CLOSE' },
  }));

  // When the real close planner receives that confirmed recovery cap.
  const plan = await buildPlan(page, 'CLOSE_LONG', {
    symbol: CURRENT_SYMBOL, mode: 'CLOSE', precision: '0.1', closePositionQty: '2',
    optionContext: { percent: 0.3, levels: 5, ladderStep: 5 },
  });

  // Then five minimum-sized orders use the smaller position and the displayed source remains unchanged.
  expect(plan.status).toBe('planned');
  expect(plan.baseQty).toBe('2');
  expect(plan.totalQty).toBe('0.05');
  expect(plan.orders.map(order => order.qty)).toEqual(['0.01', '0.01', '0.01', '0.01', '0.01']);
  await expect(page.locator('[data-testid="max-sell-amount"]')).toHaveText('可平 100 HYPE');
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [side, selector, message] of [
  ['LONG', '.bid-light', '订单簿买盘不足 5 档，档幅 5'],
  ['SHORT', '.ask-light', '订单簿卖盘不足 5 档，档幅 5'],
]) {
  test(`user cannot plan OPEN_${side} while the corresponding native book is empty`, async ({ page }) => {
    // Given the form is ready but the relevant price rows have disappeared during a native refresh.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    await page.locator('#futuresOrderbook ' + selector).evaluateAll(elements => elements.forEach(element => element.remove()));

    // When the production planner reads the updated native book.
    const result = await buildPlan(page, 'OPEN_' + side);

    // Then it reports missing market data and never invents a price or submits an order.
    expect(result.status).toBe('refused');
    expect(result.message).toBe(message);
    expect(result.recoveryKind).toBe('market_data_not_ready');
    expect(result.safeNoSubmit).toBe(true);
    expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user cannot plan after leaving the futures route', async ({ page }) => {
  // Given a working futures panel before the SPA navigates away.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());

  // When navigation changes the route before a new plan is requested.
  await page.evaluate(() => history.pushState({}, '', '/zh-CN/markets'));
  const result = await buildPlan(page, 'OPEN_LONG');

  // Then no symbol is inferred from the old page and the panel is removed.
  expect(result.status).toBe('refused');
  expect(result.message).toBe('未识别当前交易对');
  await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(errors).toEqual([]);
});
