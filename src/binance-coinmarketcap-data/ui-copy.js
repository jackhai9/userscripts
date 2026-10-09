import {
  localizedText, formatLocalizedText, resolveUiLocaleFromPathname,
} from '../binance-orderbook-trade/contracts/panel-copy.js';

export { localizedText, formatLocalizedText, resolveUiLocaleFromPathname };

export const CMC_COPY = Object.freeze({
  title: localizedText('CMC 数据', 'CMC data'),
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
  refreshPeriod: localizedText('前台 30 秒 / 后台 5 分钟刷新', 'Refresh: 30s active / 5m in background'),
  changePeriod: localizedText('24小时', '24h'),
  unavailable: localizedText('暂无数据', 'Data unavailable'),
  comparisonUnavailable: localizedText('暂无可比数据', 'Comparison unavailable'),
  supplyInvalid: localizedText('供应量口径需核实', 'Supply needs verification'),
});

export const CMC_METRIC_COPY = Object.freeze({
  price: {
    label: localizedText('价格', 'Price'),
    note: localizedText('过去变动不预测后续方向', 'Past change does not predict direction'),
    explanation: localizedText(
      '价格与24小时涨跌幅由 CMC 提供。涨跌幅描述已经发生的变动，不能单独判断情绪或后续方向。',
      'CMC provides the price and its 24-hour change. The change describes a past move and does not establish sentiment or predict direction.',
    ),
  },
  'market-cap': {
    label: localizedText('流通市值', 'Market cap'),
    qualifier: localizedText('流通部分', 'Circulating supply'),
    interpretation: localizedText('需与同类项目比较', 'Needs peer comparison'),
    note: localizedText('规模不等于估值贵贱', 'Size alone does not show value'),
    explanation: localizedText(
      '流通市值是价格乘以流通供应量得到的名义估值；判断高估或低估需要同类项目与基本面参照。各字段可能来自不同更新时间。',
      'Circulating market cap is the nominal value of price multiplied by circulating supply. Valuation needs peer and fundamental comparisons. Fields may have different update times.',
    ),
  },
  fdv: {
    label: localizedText('总估值（FDV）', 'Total valuation'),
    qualifier: localizedText('供应估值', 'FDV'),
    note: localizedText('更大供应口径下的估值', 'Values a broader token supply'),
    explanation: localizedText(
      '展示 CMC 提供的 FDV；倍数为本次 FDV ÷ 流通市值。FDV 使用的供应口径需结合项目资料核实，最大供应量缺失时不能确认最终发行上限。',
      'The value is CMC-reported FDV; its multiple is this snapshot’s FDV divided by circulating market cap. Verify the supply basis against project disclosures. Missing max supply does not establish a final issuance cap.',
    ),
  },
  unlocked: {
    label: localizedText('已解锁市值', 'Unlocked market cap'),
    interpretation: localizedText('已解锁不等于已流通', 'Unlocked is not circulating'),
    unavailable: localizedText('暂无解锁数据', 'Unlock data unavailable'),
    note: localizedText('单项数值不说明解锁压力', 'Unlock pressure needs more context'),
    explanation: localizedText(
      '已解锁市值为价格乘以已解锁供应量。已解锁代币不一定进入公众流通，缺少解锁计划时不判断未来解锁压力。',
      'Unlocked market cap is price multiplied by unlocked supply. Unlocked tokens are not necessarily in public circulation; future unlock pressure requires the unlock schedule.',
    ),
  },
  volume: {
    label: localizedText('成交额', 'Volume'),
    qualifier: localizedText('24小时', '24h · USD value'),
    interpretation: localizedText('需与历史成交比较', 'Needs historical context'),
    note: localizedText('成交额不等于净流入', 'Trading value is not net inflow'),
    explanation: localizedText(
      '这里统计过去24小时的累计美元成交金额。同一批代币可以反复成交；缺少历史基准时不能断言放量或缩量。',
      'This is cumulative USD trading value over 24 hours. Tokens can trade repeatedly; identifying unusual volume requires a historical baseline.',
    ),
  },
  turnover: {
    label: localizedText('成交额 / 流通市值', 'Volume / market cap'),
    qualifier: localizedText('24小时', '24h · circulating cap'),
    note: localizedText('需结合历史基准', 'Needs a historical baseline'),
    explanation: localizedText(
      '展示 CMC turnover 字段乘以100后的百分比，口径为24小时成交额 / 流通市值；不假定同屏字段具有相同更新时间。50%及以上描述为“交投较活跃”，仅是描述阈值；是否异常仍需历史基准，不表示净流入或买盘更强。',
      'This is the CMC-reported turnover field multiplied by 100: 24h volume / circulating market cap. Displayed fields may have different update times. At least 50% is described as relatively active, a descriptive threshold only. Unusual activity requires a historical baseline and does not establish net inflow or buying pressure.',
    ),
  },
  liquidity: {
    label: localizedText('链上流动性 / 流通市值', 'DEX liquidity / cap'),
    qualifier: localizedText('DEX 流动性', 'Circulating cap'),
    interpretation: localizedText('仅反映 CMC 统计池', 'Limited to CMC-tracked pools'),
    unavailable: localizedText('暂无流动性数据', 'Liquidity data unavailable'),
    note: localizedText('不代表币安订单簿深度', 'Not Binance order-book depth'),
    explanation: localizedText(
      '展示 CMC liquidityMcapRatio 字段乘以100后的百分比。分子为 CMC 统计的相关 DEX 池流动性金额，分母为流通市值；不代表币安订单簿深度，缺失值也不等于零流动性。',
      'The value is CMC’s liquidityMcapRatio multiplied by 100. The numerator is liquidity in CMC-tracked DEX pools and the denominator is circulating market cap. This does not measure Binance order-book depth; missing data does not mean zero liquidity.',
    ),
  },
  'total-supply': {
    label: localizedText('总供应量', 'Total supply'),
    interpretation: localizedText('包含未流通部分', 'Includes non-circulating tokens'),
    note: localizedText('已发行量，扣除已销毁部分', 'Issued supply, net of burns'),
    explanation: localizedText(
      '总供应量是已发行、扣除已销毁部分后的数量。未流通部分可能包含团队、金库等持币，不能全部当作下一次解锁量。',
      'Total supply is issued supply net of burns. Non-circulating tokens can include team and treasury holdings; this is not the next unlock amount.',
    ),
  },
  'circulating-supply': {
    label: localizedText('流通供应量', 'Circulating supply'),
    note: localizedText('未流通部分不等于待解锁', 'The remainder is not all locked'),
    explanation: localizedText(
      '占比为本次流通供应量 ÷ 总供应量。流通与已解锁供应量的口径不同，未流通部分不能直接当作未来解锁压力；缺失或非正供应量不计算占比。',
      'The share is this snapshot’s circulating supply divided by total supply. Circulating and unlocked supply use different definitions, so the remainder is not automatically future unlock pressure. Missing or non-positive supplies do not produce a share.',
    ),
  },
  'max-supply': {
    label: localizedText('最大供应量', 'Max supply'),
    interpretation: localizedText('项目规则下的供应上限', 'Supply cap under project rules'),
    unavailable: localizedText('暂无上限数据', 'Supply cap unavailable'),
    note: localizedText('缺失不代表无限增发', 'Missing does not imply unlimited issuance'),
    explanation: localizedText(
      '最大供应量是按项目规则最终可能存在的数量上限。该字段缺失时，不据此推断供应是否无限。',
      'Max supply is the eventual upper bound defined by project rules. An unavailable field does not establish unlimited supply.',
    ),
  },
  holders: {
    label: localizedText('持币地址数', 'Holder addresses'),
    interpretation: localizedText('地址数不等于人数', 'Addresses are not people'),
    note: localizedText('一人可多址，交易所可代管', 'Multiple addresses and custodians'),
    explanation: localizedText(
      '这是 CMC 统计范围内的持币地址数。一个用户可以拥有多个地址，一个交易所托管地址也可能代表多个用户；地址数不衡量独立投资者人数。',
      'This is the holder address count within CMC coverage. A person can own multiple addresses, and an exchange custody address can represent multiple users. Address count does not measure unique investors.',
    ),
  },
  treasury: {
    label: localizedText('金库资产', 'Treasury holdings'),
    interpretation: localizedText('这是金库持仓数量', 'Treasury token holdings'),
    note: localizedText('不表示持币地址数', 'Not a holder address count'),
    explanation: localizedText(
      '该资产的 CMC 页面使用金库资产字段。这里保留 CMC 的金库持仓数量与代币单位，不能当作持币地址数或独立用户数。',
      'CMC uses its treasury-holdings field for this asset. The value retains the reported token quantity and unit; it is not a holder address count or a count of unique users.',
    ),
  },
  profile: {
    label: localizedText('资料披露评分', 'Profile score'),
    note: localizedText('衡量完整性与更新时效', 'Completeness and freshness'),
    explanation: localizedText(
      '评分衡量项目资料的完整程度和更新及时程度，不表示项目安全性或投资胜率。有效范围为0%至100%；缺失或超出范围时显示暂无数据。',
      'The score measures the completeness and freshness of project information, not project safety or investment success. Valid scores range from 0% to 100%; missing or out-of-range scores are unavailable.',
    ),
  },
});
