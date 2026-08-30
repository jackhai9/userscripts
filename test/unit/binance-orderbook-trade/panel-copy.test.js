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

test('panel copy provides complete Chinese and English values for every UI leaf', () => {
  assert.deepEqual(SUPPORTED_UI_LOCALES, [UI_LOCALE_ZH_CN, UI_LOCALE_EN]);
  const leaves = collectLeaves(PANEL_COPY);
  assert.ok(leaves.length > 0);
  for (const leaf of leaves) {
    assert.notEqual(formatLocalizedText(leaf, UI_LOCALE_ZH_CN), '');
    assert.notEqual(formatLocalizedText(leaf, UI_LOCALE_EN), '');
  }
  assert.equal(formatLocalizedText(PANEL_COPY.action.accountRebalance, UI_LOCALE_ZH_CN), '账户再平衡');
  assert.equal(formatLocalizedText(PANEL_COPY.action.accountRebalance, UI_LOCALE_EN), 'Account Rebalance');
  assert.equal(formatLocalizedText(PANEL_COPY.action.closeShort, UI_LOCALE_ZH_CN), '阶梯平空');
  assert.equal(formatLocalizedText(PANEL_COPY.action.closeShort, UI_LOCALE_EN), 'Close Short');
});

test('Binance pathname selects Chinese only for zh-CN and otherwise falls back to English', () => {
  assert.equal(resolveUiLocaleFromPathname('/zh-CN/futures/BTRUSDT'), UI_LOCALE_ZH_CN);
  assert.equal(resolveUiLocaleFromPathname('/zh-cn/futures/BTRUSDT'), UI_LOCALE_ZH_CN);
  assert.equal(resolveUiLocaleFromPathname('/en/futures/BTRUSDT'), UI_LOCALE_EN);
  assert.equal(resolveUiLocaleFromPathname('/fr/futures/BTRUSDT'), UI_LOCALE_EN);
  assert.equal(resolveUiLocaleFromPathname('/futures/BTRUSDT'), UI_LOCALE_EN);
});

test('localized status values survive locale switches without losing their data', () => {
  const progress = combineLocalizedText([
    localizedText('连续阶梯平空', 'Continuous Close Short'),
    localizedText('2/3 轮', '2/3 rounds'),
    localizedText('累计 6 笔', 'Total 6'),
  ], ' · ');
  assert.equal(
    formatLocalizedText(progress, UI_LOCALE_ZH_CN),
    '连续阶梯平空 · 2/3 轮 · 累计 6 笔',
  );
  assert.equal(
    formatLocalizedText(progress, UI_LOCALE_EN),
    'Continuous Close Short · 2/3 rounds · Total 6',
  );
  assert.equal(formatLocalizedText('TypeError: percent is undefined', UI_LOCALE_EN), 'TypeError: percent is undefined');
});

test('precision refresh tooltip is localized and validates its trade count', () => {
  const tooltip = formatPrecisionRefreshTooltip(10);
  assert.equal(
    formatLocalizedText(tooltip, UI_LOCALE_ZH_CN),
    '优先根据最新 10 条成交价；价格变化不足时自动扩大范围，重新计算推荐精度。',
  );
  assert.equal(
    formatLocalizedText(tooltip, UI_LOCALE_EN),
    'Use the latest 10 trades first; expand the range when price movement is insufficient and recalculate the recommended precision.',
  );
  assert.doesNotMatch(formatLocalizedText(tooltip, UI_LOCALE_ZH_CN), /最小值/);
  assert.throws(() => formatPrecisionRefreshTooltip(1), /价格精度成交样本数无效/);
});
