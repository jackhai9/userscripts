import { test, expect } from '../test.js';
import { OTHER_SYMBOL } from '../scenarios/cancel-current-symbol.js';
import { readFixtureState } from '../helpers/userscript-page.js';
import { STATUS, advanceTo, capacityOrders, capacityRejection, finishFirstRound, openCapacity, startContinuous } from '../helpers/order-capacity-scenario.js';

test('user frees the fifty farthest slots only after all two hundred current orders render despite stale React event caches', async ({ page }) => {
  // Given two hundred current-symbol Basic orders have only fifty mounted rows and stale event caches disagree with both.
  const orders = capacityOrders(199);
  const context = await openCapacity(page, orders, { orderRowsPageSize: 50 }, { hideOtherSymbols: true });
  await page.locator('.orders-content').evaluate(host => {
    const initial = host.__reactFiber$fixture;
    const list = initial.return.memoizedProps;
    host.parentElement.__reactProps$fixture = { children: [null, null, { props: { children: {
      props: { ...list, data: list.data.slice(0, 199) },
    } } }] };
    host.__reactProps$fixture = { children: [null, { props: { children: [null, list.data.map(list.renderItem), null] } }] };
    const cachedParent = host.parentElement.__reactProps$fixture;
    const cachedHost = host.__reactProps$fixture;
    const holdNativeScroll = event => event.stopImmediatePropagation();
    host.addEventListener('scroll', holdNativeScroll, true);
    window.__releaseCapacityRows = () => {
      host.removeEventListener('scroll', holdNativeScroll, true);
      host.dispatchEvent(new Event('scroll'));
    };
    window.__capacityWindowObservations = [];
    const observe = () => {
      const current = initial.return.return.return.stateNode.current.child.child.child;
      window.__capacityWindowObservations.push({
        data: current.return.memoizedProps.data.length,
        rendered: current.memoizedProps.children[1].props.children[1].length,
        mounted: host.querySelectorAll('.open-order-row').length,
        cachedData: cachedParent.children[2].props.children.props.data.length,
        cachedRendered: cachedHost.children[1].props.children[1].length,
        sameCaches: cachedParent === host.parentElement.__reactProps$fixture && cachedHost === host.__reactProps$fixture,
        cancellations: window.__BINANCE_FIXTURE__.snapshot().events.filter(event => event.type === 'row-cancel-requested').length,
      });
    };
    observe();
    host.addEventListener('scroll', observe);
    host.addEventListener('click', () => host.removeEventListener('scroll', observe), { capture: true, once: true });
    const status = document.querySelector('#jh-binance-ladder-status');
    window.__capacityStatusObservations = [];
    const statusObserver = new MutationObserver(() => {
      window.__capacityStatusObservations.push({ text: status.textContent,
        mounted: host.querySelectorAll('.open-order-row').length,
        cancellations: window.__BINANCE_FIXTURE__.snapshot().events.filter(event => event.type === 'row-cancel-requested').length });
    });
    statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
    window.__capacityStopObservingStatus = () => statusObserver.disconnect();
  });

  // When the generated userscript receives a capacity rejection while native pagination has not delivered more rows.
  await startContinuous(page);
  await advanceTo(page, 'visible incomplete-window progress', async () =>
    (await page.locator(STATUS).textContent()).includes('上限恢复：委托 50/200'), { step: 25, limit: 2500 });

  // Then the user sees the exact incomplete window before counts, and no native cancellation is issued.
  const waitingText = await page.locator(STATUS).textContent();
  expect(waitingText.indexOf('上限恢复：委托 50/200')).toBeLessThan(waitingText.indexOf('累计'));
  expect((await readFixtureState(page)).events.filter(event => event.type === 'row-cancel-requested')).toEqual([]);
  expect(await page.locator('.open-order-row').count()).toBe(50);

  // When the native pagination gate delivers the remaining windows and the first continuous round finishes.
  await page.evaluate(() => window.__releaseCapacityRows());
  await finishFirstRound(page, context);

  // Then stale caches remain unchanged while every actual row loads before the exact farthest fifty are cancelled.
  const observations = await page.evaluate(() => window.__capacityWindowObservations);
  const statuses = await page.evaluate(() => {
    window.__capacityStopObservingStatus();
    return window.__capacityStatusObservations;
  });
  expect(observations[0]).toEqual({ data: 200, rendered: 50, mounted: 50,
    cachedData: 199, cachedRendered: 200, sameCaches: true, cancellations: 0 });
  expect(observations.some(item => item.rendered === 200 && item.mounted === 200), JSON.stringify({ observations, statuses })).toBe(true);
  expect(observations.every(item => item.data === 200 && item.cachedData === 199 && item.cachedRendered === 200
    && item.sameCaches && item.cancellations === 0)).toBe(true);
  const state = await readFixtureState(page);
  const farthest = Array.from({ length: 50 }, (_, index) => 'same-' + (198 - index));
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId)).toEqual(farthest);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId)).toEqual(farthest);
  expect(state.orders).toEqual([...orders.slice(0, 149), ...orders.slice(199)]);
  const completeIndex = state.events.findIndex(event => event.type === 'order-rows-page-loaded' && event.ids.length === 200);
  const firstCancelIndex = state.events.findIndex(event => event.type === 'row-cancel-requested');
  expect(completeIndex).toBeGreaterThanOrEqual(0);
  expect(firstCancelIndex).toBeGreaterThan(completeIndex);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(6);
  expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
  expect(state.accountTab).toBe('openOrders');
  expect(state.openOrdersSubTab).toBe('basic');
  expect(state.hideOtherSymbols).toBe(true);
  expect(state.showOrders).toBe(true);
  const waiting = statuses.find(item => item.text.includes('上限恢复：委托 50/200'));
  expect(waiting?.cancellations).toBe(0);
  expect(waiting.text.indexOf('上限恢复：委托 50/200')).toBeLessThan(waiting.text.indexOf('累计'));
  await expect(page.locator(STATUS)).toContainText('撤 50 笔');
  await expect(page.locator(STATUS)).toContainText('累计 5 笔');
  expect(context.errors).toEqual([]);
});

for (const mountDelay of [0, 120]) {
  test(`user frees only the fifty farthest same-direction slots with a native row mount delay of ${mountDelay} ms`, async ({ page }) => {
    // Given sixty matching orders span native pages and unrelated farther orders must remain untouched.
    const orders = capacityOrders(60);
    const context = await openCapacity(page, orders, { orderRowsPageSize: 8, orderRowsMountDelayMs: mountDelay });
    const initialScroll = await page.locator('.orders-content').evaluate(element => {
      element.scrollTop = 12;
      return element.scrollTop;
    });

    // When the continuous close round receives a capacity rejection and the user stops after its completed recovery round.
    await startContinuous(page);
    await finishFirstRound(page, context);

    // Then the full list determines exactly fifty farthest cancellations and preserves all other orders and confirmed progress.
    const state = await readFixtureState(page);
    const farthest = Array.from({ length: 50 }, (_, index) => 'same-' + (59 - index));
    expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId)).toEqual(farthest);
    expect(state.events.filter(({ type }) => type === 'row-cancel-response').map(({ orderId }) => orderId).sort()).toEqual([...farthest].sort());
    expect(state.orders).toEqual([...orders.slice(0, 10), ...orders.slice(60)]);
    const lastPage = state.events.find(event => event.type === 'order-rows-page-loaded' && event.ids.includes('opposite'));
    const firstCancel = state.events.find(event => event.type === 'row-cancel-requested');
    expect(firstCancel.at - lastPage.at).toBeGreaterThanOrEqual(0);
    expect(firstCancel.at - lastPage.at).toBeLessThan(700);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(6);
    expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
    expect(state.accountTab).toBe('openOrders');
    expect(state.hideOtherSymbols).toBe(false);
    expect(state.showOrders).toBe(true);
    expect(await page.locator('.orders-content').evaluate(element => element.scrollTop)).toBe(initialScroll);
    await expect(page.locator(STATUS)).toContainText('累计 5 笔');
    await expect(page.locator(STATUS)).toContainText('撤 50 笔');
    expect(context.errors).toEqual([]);
  });
}

test('user completes the same fifty capacity cancellations after a native publication hides the remaining selected rows', async ({ page }) => {
  // Given two cancellation receipts are held after selecting the fifty farthest orders from the complete native list.
  const orders = capacityOrders(60);
  const context = await openCapacity(page, orders, { orderRowsPageSize: 8 }, { hideOtherSymbols: true },
    { holdRowCancelResponses: true });
  await startContinuous(page);
  await advanceTo(page, 'the first two held cancellations', () => context.pendingCancelOrderIds().length === 2,
    { step: 25, limit: 2500 });
  expect(context.pendingCancelOrderIds()).toEqual([1059, 1058]);

  // When a native publication resets the window and acknowledged receipts allow the same selected batch to continue.
  const publishedRows = await page.evaluate(() => {
    const fixture = window.__BINANCE_FIXTURE__;
    fixture.setOrders(fixture.snapshot().orders);
    return document.querySelectorAll('.open-order-row').length;
  });
  expect(publishedRows).toBe(8);
  context.releaseCancelResponse(1059);
  await advanceTo(page, 'the third selected cancellation after reloading hidden rows',
    () => context.pendingCancelOrderIds().includes(1057), { step: 25, limit: 2500 });
  for (let id = 1058; id >= 1010; id -= 1) {
    await advanceTo(page, 'the pending cancellation for ' + id, () => context.pendingCancelOrderIds().includes(id),
      { step: 25, limit: 1500 });
    context.releaseCancelResponse(id);
  }
  await finishFirstRound(page, context);

  // Then the reloaded list preserves the original fifty identities, unrelated orders, and resumed submission progress.
  const state = await readFixtureState(page);
  const farthest = Array.from({ length: 50 }, (_, index) => 'same-' + (59 - index));
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId)).toEqual(farthest);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(50);
  expect(state.orders).toEqual([...orders.slice(0, 10), ...orders.slice(60)]);
  const publication = state.events.findIndex(event => event.type === 'native-orders-updated');
  const thirdCancel = state.events.findIndex(event => event.type === 'row-cancel-requested' && event.orderId === 'same-57');
  expect(publication).toBeGreaterThanOrEqual(0);
  expect(state.events.slice(publication, thirdCancel).some(event => event.type === 'order-rows-page-loaded'
    && event.ids.includes('opposite'))).toBe(true);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
  await expect(page.locator(STATUS)).toContainText('撤 50 笔');
  await expect(page.locator(STATUS)).toContainText('累计 5 笔');
  expect(context.errors).toEqual([]);
});

test('user waits for the native order list to mount before choosing capacity cancellations', async ({ page }) => {
  // Given the Basic scope appears before any of its delayed native rows are rendered.
  const orders = capacityOrders(3);
  const context = await openCapacity(page, orders, { orderRowsMountDelayMs: 900 });
  expect(await page.locator('.open-order-row').count()).toBe(0);

  // When the real continuous close workflow receives its first capacity rejection.
  await startContinuous(page);
  await advanceTo(page, 'a capacity-rejected request', async () => (await readFixtureState(page)).events
    .some(({ type }) => type === 'order-submit-api-rejected'), { step: 50, limit: 1500 });

  // Then a still-unmounted list has not been treated as permission to submit or cancel.
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'row-cancel-requested')).toEqual([]);

  // When the delayed native rows arrive and the captured round completes.
  await finishFirstRound(page, context);

  // Then the actual three same-direction rows are cancelled in distance order before five successful replacements.
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['same-2', 'same-1', 'same-0']);
  expect(state.orders).toEqual(orders.slice(3));
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(6);
  expect(context.errors).toEqual([]);
});

test('user receives a bounded capacity recovery failure when no matching native row can be found', async ({ page }) => {
  // Given only opposite-direction, other-symbol, and conditional orders exist.
  const orders = capacityOrders(0);
  const context = await openCapacity(page, orders, { submitApiResponses: [capacityRejection] });

  // When a capacity-rejected continuous close round searches the fully observed native scope.
  await startContinuous(page);
  await advanceTo(page, 'the precise no-matching-row reason', async () => (await page.locator(STATUS).textContent())
    .includes('未找到平空方向的可撤基础单'), { step: 50, limit: 2500 });
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(1000);

  // Then no unrelated cancellation or second submit is issued and all orders are retained.
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(orders);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested')).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  await expect(page.locator(STATUS)).toContainText('已停止');
  expect(context.errors).toEqual([]);
});

for (const [name, retainedOrders, restoredSubTab] of [
  ['a short opposite-direction list', [capacityOrders(0)[0]], 'basic'],
  ['only another symbol', [capacityOrders(0)[1]], 'basic'],
  ['an explicit empty list', [], 'basic'],
  ['the original Conditional list', Array.from({ length: 10 }, (_, index) => ({
    ...capacityOrders(0)[2], id: 'conditional-' + index, orderId: 20 + index, clientOrderId: 'conditional-' + index,
  })), 'conditional'],
]) {
  test(`user finishes delayed scroll restoration with ${name} after freeing capacity`, async ({ page }) => {
    // Given the original native scroll position belongs to a list that will change after cancellations.
    const orders = [...capacityOrders(10).slice(0, 10), ...retainedOrders];
    const context = await openCapacity(page, orders, { orderRowsPageSize: 8, orderRowsMountDelayMs: 120 },
      { openOrdersSubTab: restoredSubTab });
    await advanceTo(page, 'the original visible rows', async () => await page.locator('.open-order-row').count() === 8,
      { step: 20, limit: 200 });
    await page.locator('.orders-content').evaluate(element => { element.scrollTop = 12; });

    // When the user completes one capacity recovery round through the actual continuous action.
    await startContinuous(page);
    await finishFirstRound(page, context);

    // Then mounted short and empty lists complete immediately and a still-scrollable Conditional list restores its position.
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(retainedOrders);
    expect(state.openOrdersSubTab).toBe(restoredSubTab);
    expect(state.hideOtherSymbols).toBe(false);
    expect(await page.locator('.orders-content').evaluate(element => element.scrollTop))
      .toBe(restoredSubTab === 'conditional' ? 12 : 0);
    const filterRestoredAt = state.events.filter(event => event.type === 'hide-other-symbols' && event.value === false).at(-1).at;
    const resumedAt = state.events.filter(event => event.type === 'order-submitted')[1].at;
    expect(resumedAt - filterRestoredAt).toBeLessThan(1000);
    expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(10);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
    expect(context.errors).toEqual([]);
  });
}

test('user keeps the new symbol scope when a route switch interrupts delayed scroll restoration', async ({ page }) => {
  // Given capacity recovery has an original scroll position and restoration rows arrive after their filter.
  const context = await openCapacity(page, capacityOrders(10), { orderRowsPageSize: 8, orderRowsMountDelayMs: 300 });
  await advanceTo(page, 'the original visible rows', async () => await page.locator('.open-order-row').count() === 8,
    { step: 20, limit: 400 });
  await page.locator('.orders-content').evaluate(element => { element.scrollTop = 12; });
  await startContinuous(page);
  // A 100 ms probe still observes the 300 ms native mount window while keeping
  // ten-row cancellation progress bounded under precise coverage instrumentation.
  await advanceTo(page, 'the filter restored before its rows', async () => (await readFixtureState(page)).events
    .some(event => event.type === 'hide-other-symbols' && event.value === false), { step: 100, limit: 25000 });
  expect(await page.locator('[data-orders-loading]').count()).toBe(1);

  // When Binance changes symbol while the old restoration is waiting for the native rows.
  await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), OTHER_SYMBOL);
  await page.clock.runFor(3000);

  // Then old cleanup cannot change the new scope, and the rejected order is never retried for the new symbol.
  const state = await readFixtureState(page);
  expect(new URL(page.url()).pathname).toBe('/zh-CN/futures/' + OTHER_SYMBOL);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(10);
  expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
  expect(await page.locator('.orders-content').evaluate(element => element.scrollTop)).toBe(0);
  expect(context.errors).toEqual([]);
});

test('user does not cancel another capacity batch after a second confirmed rejection in the same round', async ({ page }) => {
  // Given sixty matching rows exist and the native API rejects both the initial and resumed submission.
  const orders = capacityOrders(60);
  const context = await openCapacity(page, orders, {
    orderRowsPageSize: 8, submitApiResponses: [capacityRejection, capacityRejection],
  });

  // When one full recovery still cannot satisfy capacity and the user stops in the declared recovery wait.
  await startContinuous(page);
  await advanceTo(page, 'the second rejected response', async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-rejected').length === 2);
  await page.clock.runFor(100);
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(3000);

  // Then only the first fifty cancellations are counted and no duplicated or third submission occurs.
  const state = await readFixtureState(page);
  expect(state.orders).toEqual([...orders.slice(0, 10), ...orders.slice(60)]);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(50);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(2);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toEqual([]);
  await expect(page.locator(STATUS)).toContainText('撤 50 笔');
  await expect(page.locator(STATUS)).toContainText('累计 0 笔');
  expect(context.errors).toEqual([]);
});

test('user cancels no orders while the native list renders a previous snapshot of the same size', async ({ page }) => {
  // Given the Basic filter is active but its native data changed before the rendered rows did.
  const orders = capacityOrders(4);
  await openCapacity(page, orders, {}, { hideOtherSymbols: true });
  await page.locator('.orders-content').evaluate(host => {
    const list = host.__reactFiber$fixture.return.return.return.stateNode.current.child.child.memoizedProps;
    list.data = list.data.map((item, i) => i ? item : { ...item, clientOrderId: 'replacement-order' });
  });

  // When Binance rejects a submission and never commits the matching window.
  await startContinuous(page);
  await advanceTo(page, 'the incomplete native list deadline', async () =>
    (await page.locator(STATUS).textContent()).includes('7 秒内未加载完成'), { step: 250, limit: 10500 });

  // Then the stale rows cannot authorize a single cancellation.
  const state = await readFixtureState(page);
  expect(state.events.filter(event => event.type === 'row-cancel-requested')).toEqual([]);
  expect(state.orders).toEqual(orders);
});

test('user can free capacity after scrolling restores an outdated native window', async ({ page }) => {
  // Given the native list replaced an order while the mounted window was away from both ends.
  const orders = capacityOrders(10);
  const context = await openCapacity(page, orders, { orderRowsPageSize: 8 }, { hideOtherSymbols: true });
  await page.locator('.orders-content').evaluate(host => {
    host.scrollTop = 12;
    const currentHost = host.__reactFiber$fixture.return.return.return.stateNode.current.child.child.child;
    const rendered = currentHost.memoizedProps.children[1].props.children[1];
    const current = rendered[0];
    rendered[0] = { ...current, props: { ...current.props, orderId: 'obsolete' } };
    currentHost.child.memoizedProps = rendered[0].props;
    host.addEventListener('scroll', () => {
      if (host.scrollTop !== 0) return;
      rendered[0] = current;
      currentHost.child.memoizedProps = current.props;
      host.firstElementChild.replaceWith(host.firstElementChild);
    });
  });

  // When capacity recovery needs the whole current list.
  await startContinuous(page);
  await finishFirstRound(page, context);

  // Then only the ten current matching IDs were clicked, in farthest-first order.
  const state = await readFixtureState(page);
  expect(state.events.filter(event => event.type === 'row-cancel-requested').map(event => event.orderId))
    .toEqual(Array.from({ length: 10 }, (_, i) => 'same-' + (9 - i)));
});

for (const condition of ['loading', 'hasMore', 'previous symbol filter']) {
  test(`user cancels no orders when the visible list is complete but native ${condition} is active`, async ({ page }) => {
    // Given all rows are visible while the native owner says its data may still change.
    const orders = capacityOrders(3);
    await openCapacity(page, orders, {}, { hideOtherSymbols: true });
    await page.locator('.orders-content').evaluate((host, flag) => {
      const current = host.__reactFiber$fixture.return.return.return.stateNode.current.child.child.child;
      const list = current.return.memoizedProps;
      if (flag === 'previous symbol filter') {
        const first = { ...list.data[0], symbol: 'BTCUSDT' };
        list.data = [first, ...list.data.slice(1)];
        current.memoizedProps.children[1].props.children[1][0] = list.renderItem(first);
      } else list[flag] = true;
    }, condition);

    // When a capacity rejection requires ranking the entire native list.
    await startContinuous(page);
    await advanceTo(page, 'the incomplete native list deadline', async () =>
      (await page.locator(STATUS).textContent()).includes('7 秒内未加载完成'), { step: 250, limit: 10500 });

    // Then visible rows alone cannot authorize any cancellation.
    const state = await readFixtureState(page);
    expect(state.events.filter(event => event.type === 'row-cancel-requested')).toEqual([]);
    expect(state.orders).toEqual(orders);
  });
}
