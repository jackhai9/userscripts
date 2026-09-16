import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';

async function submissions(page) {
  return (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
}

for (const boundary of [
  { name: 'confirmed zero balance after brief action feedback', balance: '0.00 USDT', missing: false, message: '可用余额不足', deadlineMs: 240, waitsForQuantity: false },
  { name: 'temporarily missing quantity', balance: '100.00 USDT', missing: true, message: '未读取到可开数量', deadlineMs: 1200, waitsForQuantity: true },
  { name: 'zero quantity with available balance', balance: '100.00 USDT', missing: false, message: '当前可开数量为 0', deadlineMs: 1200, waitsForQuantity: true },
]) {
  test(`user distinguishes ${boundary.name} through the actual open-ladder entrypoint`, async ({ page }) => {
    // Given the native quantity and balance expose separate, explicit readiness evidence.
    await installScenarioClock(page);
    const { errors } = await openUserscriptScenario(page, createCancelScenario({
      ui: { openableQuantity: '0' },
    }));
    await page.locator('.available-balance span').last().evaluate((element, text) => {
      element.textContent = text;
    }, boundary.balance);
    if (boundary.missing) {
      await page.locator('[data-testid^="max-"]').evaluateAll(elements => elements.forEach(element => element.remove()));
    }
    await pauseScenarioClock(page);
    await page.locator('#limitPrice-open').evaluate(input => {
      input.addEventListener('input', () => {
        document.body.dataset.quantityReadStartedAt = String(performance.now());
      }, { once: true });
    });

    // When an ordinary ladder reaches one millisecond before its feedback or quantity-readiness deadline.
    const actionStartedAt = await page.locator('[data-ladder-action="OPEN_LONG"]').evaluate(button => {
      const startedAt = performance.now();
      button.click();
      return startedAt;
    });
    await expect(page.locator('body')).toHaveAttribute('data-quantity-read-started-at', /\d/);
    const remaining = await page.evaluate(({ actionStartedAt, deadlineMs, waitsForQuantity }) => {
      const startedAt = waitsForQuantity
        ? Number(document.body.dataset.quantityReadStartedAt)
        : actionStartedAt;
      return startedAt + deadlineMs - 1 - performance.now();
    }, { actionStartedAt, deadlineMs: boundary.deadlineMs, waitsForQuantity: boundary.waitsForQuantity });
    expect(remaining).toBeGreaterThanOrEqual(0);
    await page.clock.runFor(remaining);

    // Then feedback remains pending for its full visible interval without submitting any order.
    await expect(page.locator(STATUS)).toHaveText('阶梯开多准备中');
    expect(await submissions(page)).toEqual([]);

    // When the final millisecond completes the applicable public feedback deadline.
    await page.clock.runFor(1);

    // Then the correct reason is visible, and neither submission nor cancellation occurred.
    await expect(page.locator(STATUS)).toContainText(boundary.message);
    expect(await submissions(page)).toEqual([]);
    expect((await readFixtureState(page)).events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user reprices only the three unfinished orders from the current book after the full fifth-rejection pause', async ({ page }) => {
  // Given two orders succeed before five consecutive native maker rejections.
  await installScenarioClock(page);
  const success = { outcome: 'success', delivery: 'immediate' };
  const rejection = { outcome: 'rejected', delivery: 'immediate', code: '-5022', message: 'Post only maker order rejected' };
  const host = await openUserscriptScenario(page, createCancelScenario({ host: {
    submitApiResponses: [success, success, ...Array.from({ length: 4 }, () => rejection),
      { ...rejection, delivery: 'manual' }, success, success, success],
  } }));
  await page.locator(STATUS).evaluate(status => {
    const observer = new MutationObserver(() => {
      if (status.textContent.includes('3s 后继续')) {
        document.body.dataset.repricePauseStartedAt = String(performance.now());
        observer.disconnect();
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(host.pendingSubmitSequences, { timeout: 8000 }).toEqual([7]);
  await pauseScenarioClock(page);

  // When the fifth rejection is delivered and 2,999 ms of the declared pause elapse.
  await host.releaseSubmitResponse(7);
  await expect(page.locator(STATUS)).toContainText('3s 后继续');
  await expect(page.locator(STATUS)).toContainText('剩余 3 档');
  await expect(page.locator(STATUS)).toContainText('已刷新 5 次');
  const remaining = await page.evaluate(() => Number(document.body.dataset.repricePauseStartedAt) + 2999 - performance.now());
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);

  // Then no early retry occurs and the two acknowledgements remain intact.
  expect(await submissions(page)).toHaveLength(7);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submit-api-success')
    .map(({ submitSequence }) => submitSequence)).toEqual([1, 2]);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submit-api-rejected')
    .map(({ submitSequence }) => submitSequence)).toEqual([3, 4, 5, 6, 7]);
  await expect(page.locator(STATUS)).toContainText('3s 后继续');

  // When the full three seconds expire and the native form can finish the remaining requests.
  await page.clock.runFor(1);
  await page.clock.resume();

  // Then exactly three repriced acknowledgements finish the original five-order quantity allocation.
  await expect(page.locator(STATUS)).toContainText('已完成', { timeout: 8000 });
  await expect(page.locator(STATUS)).toContainText('已挂 5/5');
  await expect(page.locator(STATUS)).toContainText('刷新盘口 5 次，错误码 -5022');
  expect((await submissions(page)).map(({ price, quantity }) => ({ price, quantity }))).toEqual(
    ['80.9', '80.4', '79.9', '80.9', '80.9', '80.9', '80.9', '80.9', '80.4', '79.9']
      .map(price => ({ price, quantity: '0.07' })),
  );
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submit-api-success')
    .map(({ submitSequence }) => submitSequence)).toEqual([1, 2, 8, 9, 10]);
  expect(host.errors).toEqual([]);
});
