import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

export const STATUS = '#jh-binance-ladder-status';
export const capacityRejection = { outcome: 'rejected', delivery: 'immediate', code: '90802025', message: 'Maximum open orders' };
const success = { outcome: 'success', delivery: 'immediate' };

export function capacityOrders(count) {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      id: 'same-' + index, orderId: 1000 + index, clientOrderId: 'client-' + index, symbol: CURRENT_SYMBOL, kind: 'basic', side: '平空',
      price: String(81 + index), quantity: '1',
    })),
    { id: 'opposite', orderId: 10, clientOrderId: 'close-long', symbol: CURRENT_SYMBOL, kind: 'basic', side: '平多', price: '999', quantity: '1' },
    { id: 'other', orderId: 11, clientOrderId: 'other-symbol', symbol: OTHER_SYMBOL, kind: 'basic', side: '平空', price: '999', quantity: '1' },
    { id: 'conditional', orderId: 12, clientOrderId: 'conditional', symbol: CURRENT_SYMBOL, kind: 'conditional', side: '平空', price: '999', quantity: '1' },
  ];
}

export async function openCapacity(page, orders, host = {}, ui = {}, options = {}) {
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    orders,
    ui: { tradeMode: 'CLOSE', accountTab: 'openOrders', hideOtherSymbols: false, ...ui },
    host: {
      submitApiResponses: [capacityRejection, success, success, success, success, { ...success, delivery: 'manual' }],
      ...host,
    },
  });
  const context = await openUserscriptScenario(page, scenario, options);
  await pauseScenarioClock(page);
  return { scenario, ...context };
}

/** Advance only the modeled host clock; every pass observes actual page state. */
export async function advanceTo(page, description, readReached, { step = 250, limit = 25000 } = {}) {
  for (let elapsed = 0; elapsed <= limit; elapsed += step) {
    if (await readReached()) return;
    if (elapsed < limit) await page.clock.runFor(step);
  }
  throw new Error('The native scenario did not reach ' + description + ': ' + await page.locator(STATUS).textContent());
}

export async function startContinuous(page) {
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
  });
}

export async function finishFirstRound(page, context) {
  // Native HTTP responses run outside the virtual clock. A shorter step lets the page
  // consume each response before delayed row mounts and the next pending submission.
  await advanceTo(page, 'the final pending response in the first round', () => context.pendingSubmitSequences().includes(6),
    { step: 100, limit: 35000 });
  await context.releaseSubmitResponse(6);
  await advanceTo(page, 'five acknowledged orders', async () => (await page.locator(STATUS).textContent()).includes('累计 5 笔'),
    { step: 50, limit: 1000 });
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(1000);
}
