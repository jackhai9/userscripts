import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTradingSignals, formatFundingPercent, formatMetricValue,
  parseCurrentFunding, parseFundingInterval, parseHistory,
} from '../../src/binance-trading-data/market-data.js';

// Public Binance/CMC samples captured at 2026-10-09T07:16:15Z, documented in userscript-validation.md.
const funding = [
  { symbol: 'STRKUSDT', fundingTime: 1791504000000, fundingRate: '-0.00000644' },
  { symbol: 'STRKUSDT', fundingTime: 1791518400000, fundingRate: '0.00000029' },
];

test('user sees the latest settled funding separately from the current period', () => {
  // Given the public STRK history and current premium-index response
  const history = parseHistory('fundingRate', funding, 'STRKUSDT');
  const current = { symbol: 'STRKUSDT', lastFundingRate: '0.00005000', nextFundingTime: 1791532800000, time: 1791530175000 };

  // When both contracts are parsed and formatted independently
  const result = parseCurrentFunding(current, 'STRKUSDT');
  const model = computeTradingSignals({ fundingRate: history }, new Set(), 'zh-CN', 'STRKUSDT');

  // Then the current value is different and never appended to settled history
  assert.equal(formatFundingPercent(result.value), '0.005%');
  assert.equal(model.indicators[6].display, '0.000029%');
  assert.equal(model.indicators[6].history.length, 2);
  assert.equal(result.nextFundingTime - result.time, 2_625_000);
});

test('user sees the reported four-hour interval without an invented default', () => {
  // Given the current symbol has explicit interval metadata
  const data = [{ symbol: 'STRKUSDT', fundingIntervalHours: 4 }];

  // When matching and absent symbols are resolved
  const current = parseFundingInterval(data, 'STRKUSDT');
  const absent = parseFundingInterval(data, 'BTCUSDT');

  // Then only the matching contract supplies a settlement interval
  assert.equal(current, 4);
  assert.equal(absent, null);
  assert.throws(() => parseFundingInterval([...data, ...data], 'STRKUSDT'), /ambiguous/);
});

test('user gets the correct open-interest ratio for a thousand-token contract', () => {
  // Given Binance has already scaled the CMC supply into 1000PEPE units
  const data = [{ symbol: '1000PEPEUSDT', sumOpenInterest: '17073744019.00000000', CMCCirculatingSupply: '413772355107.94400000', timestamp: 1791530100000 }];

  // When the actual endpoint sample becomes a displayed indicator
  const history = parseHistory('openInterest', data, '1000PEPEUSDT');
  const result = computeTradingSignals({ openInterest: history }, new Set(), 'en', '1000PEPEUSDT');

  // Then the ratio needs no extra multiplication by one thousand
  assert.equal(result.indicators[7].display, '4.13%');
  assert.equal(result.indicators[0].unit, '1000PEPE');
  assert.ok(Math.abs(result.indicators[7].value - 0.0412636171676) < 1e-10);
});

test('user sees short ratios and nonzero small funding rates', () => {
  // Given ordinary ratios and fractional rates use different precision contracts
  const cases = [[0.00000029, '0.000029%'], [0.0000424, '0.00424%'], [0, '0%'], [-0.00000029, '-0.000029%'], [5e-16, '5.00e-14%']];

  // When the public formatters prepare their display strings
  const actual = cases.map(([value]) => formatFundingPercent(value));

  // Then ratios are compact and tiny genuine funding is never shown as zero
  assert.deepEqual(actual, cases.map(([, expected]) => expected));
  assert.equal(formatMetricValue('top-accounts', 1.4963, 'en'), '1.50');
  assert.equal(formatMetricValue('basis', -0.001, 'en'), '-0.10%');
  assert.equal(formatMetricValue('oi', 373_780_000, 'zh-CN'), '3.7378亿');
  assert.equal(formatMetricValue('oi', 373_780_000, 'en'), '373.78M');
});

test('user receives explicit invalid-data errors instead of zero-valued history', () => {
  // Given malformed and wrong-symbol data cannot describe this contract
  const base = { timestamp: 1791530100000, longShortRatio: '1.5' };

  // When the endpoint parser encounters a missing value or mismatched identity
  const missing = () => parseHistory('topAccountRatio', [{ ...base, longShortRatio: null }], 'STRKUSDT');
  const mismatch = () => parseHistory('topAccountRatio', [{ ...base, symbol: 'BTCUSDT' }], 'STRKUSDT');

  // Then the invalid source is rejected while a valid empty history remains empty
  assert.throws(missing, /Missing numeric/);
  assert.throws(mismatch, /symbol mismatch/);
  assert.deepEqual(parseHistory('fundingRate', [], 'STRKUSDT'), []);
  assert.throws(() => parseHistory('fundingRate', [...funding].reverse(), 'STRKUSDT'), /increasing timestamps/);
});

test('user sees buy and sell volumes and excludes unavailable indicators from votes', () => {
  // Given a single valid volume period and a zero circulating supply
  const taker = parseHistory('takerRatio', [{ timestamp: 1791530100000, buySellRatio: '1.1339', buyVol: '22678000', sellVol: '20000000' }], 'STRKUSDT');
  const oi = parseHistory('openInterest', [{ timestamp: 1791530100000, sumOpenInterest: '20', CMCCirculatingSupply: '0' }], 'STRKUSDT');

  // When the panel computes the available observations
  const result = computeTradingSignals({ takerRatio: taker, openInterest: oi }, new Set(), 'en', 'STRKUSDT');

  // Then bar values stay in coin units and a missing supply ratio is not zero
  assert.equal(result.indicators[4].display, '1.13');
  assert.equal(result.indicators[4].history[0].buy, 22_678_000);
  assert.equal(result.indicators[4].history[0].sell, 20_000_000);
  assert.equal(result.indicators[7].display, '--');
  assert.equal(result.total, 2);
  assert.equal(result.longCount, 1);
});
