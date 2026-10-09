import { CMC_COPY, CMC_METRIC_COPY, localizedText, formatLocalizedText } from './ui-copy.js';

/** CMC numeric fields may be numbers or numeric strings; missing and invalid values stay missing. */
export function numberOrNull(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactNumber(value, locale, usd = false) {
  if (value === null) return '--';
  const magnitude = Math.abs(value);
  const units = locale === 'zh-CN'
    ? [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']]
    : [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const unit = units.find(([scale]) => magnitude >= scale);
  const scaled = unit ? magnitude / unit[0] : magnitude;
  const decimals = scaled > 0 && scaled < 1 ? Math.max(4, 3 - Math.floor(Math.log10(scaled))) : 4;
  // Small token prices need significant digits rather than a fixed decimal ceiling.
  const number = decimals > 14 ? scaled.toExponential(3) : scaled.toLocaleString('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: decimals, useGrouping: false,
  });
  return `${value < 0 ? '-' : ''}${usd ? '$' : ''}${number}${unit ? unit[1] : ''}`;
}

function percent(value, signed = false) {
  if (value === null) return '--';
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Ratios do not invent comparable supply or valuation denominators. */
function positiveRatio(numerator, denominator) {
  return numerator !== null && denominator !== null && numerator > 0 && denominator > 0
    ? numerator / denominator : null;
}

function holderMetric(detail) {
  const treasury = numberOrNull(detail.treasuryHoldings);
  if (detail.showTreasuriesFlag && treasury !== null && treasury > 0) {
    return { id: 'treasury', number: treasury };
  }
  const pageCount = numberOrNull(detail.cmcHolderCount);
  if (pageCount !== null) return { id: 'holders', number: pageCount };
  const holders = detail.holders;
  const count = holders && typeof holders === 'object'
    ? [holders.holderCount, holders.total, holders.count].map(numberOrNull).find(value => value !== null)
    : undefined;
  return { id: 'holders', number: count === undefined ? null : count };
}

/** Build only presentation data; preserve CMC-reported ratios and their source definitions. */
export function buildCmcMetricRows(detail, locale) {
  const text = value => formatLocalizedText(value, locale);
  const pair = (zh, en) => text(localizedText(zh, en));
  const stats = detail.statistics;
  const values = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, numberOrNull(value)]));
  const numeric = key => values[key] === undefined ? null : values[key];
  const priceChange = numeric('priceChangePercentage24h');
  const fdvRatio = positiveRatio(numeric('fullyDilutedMarketCap'), numeric('marketCap'));
  const supplyRatio = positiveRatio(numeric('circulatingSupply'), numeric('totalSupply'));
  const rawTurnover = numeric('turnover');
  const turnover = rawTurnover !== null && rawTurnover >= 0 ? rawTurnover * 100 : null;
  const rawLiquidity = numeric('liquidityMcapRatio');
  const liquidity = rawLiquidity !== null && rawLiquidity >= 0 ? rawLiquidity * 100 : null;
  const holder = holderMetric(detail);
  const rawProfile = numberOrNull(detail.profileCompletionScore && typeof detail.profileCompletionScore === 'object'
    ? detail.profileCompletionScore.percentage : detail.profileCompletionScore);
  const profile = rawProfile !== null && rawProfile >= 0 && rawProfile <= 100 ? rawProfile : null;
  const comparableCap = numeric('marketCap') !== null && numeric('marketCap') > 0;
  const symbol = detail.symbol || '';

  function row(id, value, options = {}) {
    const copy = CMC_METRIC_COPY[id];
    const available = value !== '--';
    return {
      id,
      label: text(copy.label),
      qualifier: copy.qualifier ? text(copy.qualifier) : '',
      value,
      unit: '',
      change: null,
      highlight: false,
      group: false,
      tone: available ? 'neutral' : 'missing',
      interpretation: available && copy.interpretation ? text(copy.interpretation) : text(copy.unavailable || CMC_COPY.unavailable),
      note: text(copy.note),
      explanation: text(copy.explanation),
      ...options,
    };
  }

  const price = row('price', compactNumber(numeric('price'), locale, true));
  if (numeric('price') !== null && priceChange !== null) {
    price.change = percent(priceChange, true);
    price.interpretation = priceChange === 0
      ? pair('24小时价格持平', 'Unchanged over 24h')
      : pair(
        `24小时${priceChange > 0 ? '上涨' : '下跌'}${Math.abs(priceChange).toFixed(2)}%`,
        `${priceChange > 0 ? 'Up' : 'Down'} ${Math.abs(priceChange).toFixed(2)}% over 24h`,
      );
    price.tone = priceChange > 0 ? 'positive' : priceChange < 0 ? 'negative' : 'neutral';
    price.explanation = `${price.interpretation}${locale === 'zh-CN' ? '。' : '.'} ${price.explanation}`;
  } else if (numeric('price') !== null) {
    price.interpretation = pair('暂无24小时变动', '24h change unavailable');
  }

  const fdv = row('fdv', compactNumber(numeric('fullyDilutedMarketCap'), locale, true), { highlight: true });
  fdv.interpretation = fdvRatio === null
    ? text(CMC_COPY.comparisonUnavailable)
    : pair(`流通市值的${fdvRatio.toFixed(2)}倍`, `${fdvRatio.toFixed(2)}× market cap`);
  if (fdvRatio !== null) fdv.explanation = `${fdv.interpretation}${locale === 'zh-CN' ? '。' : '.'} ${fdv.explanation}`;

  const turnoverRow = row('turnover', percent(turnover));
  if (turnover !== null && comparableCap) {
    turnoverRow.interpretation = turnover >= 50
      ? pair('交投较活跃', 'Relatively active trading')
      : pair('低于50%描述阈值', 'Below the 50% threshold');
    turnoverRow.note = pair(`CMC 报告比值 ${percent(turnover)}`, `CMC reports ${percent(turnover)}`);
    turnoverRow.tone = turnover >= 50 ? 'active' : 'neutral';
  } else if (turnover !== null) {
    turnoverRow.interpretation = text(CMC_COPY.comparisonUnavailable);
  }

  const liquidityRow = row('liquidity', percent(liquidity));
  if (liquidity !== null && !comparableCap) liquidityRow.interpretation = text(CMC_COPY.comparisonUnavailable);

  const total = row('total-supply', compactNumber(numeric('totalSupply'), locale), {
    unit: numeric('totalSupply') === null ? '' : symbol, group: true,
  });
  if (numeric('totalSupply') !== null && numeric('totalSupply') <= 0) total.interpretation = text(CMC_COPY.supplyInvalid);
  const circulating = row('circulating-supply', compactNumber(numeric('circulatingSupply'), locale), {
    unit: numeric('circulatingSupply') === null ? '' : symbol,
  });
  circulating.interpretation = supplyRatio === null
    ? text(CMC_COPY.comparisonUnavailable)
    : pair(`约占总供应量${(supplyRatio * 100).toFixed(1)}%`, `About ${(supplyRatio * 100).toFixed(1)}% of total supply`);
  if (supplyRatio !== null && supplyRatio > 1) {
    circulating.interpretation = pair('流通量高于总供应量', 'Circulating supply exceeds total');
    circulating.note = text(CMC_COPY.supplyInvalid);
  } else if (supplyRatio !== null) {
    circulating.explanation = `${circulating.interpretation}${locale === 'zh-CN' ? '。' : '.'} ${circulating.explanation}`;
  }
  const max = row('max-supply', compactNumber(numeric('maxSupply'), locale), {
    unit: numeric('maxSupply') === null ? '' : symbol,
  });
  if (numeric('maxSupply') !== null && numeric('maxSupply') <= 0) max.interpretation = text(CMC_COPY.supplyInvalid);

  const profileRow = row('profile', profile === null ? '--' : `${profile.toFixed(0)}%`);
  if (profile !== null) {
    profileRow.interpretation = profile < 100
      ? pair('资料仍有完善空间', 'Room to improve disclosure')
      : pair('资料评分已满分', 'Full profile score');
  }

  return [
    price,
    row('market-cap', compactNumber(numeric('marketCap'), locale, true), {
      highlight: true,
      change: numeric('marketCap') === null ? null : percent(numeric('marketCapChangePercentage24h'), true),
    }),
    { ...fdv, change: numeric('fullyDilutedMarketCap') === null ? null : percent(numeric('fullyDilutedMarketCapChangePercentage24h'), true) },
    row('unlocked', compactNumber(numeric('ucm'), locale, true)),
    row('volume', compactNumber(numeric('volume24h'), locale, true), { group: true }),
    turnoverRow,
    liquidityRow,
    total,
    circulating,
    max,
    row(holder.id, compactNumber(holder.number, locale), { group: true, unit: holder.id === 'treasury' ? symbol : '' }),
    profileRow,
  ];
}
