const freezeCopy = (copy) => Object.freeze(copy);

export const PANEL_COPY = Object.freeze({
  section: freezeCopy({
    singleOrder: '单击下单',
    ladderMaker: '阶梯下单 · Maker',
  }),
  field: freezeCopy({
    clickOrderbook: '单击订单簿时',
    minimumOrderQuantity: '最小下单量的',
    minimumOpenQuantity: '最小开仓量的',
    minimumCloseQuantity: '最小平仓量的',
    ratio: '比例',
    orderCount: '笔数',
    interval: '间距',
    pricePrecision: '精度',
  }),
  action: freezeCopy({
    openLong: '阶梯开多',
    openShort: '阶梯开空',
    closeLong: '阶梯平多',
    closeShort: '阶梯平空',
    cancel: '撤单',
    cancelRunning: '撤单处理中',
    noOrders: '无挂单',
    stopLadderByAction: freezeCopy({
      OPEN_LONG: '停止开多',
      OPEN_SHORT: '停止开空',
      CLOSE_LONG: '停止平多',
      CLOSE_SHORT: '停止平空',
    }),
    stopContinuousLadderByAction: freezeCopy({
      CLOSE_LONG: '停止连续平多',
      CLOSE_SHORT: '停止连续平空',
    }),
  }),
  status: freezeCopy({
    precisionUpdated: '精度推荐已更新',
    precisionInsufficient: '近期价格变化不足，请稍后重试',
  }),
  tooltip: freezeCopy({
    singleOrder: '单击订单簿中的某个价格，按当前方向和数量设置提交一笔订单。',
    ladderMaker: '根据当前比例、笔数、间距和价格精度设置，依次提交只做 Maker 的阶梯订单。',
    ratio: '本次阶梯下单使用可开/可平数量的百分比。',
    orderCount: '计划拆分成多少笔阶梯订单。',
    interval: '相邻订单跨越多少个订单簿价格级别。',
    pricePrecision: '与订单簿中的价格精度联动。黄点表示推荐值。比例、笔数、间距会随所选精度恢复对应设置。',
  }),
});

export function formatPrecisionRefreshTooltip(tradeCount) {
  const count = Number(tradeCount);
  if (!Number.isInteger(count) || count <= 1) {
    throw new Error(`Invalid precision trade count: ${tradeCount}`);
  }
  return `优先根据最新 ${count} 条成交价；价格变化不足时自动扩大范围，重新计算推荐精度。`;
}
