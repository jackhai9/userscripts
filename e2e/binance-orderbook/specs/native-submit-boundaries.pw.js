import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installNativeInputRollbackHost, installNativeSubmitFeedbackHost } from '../../../test/helpers/native-submit-feedback-host.js';

const STATUS = '#jh-binance-ladder-status';

async function submissions(page) {
  return (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
}

for (const feedback of [
  { label: 'a new client rejection', initial: '', text: '订单提交失败', markup: false },
  { label: 'a reused toast with updated text', initial: '订单已提交成功', text: '订单提交失败', markup: false },
  { label: 'a reused toast with fresh markup', initial: '订单提交失败', text: '订单提交失败', markup: true },
]) {
  test(`user stops immediately when native validation emits ${feedback.label}`, async ({ page }) => {
    // Given native validation owns submission and its feedback surface may contain an older message.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    const native = await page.evaluateHandle(installNativeSubmitFeedbackHost, { initialText: feedback.initial });
    await pauseScenarioClock(page);

    // When a trusted price click reaches native validation and a new rejection is published.
    await page.locator('#futuresOrderbook .bid-light').first().click();
    await page.clock.runFor(100);
    await expect.poll(() => native.evaluate(boundary => boundary.snapshot().attempts.length)).toBe(1);
    await native.evaluate((boundary, feedback) => boundary.publish(feedback.text, { replaceMarkup: feedback.markup }), feedback);

    // Then the rejection is associated with this single attempt without inventing an API error or sending a request.
    await expect(page.locator(STATUS)).toHaveText('单击开多失败：订单提交失败（未捕获错误码）');
    expect(await native.evaluate(boundary => boundary.snapshot().attempts)).toEqual([
      { action: '开多', price: '81.0', quantity: '0.07' },
    ]);
    expect(await submissions(page)).toEqual([]);
    expect(host.errors).toEqual([]);
    await native.evaluate(boundary => boundary.dispose());
    await native.dispose();
  });
}

for (const boundary of [
  { label: 'an unchanged old failure', initial: '订单提交失败', text: null, busy: false, hint: '下单请求仍未返回' },
  { label: 'a success toast without an API acknowledgement', initial: '', text: '订单已提交成功', busy: false, hint: '下单请求仍未返回' },
  { label: 'a native busy state without an API acknowledgement', initial: '', text: null, busy: true, hint: '下单按钮已恢复，但下单请求仍未返回' },
]) {
  test(`user treats ${boundary.label} as an unconfirmed order`, async ({ page }) => {
    // Given the native form can produce UI evidence without sending an exchange request.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    const native = await page.evaluateHandle(installNativeSubmitFeedbackHost, { initialText: boundary.initial, busy: boundary.busy });
    await pauseScenarioClock(page);

    // When a real single-order click receives only the declared native UI evidence.
    await page.locator('#futuresOrderbook .bid-light').first().click();
    await page.clock.runFor(100);
    await expect.poll(() => native.evaluate(host => host.snapshot().attempts.length)).toBe(1);
    if (boundary.text !== null) await native.evaluate((host, text) => host.publish(text), boundary.text);
    await page.clock.runFor(3000);

    // Then the original attempt remains pending before the full request-start deadline.
    await expect(page.locator(STATUS)).toHaveText('单击开多确认中 · 81.0 × 0.07');
    expect(await submissions(page)).toEqual([]);

    // When the remaining request-start deadline expires without a captured request.
    await page.clock.runFor(500);

    // Then neither a stale failure nor UI success can acknowledge the order or authorize another attempt.
    await expect(page.locator(STATUS)).toContainText(`未确认单击开多成功（${boundary.hint}）`);
    await expect(page.locator(STATUS)).toContainText('请在当前委托和历史成交中核对');
    expect(await native.evaluate(host => host.snapshot().attempts)).toEqual([
      { action: '开多', price: '81.0', quantity: '0.07' },
    ]);
    expect(await submissions(page)).toEqual([]);
    expect(host.errors).toEqual([]);
    await native.evaluate(host => host.dispose());
    await native.dispose();
  });
}

test('user receives a close-maker rejection from native validation without automatically retrying the single order', async ({ page }) => {
  // Given one long position can be closed and the native host may reject the maker price locally.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '1' }],
    ui: { tradeMode: 'CLOSE' },
  }));
  const native = await page.evaluateHandle(installNativeSubmitFeedbackHost);
  await pauseScenarioClock(page);

  // When a trusted close price reaches validation and receives a Post Only maker rejection.
  await page.locator('#futuresOrderbook .bid-light').first().click();
  await page.clock.runFor(100);
  await expect.poll(() => native.evaluate(boundary => boundary.snapshot().attempts.length)).toBe(1);
  await native.evaluate(boundary => boundary.publish('Post Only order rejected: could not be executed as a maker'));
  await page.clock.runFor(1500);

  // Then the reason remains visible and the one-click action never turns into a retrying ladder.
  await expect(page.locator(STATUS)).toHaveText('单击平多失败：Post Only order rejected: could not be executed as a maker');
  expect(await native.evaluate(boundary => boundary.snapshot().attempts)).toEqual([
    { action: '平多', price: '81.0', quantity: '0.01' },
  ]);
  expect(await submissions(page)).toEqual([]);
  expect(host.errors).toEqual([]);
  await native.evaluate(boundary => boundary.dispose());
  await native.dispose();
});

for (const native of [
  { label: 'missing', kind: 'remove', expected: '下单按钮 3 秒内未渲染完成' },
  { label: 'disabled', kind: 'disabled', expected: '下单按钮 3 秒内未恢复可点击' },
  { label: 'showing a loading class', kind: 'class', expected: '下单按钮 3 秒内未恢复可点击' },
  { label: 'showing a nested spinner', kind: 'spinner', expected: '下单按钮 3 秒内未恢复可点击' },
]) {
  test(`user stops a ladder after its native submit button remains ${native.label} for the readiness deadline`, async ({ page }) => {
    // Given the quantity labels remain valid while the native open-long action becomes unavailable.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await pauseScenarioClock(page);
    await page.locator('.order-entry button').first().evaluate((button, kind) => {
      if (kind === 'remove') button.remove();
      if (kind === 'disabled') button.disabled = true;
      if (kind === 'class') button.classList.add('loading');
      if (kind === 'spinner') {
        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        button.append(spinner);
      }
    }, native.kind);

    // When the ordinary ladder exhausts the native button's three-second readiness window.
    await page.locator('[data-ladder-action="OPEN_LONG"]').evaluate(button => button.click());
    await page.clock.runFor(3500);

    // Then the matching readiness reason stops the ladder with zero confirmed or sent orders.
    await expect(page.locator(STATUS)).toContainText(native.expected);
    await expect(page.locator(STATUS)).toContainText('已挂 0/5');
    expect(await submissions(page)).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

for (const field of [
  { name: 'price', selector: '#limitPrice-open', expected: '80.9', message: '价格框未同步，点击价 80.9，当前提交价 ' },
  { name: 'quantity', selector: '#unitAmount-open', expected: '0.07', message: '数量框未同步，目标量 0.07，当前提交量 ' },
]) {
  for (const rollbackValue of ['', 'unavailable', '42']) {
    test(`user cannot submit when native ${field.name} remains ${rollbackValue || 'empty'} after controlled input writes`, async ({ page }) => {
      // Given the native field consistently rejects proposed values and retains its declared committed state.
      await installScenarioClock(page);
      const host = await openUserscriptScenario(page, createCancelScenario());
      const native = await page.evaluateHandle(installNativeInputRollbackHost, { selector: field.selector, rollbackValue });
      await pauseScenarioClock(page);

      // When a real book click exercises the rejected field and the synchronization deadline expires.
      await page.locator('#futuresOrderbook .bid-light').nth(field.name === 'price' ? 1 : 0).click();
      await page.clock.runFor(600);

      // Then the mismatch is explicit, writes remain bounded, and no partially synchronized order is submitted.
      await expect(page.locator(STATUS)).toHaveText('单击开多失败：' + field.message + (rollbackValue || '-'));
      const state = await native.evaluate(boundary => boundary.snapshot());
      expect(state.current).toBe(rollbackValue);
      expect(state.proposed.length).toBeGreaterThanOrEqual(1);
      expect(state.proposed.length).toBeLessThanOrEqual(2);
      expect([...new Set(state.proposed)]).toEqual([field.expected]);
      expect(await submissions(page)).toEqual([]);
      expect(host.errors).toEqual([]);
      await native.evaluate(boundary => boundary.dispose());
      await native.dispose();
    });
  }
}
