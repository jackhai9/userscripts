import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PLACE_ORDER = '**/bapi/futures/v1/private/future/order/place-order';
const STATUS = '#jh-binance-ladder-status';
const DIRECTIONS = [
  { action: 'OPEN_LONG', mode: 'OPEN', side: 'LONG', label: '开多', qty: '0.07', prices: ['80.9', '80.4', '79.9', '81.9', '81.4', '80.9'] },
  { action: 'OPEN_SHORT', mode: 'OPEN', side: 'SHORT', label: '开空', qty: '0.07', prices: ['81.03', '81.08', '81.13', '82.03', '82.08', '82.13'] },
  { action: 'CLOSE_LONG', mode: 'CLOSE', side: 'LONG', label: '平多', qty: '0.06', prices: ['81.03', '81.08', '81.13', '82.03', '82.08', '82.13'] },
  { action: 'CLOSE_SHORT', mode: 'CLOSE', side: 'SHORT', label: '平空', qty: '0.06', prices: ['80.9', '80.4', '79.9', '81.9', '81.4', '80.9'] },
];

for (const direction of DIRECTIONS) {
  test(`user reprices only the three remaining ${direction.action} orders after a native maker rejection`, async ({ page }) => {
    // Given the first two orders succeed and the third meets a changed native book.
    const scenario = createCancelScenario({
      positions: [{ symbol: CURRENT_SYMBOL, side: direction.side, quantity: '100' }],
      ui: { tradeMode: direction.mode },
    });
    const { errors } = await openUserscriptScenario(page, scenario);
    let requests = 0;
    await page.route(PLACE_ORDER, async route => {
      requests += 1;
      expect(requests).toBeLessThanOrEqual(6);
      if (requests === 3) {
        await page.locator('#futuresOrderbook .emit-price').evaluateAll(nodes => {
          for (const node of nodes) node.textContent = (Number(node.textContent) + 1).toFixed(2);
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(requests === 3
        ? { success: false, code: '90805022', message: 'Post only maker order rejected' }
        : { success: true }) });
    });

    // When the user runs one complete ladder in the chosen direction.
    await page.locator('[data-ladder-action="' + direction.action + '"]').click();

    // Then the two accepted orders are retained and only the rejected and remaining prices are rebuilt.
    await expect(page.locator(STATUS)).toContainText('已完成', { timeout: 8000 });
    await expect(page.locator(STATUS)).toContainText('已挂 5/5');
    await expect(page.locator(STATUS)).toContainText('刷新盘口 1 次，错误码 90805022');
    const events = (await readFixtureState(page)).events;
    const submitted = events.filter(({ type }) => type === 'order-submitted');
    expect(submitted.map(({ price }) => price)).toEqual(direction.prices);
    expect(submitted.map(({ action }) => action)).toEqual(Array(6).fill(direction.label));
    expect(submitted.map(({ quantity }) => quantity)).toEqual(Array(6).fill(direction.qty));
    expect(events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
    expect(requests).toBe(6);
    expect(errors).toEqual([]);
  });
}

for (const [name, status, payload, headers, message] of [
  ['native rate limit', 429, { success: false, code: '-1003' }, { 'retry-after': '7' }, '下单请求频率受限'],
  ['native service error', 503, { success: false, message: 'Service unavailable' }, {}, 'Binance 服务异常'],
  ['capacity rejection', 200, { success: false, code: '90802025', message: 'Maximum open orders' }, {}, 'Maximum open orders（错误码 90802025）'],
  ['terminal business rejection', 200, { success: false, code: '400123', message: 'Account restricted' }, {}, '订单提交失败（错误码 400123）'],
  ['unrecognized successful HTTP response', 200, { data: { requestAccepted: true } }, {}, '下单请求已返回，但结果未识别'],
]) {
  test(`user stops an ordinary ladder on a ${name} without a second submit or cancellation`, async ({ page }) => {
    // Given the first native order response has an explicit transport and business outcome.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    let requests = 0;
    await page.route(PLACE_ORDER, async route => {
      requests += 1;
      await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(payload) });
    });

    // When the user starts an ordinary open-long ladder.
    await page.locator('[data-ladder-action="OPEN_LONG"]').click();

    // Then the exact failure category and zero acknowledged orders are shown with no recovery action.
    await expect(page.locator(STATUS)).toContainText('阶梯开多失败');
    await expect(page.locator(STATUS)).toContainText(message);
    await expect(page.locator(STATUS)).toContainText('已挂 0/5');
    expect(requests).toBe(1);
    const events = (await readFixtureState(page)).events;
    expect(events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
    expect(events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user stops a close ladder on a conflicting reduce-only response without assuming the position was closed', async ({ page }) => {
  // Given the native payload claims success but simultaneously contains a reduce-only error code.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE' },
  }));
  let requests = 0;
  await page.route(PLACE_ORDER, async route => {
    requests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, code: '90802022' }) });
  });

  // When the user starts a single close-short round.
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click();

  // Then the contradictory response stops the round as unconfirmed and cannot authorize replacement.
  await expect(page.locator(STATUS)).toContainText('只减仓拒单响应不完整或存在冲突');
  await expect(page.locator(STATUS)).toContainText('已挂 0/5');
  expect(requests).toBe(1);
  expect((await readFixtureState(page)).events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
  expect(errors).toEqual([]);
});

test('user can stop after five consecutive maker rejections during the declared reprice pause', async ({ page }) => {
  // Given five explicit maker rejections arrive without any accepted order.
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, createCancelScenario({ host: {
    submitApiResponses: Array.from({ length: 5 }, () => ({
      outcome: 'rejected', delivery: 'immediate', code: '-5022', message: 'Post only maker order rejected',
    })),
  } }));
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect(page.locator(STATUS)).toContainText('3s 后继续', { timeout: 8000 });
  await expect(page.locator(STATUS)).toContainText('已刷新 5 次');

  // When the user stops while the reprice cooldown is active and time advances past that cooldown.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await pauseScenarioClock(page);
  await page.clock.runFor(10000);

  // Then the stopped result keeps zero accepted orders and no sixth request can begin.
  await expect(page.locator(STATUS)).toContainText('阶梯开多已停止');
  await expect(page.locator(STATUS)).toContainText('已挂 0/5');
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toHaveLength(5);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submit-api-success')).toEqual([]);
  expect(errors).toEqual([]);
});

for (const direction of DIRECTIONS) {
  test(`user submits exactly one ${direction.action} order from a trusted orderbook price click`, async ({ page }) => {
    // Given both native position directions exist and the user selects one direction explicitly.
    const { errors } = await openUserscriptScenario(page, createCancelScenario({
      positions: [
        { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' },
        { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '80' },
      ],
      ui: { tradeMode: direction.mode },
    }));
    await page.getByRole('radio', { name: direction.label, exact: true }).click();

    // When the user clicks one real native bid price.
    await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();

    // Then exactly the selected direction is acknowledged with the clicked price and exchange-valid quantity.
    await expect(page.locator(STATUS)).toHaveText('单击' + direction.label + '已提交 · 81.0 × ' + (direction.mode === 'OPEN' ? '0.07' : '0.01'));
    const submissions = (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
    expect(submissions.map(({ action, price, quantity }) => ({ action, price, quantity }))).toEqual([
      { action: direction.label, price: '81.0', quantity: direction.mode === 'OPEN' ? '0.07' : '0.01' },
    ]);
    expect(errors).toEqual([]);
  });
}

for (const [name, selector, expected] of [
  ['quantity input', '#unitAmount-open', '单击下单未执行：未找到数量输入框'],
  ['price input', '#limitPrice-open', '单击下单未执行：未找到价格输入框'],
  ['precision value', '#futuresOrderbook .tick-content', '单击下单失败：未识别价格精度'],
]) {
  test(`user receives a concrete refusal when a native ${name} disappears before a price click`, async ({ page }) => {
    // Given the loaded panel loses one required native control before an actual orderbook click.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    await page.locator(selector).evaluate(element => element.remove());

    // When the user selects a bid on the incomplete native form.
    await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();

    // Then the missing control is identified and no native submit request is produced.
    await expect(page.locator(STATUS)).toHaveText(expected);
    expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const changed of ['symbol', 'mode', 'precision', 'direction']) {
  test(`user rejects an in-flight single-order draft when its captured ${changed} changes before native submission`, async ({ page }) => {
    // Given a native state transition is scheduled by the first real controlled-input write.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    await page.locator('#limitPrice-open').evaluate((input, change) => {
      input.addEventListener('input', () => {
        if (change === 'symbol') window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT');
        if (change === 'mode') document.querySelector('[data-trade-mode="CLOSE"]').click();
        if (change === 'precision') window.__BINANCE_FIXTURE__.replacePrecisionControl({
          scope: 'root', value: '0.01', symbol: 'HYPEUSDT', options: ['0.001', '0.01', '0.1', '1'],
        });
        if (change === 'direction') Array.from(document.querySelectorAll('[role="radio"]'))
          .find(radio => radio.textContent.trim() === '开空').click();
        document.body.dataset.singleDraftChanged = change;
      }, { once: true });
    }, changed);

    // When the user selects a native orderbook price and the external transition interrupts synchronization.
    await page.locator('#futuresOrderbook .bid-light.emit-price').nth(1).click();

    // Then the changed draft fails visibly and no request can use its stale symbol, mode, precision, or direction.
    await expect(page.locator('body')).toHaveAttribute('data-single-draft-changed', changed);
    await expect(page.locator(STATUS)).toContainText('失败');
    expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user keeps one pending single order when another price click and a competing ladder arrive', async ({ page }) => {
  // Given the first native single-order response is held by the external API boundary.
  const context = await openUserscriptScenario(page, createCancelScenario({ host: {
    submitApiResponses: [{ outcome: 'success', delivery: 'manual' }],
  } }));
  await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();
  await expect(page.locator(STATUS)).toContainText('单击开多确认中');

  // When a second trusted price click and the public ladder entrypoint compete with the pending single task.
  await page.locator('#futuresOrderbook .bid-light.emit-price').nth(1).click();
  const competing = await page.evaluate(() => window.__TM_CLOSE_LONG_DEBUG__.startLadder('OPEN_SHORT'));

  // Then the existing request and captured first price remain the only executable task.
  expect(competing).toEqual({ status: 'not_started' });
  expect(context.pendingSubmitSequences()).toEqual([1]);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')
    .map(({ price, quantity }) => ({ price, quantity }))).toEqual([{ price: '81.0', quantity: '0.07' }]);

  // When the original response is explicitly accepted.
  await context.releaseSubmitResponse(1);

  // Then the original single-order result finishes without a later queued submission.
  await expect(page.locator(STATUS)).toHaveText('单击开多已提交 · 81.0 × 0.07');
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(context.errors).toEqual([]);
});

test('user cannot submit from a cached close display after both native quantity labels disappear', async ({ page }) => {
  // Given a previously confirmed close quantity is still available for display after native data disappears.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' }], ui: { tradeMode: 'CLOSE' },
  }));
  await page.locator('.order-entry [data-testid^="max-"]').evaluateAll(elements => elements.forEach(element => element.remove()));

  // When the user makes a trusted native price click while fresh close evidence is missing.
  await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();

  // Then the missing current close action refuses execution and cached display values cannot authorize a submit.
  await expect(page.locator(STATUS)).toHaveText('单击下单未执行：未找到可用平仓动作');
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user can populate valid order fields in the configured safe mode without submitting', async ({ page }) => {
  // Given the public debug configuration enables the script's existing safe execution mode.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  await page.evaluate(() => { window.__TM_CLOSE_LONG_DEBUG__.cfg.SAFE_MODE = true; });

  // When the user selects one native bid price.
  await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();

  // Then the real quantity and price synchronization completes while the native action stays unused.
  await expect(page.locator('#limitPrice-open')).toHaveValue('81.0');
  await expect(page.locator('#unitAmount-open')).toHaveValue('0.07');
  await expect(page.locator('[data-ladder-action="OPEN_LONG"]')).toBeEnabled();
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(errors).toEqual([]);
});
