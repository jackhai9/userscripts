import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PANEL_COPY,
  SUPPORTED_UI_LOCALES,
  UI_LOCALE_EN,
  UI_LOCALE_ZH_CN,
  combineLocalizedText,
  formatLocalizedText,
  formatPrecisionRefreshTooltip,
  isLocalizedText,
  localizedText,
  resolveUiLocaleFromPathname,
} from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';

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
