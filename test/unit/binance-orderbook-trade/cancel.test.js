import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCurrentSymbolOpenOrdersEvidence,
  isCurrentSymbolOpenOrdersClearCandidate,
  isCurrentSymbolOpenOrdersDefinitivelyClear,
  isOpenOrdersScopeConfirmedForSymbolText,
  isOpenOrdersScopeLimitedToSymbolText,
  isOpenOrdersTabText,
  normalizeText,
  parseOpenOrdersTabCount,
  readVisibleOpenOrderSymbolsText,
  shouldContinueOpenOrdersClearObservation,
  updateOpenOrdersClearStability,
} from '../../../src/binance-orderbook-trade/core/cancel-orders.js';

test('normalizes text and recognizes open-orders tab labels', () => {
  assert.equal(normalizeText(' 当前\n委托 (2) '), '当前 委托 (2)');
  assert.equal(isOpenOrdersTabText('当前委托(2)'), true);
  assert.equal(isOpenOrdersTabText('Open Orders (3)'), true);
  assert.equal(isOpenOrdersTabText('历史委托'), false);
});

test('parses open-orders count from localized tab text', () => {
  assert.equal(parseOpenOrdersTabCount('当前委托(2)'), 2);
  assert.equal(parseOpenOrdersTabCount('Open Orders (12)'), 12);
  assert.equal(parseOpenOrdersTabCount('当前委托'), null);
});

test('visible current-symbol rows are direct open-order evidence', () => {
  assert.deepEqual(readVisibleOpenOrderSymbolsText('HYPEUSDT 永续 价格 数量 BTCUSDT 永续'), ['HYPEUSDT', 'BTCUSDT']);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '价格 HYPEUSDT 永续 数量',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: 0,
  }), true);
});

test('parses symbol when Binance joins time text and contract text', () => {
  assert.deepEqual(readVisibleOpenOrderSymbolsText('2026-05-30 10:27HYPEUSDT永续 限价'), ['HYPEUSDT']);
  assert.deepEqual(readVisibleOpenOrderSymbolsText('2026-08-23 09:07BTCUSDC永续 限价'), ['BTCUSDC']);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '2026-05-30 10:27HYPEUSDT永续 限价',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 5,
    cancelAllAvailable: true,
  }), true);
});

test('visible open-order symbols include USDC perpetual contracts', () => {
  assert.deepEqual(
    readVisibleOpenOrderSymbolsText('BTCUSDC 永续 价格 数量 HYPEUSDT 永续'),
    ['BTCUSDC', 'HYPEUSDT'],
  );
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('BTCUSDC 永续 BTCUSDC 永续', 'BTCUSDC'), true);
});

test('open-orders tab count is evidence only after symbol filter is confirmed', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 2,
  }), true);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: 2,
  }), false);
});

test('enabled cancel-all is evidence after current-symbol filter is confirmed', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托 价格 数量',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: null,
    cancelAllAvailable: true,
  }), true);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托 价格 数量',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: null,
    cancelAllAvailable: true,
  }), false);
});

test('zero tab count or other visible symbols do not authorize current-symbol cancel', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 0,
  }), false);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: 'BTCUSDT 永续',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 2,
  }), false);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: 'BTCUSDT 永续',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: null,
    cancelAllAvailable: true,
  }), false);
});

test('scope is limited only when all visible symbols match current symbol', () => {
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('HYPEUSDT 永续 HYPEUSDT 永续', 'HYPEUSDT'), true);
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('HYPEUSDT 永续 BTCUSDT 永续', 'HYPEUSDT'), false);
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('隐藏其他合约', 'HYPEUSDT'), false);
});

test('checked current-symbol filter rejects transient rows from another symbol', () => {
  assert.equal(isOpenOrdersScopeConfirmedForSymbolText('BTCUSDT 永续', 'HYPEUSDT', true), false);
  assert.equal(isOpenOrdersScopeConfirmedForSymbolText('HYPEUSDT 永续', 'HYPEUSDT', false), false);
  assert.equal(isOpenOrdersScopeConfirmedForSymbolText('HYPEUSDT 永续', 'HYPEUSDT', true), true);
  assert.equal(isOpenOrdersScopeConfirmedForSymbolText('隐藏其他合约', 'HYPEUSDT', true), true);
  assert.equal(isOpenOrdersScopeConfirmedForSymbolText('隐藏其他合约', 'HYPEUSDT', false), false);
});

test('clear candidate accepts account zero despite stale current rows', () => {
  assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
    scopeText: 'HYPEUSDT 永续 全撤',
    symbol: 'HYPEUSDT',
    openOrdersCount: 0,
  }), true);
  assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
    scopeText: 'HYPEUSDT 永续 全撤',
    symbol: 'HYPEUSDT',
    openOrdersCount: 1,
  }), false);
});

test('account zero is definitive while filtered empty state still settles', () => {
  assert.equal(isCurrentSymbolOpenOrdersDefinitivelyClear({
    scopeText: 'HYPEUSDT 永续 全撤',
    symbol: 'HYPEUSDT',
    openOrdersCount: 0,
  }), true);
  assert.equal(isCurrentSymbolOpenOrdersDefinitivelyClear({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    openOrdersCount: 3,
  }), false);
  assert.equal(isCurrentSymbolOpenOrdersDefinitivelyClear({
    scopeText: 'BTCUSDT 永续',
    symbol: 'HYPEUSDT',
    openOrdersCount: 0,
  }), false);
});

test('clear candidate isolates current symbol when other account orders remain', () => {
  assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    openOrdersCount: 3,
  }), true);
  assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
    scopeText: 'BTCUSDT 永续',
    symbol: 'HYPEUSDT',
    openOrdersCount: 0,
  }), false);
});

test('clear candidate must remain stable and resets when orders reappear', () => {
  let state = updateOpenOrdersClearStability({
    clearCandidate: true,
    clearCandidateSince: null,
    nowMs: 1_000,
    settleMs: 1_200,
  });
  assert.deepEqual(state, { clearCandidateSince: 1_000, cleared: false });

  state = updateOpenOrdersClearStability({
    clearCandidate: true,
    clearCandidateSince: state.clearCandidateSince,
    nowMs: 2_199,
    settleMs: 1_200,
  });
  assert.deepEqual(state, { clearCandidateSince: 1_000, cleared: false });

  state = updateOpenOrdersClearStability({
    clearCandidate: false,
    clearCandidateSince: state.clearCandidateSince,
    nowMs: 2_200,
    settleMs: 1_200,
  });
  assert.deepEqual(state, { clearCandidateSince: null, cleared: false });

  state = updateOpenOrdersClearStability({
    clearCandidate: true,
    clearCandidateSince: state.clearCandidateSince,
    nowMs: 2_300,
    settleMs: 1_200,
  });
  state = updateOpenOrdersClearStability({
    clearCandidate: true,
    clearCandidateSince: state.clearCandidateSince,
    nowMs: 3_500,
    settleMs: 1_200,
  });
  assert.deepEqual(state, { clearCandidateSince: 2_300, cleared: true });
});

test('post-stall clear candidate completes validation after wall-clock deadline', () => {
  assert.equal(shouldContinueOpenOrdersClearObservation({
    nowMs: 8_500,
    deadlineMs: 6_500,
    clearCandidate: true,
  }), true);
  assert.equal(shouldContinueOpenOrdersClearObservation({
    nowMs: 8_500,
    deadlineMs: 6_500,
    clearCandidate: false,
  }), false);
});
