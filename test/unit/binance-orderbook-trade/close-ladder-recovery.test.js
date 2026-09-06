import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capCloseLadderBaseQty,
  runCloseLadderWithPositionRecovery,
} from '../../../src/binance-orderbook-trade/core/close-ladder-recovery.js';
import { formatLocalizedText } from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';

function rejection() {
  return Object.assign(new Error('Reduce-only rejected (90802022)'), {
    binanceCode: 90802022,
    safeNoSubmit: true,
    ladderFailureKind: 'reduce_only_conflict',
  });
}

function scenario({ quantities, failures = [rejection()], replaceResult = { ok: true }, onWait = () => {} }) {
  const events = [];
  let readIndex = 0;
  let executionIndex = 0;
  const signal = new AbortController();
  const options = {
    signal: signal.signal,
    assertContext: () => {},
    buildPlan: async (positionQty) => {
      const baseQty = positionQty === null ? '100' : capCloseLadderBaseQty('100', positionQty);
      events.push(['build', baseQty]);
      return { spec: { mode: 'CLOSE' }, baseQty };
    },
    executePlan: async () => {
      events.push(['execute']);
      const error = failures[executionIndex++];
      if (error) throw error;
      return { done: 3 };
    },
    readPositionQty: async () => {
      const qty = quantities[readIndex++];
      assert.notEqual(qty, undefined, 'Unexpected position read');
      events.push(['position', qty]);
      return qty;
    },
    replaceOrders: async () => {
      events.push(['replace']);
      return replaceResult;
    },
    waitForRecovery: async () => {
      events.push(['wait']);
      onWait(signal);
    },
  };
  return { options, events };
}

test('a confirmed flat position ends recovery without cancellation or another submit', async () => {
  const { options, events } = scenario({ quantities: ['0'] });
  assert.deepEqual(await runCloseLadderWithPositionRecovery(options), { status: 'position_closed' });
  assert.deepEqual(events, [['build', '100'], ['execute'], ['position', '0']]);
});

test('a real position decrease rebuilds beyond the old two-attempt limit without cancelling', async () => {
  const { options, events } = scenario({
    quantities: ['100', '80', '80', '60', '60', '40'],
    failures: [rejection(), rejection(), rejection()],
  });
  const result = await runCloseLadderWithPositionRecovery(options);
  assert.equal(result.done, 3);
  assert.deepEqual(events.filter(([type]) => type === 'build'), [
    ['build', '100'], ['build', '80'], ['build', '60'], ['build', '40'],
  ]);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
  assert.equal(events.filter(([type]) => type === 'wait').length, 3);
});

test('unchanged position permits one confirmed scoped replacement before replanning', async () => {
  const { options, events } = scenario({ quantities: ['100', '100', '100'] });
  assert.equal((await runCloseLadderWithPositionRecovery(options)).done, 3);
  assert.deepEqual(events, [
    ['build', '100'], ['execute'], ['position', '100'], ['wait'], ['position', '100'],
    ['replace'], ['wait'], ['position', '100'], ['build', '100'], ['execute'],
  ]);
});

test('rejection after replacement waits for progress and stops unchanged state without another cancellation', async () => {
  const { options, events } = scenario({
    quantities: ['100', '100', '100', '100', '100'],
    failures: [rejection(), rejection()],
  });
  await assert.rejects(runCloseLadderWithPositionRecovery(options), (error) => {
    assert.match(formatLocalizedText(error.localizedText, 'en'), /position has not decreased/i);
    assert.match(error.message, /90802022/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
  assert.equal(events.filter(([type]) => type === 'replace').length, 1);
  assert.equal(events.filter(([type]) => type === 'execute').length, 2);
});

test('actual position reduction after replacement allows further recovery', async () => {
  const { options, events } = scenario({
    quantities: ['100', '100', '100', '100', '80', '80', '80', '80'],
    failures: [rejection(), rejection(), rejection()],
  });
  assert.equal((await runCloseLadderWithPositionRecovery(options)).done, 3);
  assert.equal(events.filter(([type]) => type === 'replace').length, 2);
  assert.deepEqual(events.filter(([type]) => type === 'build'), [
    ['build', '100'], ['build', '100'], ['build', '80'], ['build', '80'],
  ]);
});

test('an increased position cannot reset the recovery guard', async () => {
  const { options, events } = scenario({ quantities: ['100', '101'] });
  await assert.rejects(runCloseLadderWithPositionRecovery(options), /90802022/);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
});

test('unconfirmed cancellation stops without another position read or submission', async () => {
  const { options, events } = scenario({
    quantities: ['100', '100'],
    replaceResult: { ok: false, status: 'row_cancel_failed', message: 'Cancellation unconfirmed' },
  });
  await assert.rejects(runCloseLadderWithPositionRecovery(options), /Cancellation unconfirmed/);
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
});

test('position failures do not escape into the outer continuous retry policy', async () => {
  const { options, events } = scenario({ quantities: [] });
  options.readPositionQty = async () => {
    throw Object.assign(new Error('Position unavailable'), {
      continuousRecoveryKind: 'position_state_not_ready', safeNoSubmit: true,
    });
  };
  await assert.rejects(runCloseLadderWithPositionRecovery(options), (error) => {
    assert.match(error.message, /Position unavailable/);
    assert.equal(error.continuousRecoveryKind, undefined);
    assert.equal(error.safeNoSubmit, undefined);
    return true;
  });
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
});

test('unknown submission during recovery cannot start a new continuous round', async () => {
  const unknown = Object.assign(new Error('Submission unconfirmed'), { continuousRecoveryKind: 'submit_unconfirmed' });
  const { options } = scenario({ quantities: ['100', '80'], failures: [rejection(), unknown] });
  await assert.rejects(runCloseLadderWithPositionRecovery(options), (error) => {
    assert.match(error.message, /Submission unconfirmed/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
});

test('the executor is told to disable unrelated recovery after the first reduce-only rejection', async () => {
  const { options, events } = scenario({ quantities: ['100', '80'] });
  const executions = [];
  options.executePlan = async (_plan, { recovering }) => {
    executions.push(recovering);
    if (!recovering) throw rejection();
    throw Object.assign(new Error('Maximum open orders (90802025)'), {
      safeNoSubmit: true, binanceCode: 90802025, ladderFailureKind: 'max_open_orders',
    });
  };
  await assert.rejects(runCloseLadderWithPositionRecovery(options), (error) => {
    assert.match(error.message, /90802025/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
  assert.deepEqual(executions, [false, true]);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
});

test('manual stop during cooldown prevents the next read, cancel and submit', async () => {
  const stopped = Object.assign(new Error('Stopped'), { name: 'LadderStoppedError' });
  const { options, events } = scenario({ quantities: ['100'], onWait: (signal) => signal.abort(stopped) });
  await assert.rejects(runCloseLadderWithPositionRecovery(options), (error) => error === stopped);
  assert.deepEqual(events, [['build', '100'], ['execute'], ['position', '100'], ['wait']]);
});

test('context changes after a wait are terminal before another side effect', async () => {
  let changed = false;
  const { options, events } = scenario({ quantities: ['100'], onWait: () => { changed = true; } });
  options.assertContext = () => { if (changed) throw new Error('Symbol changed'); };
  await assert.rejects(runCloseLadderWithPositionRecovery(options), /Symbol changed/);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
});

test('text-only reduce-only feedback is not proof of a safe retry', async () => {
  const error = new Error('Reduce-only rejected (90802022)');
  const { options, events } = scenario({ quantities: [], failures: [error] });
  await assert.rejects(runCloseLadderWithPositionRecovery(options), (actual) => actual === error);
  assert.deepEqual(events, [['build', '100'], ['execute']]);
});

test('recovery quantity respects both fresh DOM availability and exact API position', () => {
  assert.equal(capCloseLadderBaseQty('60', '80'), '60');
  assert.equal(capCloseLadderBaseQty('100', '80'), '80');
  assert.equal(capCloseLadderBaseQty('1.000000000000000002', '1.000000000000000001'), '1.000000000000000001');
  assert.equal(capCloseLadderBaseQty('0', '80'), '0');
  assert.throws(() => capCloseLadderBaseQty(null, '80'), /quantity/i);
  assert.throws(() => capCloseLadderBaseQty('100', 'invalid'), /quantity/i);
});
