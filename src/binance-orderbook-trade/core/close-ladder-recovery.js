import { compareDecimalStrings, normalizeDecimalString } from './decimal.js';
import { throwIfAborted } from '../../shared/abort.js';
import { combineLocalizedText, formatLocalizedText, localizedText } from '../contracts/panel-copy.js';

export function capCloseLadderBaseQty(domQty, positionQty) {
  const comparison = compareDecimalStrings(domQty, positionQty);
  if (comparison === null) throw new Error('Invalid close recovery quantity');
  return normalizeDecimalString(comparison <= 0 ? domQty : positionQty);
}

function isConfirmedReduceOnlyConflict(error) {
  return error?.ladderFailureKind === 'reduce_only_conflict'
    && error.binanceCode === 90802022
    && error.safeNoSubmit === true;
}

function recoveryFailure(reason, rejection) {
  const text = combineLocalizedText([reason, rejection.message], ' · ');
  const error = new Error(formatLocalizedText(text, 'zh-CN'), { cause: rejection });
  error.name = 'CloseLadderRecoveryError';
  error.localizedText = text;
  return error;
}

/**
 * A cancelled or newly submitted order is not evidence of a smaller position.
 * Spend one scoped replacement at an unchanged authoritative quantity, then
 * require a strict position decrease before spending another. Failed recovery
 * adapters cannot inherit the outer runner's unrelated retry permissions.
 */
export async function runCloseLadderWithPositionRecovery({
  buildPlan,
  executePlan,
  readPositionQty,
  replaceOrders,
  waitForRecovery,
  assertContext,
  signal = null,
}) {
  let plan = await buildPlan(null);
  let previousQty = null;
  let replacementQty = null;
  let lastRejection = null;
  const check = () => {
    throwIfAborted(signal);
    assertContext(plan);
  };
  const read = async () => {
    check();
    const qty = normalizeDecimalString(await readPositionQty(plan));
    check();
    if (qty === null) throw new Error('Invalid confirmed position quantity');
    return qty;
  };
  const wait = async () => {
    check();
    await waitForRecovery(plan, lastRejection);
    check();
  };
  const assertNotIncreased = (qty, baseline) => {
    if (compareDecimalStrings(qty, baseline) > 0) {
      throw recoveryFailure(localizedText(
        '目标方向持仓增加，已停止只减仓冲突恢复',
        'Position increased; reduce-only recovery stopped',
      ), lastRejection);
    }
  };

  try {
    while (true) {
      check();
      try {
        const execution = await executePlan(plan, { recovering: lastRejection !== null });
        return { plan, ...execution };
      } catch (error) {
        if (!isConfirmedReduceOnlyConflict(error)) throw error;
        lastRejection = error;
      }

      const beforeWaitQty = await read();
      if (beforeWaitQty === '0') return { status: 'position_closed' };
      if (previousQty !== null) assertNotIncreased(beforeWaitQty, previousQty);
      await wait();
      let qty = await read();
      if (qty === '0') return { status: 'position_closed' };
      assertNotIncreased(qty, beforeWaitQty);
      const decreased = compareDecimalStrings(qty, previousQty ?? beforeWaitQty) < 0;

      if (!decreased) {
        if (replacementQty !== null && compareDecimalStrings(qty, replacementQty) >= 0) {
          throw recoveryFailure(localizedText(
            '替换后仍有只减仓冲突，复核持仓未减少，已停止',
            'Reduce-only conflict persists after replacement; position has not decreased; stopped',
          ), lastRejection);
        }
        check();
        const result = await replaceOrders(plan);
        check();
        if (result.ok !== true) throw recoveryFailure(result.message, lastRejection);
        replacementQty = qty;
        await wait();
        const afterReplacementQty = await read();
        if (afterReplacementQty === '0') return { status: 'position_closed' };
        assertNotIncreased(afterReplacementQty, qty);
        qty = afterReplacementQty;
      }

      previousQty = qty;
      check();
      plan = await buildPlan(qty);
      check();
    }
  } catch (error) {
    if (!lastRejection
      || ['LadderStoppedError', 'ClosePositionCompletedError', 'CloseLadderRecoveryError'].includes(error.name)) {
      throw error;
    }
    throw recoveryFailure(error.localizedText || error.message, lastRejection);
  }
}
