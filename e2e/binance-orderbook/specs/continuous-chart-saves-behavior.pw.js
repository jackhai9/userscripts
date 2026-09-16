import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, ORDER_SETS, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';
const EXISTING_ORDERS = [
  { ...ORDER_SETS.current[0], id: 'original-1' },
  { ...ORDER_SETS.current[0], id: 'original-2' },
];

async function eventsOfType(page, type) {
  return (await readFixtureState(page)).events.filter(event => event.type === type);
}

async function savedSnapshots(page) {
  return (await eventsOfType(page, 'chart-saved')).map(({ snapshot }) => snapshot);
}

async function saveMethodIsNative(nativeSave) {
  return nativeSave.evaluate(original => (
    document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi.saveChart === original
  ));
}

/** Stop virtual time near the actual request, before its 250 ms drawing-discovery deadline. */
async function advanceToSubmission(page, host, sequence) {
  for (let step = 0; step < 120; step += 1) {
    const pending = host.pendingSubmitSequences();
    if (pending.length > 0) {
      expect(pending).toEqual([sequence]);
      return;
    }
    await page.clock.runFor(25);
  }
  expect(host.pendingSubmitSequences()).toEqual([sequence]);
}

async function advanceFromDrawing(page, drawingId, eventType, elapsed) {
  const remaining = await page.evaluate(({ drawingId, eventType, elapsed }) => {
    const event = window.__BINANCE_FIXTURE__.snapshot().events.find(entry => (
      entry.type === 'chart-drawing-event'
      && entry.drawingId === drawingId
      && entry.eventType === eventType
    ));
    if (!event) throw new Error(`No native ${eventType} event exists for ${drawingId}`);
    return event.at + elapsed - performance.now();
  }, { drawingId, eventType, elapsed });
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);
}

async function releaseAcceptedDrawing(page, host, sequence) {
  await host.releaseSubmitResponse(sequence);
  await expect.poll(async () => (await eventsOfType(page, 'chart-drawing-event'))
    .filter(({ eventType }) => eventType === 'create').map(({ drawingId }) => drawingId))
    .toEqual(Array.from({ length: sequence }, (_, index) => `order-submitted-${index + 1}`));
}

async function openContinuousDrawingHost(page, {
  orders = [],
  responses = Array.from({ length: 3 }, () => ({ outcome: 'success', delivery: 'manual' })),
} = {}) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    orders,
    ui: { tradeMode: 'CLOSE', accountTab: 'openOrders' },
    host: {
      orderDrawingEvents: true,
      submitApiResponses: responses,
    },
  }));
  await page.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  const nativeSave = await page.evaluateHandle(() => (
    document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi.saveChart
  ));
  await pauseScenarioClock(page);
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
  await advanceToSubmission(page, host, 1);
  return { ...host, nativeSave };
}

test('user saves one complete chart per continuous round after every accepted order drawing settles', async ({ page }) => {
  // Given the first native request is pending in a three-order continuous close round.
  const host = await openContinuousDrawingHost(page);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);
  expect(await savedSnapshots(page)).toEqual([]);

  // When the first accepted order creates its native drawing and approaches the 120 ms quiet deadline.
  await releaseAcceptedDrawing(page, host, 1);
  await advanceFromDrawing(page, 'order-submitted-1', 'create', 119);

  // Then its save is captured while confirmation progress waits for the complete drawing lifecycle.
  expect(await saveMethodIsNative(host.nativeSave)).toBe(false);
  expect((await eventsOfType(page, 'chart-save-requested')).map(({ snapshot }) => snapshot)).toEqual([
    { checked: true, drawingIds: ['order-submitted-1'] },
  ]);
  expect(await savedSnapshots(page)).toEqual([]);
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 第 1 笔确认中 · 0/1 轮 · 本轮 0/3 笔 · 累计 0 笔');

  // When the first two drawing bursts finish and the third native order is submitted.
  await page.clock.runFor(1);
  await advanceToSubmission(page, host, 2);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);
  await releaseAcceptedDrawing(page, host, 2);
  await advanceFromDrawing(page, 'order-submitted-2', 'create', 120);
  await advanceToSubmission(page, host, 3);

  // Then no partial full-chart save escaped before the round's final order.
  expect(await savedSnapshots(page)).toEqual([]);
  expect((await eventsOfType(page, 'chart-save-requested')).map(({ snapshot }) => snapshot)).toEqual([
    { checked: true, drawingIds: ['order-submitted-1'] },
    { checked: true, drawingIds: ['order-submitted-1', 'order-submitted-2'] },
  ]);
  await expect(page.locator(STATUS)).toContainText('本轮 2/3 笔 · 累计 2 笔');

  // When the last order is accepted and its own quiet period completes.
  await releaseAcceptedDrawing(page, host, 3);
  await advanceFromDrawing(page, 'order-submitted-3', 'create', 119);
  expect(await savedSnapshots(page)).toEqual([]);
  await page.clock.runFor(1);

  // Then the round saves only its final three-drawing snapshot and restores the native save method.
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 1s 后继续 · 1/1 轮 · 本轮 3/3 笔 · 累计 3 笔');
  expect(await savedSnapshots(page)).toEqual([
    { checked: true, drawingIds: ['order-submitted-1', 'order-submitted-2', 'order-submitted-3'] },
  ]);
  expect(await eventsOfType(page, 'chart-save-requested')).toHaveLength(3);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);

  // When the user stops during cooldown and several possible round deadlines pass.
  await page.getByRole('button', { name: '停止平空', exact: true }).click();
  await page.clock.runFor(5_000);

  // Then the same saved snapshot remains final and no fourth order can begin.
  await expect(page.locator(STATUS)).toContainText('已停止');
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(3);
  expect(await eventsOfType(page, 'chart-saved')).toHaveLength(1);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);
  await host.nativeSave.dispose();
  expect(host.errors).toEqual([]);
});

test('user stopping inside a drawing burst preserves the partial round and restores ordinary native removal saves', async ({ page }) => {
  // Given one drawing is deferred and a second native submission is pending in the same round.
  const host = await openContinuousDrawingHost(page, { orders: EXISTING_ORDERS });
  await releaseAcceptedDrawing(page, host, 1);
  await advanceFromDrawing(page, 'order-submitted-1', 'create', 120);
  await advanceToSubmission(page, host, 2);

  // When the second drawing requests a save and the user presses Stop before its quiet period ends.
  await releaseAcceptedDrawing(page, host, 2);
  await advanceFromDrawing(page, 'order-submitted-2', 'create', 100);
  expect((await eventsOfType(page, 'order-submit-api-success')).map(({ submitSequence }) => submitSequence))
    .toEqual([1, 2]);
  await expect(page.locator(STATUS)).toContainText('本轮 1/3 笔 · 累计 1 笔');
  await page.getByRole('button', { name: '停止平空', exact: true }).click();
  await advanceFromDrawing(page, 'order-submitted-2', 'create', 119);

  // Then Stop has not discarded the pending snapshot or falsely advanced the last confirmation.
  expect(await savedSnapshots(page)).toEqual([]);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(false);
  await expect(page.locator(STATUS)).toContainText('停止中');
  await expect(page.locator(STATUS)).toContainText('本轮 1/3 笔 · 累计 1 笔');

  // When the final millisecond completes the active drawing burst and stopped-round cleanup.
  await page.clock.runFor(1);

  // Then exactly the confirmed partial round is persisted and the native save function is restored.
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 已停止 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔');
  expect(await savedSnapshots(page)).toEqual([
    { checked: true, drawingIds: ['order-original-1', 'order-original-2', 'order-submitted-1', 'order-submitted-2'] },
  ]);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);

  // When a later native row cancellation removes one original order after the session ended.
  await page.locator('[data-order-id="original-1"] svg[aria-label="撤销挂单"]').click();
  await page.clock.runFor(1);
  await advanceFromDrawing(page, 'order-original-1', 'remove', 100);

  // Then its native save runs at 100 ms without a leaked continuous listener retaining it until 120 ms.
  expect(await savedSnapshots(page)).toEqual([
    { checked: true, drawingIds: ['order-original-1', 'order-original-2', 'order-submitted-1', 'order-submitted-2'] },
    { checked: true, drawingIds: ['order-original-2', 'order-submitted-1', 'order-submitted-2'] },
  ]);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);
  await page.clock.runFor(5_000);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(2);
  expect(await eventsOfType(page, 'chart-saved')).toHaveLength(2);
  await host.nativeSave.dispose();
  expect(host.errors).toEqual([]);
});

test('user retains the last accepted chart snapshot when a later order ends the continuous round with a rejection', async ({ page }) => {
  // Given one accepted order drawing is deferred and the second native response will reject the order.
  const host = await openContinuousDrawingHost(page, { responses: [
    { outcome: 'success', delivery: 'manual' },
    { outcome: 'rejected', delivery: 'manual', code: '400123', message: 'Account restricted' },
  ] });
  await releaseAcceptedDrawing(page, host, 1);
  await advanceFromDrawing(page, 'order-submitted-1', 'create', 120);
  await advanceToSubmission(page, host, 2);
  expect(await savedSnapshots(page)).toEqual([]);

  // When the rejection arrives and the unmatched drawing-discovery deadline completes.
  await host.releaseSubmitResponse(2);
  await expect.poll(async () => (await eventsOfType(page, 'order-submit-api-rejected')).length).toBe(1);
  await page.clock.runFor(250);

  // Then failed-round cleanup saves the accepted drawing once and restores the original chart owner.
  await expect(page.locator(STATUS)).toContainText('失败');
  await expect(page.locator(STATUS)).toContainText('错误码 400123');
  await expect(page.locator(STATUS)).toContainText('本轮 1/3 笔 · 累计 1 笔');
  expect(await savedSnapshots(page)).toEqual([{ checked: true, drawingIds: ['order-submitted-1'] }]);
  expect((await eventsOfType(page, 'chart-drawing-event')).map(({ drawingId, eventType }) => ({ drawingId, eventType })))
    .toEqual([{ drawingId: 'order-submitted-1', eventType: 'create' }]);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);

  // When terminal cleanup receives its queued panel-rendering animation frame.
  await page.clock.runFor(16);

  // Then the completed session releases Stop and permits a fresh close action.
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
  await expect(page.locator('[data-ladder-action="CLOSE_SHORT"]')).toBeEnabled();

  // When several possible recovery intervals elapse after that terminal rejection.
  await page.clock.runFor(5_000);

  // Then neither a duplicate snapshot nor a third order is created.
  expect(await eventsOfType(page, 'chart-saved')).toHaveLength(1);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(2);
  await host.nativeSave.dispose();
  expect(host.errors).toEqual([]);
});

test('user coalesces native order-removal saves while a continuous submit is pending', async ({ page }) => {
  // Given the first submit remains unanswered while two original native orders are visible.
  const host = await openContinuousDrawingHost(page, { orders: EXISTING_ORDERS });

  // When native row actions remove both orders during one short drawing burst.
  await page.locator('[data-order-id="original-1"] svg[aria-label="撤销挂单"]').click();
  await page.clock.runFor(1);
  await page.locator('[data-order-id="original-2"] svg[aria-label="撤销挂单"]').click();
  await page.clock.runFor(1);
  await advanceFromDrawing(page, 'order-original-2', 'remove', 119);

  // Then both native save requests are captured without prematurely serializing the chart.
  expect((await eventsOfType(page, 'chart-drawing-event')).map(({ drawingId, eventType }) => ({ drawingId, eventType })))
    .toEqual([
      { drawingId: 'order-original-1', eventType: 'remove' },
      { drawingId: 'order-original-2', eventType: 'remove' },
    ]);
  expect(await eventsOfType(page, 'chart-save-requested')).toHaveLength(2);
  expect(await savedSnapshots(page)).toEqual([]);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(false);

  // When the final removal settles and the user stops the still pending submit.
  await page.clock.runFor(1);
  expect(await savedSnapshots(page)).toEqual([{ checked: true, drawingIds: [] }]);
  await page.getByRole('button', { name: '停止平空', exact: true }).click();
  await page.clock.runFor(300);
  await host.releaseSubmitResponse(1, { outcome: 'rejected', code: '400123', message: 'Account restricted' });
  await expect.poll(async () => (await eventsOfType(page, 'order-submit-api-rejected')).length).toBe(1);
  await page.clock.runFor(5_000);

  // Then the final empty chart was saved once and stopped cleanup leaves the native method intact.
  await expect(page.locator(STATUS)).toContainText('已停止');
  expect(await savedSnapshots(page)).toEqual([{ checked: true, drawingIds: [] }]);
  expect(await saveMethodIsNative(host.nativeSave)).toBe(true);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(1);
  expect((await readFixtureState(page)).orders).toEqual([]);
  await host.nativeSave.dispose();
  expect(host.errors).toEqual([]);
});
