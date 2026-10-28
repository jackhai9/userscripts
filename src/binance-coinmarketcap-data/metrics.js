import { CMC_METRIC_COPY, localizedText, formatLocalizedText } from './ui-copy.js';

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

function absPercent(value, digits = 0) {
  return `${Math.abs(value).toFixed(digits)}%`;
}

/** Up to the top holder share CMC lists; exchange and burn addresses are not excluded upstream. */
function topHolderShare(detail) {
  const list = detail.holders && typeof detail.holders === 'object' ? detail.holders.holderList : null;
  return Array.isArray(list) && list.length > 0 ? numberOrNull(list[0].share) : null;
}

/**
 * Each reading states a calculated comparison and a stance.
 * Tones: positive = bullish, negative = bearish, neutral = no lean, missing = no data.
 */
export function buildCmcMetricRows(detail, locale) {
  const text = value => formatLocalizedText(value, locale);
  const pair = (zh, en) => text(localizedText(zh, en));
  const stats = detail.statistics;
  const values = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, numberOrNull(value)]));
  const numeric = key => values[key] === undefined ? null : values[key];
  const price = numeric('price');
  const marketCap = numeric('marketCap');
  const priceChange = numeric('priceChangePercentage24h');
  const fdvRatio = positiveRatio(numeric('fullyDilutedMarketCap'), marketCap);
  const unlockRatio = positiveRatio(numeric('ucm'), marketCap);
  const supplyRatio = positiveRatio(numeric('circulatingSupply'), numeric('totalSupply'));
  const rawTurnover = numeric('turnover');
  const turnover = rawTurnover !== null && rawTurnover >= 0 ? rawTurnover * 100 : null;
  const rawLiquidity = numeric('liquidityMcapRatio');
  const liquidity = rawLiquidity !== null && rawLiquidity >= 0 ? rawLiquidity * 100 : null;
  const holder = holderMetric(detail);
  const rawProfile = numberOrNull(detail.profileCompletionScore && typeof detail.profileCompletionScore === 'object'
    ? detail.profileCompletionScore.percentage : detail.profileCompletionScore);
  const profile = rawProfile !== null && rawProfile >= 0 && rawProfile <= 100 ? rawProfile : null;
  const comparableCap = marketCap !== null && marketCap > 0;
  const symbol = detail.symbol || '';

  function row(id, value, options = {}) {
    const copy = CMC_METRIC_COPY[id];
    return {
      id,
      label: text(copy.label),
      value,
      unit: '',
      change: null,
      highlight: false,
      group: false,
      tone: 'missing',
      interpretation: '--',
      note: text(copy.note),
      explanation: text(copy.explanation),
      ...options,
    };
  }
  function read(target, tone, zh, en) {
    target.tone = tone;
    target.interpretation = pair(zh, en);
  }

  const priceRow = row('price', compactNumber(price, locale, true));
  const change7d = numeric('priceChangePercentage7d');
  const high30d = numeric('high30d');
  const low30d = numeric('low30d');
  if (price !== null) priceRow.change = priceChange === null ? null : percent(priceChange, true);
  if (price !== null && change7d !== null && high30d !== null && low30d !== null && high30d > low30d) {
    const position = (price - low30d) / (high30d - low30d);
    const move = { zh: `7日${change7d >= 0 ? '涨' : '跌'}${absPercent(change7d)}`, en: `${change7d >= 0 ? 'Up' : 'Down'} ${absPercent(change7d)} in 7d` };
    if (position < 0.2 && change7d < 0) read(priceRow, 'negative', `${move.zh}，贴近30日低点`, `${move.en}, near 30d low`);
    else if (position > 0.8 && change7d > 0) read(priceRow, 'positive', `${move.zh}，逼近30日高点`, `${move.en}, near 30d high`);
    else {
      const zone = position < 1 / 3 ? ['偏下', 'lower'] : position > 2 / 3 ? ['偏上', 'upper'] : ['中部', 'middle'];
      read(priceRow, 'neutral', `${move.zh}，处30日区间${zone[0]}`, `${move.en}, ${zone[1]} 30d range`);
    }
  } else if (price !== null && priceChange === 0) {
    read(priceRow, 'neutral', '24小时持平', 'Flat in 24h');
  } else if (price !== null && priceChange !== null) {
    read(priceRow, priceChange > 0 ? 'positive' : 'negative',
      `24小时${priceChange > 0 ? '涨' : '跌'}${absPercent(priceChange, 1)}`, `${priceChange > 0 ? 'Up' : 'Down'} ${absPercent(priceChange, 1)} in 24h`);
  }

  const capRow = row('market-cap', compactNumber(marketCap, locale, true), { highlight: true });
  const rank = numeric('rank');
  const dominance = numeric('marketCapDominance');
  if (comparableCap && rank !== null && rank > 0) {
    if (rank <= 3 && dominance !== null && dominance >= 50) read(capRow, 'positive', `市占率${absPercent(dominance)}，资金抱团龙头`, `${absPercent(dominance)} dominance, money in the leader`);
    else if (rank <= 10) read(capRow, 'neutral', `第${rank}名，大盘币`, `#${rank}, large cap`);
    else if (rank <= 100) read(capRow, 'neutral', `第${rank}名，中盘币`, `#${rank}, mid cap`);
    else read(capRow, 'negative', `第${rank}名，小盘币波动大`, `#${rank}, volatile small cap`);
  }

  const fdv = row('fdv', compactNumber(numeric('fullyDilutedMarketCap'), locale, true), { highlight: true });
  if (fdvRatio !== null) {
    const multiple = fdvRatio.toFixed(2);
    if (fdvRatio < 1.2) read(fdv, 'positive', `仅为流通的${multiple}倍，几乎无稀释`, `${multiple}× cap, little dilution`);
    else if (fdvRatio < 2) read(fdv, 'neutral', `流通的${multiple}倍，稀释压力中等`, `${multiple}× cap, moderate dilution`);
    else if (fdvRatio < 5) read(fdv, 'negative', `流通的${multiple}倍，稀释压力大`, `${multiple}× cap, heavy dilution`);
    else read(fdv, 'negative', `流通的${multiple}倍，稀释极重`, `${multiple}× cap, extreme dilution`);
  }

  const unlocked = row('unlocked', compactNumber(numeric('ucm'), locale, true));
  if (unlockRatio !== null) {
    if (unlockRatio > 1.2) read(unlocked, 'negative', `比流通多${absPercent((unlockRatio - 1) * 100)}，潜在抛压大`, `${absPercent((unlockRatio - 1) * 100)} above cap, sell pressure`);
    else read(unlocked, 'neutral', '解锁部分基本已流通', 'Unlocked supply mostly circulating');
  }

  const volume24h = numeric('volume24h');
  const volume7d = numeric('volume7d');
  const volume = row('volume', compactNumber(volume24h, locale, true), { group: true });
  if (volume24h !== null && volume7d !== null && volume7d > 0) {
    const versus = (volume24h / (volume7d / 7) - 1) * 100;
    const delta = { zh: `比7日均量${versus >= 0 ? '高' : '低'}${absPercent(versus)}`, en: `${versus >= 0 ? '+' : '-'}${absPercent(versus)} vs 7d avg` };
    if (versus >= 30 && priceChange !== null && priceChange < 0) read(volume, 'negative', `${delta.zh}，放量下跌`, `${delta.en}, selling volume`);
    else if (versus >= 30) read(volume, 'positive', `${delta.zh}，资金涌入`, `${delta.en}, money flowing in`);
    else if (versus <= -30) read(volume, 'neutral', `${delta.zh}，交投降温`, `${delta.en}, cooling off`);
    else read(volume, 'neutral', `${delta.zh}，量能平稳`, `${delta.en}, steady`);
  }

  const turnoverRow = row('turnover', percent(turnover));
  if (turnover !== null && comparableCap) {
    if (turnover < 3) read(turnoverRow, 'neutral', '换手低，筹码稳定', 'Low turnover, stable holders');
    else if (turnover < 15) read(turnoverRow, 'neutral', '交投一般', 'Normal trading');
    else if (turnover < 50) read(turnoverRow, 'positive', '交投活跃', 'Active trading');
    else read(turnoverRow, 'negative', '换手过高，投机过热', 'Overheated speculation');
  }

  const liquidityRow = row('liquidity', percent(liquidity));
  if (liquidity !== null && comparableCap) {
    if (liquidity < 1) read(liquidityRow, 'negative', '链上池子很薄，易砸盘', 'Very thin DEX pools');
    else if (liquidity < 5) read(liquidityRow, 'neutral', '链上池子偏薄', 'Thin DEX pools');
    else read(liquidityRow, 'positive', '链上流动性充足', 'Deep DEX pools');
  }

  const totalSupply = numeric('totalSupply');
  const maxSupply = numeric('maxSupply');
  const infinite = detail.isInfiniteMaxSupply === 1 || detail.isInfiniteMaxSupply === true;
  const total = row('total-supply', compactNumber(totalSupply, locale), { unit: totalSupply === null ? '' : symbol, group: true });
  const exceedsCap = totalSupply !== null && maxSupply !== null && maxSupply > 0 && totalSupply > maxSupply * 1.0005;
  if ((totalSupply !== null && totalSupply <= 0) || exceedsCap) read(total, 'neutral', '供应量数据异常', 'Invalid supply data');
  else if (totalSupply !== null && maxSupply !== null && maxSupply > 0) {
    const minted = totalSupply / maxSupply * 100;
    if (minted >= 99.95) read(total, 'neutral', '已达上限，全部铸造', 'Fully minted');
    else read(total, 'neutral', `已铸造上限的${minted.toFixed(1)}%`, `${minted.toFixed(1)}% of cap minted`);
  } else if (totalSupply !== null && infinite) read(total, 'negative', '无上限，持续增发', 'Uncapped, still inflating');

  const circulating = row('circulating-supply', compactNumber(numeric('circulatingSupply'), locale), {
    unit: numeric('circulatingSupply') === null ? '' : symbol,
  });
  if (supplyRatio !== null && supplyRatio > 1.0005) read(circulating, 'neutral', '流通量超过总量，数据异常', 'Exceeds total supply, invalid');
  else if (supplyRatio !== null) {
    const locked = Math.max(0, (1 - supplyRatio) * 100);
    if (supplyRatio >= 0.95) read(circulating, 'positive', '基本全部流通，无解锁抛压', 'Nearly all circulating');
    else if (supplyRatio >= 0.7) read(circulating, 'neutral', `还有${locked.toFixed(0)}%未流通`, `${locked.toFixed(0)}% not yet circulating`);
    else read(circulating, 'negative', `还有${locked.toFixed(0)}%未流通，解锁压力大`, `${locked.toFixed(0)}% locked, unlock pressure`);
  }

  const max = row('max-supply', compactNumber(maxSupply, locale), { unit: maxSupply === null ? '' : symbol });
  if ((maxSupply !== null && maxSupply <= 0) || exceedsCap) read(max, 'neutral', '供应量数据异常', 'Invalid supply data');
  else if (maxSupply !== null && totalSupply !== null && totalSupply > 0) {
    const remaining = (maxSupply - totalSupply) / maxSupply * 100;
    if (remaining <= 0.05) read(max, 'positive', '封顶，不再增发', 'Capped, no new issuance');
    else if (remaining < 10) read(max, 'positive', `仅剩${remaining.toFixed(1)}%待发行，通胀低`, `${remaining.toFixed(1)}% left to issue`);
    else read(max, 'negative', `还有${remaining.toFixed(0)}%待发行，有增发压力`, `${remaining.toFixed(0)}% left to issue`);
  } else if (infinite) read(max, 'negative', '无上限，长期通胀', 'No cap, long-term inflation');

  const holderRow = row(holder.id, compactNumber(holder.number, locale), { group: true, unit: holder.id === 'treasury' ? symbol : '' });
  if (holder.id === 'treasury') read(holderRow, 'positive', '机构金库持仓，筹码锁定', 'Held by corporate treasuries');
  else {
    const share = topHolderShare(detail);
    if (share !== null && share > 20) read(holderRow, 'negative', `最大地址占${share.toFixed(0)}%，筹码集中`, `Top address ${share.toFixed(0)}%, concentrated`);
    else if (share !== null && share < 5) read(holderRow, 'positive', `最大地址占${share.toFixed(1)}%，筹码分散`, `Top address ${share.toFixed(1)}%, dispersed`);
    else if (share !== null) read(holderRow, 'neutral', `最大地址占${share.toFixed(0)}%`, `Top address holds ${share.toFixed(0)}%`);
  }

  const profileRow = row('profile', profile === null ? '--' : `${profile.toFixed(0)}%`);
  if (profile !== null) {
    if (profile >= 80) read(profileRow, 'neutral', '披露较完整', 'Well disclosed');
    else if (profile >= 50) read(profileRow, 'neutral', '披露一般', 'Partly disclosed');
    else read(profileRow, 'negative', '透明度差', 'Poor transparency');
  }

  return [
    priceRow, capRow, fdv, unlocked, volume, turnoverRow, liquidityRow, total, circulating, max, holderRow, profileRow,
  ];
}

/** Net lean across rows: three more bullish than bearish readings (or vice versa) sets a stance. */
export function summarizeCmcStance(rows, locale) {
  const bulls = rows.filter(row => row.tone === 'positive').length;
  const bears = rows.filter(row => row.tone === 'negative').length;
  const tone = bulls - bears >= 3 ? 'positive' : bears - bulls >= 3 ? 'negative' : 'neutral';
  const label = { positive: ['偏多', 'Bullish'], negative: ['偏空', 'Bearish'], neutral: ['中性', 'Neutral'] }[tone];
  return {
    tone,
    label: formatLocalizedText(localizedText(label[0], label[1]), locale),
    detail: formatLocalizedText(localizedText(`多${bulls} / 空${bears}`, `${bulls} bull / ${bears} bear`), locale),
  };
}
