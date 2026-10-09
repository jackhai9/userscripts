const HISTORY_FIELDS = Object.freeze({
  topAccountRatio: 'longShortRatio',
  topPositionRatio: 'longShortRatio',
  globalAccountRatio: 'longShortRatio',
  takerRatio: 'buySellRatio',
  basis: 'basisRate',
  fundingRate: 'fundingRate',
});

function numeric(value, field) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || (typeof value === 'string' && value.trim() === '')) {
    throw new TypeError(`Missing numeric ${field}`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`Invalid numeric ${field}`);
  return result;
}

function timestamp(value, field) {
  const result = numeric(value, field);
  if (!Number.isSafeInteger(result) || result <= 0) throw new TypeError(`Invalid timestamp ${field}`);
  return result;
}

/** Both OI and Binance's CMC supply use the contract base unit, including 1000-token contracts. */
export function parseHistory(key, payload, symbol) {
  if (!Array.isArray(payload)) throw new TypeError(`${key} must be an array`);
  let previousTime = 0;
  return payload.map(row => {
    if (!row || typeof row !== 'object') throw new TypeError(`Invalid ${key} record`);
    if (row.symbol !== undefined && row.symbol !== symbol) throw new Error(`${key} symbol mismatch`);
    if (row.pair !== undefined && row.pair !== symbol) throw new Error(`${key} pair mismatch`);
    const time = timestamp(row[key === 'fundingRate' ? 'fundingTime' : 'timestamp'], key);
    if (time <= previousTime) throw new Error(`${key} history must have increasing timestamps`);
    previousTime = time;
    if (key === 'openInterest') {
      const value = numeric(row.sumOpenInterest, 'sumOpenInterest');
      if (value < 0) throw new RangeError('Open interest cannot be negative');
      const rawSupply = row.CMCCirculatingSupply;
      const supply = rawSupply === null || rawSupply === undefined || rawSupply === ''
        ? null : numeric(rawSupply, 'CMCCirculatingSupply');
      return { timestamp: time, value, supply };
    }
    const field = HISTORY_FIELDS[key];
    if (!field) throw new Error(`Unknown historical endpoint: ${key}`);
    const point = { timestamp: time, value: numeric(row[field], field) };
    if (key === 'takerRatio') {
      point.buy = numeric(row.buyVol, 'buyVol');
      point.sell = numeric(row.sellVol, 'sellVol');
      if (point.buy < 0 || point.sell < 0) throw new RangeError('Taker volume cannot be negative');
    }
    return point;
  });
}

export function parseCurrentFunding(payload, symbol) {
  if (!payload || Array.isArray(payload) || payload.symbol !== symbol) throw new Error('Current funding symbol mismatch');
  return {
    value: numeric(payload.lastFundingRate, 'lastFundingRate'),
    time: timestamp(payload.time, 'premiumIndex.time'),
    nextFundingTime: timestamp(payload.nextFundingTime, 'nextFundingTime'),
  };
}

/** An absent symbol is unknown: the adjusted-symbol endpoint does not promise an 8h default. */
export function parseFundingInterval(payload, symbol) {
  if (!Array.isArray(payload)) throw new TypeError('Funding information must be an array');
  const matches = payload.filter(row => row && row.symbol === symbol);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error('Funding interval symbol is ambiguous');
  const hours = numeric(matches[0].fundingIntervalHours, 'fundingIntervalHours');
  if (!Number.isInteger(hours) || hours <= 0) throw new RangeError('Invalid funding interval');
  return hours;
}

/** Fractional rates need more precision than ratios; genuine zero remains distinguishable. */
export function formatFundingPercent(value) {
  if (value === null) return '--';
  if (!Number.isFinite(value)) throw new TypeError('Invalid funding rate');
  const percent = value * 100;
  if (percent === 0) return '0%';
  const magnitude = Math.abs(percent);
  if (magnitude < 1e-12) return percent.toExponential(2) + '%';
  const decimals = Math.max(6, Math.min(14, 2 - Math.floor(Math.log10(magnitude))));
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, useGrouping: false }).format(percent) + '%';
}

function compactQuantity(value, locale) {
  const scales = locale === 'zh-CN'
    ? [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']]
    : [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const scale = scales.find(([base]) => Math.abs(value) >= base);
  const amount = scale ? value / scale[0] : value;
  const decimals = locale === 'zh-CN' ? 4 : 2;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, useGrouping: false }).format(amount) + (scale ? scale[1] : '');
}

export function formatMetricValue(id, value, locale) {
  if (value === null) return '--';
  if (!Number.isFinite(value)) throw new TypeError(`Invalid ${id} value`);
  if (id === 'funding') return formatFundingPercent(value);
  if (id === 'oi' || id === 'volume') return compactQuantity(value, locale);
  if (id === 'basis' || id === 'oi-supply') {
    return (id === 'basis' && value > 0 ? '+' : '') + (value * 100).toFixed(2) + '%';
  }
  return value.toFixed(2);
}

const INDICATORS = Object.freeze([
  ['oi', 'openInterest'],
  ['top-accounts', 'topAccountRatio'],
  ['top-positions', 'topPositionRatio'],
  ['global-accounts', 'globalAccountRatio'],
  ['taker', 'takerRatio'],
  ['basis', 'basis'],
  ['funding', 'fundingRate'],
  ['oi-supply', 'openInterest'],
]);

/** Preserve the existing directional rules; only settled funding participates in its vote. */
export function computeTradingSignals(data, cachedKeys, locale, symbol, endpointErrors = {}) {
  const unit = symbol.replace(/USDT$|USDC$/, '');
  const indicators = INDICATORS.map(([id, key]) => {
    const source = data[key] || [];
    const history = id === 'oi-supply'
      ? source.map(point => ({ timestamp: point.timestamp, value: point.supply > 0 ? point.value / point.supply : null }))
      : source;
    const value = history.length ? history.at(-1).value : null;
    let signal = 'neutral';
    let arrow = '';
    if (value !== null) {
      if (id === 'oi' && history.length > 6) {
        const previous = history.at(-7).value;
        signal = value > previous ? 'long' : value < previous ? 'short' : 'neutral';
        arrow = value > previous ? ' ▲' : value < previous ? ' ▼' : '';
      } else if (id === 'basis') {
        signal = value > 0 ? 'long' : value < 0 ? 'short' : 'neutral';
      } else if (id === 'funding') {
        signal = value < -0.0001 ? 'long' : value > 0.0001 ? 'short' : 'neutral';
      } else if (id !== 'oi' && id !== 'oi-supply') {
        signal = value > 1 ? 'long' : value < 1 ? 'short' : 'neutral';
      }
    }
    return {
      id, signal, value, history,
      display: formatMetricValue(id, value, locale) + arrow,
      unit: id === 'oi' || id === 'taker' ? unit : '',
      cached: cachedKeys.has(key), error: endpointErrors[key] || null,
      vote: id !== 'oi-supply' && value !== null,
    };
  });
  const voters = indicators.filter(indicator => indicator.vote && !indicator.cached);
  return {
    symbol, indicators,
    longCount: voters.filter(indicator => indicator.signal === 'long').length,
    shortCount: voters.filter(indicator => indicator.signal === 'short').length,
    total: voters.length,
  };
}
