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

test('user sees cancellation availability and completion in the action button', () => {
  // Given idle, running, completed-empty, and ladder-blocked cancellation states.
  const states = [
    { ladderRunning: false, cancelRunning: false, noOrdersFeedback: false },
    { ladderRunning: false, cancelRunning: true, noOrdersFeedback: false },
    { ladderRunning: false, cancelRunning: false, noOrdersFeedback: true },
    { ladderRunning: true, cancelRunning: false, noOrdersFeedback: true },
  ];

  // When the cancel button derives availability and localized labels.
  const [idle, running, noOrders, blocked] = states.map(resolveCancelSymbolButtonPresentation);

  // Then no-orders feedback leaves the action enabled and active work prevents competition.
  assert.equal(idle.disabled, false);
  assert.equal(formatLocalizedText(idle.label, UI_LOCALE_ZH_CN), '撤单');
  assert.equal(formatLocalizedText(idle.label, UI_LOCALE_EN), 'Cancel');
  assert.equal(running.disabled, true);
  assert.equal(formatLocalizedText(running.label, UI_LOCALE_ZH_CN), '撤单处理中');
  assert.equal(noOrders.disabled, false);
  assert.equal(formatLocalizedText(noOrders.label, UI_LOCALE_EN), 'No Orders');
  assert.equal(blocked.disabled, true);
  assert.equal(formatLocalizedText(blocked.label, UI_LOCALE_ZH_CN), '撤单');
});

test('user recognizes the current-orders tab despite whitespace and localization', () => {
  // Given Chinese and English account-tab labels, including an unrelated history tab.
  const cases = [
    { read: normalizeText, args: [' 当前\n委托 (2) '], expected: '当前 委托 (2)' },
    { read: isOpenOrdersTabText, args: ['当前委托(2)'], expected: true },
    { read: isOpenOrdersTabText, args: ['Open Orders (3)'], expected: true },
    { read: isOpenOrdersTabText, args: ['历史委托'], expected: false },
  ];

  // When the labels are normalized and classified.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only the supported current-orders labels match.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user reads the count from localized current-orders tabs', () => {
  // Given localized tabs with counts and a tab whose count is missing.
  const cases = [
    { read: parseOpenOrdersTabCount, args: ['当前委托(2)'], expected: 2 },
    { read: parseOpenOrdersTabCount, args: ['Open Orders (12)'], expected: 12 },
    { read: parseOpenOrdersTabCount, args: ['当前委托'], expected: null },
  ];

  // When the displayed account-order counts are parsed.
  const results = cases.map(({ read, args }) => read(...args));

  // Then the exact counts are returned and an unread count stays unknown.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user can cancel when a current-symbol order row is visible', () => {
  // Given visible current-symbol rows despite an unchecked filter and stale account count.
  const cases = [
    { read: readVisibleOpenOrderSymbolsText, args: ['HYPEUSDT 永续 价格 数量 BTCUSDT 永续'], expected: ['HYPEUSDT', 'BTCUSDT'] },
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '价格 HYPEUSDT 永续 数量',
      symbol: 'HYPEUSDT',
      symbolFilterOk: false,
      openOrdersCount: 0,
    }], expected: true },
  ];

  // When the order symbols and cancellation evidence are evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then the visible row supplies current-symbol evidence.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user keeps the full contract identity beside a joined timestamp', () => {
  // Given Binance rows joining minute or second timestamps to USDT and USDC contracts.
  const cases = [
    { read: readVisibleOpenOrderSymbolsText, args: ['2026-05-30 10:27HYPEUSDT永续 限价'], expected: ['HYPEUSDT'] },
    { read: readVisibleOpenOrderSymbolsText, args: ['2026-08-23 09:07BTCUSDC永续 限价'], expected: ['BTCUSDC'] },
    { read: readVisibleOpenOrderSymbolsText, args: ['2026-08-25 17:08:51HYPEUSDTPerp Limit'], expected: ['HYPEUSDT'] },
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '2026-05-30 10:27HYPEUSDT永续 限价',
      symbol: 'HYPEUSDT',
      symbolFilterOk: true,
      openOrdersCount: 5,
      cancelAllAvailable: true,
    }], expected: true },
  ];

  // When visible contract symbols and cancellation evidence are read.
  const results = cases.map(({ read, args }) => read(...args));

  // Then timestamps are removed without removing any contract prefix.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

for (const symbol of ['龙虾USDT', '币安人生USDC', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT', '1000000龙虾USDT', 'A_BTCUSDT']) {
  test(`user keeps the complete ${symbol} contract in cancellation evidence`, () => {
    // Given joined and separated timestamp rows in both supported perpetual labels.
    const rows = ['永续', 'Perp'].flatMap((label) => [
      symbol + label,
      '2026-09-12 10:27' + symbol + label + ' Limit',
      '2026-09-12 10:27:51' + symbol + label + ' Limit',
    ]);
    const scopeText = symbol + '永续';

    // When the current-symbol scope and its visible contracts are evaluated.
    const parsed = rows.map(readVisibleOpenOrderSymbolsText);
    const limited = isOpenOrdersScopeLimitedToSymbolText(scopeText, symbol);
    const ready = isCurrentSymbolOpenOrdersFilterReady({ scopeText, symbol, filterChecked: true, cancelAllAvailable: true });
    const clear = isCurrentSymbolOpenOrdersClearCandidate({ scopeText, symbol, openOrdersCount: 1 });

    // Then the full contract authorizes only its own nonempty order scope.
    parsed.forEach((result) => assert.deepEqual(result, [symbol]));
    assert.equal(limited, true);
    assert.equal(ready, true);
    assert.equal(clear, false);
  });
}

test('user cannot treat Unicode or numeric-prefix contracts as a shorter current symbol', () => {
  // Given BTCUSDT rows mixed with distinct Unicode and numeric-prefix contracts.
  const others = ['龙虾USDT', '龙虾BTCUSDT', 'A_BTCUSDT', '27BTCUSDT', '4USDT'];
  const cases = others.map((other) => ({ other, scopeText: 'BTCUSDT 永续 ' + other + ' 永续' }));

  // When symbol parsing and every cancellation-scope gate read those rows.
  const results = cases.map(({ other, scopeText }) => ({
    symbols: readVisibleOpenOrderSymbolsText(scopeText),
    limited: isOpenOrdersScopeLimitedToSymbolText(scopeText, 'BTCUSDT'),
    confirmed: isOpenOrdersScopeConfirmedForSymbolText(scopeText, 'BTCUSDT', true),
    ready: isCurrentSymbolOpenOrdersFilterReady({ scopeText, symbol: 'BTCUSDT', filterChecked: true, cancelAllAvailable: true }),
    clear: isCurrentSymbolOpenOrdersClearCandidate({ scopeText, symbol: 'BTCUSDT', openOrdersCount: 0 }),
    evidence: hasCurrentSymbolOpenOrdersEvidence({ scopeText: other + '永续', symbol: 'BTCUSDT', symbolFilterOk: true, cancelAllAvailable: true }),
  }));
  const suffixMatches = [
    isOpenOrdersScopeLimitedToSymbolText('龙虾USDT永续', '虾USDT'),
    isOpenOrdersScopeLimitedToSymbolText('超级龙虾USDT永续', '龙虾USDT'),
  ];

  // Then every complete contract remains distinct and mixed-symbol cancellation stays blocked.
  results.forEach((result, index) => assert.deepEqual(result, {
    symbols: ['BTCUSDT', others[index]], limited: false, confirmed: false,
    ready: false, clear: false, evidence: false,
  }));
  assert.deepEqual(suffixMatches, [false, false]);
});

test('user cannot mistake a contract mention inside account text for an order row', () => {
  // Given standalone contract lines and an embedded account summary mention.
  const cases = [
    { read: readVisibleOpenOrderSymbolsText, args: ['\n龙虾USDT\nBTCUSDT永续\n4USDT\n'], expected: ['龙虾USDT', 'BTCUSDT', '4USDT'] },
    { read: readVisibleOpenOrderSymbolsText, args: ['Account 龙虾USDT total'], expected: [] },
    { read: isOpenOrdersScopeLimitedToSymbolText, args: ['\n龙虾USDT\nBTCUSDT永续\n', 'BTCUSDT'], expected: false },
    { read: isCurrentSymbolOpenOrdersClearCandidate, args: [{
      scopeText: '\n龙虾USDT\n', symbol: '龙虾USDT', openOrdersCount: 1,
    }], expected: false },
  ];

  // When the panel determines visible order symbols and clear candidates.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only complete contract lines count as order evidence.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user matches an order cell only to its full contract with a supported perpetual label', () => {
  // Given supported contract cells and suffix, mixed-row, malformed, or empty lookalikes.
  const symbols = ['龙虾USDT', '币安人生USDC', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT', 'A_BTCUSDT'];
  const valid = symbols.flatMap((symbol) => [symbol, symbol + '永续', symbol + ' Perp', ' ' + symbol + '\n永续 ']
    .map((text) => ({ text, symbol })));
  const invalid = [
    ['龙虾USDT永续', '虾USDT'], ['超级龙虾USDT永续', '龙虾USDT'],
    ['龙虾BTCUSDT永续', 'BTCUSDT'], ['A_BTCUSDT永续', 'BTCUSDT'],
    ['27BTCUSDT永续', 'BTCUSDT'], ['BTCUSDT 永续 龙虾USDT 永续', 'BTCUSDT'],
    ['BTCUSDT永续限价', 'BTCUSDT'], ['', ''],
  ];

  // When each cell is parsed and compared with the selected symbol.
  const parsed = valid.map(({ text, symbol }) => [parseOpenOrderContractSymbol(text), isOpenOrderRowCurrentSymbol(text, symbol)]);
  const rejected = invalid.map(([text, symbol]) => isOpenOrderRowCurrentSymbol(text, symbol));
  const invalidContracts = ['BTCUSDT?', 'USDT'].map(parseOpenOrderContractSymbol);

  // Then supported cells match completely and every lookalike is refused.
  parsed.forEach((result, index) => assert.deepEqual(result, [valid[index].symbol, true]));
  rejected.forEach((result, index) => assert.equal(result, false, invalid[index].join(' / ')));
  assert.deepEqual(invalidContracts, [null, null]);
});

test('user can scope cancellations to a USDC perpetual contract', () => {
  // Given mixed USDC and USDT rows plus repeated rows for one USDC symbol.
  const cases = [
    { read: readVisibleOpenOrderSymbolsText, args: ['BTCUSDC 永续 价格 数量 HYPEUSDT 永续'], expected: ['BTCUSDC', 'HYPEUSDT'] },
    { read: isOpenOrdersScopeLimitedToSymbolText, args: ['BTCUSDC 永续 BTCUSDC 永续', 'BTCUSDC'], expected: true },
  ];

  // When visible order symbols and scope are resolved.
  const results = cases.map(({ read, args }) => read(...args));

  // Then both quote currencies retain their exact contract identity.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot cancel from an account-wide order count alone', () => {
  // Given a nonzero account count without visible current-symbol rows or an available cancel control.
  const cases = [
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '隐藏其他合约 当前委托',
      symbol: 'HYPEUSDT',
      symbolFilterOk: true,
      openOrdersCount: 2,
    }], expected: false },
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '隐藏其他合约 当前委托',
      symbol: 'HYPEUSDT',
      symbolFilterOk: false,
      openOrdersCount: 2,
    }], expected: false },
  ];

  // When current-symbol cancellation evidence is evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then the account count does not authorize cancellation.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user sees no current-symbol orders only after the filtered empty state settles', () => {
  // Given localized empty states, stale rows, and unresolved filter or cancel-control states.
  const cases = [
    { read: isFilteredCurrentSymbolOpenOrdersEmpty, args: [{
      scopeText: '基础单(1) 隐藏其他合约 全撤 暂无当前委托。',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: true },
    { read: isFilteredCurrentSymbolOpenOrdersEmpty, args: [{
      scopeText: 'Basic(1) Hide Other Symbols Cancel All You have no open orders.',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: true },
    { read: isFilteredCurrentSymbolOpenOrdersEmpty, args: [{
      scopeText: '基础单(1) 隐藏其他合约 全撤 暂无当前委托。',
      symbol: 'HYPEUSDT',
      filterChecked: false,
      cancelAllAvailable: false,
    }], expected: false },
    { read: isFilteredCurrentSymbolOpenOrdersEmpty, args: [{
      scopeText: '基础单(1) 隐藏其他合约 HYPEUSDT 永续 暂无当前委托。',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: false },
    { read: isFilteredCurrentSymbolOpenOrdersEmpty, args: [{
      scopeText: '基础单(1) 隐藏其他合约 全撤 暂无当前委托。',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: true,
    }], expected: false },
    { read: isFilteredCurrentSymbolOpenOrdersEmpty, args: [{
      scopeText: '基础单(1) 隐藏其他合约',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: false },
  ];

  // When the filtered empty-state evidence is evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only a checked filter with explicit empty text and no rows confirms emptiness.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user recognizes only the verified empty-state and cancel labels', () => {
  // Given the supported Chinese and English Binance labels plus similar unsupported text.
  const cases = [
    { read: hasBinanceCurrentSymbolOpenOrdersEmptyText, args: ['暂无当前委托。'], expected: true },
    { read: hasBinanceCurrentSymbolOpenOrdersEmptyText, args: ['You have no open orders.'], expected: true },
    { read: hasBinanceCurrentSymbolOpenOrdersEmptyText, args: ['当前没有订单'], expected: false },
    { read: isBinanceCancelAllText, args: ['全撤'], expected: true },
    { read: isBinanceCancelAllText, args: ['Cancel All'], expected: true },
    { read: isBinanceCancelAllText, args: ['撤本币挂单'], expected: false },
  ];

  // When empty-state and cancel-all labels are classified.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only verified native page text matches.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user waits until the current-symbol filter has replaced stale order rows', () => {
  // Given checked and unchecked filters with stale rows, current rows, or a localized empty state.
  const cases = [
    { read: isCurrentSymbolOpenOrdersFilterReady, args: [{
      scopeText: 'BTCUSDT 永续 隐藏其他合约',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: true,
    }], expected: false },
    { read: isCurrentSymbolOpenOrdersFilterReady, args: [{
      scopeText: '隐藏其他合约',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: false },
    { read: isCurrentSymbolOpenOrdersFilterReady, args: [{
      scopeText: 'HYPEUSDT 永续 隐藏其他合约 全撤',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: true,
    }], expected: true },
    { read: isCurrentSymbolOpenOrdersFilterReady, args: [{
      scopeText: '隐藏其他合约 暂无当前委托。',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: true },
    { read: isCurrentSymbolOpenOrdersFilterReady, args: [{
      scopeText: 'Hide Other Symbols You have no open orders.',
      symbol: 'HYPEUSDT',
      filterChecked: true,
      cancelAllAvailable: false,
    }], expected: true },
    { read: isCurrentSymbolOpenOrdersFilterReady, args: [{
      scopeText: 'HYPEUSDT 永续',
      symbol: 'HYPEUSDT',
      filterChecked: false,
      cancelAllAvailable: true,
    }], expected: false },
  ];

  // When the filtered pane is checked for readiness.
  const results = cases.map(({ read, args }) => read(...args));

  // Then transient and other-symbol rows remain unready.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user needs a confirmed symbol filter before an available cancel control proves orders exist', () => {
  // Given the same enabled cancel control with confirmed and unconfirmed filters.
  const cases = [
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '隐藏其他合约 当前委托 价格 数量',
      symbol: 'HYPEUSDT',
      symbolFilterOk: true,
      openOrdersCount: null,
      cancelAllAvailable: true,
    }], expected: true },
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '隐藏其他合约 当前委托 价格 数量',
      symbol: 'HYPEUSDT',
      symbolFilterOk: false,
      openOrdersCount: null,
      cancelAllAvailable: true,
    }], expected: false },
  ];

  // When current-symbol order evidence is evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only the confirmed filter authorizes the control as evidence.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot cancel another symbol from a zero or unrelated account count', () => {
  // Given empty current-symbol text or rows belonging only to another symbol.
  const cases = [
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: '隐藏其他合约 当前委托',
      symbol: 'HYPEUSDT',
      symbolFilterOk: true,
      openOrdersCount: 0,
    }], expected: false },
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: 'BTCUSDT 永续',
      symbol: 'HYPEUSDT',
      symbolFilterOk: true,
      openOrdersCount: 2,
    }], expected: false },
    { read: hasCurrentSymbolOpenOrdersEvidence, args: [{
      scopeText: 'BTCUSDT 永续',
      symbol: 'HYPEUSDT',
      symbolFilterOk: true,
      openOrdersCount: null,
      cancelAllAvailable: true,
    }], expected: false },
  ];

  // When cancellation evidence is evaluated against the active symbol.
  const results = cases.map(({ read, args }) => read(...args));

  // Then unrelated rows and account counts do not authorize the action.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user limits a cancellation scope to rows of exactly one current symbol', () => {
  // Given matching rows, mixed-symbol rows, and a pane with no readable rows.
  const cases = [
    { read: isOpenOrdersScopeLimitedToSymbolText, args: ['HYPEUSDT 永续 HYPEUSDT 永续', 'HYPEUSDT'], expected: true },
    { read: isOpenOrdersScopeLimitedToSymbolText, args: ['HYPEUSDT 永续 BTCUSDT 永续', 'HYPEUSDT'], expected: false },
    { read: isOpenOrdersScopeLimitedToSymbolText, args: ['隐藏其他合约', 'HYPEUSDT'], expected: false },
  ];

  // When the visible scope is compared with the current symbol.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only a nonempty set of matching symbols confirms the scope.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot trust a checked filter while another symbol remains visible', () => {
  // Given current and stale rows under both checked and unchecked filter states.
  const cases = [
    { read: isOpenOrdersScopeConfirmedForSymbolText, args: ['BTCUSDT 永续', 'HYPEUSDT', true], expected: false },
    { read: isOpenOrdersScopeConfirmedForSymbolText, args: ['HYPEUSDT 永续', 'HYPEUSDT', false], expected: false },
    { read: isOpenOrdersScopeConfirmedForSymbolText, args: ['HYPEUSDT 永续', 'HYPEUSDT', true], expected: true },
    { read: isOpenOrdersScopeConfirmedForSymbolText, args: ['隐藏其他合约', 'HYPEUSDT', true], expected: true },
    { read: isOpenOrdersScopeConfirmedForSymbolText, args: ['隐藏其他合约', 'HYPEUSDT', false], expected: false },
  ];

  // When the active symbol scope is confirmed.
  const results = cases.map(({ read, args }) => read(...args));

  // Then stale other-symbol rows prevent confirmation even with a checked filter.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user can observe cancellation progress after the account count reaches zero', () => {
  // Given the same stale current-symbol row with account counts of zero and one.
  const cases = [
    { read: isCurrentSymbolOpenOrdersClearCandidate, args: [{
      scopeText: 'HYPEUSDT 永续 全撤',
      symbol: 'HYPEUSDT',
      openOrdersCount: 0,
    }], expected: true },
    { read: isCurrentSymbolOpenOrdersClearCandidate, args: [{
      scopeText: 'HYPEUSDT 永续 全撤',
      symbol: 'HYPEUSDT',
      openOrdersCount: 1,
    }], expected: false },
  ];

  // When the cleared-order candidate is evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then the authoritative zero count permits clearing despite the stale row.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user distinguishes definitive account zero from a filtered empty candidate', () => {
  // Given account zero with stale current rows, a nonzero count, and another-symbol rows.
  const cases = [
    { read: isCurrentSymbolOpenOrdersDefinitivelyClear, args: [{
      scopeText: 'HYPEUSDT 永续 全撤',
      symbol: 'HYPEUSDT',
      openOrdersCount: 0,
    }], expected: true },
    { read: isCurrentSymbolOpenOrdersDefinitivelyClear, args: [{
      scopeText: '隐藏其他合约 当前委托',
      symbol: 'HYPEUSDT',
      openOrdersCount: 3,
    }], expected: false },
    { read: isCurrentSymbolOpenOrdersDefinitivelyClear, args: [{
      scopeText: 'BTCUSDT 永续',
      symbol: 'HYPEUSDT',
      openOrdersCount: 0,
    }], expected: false },
  ];

  // When definitive current-symbol clearing is evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only account zero in a valid scope is definitive.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user can finish current-symbol cancellation while other account orders remain', () => {
  // Given an empty current-symbol pane and an invalid pane showing another symbol.
  const cases = [
    { read: isCurrentSymbolOpenOrdersClearCandidate, args: [{
      scopeText: '隐藏其他合约 当前委托',
      symbol: 'HYPEUSDT',
      openOrdersCount: 3,
    }], expected: true },
    { read: isCurrentSymbolOpenOrdersClearCandidate, args: [{
      scopeText: 'BTCUSDT 永续',
      symbol: 'HYPEUSDT',
      openOrdersCount: 0,
    }], expected: false },
  ];

  // When current-symbol clear candidates are evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then other account orders are allowed only while the filtered scope is valid.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user waits for a fresh stability window after an order reappears', () => {
  // Given a 1200 ms settle window and no earlier clear candidate.
  const settleMs = 1_200;
  let state;

  // When the first clear observation occurs at 1000 ms.
  state = updateOpenOrdersClearStability({ clearCandidate: true, clearCandidateSince: null, nowMs: 1_000, settleMs });

  // Then the observation starts a new window without claiming success.
  assert.deepEqual(state, { clearCandidateSince: 1_000, cleared: false });

  // When the same candidate remains one millisecond short of the window.
  state = updateOpenOrdersClearStability({ clearCandidate: true, clearCandidateSince: state.clearCandidateSince, nowMs: 2_199, settleMs });

  // Then clearing remains pending.
  assert.deepEqual(state, { clearCandidateSince: 1_000, cleared: false });

  // When an order reappears at the original deadline.
  state = updateOpenOrdersClearStability({ clearCandidate: false, clearCandidateSince: state.clearCandidateSince, nowMs: 2_200, settleMs });

  // Then the old candidate and its elapsed time are discarded.
  assert.deepEqual(state, { clearCandidateSince: null, cleared: false });

  // When a new candidate survives its own full window from 2300 to 3500 ms.
  state = updateOpenOrdersClearStability({ clearCandidate: true, clearCandidateSince: state.clearCandidateSince, nowMs: 2_300, settleMs });
  state = updateOpenOrdersClearStability({ clearCandidate: true, clearCandidateSince: state.clearCandidateSince, nowMs: 3_500, settleMs });

  // Then clearing completes using the new candidate's start time.
  assert.deepEqual(state, { clearCandidateSince: 2_300, cleared: true });
});

test('user can finish a stable clear observation after the main thread stalls', () => {
  // Given a resumed clock beyond the deadline with and without a clear candidate.
  const cases = [
    { read: shouldContinueOpenOrdersClearObservation, args: [{
      nowMs: 8_500,
      deadlineMs: 6_500,
      clearCandidate: true,
    }], expected: true },
    { read: shouldContinueOpenOrdersClearObservation, args: [{
      nowMs: 8_500,
      deadlineMs: 6_500,
      clearCandidate: false,
    }], expected: false },
  ];

  // When the observation decides whether it still needs to settle.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only an existing clear candidate may continue beyond the deadline.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});


test('user cannot authorize cancellation before the current symbol is known', () => {
  // Given an unavailable symbol while a filtered pane appears empty or contains orders.
  const missingSymbols = [null, ''];

  // When all symbol-dependent cancellation evidence is evaluated.
  const results = missingSymbols.map((symbol) => ({
    scope: isOpenOrdersScopeLimitedToSymbolText('BTCUSDT 永续', symbol),
    empty: isFilteredCurrentSymbolOpenOrdersEmpty({ scopeText: '暂无当前委托。', symbol, filterChecked: true, cancelAllAvailable: false }),
    orders: hasCurrentSymbolOpenOrdersEvidence({ scopeText: 'BTCUSDT 永续', symbol, symbolFilterOk: true, cancelAllAvailable: true }),
    row: isOpenOrderRowCurrentSymbol('BTCUSDT 永续', symbol),
  }));
  const unreadText = [normalizeText(null), readVisibleOpenOrderSymbolsText(null)];

  // Then no scope or order is authorized and absent text remains empty evidence.
  results.forEach((result) => assert.deepEqual(result, { scope: false, empty: false, orders: false, row: false }));
  assert.deepEqual(unreadText, ['', []]);
});

test('user keeps observing before the deadline even without a clear candidate', () => {
  // Given the final millisecond before a 6500 ms observation deadline.
  const observation = { nowMs: 6_499, deadlineMs: 6_500, clearCandidate: false };

  // When observation permission is checked before and exactly at the deadline.
  const before = shouldContinueOpenOrdersClearObservation(observation);
  const atDeadline = shouldContinueOpenOrdersClearObservation({ ...observation, nowMs: 6_500 });

  // Then a missing candidate times out exactly at the deadline.
  assert.equal(before, true);
  assert.equal(atDeadline, false);
});
