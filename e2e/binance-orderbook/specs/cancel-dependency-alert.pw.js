import { test, expect } from '../test.js';
import { ORDER_SETS, POSITION_SETS, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const CANCEL = '[data-ladder-cancel-symbol="true"]';
const ALERT = '#jh-binance-dependency-alert';
const STATUS = '#jh-binance-ladder-status';
const UNKNOWN_STATUS = '未识别到撤单确认弹窗，无法确认撤单结果，请核对当前委托';

/** Model a provider copy change after its own handler renders the native dialog. */
async function changeNativePrompt(page, text) {
  await page.evaluate(text => {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-cancel-all]')) {
        document.querySelector('.bn-modal-title').textContent = text;
      }
    });
  }, text);
}

for (const text of ['确定取消所有基础委托？', 'Are you sure you want to cancel all basic orders?']) {
  test(`user completes cancellation with the current basic-order prompt: ${text}`, async ({ page }) => {
    // Given the native provider uses its current Basic-order copy.
    const { errors } = await openUserscriptScenario(page, createCancelScenario({
      orders: ORDER_SETS.current, positions: POSITION_SETS.current,
    }));
    await changeNativePrompt(page, text);
    // When the user opens and confirms the native dialog.
    await page.locator(CANCEL).click();
    await expect(page.locator(STATUS)).toHaveText('撤单确认弹窗已打开');
    await page.locator('[data-dialog-action="confirm"]').click();
    // Then the script follows completion and produces no dependency warning.
    await expect(page.locator(STATUS)).toHaveText('撤单已完成');
    expect((await readFixtureState(page)).orders).toEqual([]);
    await expect(page.locator(ALERT)).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('user retains a dependency warning when unknown copy is manually confirmed and orders clear', async ({ page }) => {
  // Given a native dialog with changed copy but working provider confirmation.
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    orders: ORDER_SETS.current, positions: POSITION_SETS.current,
  }));
  await changeNativePrompt(page, 'Provider changed the cancellation question');
  await page.locator(CANCEL).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await pauseScenarioClock(page);
  // When the user confirms successfully before the script discovery deadline.
  await page.locator('[data-dialog-action="confirm"]').click();
  await page.clock.runFor(2000);
  // Then the warning exposes lost tracking without claiming the cancellation failed.
  await expect(page.locator(STATUS)).toHaveText(UNKNOWN_STATUS);
  expect((await readFixtureState(page)).orders).toEqual([]);
  await expect(page.locator(ALERT)).toBeVisible();
  await expect(page.locator(ALERT)).toHaveAttribute('title', /撤单弹窗跟踪.*未观察到符合约定的弹窗.*无法确认/);
  // When the page switches to English without changing symbol or reloading.
  await page.evaluate(() => history.pushState({}, '', location.pathname.replace('/zh-CN/', '/en/')));
  await page.clock.runFor(1000);
  // Then the retained status and dependency details are both localized.
  await expect(page.locator(STATUS)).toHaveText('Cancellation dialog was not recognized; the result is unknown. Check open orders');
  await expect(page.locator(ALERT)).toHaveText('⚠ Binance dependency check failed; script update may be needed');
  await expect(page.locator(ALERT)).toHaveAttribute('title', /Cancellation dialog tracking.*expected dialog not observed.*result cannot be confirmed/);
  // When a later no-order action updates the ordinary status.
  await page.locator(CANCEL).click();
  await page.clock.runFor(500);
  // Then the dependency warning survives that unrelated status update.
  await expect(page.locator(ALERT)).toBeVisible();
  expect((await readFixtureState(page)).events.filter(event => event.type === 'cancel-requested')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('user sees each cancellation dependency reason once without losing later distinct failures', async ({ page }) => {
  // Given a provider copy change and a persistent warning panel.
  const reports = [];
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('Binance dependency check failed')) reports.push(message.text());
  });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    orders: ORDER_SETS.current, positions: POSITION_SETS.current,
  }));
  await changeNativePrompt(page, 'Provider changed the cancellation question');
  // When the same unrecognized dialog is requested twice and manually dismissed.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator(CANCEL).click();
    await expect.poll(async () => {
      await page.clock.runFor(16);
      return page.getByRole('dialog').isVisible();
    }).toBe(true);
    if (attempt === 0) await pauseScenarioClock(page);
    await page.clock.runFor(2000);
    await expect(page.locator(STATUS)).toHaveText(UNKNOWN_STATUS);
    await page.locator('[data-dialog-action="cancel"]').click();
    await page.clock.runFor(100);
  }
  // Then the warning and console keep one report for that reason.
  expect(reports).toHaveLength(1);
  await expect(page.locator(ALERT)).toHaveAttribute('title', /"visibleCandidates":3,"matchedCandidates":0/);
  // When a subsequent dialog has recognized copy but an extra native action.
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-cancel-all]')) {
        document.querySelector('.bn-modal-title').textContent = '确定取消所有基础委托？';
        document.querySelector('[role="dialog"]').append(document.createElement('button'));
      }
    });
  });
  await page.locator(CANCEL).click();
  await expect.poll(async () => {
    await page.clock.runFor(16);
    return page.locator(STATUS).textContent();
  }).toBe('撤单确认弹窗结构异常，未执行弹窗操作');
  // Then both distinct reasons remain visible and no order was cancelled.
  await expect(page.locator(ALERT)).toHaveAttribute('title', /未观察到符合约定的弹窗、弹窗操作结构不符/);
  expect(reports).toHaveLength(2);
  expect((await readFixtureState(page)).orders).toEqual(ORDER_SETS.current);
  expect(errors).toEqual([]);
});

test('user sees chart preparation failure without a misleading dialog dependency warning', async ({ page }) => {
  // Given a recognized native dialog and a chart frame that disappears before confirmation.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    orders: ORDER_SETS.current, positions: POSITION_SETS.current,
  }));
  await page.locator(CANCEL).click();
  await expect(page.locator(STATUS)).toHaveText('撤单确认弹窗已打开');
  await page.locator('.chart-widget-root iframe').evaluate(frame => frame.remove());
  // When the user tries to confirm while chart preparation is unavailable.
  await page.locator('[data-dialog-action="confirm"]').click();
  // Then the existing guard prevents the action, with no dialog-contract misclassification.
  await expect(page.locator(STATUS)).toHaveText('未能准备撤单图表保存，未执行撤单');
  await expect(page.locator(ALERT)).toBeHidden();
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  expect(state.events.filter(event => event.type === 'cancel-requested')).toEqual([]);
  expect(errors).toEqual([]);
});
