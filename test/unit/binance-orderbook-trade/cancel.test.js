import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCurrentSymbolOpenOrdersEvidence,
  isFilteredCurrentSymbolOpenOrdersEmpty,
  isCurrentSymbolOpenOrdersFilterReady,
  isCurrentSymbolOpenOrdersClearCandidate,
  isCurrentSymbolOpenOrdersDefinitivelyClear,
  isOpenOrderRowCurrentSymbol,
  isOpenOrdersScopeConfirmedForSymbolText,
  isOpenOrdersScopeLimitedToSymbolText,
  isOpenOrdersTabText,
  normalizeText,
  parseOpenOrdersTabCount,
  parseOpenOrderContractSymbol,
  readVisibleOpenOrderSymbolsText,
  resolveCancelSymbolButtonPresentation,
  shouldContinueOpenOrdersClearObservation,
  updateOpenOrdersClearStability,
} from '../../../src/binance-orderbook-trade/core/cancel-orders.js';
import {
  hasBinanceCurrentSymbolOpenOrdersEmptyText,
  isBinanceCancelAllText,
} from '../../../src/binance-orderbook-trade/contracts/binance-page-text.js';
import {
  formatLocalizedText,
  UI_LOCALE_EN,
  UI_LOCALE_ZH_CN,
} from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';

test('cancel button exposes no-order completion feedback without disabling new actions', () => {
  const idle = resolveCancelSymbolButtonPresentation({
    ladderRunning: false,
    cancelRunning: false,
    noOrdersFeedback: false,
  });
  assert.equal(idle.disabled, false);
  assert.equal(formatLocalizedText(idle.label, UI_LOCALE_ZH_CN), '撤单');
  assert.equal(formatLocalizedText(idle.label, UI_LOCALE_EN), 'Cancel');
  const running = resolveCancelSymbolButtonPresentation({
    ladderRunning: false,
    cancelRunning: true,
    noOrdersFeedback: false,
  });
  assert.equal(running.disabled, true);
  assert.equal(formatLocalizedText(running.label, UI_LOCALE_ZH_CN), '撤单处理中');
  const noOrders = resolveCancelSymbolButtonPresentation({
    ladderRunning: false,
    cancelRunning: false,
    noOrdersFeedback: true,
  });
  assert.equal(noOrders.disabled, false);
  assert.equal(formatLocalizedText(noOrders.label, UI_LOCALE_EN), 'No Orders');
  const blocked = resolveCancelSymbolButtonPresentation({
    ladderRunning: true,
    cancelRunning: false,
    noOrdersFeedback: true,
  });
  assert.equal(blocked.disabled, true);
  assert.equal(formatLocalizedText(blocked.label, UI_LOCALE_ZH_CN), '撤单');
});

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
  assert.deepEqual(readVisibleOpenOrderSymbolsText('2026-08-25 17:08:51HYPEUSDTPerp Limit'), ['HYPEUSDT']);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '2026-05-30 10:27HYPEUSDT永续 限价',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 5,
    cancelAllAvailable: true,
  }), true);
});

for (const symbol of ['龙虾USDT', '币安人生USDC', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT', '1000000龙虾USDT', 'A_BTCUSDT']) {
  test(`keeps the complete ${symbol} contract in order evidence`, () => {
    for (const label of ['永续', 'Perp']) {
      assert.deepEqual(readVisibleOpenOrderSymbolsText(`${symbol}${label}`), [symbol]);
      assert.deepEqual(readVisibleOpenOrderSymbolsText(`2026-09-12 10:27${symbol}${label} Limit`), [symbol]);
      assert.deepEqual(readVisibleOpenOrderSymbolsText(`2026-09-12 10:27:51${symbol}${label} Limit`), [symbol]);
    }
    assert.equal(isOpenOrdersScopeLimitedToSymbolText(`${symbol}永续`, symbol), true);
    assert.equal(isCurrentSymbolOpenOrdersFilterReady({
      scopeText: `${symbol}永续`, symbol, filterChecked: true, cancelAllAvailable: true,
    }), true);
    assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
      scopeText: `${symbol}永续`, symbol, openOrdersCount: 1,
    }), false);
  });
}

test('other Unicode and numeric-prefix contracts cannot become current-symbol evidence', () => {
  for (const other of ['龙虾USDT', '龙虾BTCUSDT', 'A_BTCUSDT', '27BTCUSDT', '4USDT']) {
    const scopeText = `BTCUSDT 永续 ${other} 永续`;
    assert.deepEqual(readVisibleOpenOrderSymbolsText(scopeText), ['BTCUSDT', other]);
    assert.equal(isOpenOrdersScopeLimitedToSymbolText(scopeText, 'BTCUSDT'), false);
    assert.equal(isOpenOrdersScopeConfirmedForSymbolText(scopeText, 'BTCUSDT', true), false);
    assert.equal(isCurrentSymbolOpenOrdersFilterReady({
      scopeText, symbol: 'BTCUSDT', filterChecked: true, cancelAllAvailable: true,
    }), false);
    assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
      scopeText, symbol: 'BTCUSDT', openOrdersCount: 0,
    }), false);
    assert.equal(hasCurrentSymbolOpenOrdersEvidence({
      scopeText: `${other}永续`, symbol: 'BTCUSDT', symbolFilterOk: true, cancelAllAvailable: true,
    }), false);
  }
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('龙虾USDT永续', '虾USDT'), false);
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('超级龙虾USDT永续', '龙虾USDT'), false);
});

test('bare contracts are evidence only on their own complete lines', () => {
  assert.deepEqual(readVisibleOpenOrderSymbolsText('\n龙虾USDT\nBTCUSDT永续\n4USDT\n'), ['龙虾USDT', 'BTCUSDT', '4USDT']);
  assert.deepEqual(readVisibleOpenOrderSymbolsText('Account 龙虾USDT total'), []);
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('\n龙虾USDT\nBTCUSDT永续\n', 'BTCUSDT'), false);
  assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
    scopeText: '\n龙虾USDT\n', symbol: '龙虾USDT', openOrdersCount: 1,
  }), false);
});

test('order symbol cells match the complete contract and only supported labels', () => {
  for (const symbol of ['龙虾USDT', '币安人生USDC', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT', 'A_BTCUSDT']) {
    for (const text of [symbol, `${symbol}永续`, `${symbol} Perp`, ` ${symbol}\n永续 `]) {
      assert.equal(parseOpenOrderContractSymbol(text), symbol);
      assert.equal(isOpenOrderRowCurrentSymbol(text, symbol), true);
    }
  }
  for (const [text, symbol] of [
    ['龙虾USDT永续', '虾USDT'], ['超级龙虾USDT永续', '龙虾USDT'],
    ['龙虾BTCUSDT永续', 'BTCUSDT'], ['A_BTCUSDT永续', 'BTCUSDT'],
    ['27BTCUSDT永续', 'BTCUSDT'], ['BTCUSDT 永续 龙虾USDT 永续', 'BTCUSDT'],
    ['BTCUSDT永续限价', 'BTCUSDT'], ['', ''],
  ]) {
    assert.equal(isOpenOrderRowCurrentSymbol(text, symbol), false, `${text} / ${symbol}`);
  }
  assert.equal(parseOpenOrderContractSymbol('BTCUSDT?'), null);
  assert.equal(parseOpenOrderContractSymbol('USDT'), null);
});

test('visible open-order symbols include USDC perpetual contracts', () => {
  assert.deepEqual(
    readVisibleOpenOrderSymbolsText('BTCUSDC 永续 价格 数量 HYPEUSDT 永续'),
    ['BTCUSDC', 'HYPEUSDT'],
  );
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('BTCUSDC 永续 BTCUSDC 永续', 'BTCUSDC'), true);
});

test('account open-order count never proves that the current symbol has orders', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 2,
  }), false);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: 2,
  }), false);
});

test('confirmed filtered empty state proves only the current symbol has no orders', () => {
  assert.equal(isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText: '基础单(1) 隐藏其他合约 全撤 暂无当前委托。',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), true);
  assert.equal(isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText: 'Basic(1) Hide Other Symbols Cancel All You have no open orders.',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), true);
  assert.equal(isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText: '基础单(1) 隐藏其他合约 全撤 暂无当前委托。',
    symbol: 'HYPEUSDT',
    filterChecked: false,
    cancelAllAvailable: false,
  }), false);
  assert.equal(isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText: '基础单(1) 隐藏其他合约 HYPEUSDT 永续 暂无当前委托。',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), false);
  assert.equal(isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText: '基础单(1) 隐藏其他合约 全撤 暂无当前委托。',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: true,
  }), false);
  assert.equal(isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText: '基础单(1) 隐藏其他合约',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), false);
});

test('centralizes verified Binance account-order page texts', () => {
  assert.equal(hasBinanceCurrentSymbolOpenOrdersEmptyText('暂无当前委托。'), true);
  assert.equal(hasBinanceCurrentSymbolOpenOrdersEmptyText('You have no open orders.'), true);
  assert.equal(hasBinanceCurrentSymbolOpenOrdersEmptyText('当前没有订单'), false);
  assert.equal(isBinanceCancelAllText('全撤'), true);
  assert.equal(isBinanceCancelAllText('Cancel All'), true);
  assert.equal(isBinanceCancelAllText('撤本币挂单'), false);
});

test('current-symbol filter readiness rejects stale and transient React states', () => {
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({
    scopeText: 'BTCUSDT 永续 隐藏其他合约',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: true,
  }), false);
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({
    scopeText: '隐藏其他合约',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), false);
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({
    scopeText: 'HYPEUSDT 永续 隐藏其他合约 全撤',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: true,
  }), true);
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({
    scopeText: '隐藏其他合约 暂无当前委托。',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), true);
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({
    scopeText: 'Hide Other Symbols You have no open orders.',
    symbol: 'HYPEUSDT',
    filterChecked: true,
    cancelAllAvailable: false,
  }), true);
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({
    scopeText: 'HYPEUSDT 永续',
    symbol: 'HYPEUSDT',
    filterChecked: false,
    cancelAllAvailable: true,
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
