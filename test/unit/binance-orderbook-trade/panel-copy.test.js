import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHART_CONTRACT_ALERT,
  PANEL_COPY,
  formatChartContractAlertTooltip,
  formatPrecisionRefreshTooltip,
  formatUsdtRebalanceAllocatedStatus,
  formatUsdtRebalanceTargetSummary,
  formatUsdtRebalanceTooltip,
} from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';
import {
  SUPPORTED_UI_LOCALES,
  UI_LOCALE_EN,
  UI_LOCALE_ZH_CN,
  combineLocalizedText,
  formatLocalizedText,
  isLocalizedText,
  localizedText,
  resolveUiLocaleFromPathname,
} from '../../../src/shared/ui-locale.js';

for (const { percents, ratio, copy } of [
  {
    percents: { FUNDING: 50, MAIN: 40, UMFUTURE: 10 },
    ratio: '5:4:1',
    copy: {
      tooltip: ['将资金、现货和 U 本位账户的 USDT 按 5:4:1 分配', 'Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a 5:4:1 ratio'],
      targetSummary: ['目标分配：资金 50% / 现货 40% / U本位 10%', 'Target allocation: Funding 50% / Spot 40% / USDⓈ-M Futures 10%'],
      allocated: ['USDT 已按 5:4:1 分配', 'USDT is already allocated at 5:4:1'],
    },
  },
  {
    percents: { FUNDING: 70, MAIN: 20, UMFUTURE: 10 },
    ratio: '7:2:1',
    copy: {
      tooltip: ['将资金、现货和 U 本位账户的 USDT 按 7:2:1 分配', 'Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a 7:2:1 ratio'],
      targetSummary: ['目标分配：资金 70% / 现货 20% / U本位 10%', 'Target allocation: Funding 70% / Spot 20% / USDⓈ-M Futures 10%'],
      allocated: ['USDT 已按 7:2:1 分配', 'USDT is already allocated at 7:2:1'],
    },
  },
]) {
  test(`user sees account rebalance copy for the ${ratio} allocation in both languages`, () => {
    // Given a validated allocation and its reduced ratio label
    const allocation = percents;

    // When the rebalance tooltip, dialog summary, and balanced status are built
    const built = {
      tooltip: formatUsdtRebalanceTooltip(ratio),
      targetSummary: formatUsdtRebalanceTargetSummary(allocation),
      allocated: formatUsdtRebalanceAllocatedStatus(ratio),
    };

    // Then each text names the same allocation in Chinese and English
    for (const [key, [chinese, english]] of Object.entries(copy)) {
      assert.equal(formatLocalizedText(built[key], UI_LOCALE_ZH_CN), chinese, key);
      assert.equal(formatLocalizedText(built[key], UI_LOCALE_EN), english, key);
    }
  });
}

function collectLeaves(value) {
  if (isLocalizedText(value)) return [value];
  return Object.values(value).flatMap(collectLeaves);
}

test("user sees that panel copy provides complete Chinese and English values for every UI leaf", () => {
  // Given every user-facing panel message and the two supported locales
  const copy = PANEL_COPY;
  const locales = [UI_LOCALE_ZH_CN, UI_LOCALE_EN];

  // When all message leaves are formatted in both languages
  const leaves = collectLeaves(copy);
  const rendered = leaves.map((leaf) => locales.map((locale) => formatLocalizedText(leaf, locale)));

  // Then every leaf has both translations and the trading actions use their exact copy
  assert.deepEqual(SUPPORTED_UI_LOCALES, [UI_LOCALE_ZH_CN, UI_LOCALE_EN]);
  assert.ok(leaves.length > 0);
  for (const [chinese, english] of rendered) {
    assert.notEqual(chinese, '');
    assert.notEqual(english, '');
  }
  assert.equal(formatLocalizedText(PANEL_COPY.action.accountRebalance, UI_LOCALE_ZH_CN), '账户再平衡');
  assert.equal(formatLocalizedText(PANEL_COPY.action.accountRebalance, UI_LOCALE_EN), 'Account Rebalance');
  assert.equal(formatLocalizedText(PANEL_COPY.rebalanceDialog.confirm, UI_LOCALE_ZH_CN), '确认再平衡');
  assert.equal(formatLocalizedText(PANEL_COPY.rebalanceDialog.confirm, UI_LOCALE_EN), 'Confirm Rebalance');
  assert.equal(formatLocalizedText(PANEL_COPY.action.cancel, UI_LOCALE_EN), 'Cancel');
  assert.equal(formatLocalizedText(PANEL_COPY.action.closeShort, UI_LOCALE_ZH_CN), '阶梯平空');
  assert.equal(formatLocalizedText(PANEL_COPY.action.closeShort, UI_LOCALE_EN), 'Close Short');
});

test("user sees that Binance pathname selects Chinese only for zh-CN and otherwise falls back to English", () => {
  // Given the current locale and localized message data are available
  const scenarioInputs = ['/zh-CN/futures/BTRUSDT'];

  // When the panel text is resolved for display
  const observed = resolveUiLocaleFromPathname(...scenarioInputs);

  // Then sees that Binance pathname selects Chinese only for zh-CN and otherwise falls back to English
  assert.equal(observed, UI_LOCALE_ZH_CN);
  assert.equal(resolveUiLocaleFromPathname('/zh-cn/futures/BTRUSDT'), UI_LOCALE_ZH_CN);
  assert.equal(resolveUiLocaleFromPathname('/en/futures/BTRUSDT'), UI_LOCALE_EN);
  assert.equal(resolveUiLocaleFromPathname('/fr/futures/BTRUSDT'), UI_LOCALE_EN);
  assert.equal(resolveUiLocaleFromPathname('/futures/BTRUSDT'), UI_LOCALE_EN);
});

test("user sees that localized status values survive locale switches without losing their data", () => {
  // Given the current locale and localized message data are available
  const progress = combineLocalizedText([
    localizedText('连续阶梯平空', 'Continuous Close Short'),
    localizedText('2/3 轮', '2/3 rounds'),
    localizedText('累计 6 笔', 'Total 6'),
  ], ' · ');
  // When the panel text is resolved for display
  const observed = formatLocalizedText(progress, UI_LOCALE_ZH_CN);

  // Then sees that localized status values survive locale switches without losing their data
  assert.equal(
    observed,
    '连续阶梯平空 · 2/3 轮 · 累计 6 笔',
  );
  assert.equal(
    formatLocalizedText(progress, UI_LOCALE_EN),
    'Continuous Close Short · 2/3 rounds · Total 6',
  );
  assert.equal(formatLocalizedText('TypeError: percent is undefined', UI_LOCALE_EN), 'TypeError: percent is undefined');
});

test("user sees that precision refresh tooltip is localized and validates its trade count", () => {
  // Given the current locale and localized message data are available
  const tooltip = formatPrecisionRefreshTooltip(10);
  // When the panel text is resolved for display
  const observed = formatLocalizedText(tooltip, UI_LOCALE_ZH_CN);

  // Then sees that precision refresh tooltip is localized and validates its trade count
  assert.equal(
    observed,
    '优先根据最新 10 条成交价；价格变化不足时自动扩大范围，重新计算推荐精度。',
  );
  assert.equal(
    formatLocalizedText(tooltip, UI_LOCALE_EN),
    'Use the latest 10 trades first; expand the range when price movement is insufficient and recalculate the recommended precision.',
  );
  assert.doesNotMatch(formatLocalizedText(tooltip, UI_LOCALE_ZH_CN), /最小值/);
  assert.throws(() => formatPrecisionRefreshTooltip(1), /价格精度成交样本数无效/);
});

test('user reads which chart dependencies changed and what the native fallback means in both locales', () => {
  // Given two reported dependency breaks of the order-line save filter.
  const entries = [
    { reason: 'listener-shape', detail: 'study: a | drawing: b' },
    { reason: 'removal-capture', detail: '3 order-line removals were emitted outside removeSource' },
  ];

  // When the panel formats its alert.
  const tooltip = formatChartContractAlertTooltip(entries);

  // Then the short alert and the tooltip name every changed dependency, the consequence and the raw details.
  assert.deepEqual(CHART_CONTRACT_ALERT, { zhCN: '⚠ 图表保存保护失效，需更新脚本', en: '⚠ Chart save protection broken; update the script' });
  assert.equal(tooltip.zhCN, '币安图表依赖已变化：保存监听函数结构、挂单线移除路径。已回退币安原生保存，挂单线每次变化都会保存整张图，连续挂单可能再次造成 IndexedDB 积压。细节：study: a | drawing: b; 3 order-line removals were emitted outside removeSource');
  assert.equal(tooltip.en, "Binance chart dependency changed: save listener body, order-line removal path. Binance's native save is back in effect; every order-line change saves the whole chart, so continuous orders may stall IndexedDB again. Details: study: a | drawing: b; 3 order-line removals were emitted outside removeSource");
});

test('user never sees an alert for an unknown or empty chart dependency report', () => {
  // Given reports that the filter can never produce.
  const unknown = [{ reason: 'renamed', detail: 'x' }];
  const empty = [];

  // When they are formatted.
  const formatUnknown = () => formatChartContractAlertTooltip(unknown);
  const formatEmpty = () => formatChartContractAlertTooltip(empty);

  // Then the programming error is thrown instead of displayed.
  assert.throws(formatUnknown, /Unknown chart contract break: renamed/);
  assert.throws(formatEmpty, /at least one break/);
});
