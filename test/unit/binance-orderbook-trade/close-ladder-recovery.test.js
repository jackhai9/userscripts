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

test('user finishes close recovery immediately when the position is confirmed flat', async () => {
  // Given a reduce-only rejection followed by an authoritative zero position.
  const { options, events } = scenario({ quantities: ['0'] });
  // When the close round reads the confirmed position.
  const result = await runCloseLadderWithPositionRecovery(options);

  // Then the round ends without cancellation or another submission.
  assert.deepEqual(result, { status: 'position_closed' });
  assert.deepEqual(events, [['build', '100'], ['execute'], ['position', '0']]);
});

test('user keeps recovering while each fresh position snapshot proves a real decrease', async () => {
  // Given three rejections followed by strictly decreasing confirmed positions.
  const { options, events } = scenario({
    quantities: ['100', '80', '80', '60', '60', '40'],
    failures: [rejection(), rejection(), rejection()],
  });
  // When the close round rebuilds from each smaller position.
  const result = await runCloseLadderWithPositionRecovery(options);

  // Then all three decreases authorize new plans without cancellation.
  assert.equal(result.done, 3);
  assert.deepEqual(events.filter(([type]) => type === 'build'), [
    ['build', '100'], ['build', '80'], ['build', '60'], ['build', '40'],
  ]);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
  assert.equal(events.filter(([type]) => type === 'wait').length, 3);
});

test('user can replace conflicting close orders once at an unchanged position', async () => {
  // Given a rejection and an unchanged position before and after the recovery wait.
  const { options, events } = scenario({ quantities: ['100', '100', '100'] });
  // When the close round runs its scoped replacement workflow.
  const result = await runCloseLadderWithPositionRecovery(options);

  // Then one replacement and its readiness wait precede a rebuilt plan.
  assert.equal(result.done, 3);
  assert.deepEqual(events, [
    ['build', '100'], ['execute'], ['position', '100'], ['wait'], ['position', '100'],
    ['replace'], ['wait'], ['position', '100'], ['build', '100'], ['execute'],
  ]);
});

test('user stops after replacement when a repeated rejection shows no position progress', async () => {
  // Given a second reduce-only rejection after one replacement at the same quantity.
  const { options, events } = scenario({
    quantities: ['100', '100', '100', '100', '100'],
    failures: [rejection(), rejection()],
  });
  // When the close round rechecks position progress.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the native rejection is preserved without another replacement or outer retry permission.
  await assert.rejects(completion, (error) => {
    assert.match(formatLocalizedText(error.localizedText, 'en'), /position has not decreased/i);
    assert.match(error.message, /90802022/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
  assert.equal(events.filter(([type]) => type === 'replace').length, 1);
  assert.equal(events.filter(([type]) => type === 'execute').length, 2);
});

test('user can replace close orders again only after a confirmed position decrease', async () => {
  // Given a replacement followed by a real decrease and another unchanged rejection.
  const { options, events } = scenario({
    quantities: ['100', '100', '100', '100', '80', '80', '80', '80'],
    failures: [rejection(), rejection(), rejection()],
  });
  // When the close round continues its progress-guarded recovery.
  const result = await runCloseLadderWithPositionRecovery(options);

  // Then the smaller position authorizes the second replacement and matching plan quantity.
  assert.equal(result.done, 3);
  assert.equal(events.filter(([type]) => type === 'replace').length, 2);
  assert.deepEqual(events.filter(([type]) => type === 'build'), [
    ['build', '100'], ['build', '100'], ['build', '80'], ['build', '80'],
  ]);
});

test('user stops close recovery when the confirmed position increases', async () => {
  // Given a reduce-only rejection followed by a position increase during the wait.
  const { options, events } = scenario({ quantities: ['100', '101'] });
  // When the close round rechecks the authoritative quantity.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the round rejects without another cancellation or submission.
  await assert.rejects(completion, /90802022/);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
});

test('user stops close recovery when scoped cancellation is unconfirmed', async () => {
  // Given an unchanged position and an unconfirmed scoped-cancellation result.
  const { options, events } = scenario({
    quantities: ['100', '100'],
    replaceResult: { ok: false, status: 'row_cancel_failed', message: 'Cancellation unconfirmed' },
  });
  // When the close round attempts its allowed replacement.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the cancellation reason ends the round before another submission.
  await assert.rejects(completion, /Cancellation unconfirmed/);
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
});

test('user stops close recovery when the authoritative position cannot be read', async () => {
  // Given a position adapter failure carrying an unrelated continuous retry classification.
  const { options, events } = scenario({ quantities: [] });
  options.readPositionQty = async () => {
    throw Object.assign(new Error('Position unavailable'), {
      continuousRecoveryKind: 'position_state_not_ready', safeNoSubmit: true,
    });
  };
  // When the close round reads the position after a reduce-only rejection.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the error loses outer retry permission and cannot authorize another submission.
  await assert.rejects(completion, (error) => {
    assert.match(error.message, /Position unavailable/);
    assert.equal(error.continuousRecoveryKind, undefined);
    assert.equal(error.safeNoSubmit, undefined);
    return true;
  });
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
});

test('user stops after an unknown submission during reduce-only recovery', async () => {
  // Given a genuine position decrease followed by an unconfirmed submission outcome.
  const unknown = Object.assign(new Error('Submission unconfirmed'), { continuousRecoveryKind: 'submit_unconfirmed' });
  const { options } = scenario({ quantities: ['100', '80'], failures: [rejection(), unknown] });
  // When the rebuilt plan executes under reduce-only recovery.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the uncertain outcome stays terminal for continuous mode.
  await assert.rejects(completion, (error) => {
    assert.match(error.message, /Submission unconfirmed/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
});

test('user cannot trigger capacity cancellation after reduce-only recovery has started', async () => {
  // Given a reduce-only conflict followed by a maximum-open-orders rejection.
  const { options, events } = scenario({ quantities: ['100', '80'] });
  const executions = [];
  options.executePlan = async (_plan, { recovering }) => {
    executions.push(recovering);
    if (!recovering) throw rejection();
    throw Object.assign(new Error('Maximum open orders (90802025)'), {
      safeNoSubmit: true, binanceCode: 90802025, ladderFailureKind: 'max_open_orders',
    });
  };
  // When the round retries the smaller position with recovery active.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the executor receives the recovery flag and no capacity replacement is authorized.
  await assert.rejects(completion, (error) => {
    assert.match(error.message, /90802025/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
  assert.deepEqual(executions, [false, true]);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
});

test('user can stop close recovery during its cooldown', async () => {
  // Given a reduce-only rejection and a user stop delivered during the recovery wait.
  const stopped = Object.assign(new Error('Stopped'), { name: 'LadderStoppedError' });
  const { options, events } = scenario({ quantities: ['100'], onWait: (signal) => signal.abort(stopped) });
  // When the close round observes the stop signal.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the original stop error propagates before another position read or side effect.
  await assert.rejects(completion, (error) => error === stopped);
  assert.deepEqual(events, [['build', '100'], ['execute'], ['position', '100'], ['wait']]);
});

test('user stops close recovery when the symbol changes during the wait', async () => {
  // Given a symbol change while the rejected close round waits for readiness.
  let changed = false;
  const { options, events } = scenario({ quantities: ['100'], onWait: () => { changed = true; } });
  options.assertContext = () => { if (changed) throw new Error('Symbol changed'); };
  // When the close round revalidates its captured context.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the symbol change is terminal before any replacement.
  await assert.rejects(completion, /Symbol changed/);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
});

test('user cannot recover a reduce-only conflict from toast text alone', async () => {
  // Given a reduce-only message without a confirmed safe native response.
  const error = new Error('Reduce-only rejected (90802022)');
  const { options, events } = scenario({ quantities: [], failures: [error] });
  // When the close round handles that failure.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the same error propagates without a position read or cancellation.
  await assert.rejects(completion, (actual) => actual === error);
  assert.deepEqual(events, [['build', '100'], ['execute']]);
});

test('user caps a recovery plan by both fresh closeable quantity and the confirmed position', () => {
  // Given exact DOM/API quantity pairs and two missing or malformed inputs.
  const pairs = [['60', '80'], ['100', '80'], ['1.000000000000000002', '1.000000000000000001'], ['0', '80']];
  const invalidPairs = [[null, '80'], ['100', 'invalid']];

  // When valid quantities are capped and invalid quantities are prepared for validation.
  const quantities = pairs.map(([dom, api]) => capCloseLadderBaseQty(dom, api));
  const invalidActions = invalidPairs.map(([dom, api]) => () => capCloseLadderBaseQty(dom, api));

  // Then the smaller exact quantity wins and missing DOM evidence never falls back to the API amount.
  assert.deepEqual(quantities, ['60', '80', '1.000000000000000001', '0']);
  invalidActions.forEach((action) => assert.throws(action, /quantity/i));
});

for (const { name, quantities, replacements, waits } of [
  { name: 'during the initial recovery wait', quantities: ['100', '0'], replacements: 0, waits: 1 },
  { name: 'after the scoped replacement', quantities: ['100', '100', '0'], replacements: 1, waits: 2 },
]) {
  test(`user finishes the close round when the position becomes flat ${name}`, async () => {
    // Given a reduce-only rejection and authoritative position reads that become zero.
    const { options, events } = scenario({ quantities });

    // When the close round performs its allowed recovery steps.
    const result = await runCloseLadderWithPositionRecovery(options);

    // Then the flat result ends recovery without rebuilding or submitting another order.
    assert.deepEqual(result, { status: 'position_closed' });
    assert.equal(events.filter(([type]) => type === 'execute').length, 1);
    assert.equal(events.filter(([type]) => type === 'replace').length, replacements);
    assert.equal(events.filter(([type]) => type === 'wait').length, waits);
    assert.deepEqual(events.filter(([type]) => type === 'build'), [['build', '100']]);
  });
}

test('user completes an ordinary close round without reading or replacing positions', async () => {
  // Given a first plan that succeeds and no recovery position reads.
  const { options, events } = scenario({ quantities: [], failures: [] });
  delete options.signal;

  // When the close round executes without a stop signal or rejection.
  const result = await runCloseLadderWithPositionRecovery(options);

  // Then the original plan and exact execution result are returned without recovery work.
  assert.deepEqual(result, { plan: { spec: { mode: 'CLOSE' }, baseQty: '100' }, done: 3 });
  assert.deepEqual(events, [['build', '100'], ['execute']]);
});

test('user stops reduce-only recovery when the position adapter returns an unread quantity', async () => {
  // Given a confirmed rejection and a position read that returns no authoritative quantity.
  const { options, events } = scenario({ quantities: [null] });

  // When recovery tries to establish its position baseline.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then invalid position evidence is terminal and cannot authorize waiting or cancellation.
  await assert.rejects(completion, (error) => {
    assert.equal(error.name, 'CloseLadderRecoveryError');
    assert.match(error.message, /Invalid confirmed position quantity/);
    assert.match(error.message, /90802022/);
    assert.equal(error.continuousRecoveryKind, undefined);
    return true;
  });
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
  assert.equal(events.filter(([type]) => type === 'replace').length, 0);
  assert.equal(events.filter(([type]) => type === 'wait').length, 0);
});

test('user stops recovery if the position increases after replacement', async () => {
  // Given unchanged position evidence authorizing one replacement followed by a larger position.
  const { options, events } = scenario({ quantities: ['100', '100', '101'] });

  // When the post-replacement position is revalidated.
  const completion = runCloseLadderWithPositionRecovery(options);

  // Then the increased position ends the round with no additional plan or submission.
  await assert.rejects(completion, (error) => {
    assert.match(formatLocalizedText(error.localizedText, 'en'), /Position increased/);
    assert.match(error.message, /90802022/);
    return true;
  });
  assert.equal(events.filter(([type]) => type === 'execute').length, 1);
  assert.equal(events.filter(([type]) => type === 'replace').length, 1);
  assert.deepEqual(events.filter(([type]) => type === 'build'), [['build', '100']]);
});
