import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCmcMetricRows, numberOrNull } from '../../src/binance-coinmarketcap-data/metrics.js';
import { cmcDetail } from '../helpers/data-media-migration-host.js';

for (const invalid of [null, undefined, '', '  ', 'unavailable', false, [], {}, Infinity, NaN]) {
  test(`user retains a missing CMC number for ${String(invalid)} instead of a fabricated zero`, () => {
    // Given an upstream field contains a missing or unsupported numeric representation
    const value = invalid;

    // When the numeric adapter normalizes that provider field
    const actual = numberOrNull(value);

    // Then the value remains explicitly missing
    assert.equal(actual, null);
  });
}

test('user retains valid numeric zero and numeric strings in CMC statistics', () => {
  // Given CMC sends zero quantities and numeric strings
  const values = [0, '0', ' 12.5 ', -2.75];

  // When the provider fields pass through the numeric adapter
  const actual = values.map(numberOrNull);

  // Then valid zero and signed numbers retain their exact numeric meaning
  assert.deepEqual(actual, [0, 0, 12.5, -2.75]);
});

for (const locale of ['zh-CN', 'en']) {
  test(`user sees nonzero small token prices and genuine zero distinctly in ${locale}`, () => {
    // Given the price provider supplies a small token price, a tiny price, and a genuine zero
    const snapshots = [0.00000378, 1e-18, 0].map(price => ({ statistics: { price } }));

    // When the panel formats the actual numeric price fields
    const prices = snapshots.map(detail => buildCmcMetricRows(detail, locale).find(row => row.id === 'price').value);

    // Then small prices retain significant digits and cannot be mistaken for zero
    assert.deepEqual(prices, ['$0.00000378', '$1.000e-18', '$0']);
  });

  test(`user reads computed valuation and supply comparisons in ${locale}`, () => {
    // Given a snapshot has a 2.5 valuation multiple and forty percent circulating supply
    const detail = cmcDetail();
    Object.assign(detail.statistics, { marketCap: 200_000_000, fullyDilutedMarketCap: 500_000_000, totalSupply: 250_000_000, circulatingSupply: 100_000_000 });

    // When the presentation is built for the requested language
    const rows = buildCmcMetricRows(detail, locale);

    // Then both comparisons use the snapshot and quantity units remain separate from the number
    const fdv = rows.find(row => row.id === 'fdv');
    const supply = rows.find(row => row.id === 'circulating-supply');
    assert.equal(fdv.interpretation, locale === 'zh-CN' ? '流通市值的2.50倍' : '2.50× market cap');
    assert.equal(fdv.value, locale === 'zh-CN' ? '$5亿' : '$500M');
    assert.equal(supply.interpretation, locale === 'zh-CN' ? '约占总供应量40.0%' : 'About 40.0% of total supply');
    assert.equal(supply.value, locale === 'zh-CN' ? '1亿' : '100M');
    assert.equal(supply.unit, 'BTC');
  });
}

for (const scenario of [
  { change: 12.5, reading: 'Up 12.50% over 24h', tone: 'positive' },
  { change: -3, reading: 'Down 3.00% over 24h', tone: 'negative' },
  { change: 0, reading: 'Unchanged over 24h', tone: 'neutral' },
  { change: null, reading: '24h change unavailable', tone: 'neutral' },
]) {
  test(`user sees the actual ${scenario.change} daily CMC price change without a forecast`, () => {
    // Given the current snapshot contains the specified daily price change
    const detail = cmcDetail();
    detail.statistics.priceChangePercentage24h = scenario.change;

    // When the price interpretation is prepared
    const price = buildCmcMetricRows(detail, 'en').find(row => row.id === 'price');

    // Then its direction and magnitude agree with the response
    assert.equal(price.interpretation, scenario.reading);
    assert.equal(price.tone, scenario.tone);
    assert.match(price.explanation, /does not establish sentiment or predict direction/);
  });
}

for (const scenario of [
  { turnover: 0, reading: 'Below the 50% threshold' },
  { turnover: 0.4999, reading: 'Below the 50% threshold' },
  { turnover: 0.5, reading: 'Relatively active trading' },
  { turnover: 0.75, reading: 'Relatively active trading' },
]) {
  test(`user sees CMC reported turnover ${scenario.turnover} with its stated descriptive threshold`, () => {
    // Given the provider reports a turnover field independently of the displayed value timestamps
    const detail = cmcDetail();
    Object.assign(detail.statistics, { marketCap: 200_000_000, volume24h: 100_000_000, turnover: scenario.turnover });

    // When the reported turnover is presented
    const row = buildCmcMetricRows(detail, 'en').find(row => row.id === 'turnover');

    // Then the supplied ratio is preserved and the interpretation discloses its threshold
    assert.equal(row.value, `${(scenario.turnover * 100).toFixed(2)}%`);
    assert.equal(row.interpretation, scenario.reading);
    assert.match(row.explanation, /CMC-reported turnover/);
    assert.match(row.explanation, /descriptive threshold only/);
    assert.match(row.explanation, /historical baseline/);
  });
}

for (const denominator of [null, '', 0, -1]) {
  test(`user gets no CMC ratio inference from a ${String(denominator)} denominator`, () => {
    // Given valuation and supply denominators are absent or non-positive
    const detail = cmcDetail();
    Object.assign(detail.statistics, { marketCap: denominator, totalSupply: denominator, turnover: 0.75 });

    // When CMC values are converted to presentation rows
    const rows = buildCmcMetricRows(detail, 'en');

    // Then neither derived ratios nor activity claims infer a usable denominator
    for (const id of ['fdv', 'circulating-supply', 'turnover', 'liquidity']) {
      assert.equal(rows.find(row => row.id === id).interpretation, 'Comparison unavailable');
    }
  });
}

test('user keeps zero CMC values without inventing a supply comparison or discarding zero holders', () => {
  // Given all statistics are zero and the first available holder count is genuinely zero
  const detail = cmcDetail({ profileCompletionScore: 0, holders: { holderCount: 0, total: 99 } });
  for (const key of Object.keys(detail.statistics)) detail.statistics[key] = 0;

  // When the English panel rows are prepared
  const rows = buildCmcMetricRows(detail, 'en');

  // Then price, score, and holders retain zero while zero supply cannot support a ratio
  assert.equal(rows.find(row => row.id === 'price').value, '$0');
  assert.equal(rows.find(row => row.id === 'holders').value, '0');
  assert.equal(rows.find(row => row.id === 'profile').value, '0%');
  assert.equal(rows.find(row => row.id === 'circulating-supply').interpretation, 'Comparison unavailable');
});

test('user sees missing CMC metrics as unavailable rather than zero supply or unlimited issuance', () => {
  // Given the asset exists but its optional statistics and score are missing
  const detail = { statistics: {}, symbol: 'BTC', profileCompletionScore: null };

  // When the panel builds an English snapshot
  const rows = buildCmcMetricRows(detail, 'en');

  // Then all values remain absent and the explanations preserve the limits of the data
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map(row => row.value), Array(12).fill('--'));
  assert.equal(rows.find(row => row.id === 'max-supply').interpretation, 'Supply cap unavailable');
  assert.match(rows.find(row => row.id === 'max-supply').explanation, /does not establish unlimited supply/);
  assert.match(rows.find(row => row.id === 'holders').explanation, /does not measure unique investors/);
});

test('user sees treasury holdings with token units instead of an address-count interpretation', () => {
  // Given CMC explicitly replaces holder information with a positive treasury position
  const detail = cmcDetail({ showTreasuriesFlag: true, treasuryHoldings: 1200 });

  // When the CMC panel builds the treasury row
  const row = buildCmcMetricRows(detail, 'en').find(row => row.id === 'treasury');

  // Then the quantity and explanation retain treasury semantics
  assert.equal(row.label, 'Treasury holdings');
  assert.equal(row.value, '1.2K');
  assert.equal(row.unit, 'BTC');
  assert.equal(row.interpretation, 'Treasury token holdings');
  assert.match(row.explanation, /not a holder address count/);
});

for (const score of [-1, 101, '', null]) {
  test(`user sees CMC profile score ${String(score)} as unavailable without a safety judgment`, () => {
    // Given CMC provides a missing or out-of-range profile percentage
    const detail = cmcDetail({ profileCompletionScore: { percentage: score } });

    // When the profile score is interpreted
    const row = buildCmcMetricRows(detail, 'en').find(row => row.id === 'profile');

    // Then an invalid percentage stays absent and the score purpose remains explicit
    assert.equal(row.value, '--');
    assert.equal(row.interpretation, 'Data unavailable');
    assert.match(row.explanation, /not project safety or investment success/);
  });
}
