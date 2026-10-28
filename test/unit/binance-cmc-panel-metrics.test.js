import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCmcMetricRows, numberOrNull, summarizeCmcStance } from '../../src/binance-coinmarketcap-data/metrics.js';
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
}

/** ARB statistics as returned by the CMC data-api detail endpoint on 2026-10-26. */
function arbDetail() {
  return {
    symbol: 'ARB',
    statistics: {
      price: 0.1695504290969836, priceChangePercentage24h: 2.5558654, priceChangePercentage7d: -13.97025063,
      high30d: 0.2356581303635056, low30d: 0.16305702565480068, marketCap: 1168561060.89,
      fullyDilutedMarketCap: 1695504290.97, ucm: 1618614518.9142785, circulatingSupply: 6892115031,
      totalSupply: 10000000000, maxSupply: 10000000000, turnover: 0.09133753, liquidityMcapRatio: null,
      volume24h: 106733477.16699164, volume7d: 548262765.6988723, rank: 57,
    },
    isInfiniteMaxSupply: 0,
    holders: { holderCount: 67008, holderList: [{ share: 34.19 }, { share: 8.1 }] },
    profileCompletionScore: { percentage: 83.2427915 },
  };
}

function readings(detail, locale = 'zh-CN') {
  return Object.fromEntries(buildCmcMetricRows(detail, locale).map(row => [row.id, [row.interpretation, row.tone]]));
}

test('user reads a calculated stance for every CMC metric of a real ARB snapshot', () => {
  // Given the ARB snapshot fetched from CMC on 2026-10-26
  const detail = arbDetail();

  // When the Chinese panel rows are prepared
  const actual = readings(detail);

  // Then every reading states the computed comparison and its lean
  assert.deepEqual(actual, {
    price: ['7日跌14%，贴近30日低点', 'negative'],
    'market-cap': ['第57名，中盘币', 'neutral'],
    fdv: ['流通的1.45倍，稀释压力中等', 'neutral'],
    unlocked: ['比流通多39%，潜在抛压大', 'negative'],
    volume: ['比7日均量高36%，资金涌入', 'positive'],
    turnover: ['交投一般', 'neutral'],
    liquidity: ['--', 'missing'],
    'total-supply': ['已达上限，全部铸造', 'neutral'],
    'circulating-supply': ['还有31%未流通，解锁压力大', 'negative'],
    'max-supply': ['封顶，不再增发', 'positive'],
    holders: ['最大地址占34%，筹码集中', 'negative'],
    profile: ['披露较完整', 'neutral'],
  });
});

test('user reads the same ARB stance in English with the 24h price change kept on the price row only', () => {
  // Given the same ARB snapshot
  const detail = arbDetail();

  // When the English rows are prepared
  const rows = buildCmcMetricRows(detail, 'en');

  // Then readings are translated and only the price carries a daily change
  assert.deepEqual(rows.filter(row => row.change !== null).map(row => [row.id, row.change]), [['price', '+2.56%']]);
  assert.deepEqual(['price', 'volume', 'circulating-supply'].map(id => rows.find(row => row.id === id).interpretation), [
    'Down 14% in 7d, near 30d low', '+36% vs 7d avg, money flowing in', '31% locked, unlock pressure',
  ]);
});

for (const scenario of [
  { name: 'falls near the 30-day low', price: 105, change7d: -6, reading: ['7日跌6%，贴近30日低点', 'negative'] },
  { name: 'rises near the 30-day high', price: 195, change7d: 12, reading: ['7日涨12%，逼近30日高点', 'positive'] },
  { name: 'rises from the lower part of the range', price: 110, change7d: 3, reading: ['7日涨3%，处30日区间偏下', 'neutral'] },
  { name: 'sits in the middle of the range', price: 150, change7d: -2, reading: ['7日跌2%，处30日区间中部', 'neutral'] },
  { name: 'falls from the upper part of the range', price: 190, change7d: -4, reading: ['7日跌4%，处30日区间偏上', 'neutral'] },
]) {
  test(`user sees the price stance when it ${scenario.name}`, () => {
    // Given a 100–200 thirty-day range and the scenario's seven-day move
    const detail = arbDetail();
    Object.assign(detail.statistics, { price: scenario.price, priceChangePercentage7d: scenario.change7d, low30d: 100, high30d: 200 });

    // When the price row is interpreted
    const actual = readings(detail).price;

    // Then range position and weekly direction decide the lean
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const scenario of [
  { change: 12.5, reading: ['24小时涨12.5%', 'positive'] },
  { change: -3, reading: ['24小时跌3.0%', 'negative'] },
  { change: 0, reading: ['24小时持平', 'neutral'] },
  { change: null, reading: ['--', 'missing'] },
]) {
  test(`user sees only the ${scenario.change} daily price move when weekly and range data are missing`, () => {
    // Given the snapshot lacks seven-day and thirty-day price history
    const detail = arbDetail();
    Object.assign(detail.statistics, { priceChangePercentage24h: scenario.change, priceChangePercentage7d: null, high30d: null });

    // When the price row is interpreted
    const actual = readings(detail).price;

    // Then the reading reports the daily move it can support
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const scenario of [
  { fdv: 119, reading: ['仅为流通的1.19倍，几乎无稀释', 'positive'] },
  { fdv: 120, reading: ['流通的1.20倍，稀释压力中等', 'neutral'] },
  { fdv: 199, reading: ['流通的1.99倍，稀释压力中等', 'neutral'] },
  { fdv: 200, reading: ['流通的2.00倍，稀释压力大', 'negative'] },
  { fdv: 500, reading: ['流通的5.00倍，稀释极重', 'negative'] },
]) {
  test(`user sees the dilution stance for an FDV of ${scenario.fdv / 100}x market cap`, () => {
    // Given a market cap of 100 and the scenario FDV
    const detail = arbDetail();
    Object.assign(detail.statistics, { marketCap: 100, fullyDilutedMarketCap: scenario.fdv });

    // When the FDV row is interpreted
    const actual = readings(detail).fdv;

    // Then the multiple falls into its stated band
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const scenario of [
  { volume24h: 140, change: -2, reading: ['比7日均量高40%，放量下跌', 'negative'] },
  { volume24h: 130, change: 1, reading: ['比7日均量高30%，资金涌入', 'positive'] },
  { volume24h: 110, change: -2, reading: ['比7日均量高10%，量能平稳', 'neutral'] },
  { volume24h: 70, change: 3, reading: ['比7日均量低30%，交投降温', 'neutral'] },
]) {
  test(`user sees the volume stance for ${scenario.volume24h}% of the seven-day average with a ${scenario.change}% move`, () => {
    // Given a seven-day volume averaging 100 per day
    const detail = arbDetail();
    Object.assign(detail.statistics, { volume24h: scenario.volume24h, volume7d: 700, priceChangePercentage24h: scenario.change });

    // When the volume row is interpreted
    const actual = readings(detail).volume;

    // Then the surge or slowdown is judged together with the price direction
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const scenario of [
  { turnover: 0.0299, reading: ['换手低，筹码稳定', 'neutral'] },
  { turnover: 0.03, reading: ['交投一般', 'neutral'] },
  { turnover: 0.15, reading: ['交投活跃', 'positive'] },
  { turnover: 0.5, reading: ['换手过高，投机过热', 'negative'] },
]) {
  test(`user sees the turnover stance for a CMC turnover of ${scenario.turnover}`, () => {
    // Given CMC reports the scenario turnover
    const detail = arbDetail();
    detail.statistics.turnover = scenario.turnover;

    // When the turnover row is interpreted
    const actual = readings(detail).turnover;

    // Then the percentage falls into its stated band
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const scenario of [
  { ratio: 0.009, reading: ['链上池子很薄，易砸盘', 'negative'] },
  { ratio: 0.01, reading: ['链上池子偏薄', 'neutral'] },
  { ratio: 0.05, reading: ['链上流动性充足', 'positive'] },
]) {
  test(`user sees the DEX liquidity stance for a ratio of ${scenario.ratio}`, () => {
    // Given CMC reports the scenario liquidity ratio
    const detail = arbDetail();
    detail.statistics.liquidityMcapRatio = scenario.ratio;

    // When the liquidity row is interpreted
    const actual = readings(detail).liquidity;

    // Then thin pools are bearish and deep pools bullish
    assert.deepEqual(actual, scenario.reading);
  });
}

test('user sees capped, nearly minted supply as low inflation with no unlock pressure', () => {
  // Given BTC-like supply with 95.7% minted and everything minted circulating
  const detail = arbDetail();
  Object.assign(detail.statistics, { totalSupply: 20103850, circulatingSupply: 20103850, maxSupply: 21000000 });

  // When the supply rows are interpreted
  const actual = readings(detail);

  // Then minted share, circulation, and remaining issuance are calculated
  assert.deepEqual([actual['total-supply'], actual['circulating-supply'], actual['max-supply']], [
    ['已铸造上限的95.7%', 'neutral'], ['基本全部流通，无解锁抛压', 'positive'], ['仅剩4.3%待发行，通胀低', 'positive'],
  ]);
});

test('user sees uncapped supply and partial issuance as inflation pressure', () => {
  // Given one uncapped token and one with 40% of its cap left to issue
  const uncapped = arbDetail();
  Object.assign(uncapped.statistics, { maxSupply: null });
  uncapped.isInfiniteMaxSupply = 1;
  const partial = arbDetail();
  Object.assign(partial.statistics, { totalSupply: 6e9, circulatingSupply: 5.1e9, maxSupply: 1e10 });

  // When both snapshots are interpreted
  const uncappedRows = readings(uncapped);
  const partialRows = readings(partial);

  // Then both inflation cases are bearish while 85% circulation stays neutral
  assert.deepEqual([uncappedRows['total-supply'], uncappedRows['max-supply']], [
    ['无上限，持续增发', 'negative'], ['无上限，长期通胀', 'negative'],
  ]);
  assert.deepEqual([partialRows['circulating-supply'], partialRows['max-supply']], [
    ['还有15%未流通', 'neutral'], ['还有40%待发行，有增发压力', 'negative'],
  ]);
});

test('user sees total supply above the cap flagged as invalid instead of a minted share', () => {
  // Given CMC reports a total supply larger than the maximum supply
  const detail = arbDetail();
  Object.assign(detail.statistics, { totalSupply: 25e9, circulatingSupply: 10e9, maxSupply: 21e9 });

  // When the supply rows are interpreted
  const actual = readings(detail);

  // Then neither the minted share nor the remaining issuance is calculated
  assert.deepEqual([actual['total-supply'], actual['max-supply']], [
    ['供应量数据异常', 'neutral'], ['供应量数据异常', 'neutral'],
  ]);
});

test('user sees circulating supply above total supply flagged as invalid data', () => {
  // Given CMC reports more circulating than total supply
  const detail = arbDetail();
  Object.assign(detail.statistics, { circulatingSupply: 11e9 });

  // When the circulating row is interpreted
  const actual = readings(detail)['circulating-supply'];

  // Then no unlock judgment is drawn from inconsistent supply
  assert.deepEqual(actual, ['流通量超过总量，数据异常', 'neutral']);
});

for (const scenario of [
  { share: 3.2, reading: ['最大地址占3.2%，筹码分散', 'positive'] },
  { share: 12, reading: ['最大地址占12%', 'neutral'] },
  { share: null, reading: ['--', 'missing'] },
]) {
  test(`user sees holder concentration for a top address share of ${scenario.share}`, () => {
    // Given the CMC holder list's largest address has the scenario share
    const detail = arbDetail();
    detail.holders = scenario.share === null ? { holderCount: 67008 } : { holderCount: 67008, holderList: [{ share: scenario.share }] };

    // When the holders row is interpreted
    const actual = readings(detail).holders;

    // Then dispersed holdings are bullish and missing lists stay unread
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const denominator of [null, '', 0, -1]) {
  test(`user gets no CMC ratio reading from a ${String(denominator)} denominator`, () => {
    // Given valuation and supply denominators are absent or non-positive
    const detail = arbDetail();
    Object.assign(detail.statistics, { marketCap: denominator, totalSupply: denominator, liquidityMcapRatio: 0.03 });

    // When CMC values are converted to presentation rows
    const actual = readings(detail);

    // Then no ratio reading is derived from an unusable denominator
    for (const id of ['market-cap', 'fdv', 'unlocked', 'turnover', 'liquidity', 'circulating-supply']) {
      assert.deepEqual(actual[id], ['--', 'missing'], id);
    }
  });
}

test('user sees missing CMC metrics as unread rather than as zero supply or unlimited issuance', () => {
  // Given the asset exists but its optional statistics and score are missing
  const detail = { statistics: {}, symbol: 'BTC', profileCompletionScore: null };

  // When the panel builds an English snapshot
  const rows = buildCmcMetricRows(detail, 'en');

  // Then every value and reading stays absent and no stance is taken
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map(row => [row.value, row.interpretation, row.tone]), Array(12).fill(['--', '--', 'missing']));
  assert.deepEqual(summarizeCmcStance(rows, 'en'), { tone: 'neutral', label: 'Neutral', detail: '0 bull / 0 bear' });
});

test('user sees treasury holdings with token units as locked supply', () => {
  // Given CMC replaces holder information with a positive treasury position
  const detail = cmcDetail({ showTreasuriesFlag: true, treasuryHoldings: 1200 });

  // When the CMC panel builds the treasury row
  const row = buildCmcMetricRows(detail, 'en').find(row => row.id === 'treasury');

  // Then the quantity keeps its unit and the reading treats it as locked supply
  assert.deepEqual([row.label, row.value, row.unit, row.interpretation, row.tone], [
    'Treasuries', '1.2K', 'BTC', 'Held by corporate treasuries', 'positive',
  ]);
});

for (const scenario of [
  { score: 80, reading: ['披露较完整', 'neutral'] },
  { score: 50, reading: ['披露一般', 'neutral'] },
  { score: 49.9, reading: ['透明度差', 'negative'] },
  { score: -1, reading: ['--', 'missing'] },
  { score: 101, reading: ['--', 'missing'] },
  { score: null, reading: ['--', 'missing'] },
]) {
  test(`user sees the disclosure stance for a CMC profile score of ${scenario.score}`, () => {
    // Given CMC provides the scenario profile percentage
    const detail = arbDetail();
    detail.profileCompletionScore = { percentage: scenario.score };

    // When the profile row is interpreted
    const actual = readings(detail).profile;

    // Then valid scores fall into bands and invalid scores stay unread
    assert.deepEqual(actual, scenario.reading);
  });
}

for (const scenario of [
  { tones: ['positive', 'positive', 'positive', 'neutral'], stance: { tone: 'positive', label: '偏多', detail: '多3 / 空0' } },
  { tones: ['negative', 'negative', 'negative', 'negative', 'positive'], stance: { tone: 'negative', label: '偏空', detail: '多1 / 空4' } },
  { tones: ['negative', 'negative', 'negative', 'negative', 'positive', 'positive'], stance: { tone: 'neutral', label: '中性', detail: '多2 / 空4' } },
]) {
  test(`user sees a ${scenario.stance.label} panel stance from ${scenario.stance.detail}`, () => {
    // Given rows with the scenario's bullish and bearish readings
    const rows = scenario.tones.map(tone => ({ tone }));

    // When the panel stance is summarized
    const actual = summarizeCmcStance(rows, 'zh-CN');

    // Then a lead of three readings is required to take a side
    assert.deepEqual(actual, scenario.stance);
  });
}
