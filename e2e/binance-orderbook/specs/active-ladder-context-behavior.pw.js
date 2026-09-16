import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const STATUS = '#jh-binance-ladder-status';
const ORIGINAL_ORDERS = [
  { price: '80.9', quantity: '0.1' },
  { price: '80.4', quantity: '0.1' },
  { price: '79.9', quantity: '0.1' },
];
const FIVE_ORDER_PROFILE = [
  { price: '80.9', quantity: '0.06' },
  { price: '80.4', quantity: '0.06' },
  { price: '79.9', quantity: '0.06' },
  { price: '79.4', quantity: '0.06' },
  { price: '78.9', quantity: '0.06' },
];
const CHANGES = [
  {
    label: 'native price precision', group: 'precision', value: '0.01',
    failure: '执行中价格精度已变化，已停止',
    recovery: '价格精度已变化，下一轮按新精度继续',
    nextOrders: FIVE_ORDER_PROFILE,
  },
  {
    label: 'saved ratio', group: 'percent', value: '1',
    failure: '执行中比例、笔数或间距已变化',
    recovery: '比例、笔数或间距已变化，下一轮按新设置继续',
    nextOrders: [
      { price: '80.9', quantity: '0.33' },
      { price: '80.4', quantity: '0.33' },
      { price: '79.9', quantity: '0.34' },
    ],
  },
  {
    label: 'saved order count', group: 'levels', value: '5',
    failure: '执行中比例、笔数或间距已变化',
    recovery: '比例、笔数或间距已变化，下一轮按新设置继续',
    nextOrders: FIVE_ORDER_PROFILE,
  },
  {
    label: 'saved price gap', group: 'step', value: '1',
    failure: '执行中比例、笔数或间距已变化',
    recovery: '比例、笔数或间距已变化，下一轮按新设置继续',
    nextOrders: [
      { price: '80.9', quantity: '0.1' },
      { price: '80.8', quantity: '0.1' },
      { price: '80.7', quantity: '0.1' },
    ],
  },
];

test.afterEach(async ({ page }, testInfo) => {
  const phases = await page.evaluate(() => {
    const observation = window.__ACTIVE_LADDER_CONTEXT_PHASES__;
    if (!observation) return [];
    observation.observer.disconnect();
    delete window.__ACTIVE_LADDER_CONTEXT_PHASES__;
    return observation.events;
  });
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('active-context-phases.json', {
      body: Buffer.from(JSON.stringify(phases, null, 2)),
      contentType: 'application/json',
    });
  }
});

function expectedSubmissions(orders) {
  return orders.map((order, index) => ({
    submitSequence: index + 1,
    action: '平空',
    ...order,
  }));
}

async function readSubmissions(page) {
  return (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submitted')
    .map(({ submitSequence, action, price, quantity }) => ({
      submitSequence, action, price, quantity,
    }));
}

async function readAcknowledgements(page) {
  return (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success')
    .map(({ submitSequence }) => submitSequence);
}

async function expectNoCancellation(page) {
  expect((await readFixtureState(page)).events.filter(({ type }) => [
    'cancel-requested', 'row-cancel-requested', 'cancel-cleared', 'row-cancel-cleared',
  ].includes(type))).toEqual([]);
}

/** Observe the rendered recovery phase so the one-second deadline has an exact origin. */
async function observePhases(page) {
  await page.locator(STATUS).evaluate((status) => {
    const events = [];
    const observer = new MutationObserver(() => {
      events.push({ at: performance.now(), text: status.textContent });
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    window.__ACTIVE_LADDER_CONTEXT_PHASES__ = { events, observer };
  });
}

async function advanceToPhaseAge(page, phaseText, elapsed) {
  const remaining = await page.evaluate(({ phaseText, elapsed }) => {
    const phase = window.__ACTIVE_LADDER_CONTEXT_PHASES__.events
      .find(({ text }) => text === phaseText);
    if (!phase) throw new Error(`The rendered recovery phase was not observed: ${phaseText}`);
    return phase.at + elapsed - performance.now();
  }, { phaseText, elapsed });
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);
}

async function openPendingLadder(page, { continuous, pendingSequence, nextOrders }) {
  await installScenarioClock(page);
  const responses = continuous
    ? [
      { outcome: 'success', delivery: 'immediate' },
      { outcome: 'success', delivery: 'manual' },
      ...nextOrders.map((order, index) => ({
        outcome: 'success',
        delivery: index === 0 || index === nextOrders.length - 1 ? 'manual' : 'immediate',
      })),
    ]
    : ORIGINAL_ORDERS.map((order, index) => ({
      outcome: 'success', delivery: index + 1 === pendingSequence ? 'manual' : 'immediate',
    }));
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
    host: { submitApiResponses: responses },
  }));
  const panel = page.locator(PANEL);
  await panel.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  await observePhases(page);
  await panel.getByRole('button', { name: '阶梯平空', exact: true }).click(
    continuous ? { modifiers: ['Alt'] } : {},
  );
  await expect.poll(host.pendingSubmitSequences).toEqual([pendingSequence]);
  await pauseScenarioClock(page);
  // The native response stays gated while the minimum action-feedback interval expires.
  await page.clock.runFor(300);
  expect(await readSubmissions(page)).toEqual(expectedSubmissions(ORIGINAL_ORDERS.slice(0, pendingSequence)));
  expect(await readAcknowledgements(page)).toEqual(
    Array.from({ length: pendingSequence - 1 }, (value, index) => index + 1),
  );
  return { ...host, panel, status: panel.locator(STATUS) };
}

async function changeActiveContext(page, change) {
  if (change.group === 'precision') {
    await page.locator('#futuresOrderbook .bn-select-trigger').click();
    await page.getByRole('option', { name: change.value, exact: true }).click();
    await expect(page.locator('#futuresOrderbook .tick-content')).toHaveText(change.value);
    expect((await readFixtureState(page)).orderbookPrecision).toBe(change.value);
  } else {
    const option = page.locator(PANEL).locator(
      `[data-ladder-group="${change.group}"][data-ladder-value="${change.value}"]`,
    );
    await expect(option).toBeEnabled();
    await option.click();
  }
  await page.clock.runFor(64);
}

for (const change of CHANGES) {
  const pendingSequence = change.group === 'precision' ? 1 : 2;
  test(`user stops an active ordinary ladder after ${change.label} changes and keeps confirmed progress`, async ({ page }) => {
    // Given a three-order close-short ladder has an in-flight native request and unsent levels.
    const host = await openPendingLadder(page, {
      continuous: false, pendingSequence, nextOrders: [],
    });

    // When the user changes the real native precision or an enabled saved option before acknowledgement.
    await changeActiveContext(page, change);

    // Then the existing request remains pending without inventing confirmation or submitting another level.
    expect(host.pendingSubmitSequences()).toEqual([pendingSequence]);
    expect(await readSubmissions(page)).toEqual(expectedSubmissions(ORIGINAL_ORDERS.slice(0, pendingSequence)));
    expect(await readAcknowledgements(page)).toEqual(
      Array.from({ length: pendingSequence - 1 }, (value, index) => index + 1),
    );
    await expect(host.status).toContainText(`挂单 ${pendingSequence}/3 确认中`);

    // When the native response confirms the order that was already sent.
    await host.releaseSubmitResponse(pendingSequence);
    await expect.poll(() => readAcknowledgements(page)).toEqual(
      Array.from({ length: pendingSequence }, (value, index) => index + 1),
    );

    // Then the next context check stops the old plan and retains exactly its confirmed count.
    const failure = `阶梯平空失败：已挂 ${pendingSequence}/3 笔 · ${change.failure}`;
    await expect(host.status).toHaveText(failure);
    await page.clock.runFor(32);
    await expect(host.panel.getByRole('button', { name: '阶梯平空', exact: true })).toBeEnabled();
    await expect(host.panel.getByRole('button', { name: '停止平空', exact: true })).toHaveCount(0);
    expect(await readSubmissions(page)).toEqual(expectedSubmissions(ORIGINAL_ORDERS.slice(0, pendingSequence)));
    expect(host.pendingSubmitSequences()).toEqual([]);
    await expectNoCancellation(page);

    // When additional business time passes after the ordinary task has ended.
    await page.clock.runFor(3000);

    // Then no old remaining level is retried and the exact terminal result is stable.
    await expect(host.status).toHaveText(failure);
    expect(await readSubmissions(page)).toEqual(expectedSubmissions(ORIGINAL_ORDERS.slice(0, pendingSequence)));
    expect(host.pendingSubmitSequences()).toEqual([]);
    expect(host.errors).toEqual([]);
  });

  test(`user rebuilds a continuous ladder after active ${change.label} changes without resuming old remaining levels`, async ({ page }) => {
    // Given the first close-short round has one confirmed order, one pending order, and one unsent level.
    const host = await openPendingLadder(page, {
      continuous: true, pendingSequence: 2, nextOrders: change.nextOrders,
    });

    // When the user changes the active context before the second native response is delivered.
    await changeActiveContext(page, change);

    // Then the pending order is not counted and the old third level is not submitted.
    await expect(host.status).toHaveText('连续阶梯平空 · 第 2 笔确认中 · 0/1 轮 · 本轮 1/3 笔 · 累计 1 笔');
    expect(await readAcknowledgements(page)).toEqual([1]);
    expect(await readSubmissions(page)).toEqual(expectedSubmissions(ORIGINAL_ORDERS.slice(0, 2)));

    // When the native response confirms that second order and recovery approaches its one-second deadline.
    await host.releaseSubmitResponse(2);
    await expect.poll(() => readAcknowledgements(page)).toEqual([1, 2]);
    const recovery = `连续阶梯平空 · 1s 后继续 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔 · ${change.recovery}`;
    await expect(host.status).toHaveText(recovery);
    await advanceToPhaseAge(page, recovery, 999);

    // Then all confirmed progress survives but neither the old third order nor a new round starts early.
    await expect(host.status).toHaveText(recovery);
    expect(await readSubmissions(page)).toEqual(expectedSubmissions(ORIGINAL_ORDERS.slice(0, 2)));
    expect(host.pendingSubmitSequences()).toEqual([]);
    await expectNoCancellation(page);

    // When the full recovery interval expires and the rebuilt round reaches its first native response gate.
    await page.clock.runFor(1);
    await page.clock.resume();
    await expect.poll(host.pendingSubmitSequences).toEqual([3]);
    await pauseScenarioClock(page);

    // Then a fresh plan starts from its first level with the changed profile and the original close direction.
    const orderCount = change.nextOrders.length;
    await expect(host.status).toHaveText(`连续阶梯平空 · 第 1 笔确认中 · 0/2 轮 · 本轮 0/${orderCount} 笔 · 累计 2 笔`);
    expect(await readSubmissions(page)).toEqual(expectedSubmissions([
      ...ORIGINAL_ORDERS.slice(0, 2), change.nextOrders[0],
    ]));

    // When the rebuilt round receives its own acknowledgements through its final response gate.
    await host.releaseSubmitResponse(3);
    await page.clock.resume();
    const lastSequence = 2 + orderCount;
    await expect.poll(host.pendingSubmitSequences).toEqual([lastSequence]);
    await pauseScenarioClock(page);
    await page.clock.runFor(300);
    const expectedOrders = expectedSubmissions([...ORIGINAL_ORDERS.slice(0, 2), ...change.nextOrders]);
    expect(await readSubmissions(page)).toEqual(expectedOrders);
    await host.releaseSubmitResponse(lastSequence);
    await expect.poll(() => readAcknowledgements(page)).toEqual(
      Array.from({ length: lastSequence }, (value, index) => index + 1),
    );

    // Then exactly one rebuilt round completes with its new prices, quantities, order count, and cumulative total.
    const completed = `连续阶梯平空 · 1s 后继续 · 1/2 轮 · 本轮 ${orderCount}/${orderCount} 笔 · 累计 ${lastSequence} 笔`;
    await expect(host.status).toHaveText(completed);
    expect(await readSubmissions(page)).toEqual(expectedOrders);
    await expectNoCancellation(page);

    // When the user stops the session during the following cooldown.
    await host.panel.getByRole('button', { name: '停止平空', exact: true }).click();
    await page.clock.runFor(3000);

    // Then the session preserves both rounds' confirmed total without starting a third round.
    await expect(host.status).toHaveText(`连续阶梯平空 · 已停止 · 1/2 轮 · 本轮 ${orderCount}/${orderCount} 笔 · 累计 ${lastSequence} 笔`);
    expect(await readSubmissions(page)).toEqual(expectedOrders);
    expect(host.pendingSubmitSequences()).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}
