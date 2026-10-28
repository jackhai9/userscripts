import {
  localizedText,
  formatLocalizedText,
  resolveUiLocaleFromPathname,
} from '../shared/ui-locale.js';

export { localizedText, formatLocalizedText, resolveUiLocaleFromPathname };

export const CMC_COPY = Object.freeze({
  title: localizedText('CMC 数据', 'CMC'),
  metric: localizedText('指标', 'Metric'),
  value: localizedText('数值', 'Value'),
  interpretation: localizedText('解读', 'Interpretation'),
  refresh: localizedText('刷新', 'Refresh'),
  collapse: localizedText('折叠', 'Collapse'),
  expand: localizedText('展开', 'Expand'),
  close: localizedText('关闭', 'Close'),
  details: localizedText('查看解读依据', 'View interpretation basis'),
  loading: localizedText('正在读取 CoinMarketCap...', 'Loading CoinMarketCap...'),
  failed: localizedText('读取失败', 'Unable to load data'),
  unidentifiedContract: localizedText('无法识别当前合约', 'Unable to identify the current contract'),
  source: localizedText('来源：CoinMarketCap', 'Source: CoinMarketCap'),
  api: localizedText('CMC data-api', 'CMC data-api'),
  page: localizedText('CMC 页面快照', 'CMC page snapshot'),
  fetched: localizedText('拉取', 'Fetched'),
  dataTime: localizedText('CMC 数据时间', 'CMC data time'),
  fetchedTime: localizedText('本次拉取时间', 'Fetch time'),
  changePeriod: localizedText('24h', '24h'),
});

export const CMC_METRIC_COPY = Object.freeze({
  price: {
    label: localizedText('价格', 'Price'),
    note: localizedText('7日涨跌 + 30日区间位置', '7d move + 30d range position'),
    explanation: localizedText(
      '按30日最高、最低价算出当前所处位置。处在区间下部20%且7日下跌记为偏空，处在上部20%且7日上涨记为偏多，其余为中性。缺少7日或30日数据时只看24小时涨跌。',
      'Position is measured inside the 30-day high/low range. Bottom 20% with a 7-day decline is bearish, top 20% with a 7-day gain is bullish, otherwise neutral. Without 7-day or 30-day data, only the 24h change is used.',
    ),
  },
  'market-cap': {
    label: localizedText('流通市值', 'Mkt cap'),
    note: localizedText('CMC 市值排名', 'CMC rank'),
    explanation: localizedText(
      '价格 × 流通供应量。排名前10为大盘、前100为中盘、其余为小盘（小盘波动大，记偏空）；前3名且市占率达50%记偏多。',
      'Price × circulating supply. Top 10 is large cap, top 100 mid cap, the rest small cap (volatile, bearish). A top-3 asset with at least 50% dominance is bullish.',
    ),
  },
  fdv: {
    label: localizedText('FDV', 'FDV'),
    note: localizedText('FDV ÷ 流通市值', 'FDV ÷ market cap'),
    explanation: localizedText(
      '倍数 = FDV ÷ 流通市值，代表未流通筹码的稀释空间。低于1.2倍偏多，1.2–2倍中性，2倍以上偏空。',
      'Multiple = FDV ÷ market cap, the dilution still to come. Below 1.2× is bullish, 1.2–2× neutral, 2× and above bearish.',
    ),
  },
  unlocked: {
    label: localizedText('已解锁市值', 'Unlocked'),
    note: localizedText('已解锁 ÷ 流通市值', 'Unlocked ÷ market cap'),
    explanation: localizedText(
      '价格 × 已解锁供应量。已解锁却未流通的筹码随时可能卖出；已解锁市值超过流通市值20%以上记偏空。',
      'Price × unlocked supply. Unlocked but non-circulating tokens can be sold at any time; more than 20% above market cap is bearish.',
    ),
  },
  volume: {
    label: localizedText('24h 成交额', 'Volume'),
    note: localizedText('对比7日日均成交额', 'Compared with the 7-day daily average'),
    explanation: localizedText(
      '24小时成交额对比 CMC 7日成交额的日均值。高出30%以上为放量：价格同时下跌记偏空，否则偏多；低30%以上为缩量。',
      '24h volume against the daily average of CMC 7-day volume. 30% or more above is a surge: bearish if price fell, otherwise bullish. 30% or more below is cooling.',
    ),
  },
  turnover: {
    label: localizedText('换手率', 'Turnover'),
    note: localizedText('24h 成交额 ÷ 流通市值', '24h volume ÷ market cap'),
    explanation: localizedText(
      'CMC turnover 字段 × 100。低于3%筹码稳定，3–15%一般，15–50%活跃（偏多），50%以上为投机过热（偏空）。',
      'CMC turnover × 100. Below 3% is stable, 3–15% normal, 15–50% active (bullish), 50% and above overheated speculation (bearish).',
    ),
  },
  liquidity: {
    label: localizedText('链上流动性', 'DEX liq.'),
    note: localizedText('DEX 池子 ÷ 流通市值', 'DEX pools ÷ market cap'),
    explanation: localizedText(
      'CMC liquidityMcapRatio × 100，只统计 CMC 收录的 DEX 池子，与币安订单簿无关。低于1%容易被砸盘（偏空），1–5%偏薄，5%以上充足（偏多）。',
      'CMC liquidityMcapRatio × 100, covering CMC-tracked DEX pools only, unrelated to the Binance order book. Below 1% is easy to dump (bearish), 1–5% thin, 5% and above deep (bullish).',
    ),
  },
  'total-supply': {
    label: localizedText('总供应量', 'Total'),
    note: localizedText('总供应量 ÷ 最大供应量', 'Total ÷ max supply'),
    explanation: localizedText(
      '已发行并扣除销毁后的数量，与最大供应量比较得出已铸造比例；没有上限的代币记偏空。',
      'Issued supply net of burns, compared with max supply for the minted share. Uncapped tokens are bearish.',
    ),
  },
  'circulating-supply': {
    label: localizedText('流通供应量', 'Circ.'),
    note: localizedText('流通 ÷ 总供应量', 'Circulating ÷ total'),
    explanation: localizedText(
      '流通供应量 ÷ 总供应量。95%以上基本无解锁抛压（偏多），70–95%中性，低于70%解锁压力大（偏空）。',
      'Circulating ÷ total supply. 95% and above means little unlock pressure (bullish), 70–95% neutral, below 70% heavy unlock pressure (bearish).',
    ),
  },
  'max-supply': {
    label: localizedText('最大供应量', 'Max'),
    note: localizedText('剩余可发行比例', 'Share left to issue'),
    explanation: localizedText(
      '项目规则下的供应上限，与总供应量比较得出剩余可发行比例。剩余不足10%偏多，10%以上或无上限偏空。',
      'The supply cap under project rules, compared with total supply. Less than 10% left to issue is bullish; 10% or more, or no cap, is bearish.',
    ),
  },
  holders: {
    label: localizedText('持币地址', 'Holders'),
    note: localizedText('最大持币地址占比', 'Largest holder share'),
    explanation: localizedText(
      'CMC 统计的持币地址数；解读看 CMC 持币榜第一名的占比，交易所和销毁地址未剔除。超过20%筹码集中（偏空），低于5%分散（偏多）。',
      'CMC holder address count. The reading uses the largest address on the CMC holder list, without excluding exchange or burn addresses. Above 20% is concentrated (bearish), below 5% dispersed (bullish).',
    ),
  },
  treasury: {
    label: localizedText('金库持仓', 'Treasuries'),
    note: localizedText('上市公司与机构金库', 'Corporate and institutional treasuries'),
    explanation: localizedText(
      'CMC 统计的上市公司和机构金库持有数量，这部分筹码长期锁定，记偏多。',
      'Tokens held by corporate and institutional treasuries according to CMC. These holdings are locked long term, which is bullish.',
    ),
  },
  profile: {
    label: localizedText('资料评分', 'Profile'),
    note: localizedText('资料完整度与更新时效', 'Completeness and freshness'),
    explanation: localizedText(
      'CMC 资料披露评分。80%以上较完整，50–80%一般，低于50%透明度差（偏空）。',
      'CMC profile disclosure score. 80% and above is well disclosed, 50–80% partial, below 50% poor transparency (bearish).',
    ),
  },
});
