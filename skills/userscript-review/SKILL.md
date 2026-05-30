---
name: userscript-review
version: 1.0.0
description: Review userscript changes for regressions and race conditions.
---

# userscript-review

Use this skill when reviewing code changes in this repository.

## Workflow

1. Read `AGENTS.md` first.
2. Identify changed files and focus on `scripts/*.user.js`.
3. Run `node --check` on each changed userscript.
4. Review for functional issues before style concerns.
5. Output findings ordered by severity, with file references.

## Review Priorities

### `scripts/binance-orderbook-trade.user.js`

Check these first:

- symbol 切换后是否可能读取旧规则、旧 DOM、旧 tab 状态
- `LIMIT` / `MARKET` 是否使用了各自正确的规则
- `LOT_SIZE`、`MARKET_LOT_SIZE`、`MIN_NOTIONAL` 是否按当前 symbol 闭合
- 规则未 ready 时是否拒绝下单，而不是 fallback 去猜
- 前后台切换、面板渲染、observer、兜底轮询是否引入竞态
- Binance UI 操作是否按业务区域收窄，而不是全局按文本匹配同名 tab 或按钮
- `当前委托`、`隐藏其他合约`、`全撤` 等控件是否用现网 DOM / accessibility tree 验证过语义；不要假设可见文字一定在 `button`
- 撤单类破坏性动作是否只打开 Binance 原生确认弹窗，不自动点击原生确认
- 阶梯挂单运行中是否禁用启动类按钮，避免并行启动多个全局 `ladderTask`
- 订单簿 DOM 深度不足时，价格推导是否基于当前显示精度的相邻价格差，而不是直接用交易所 `tickSize`
- 高频路径是否避免全页面 DOM 扫描；全局扫描只能用于低频动作并保持候选范围明确

### `scripts/binance-trading-data.user.js`

Check these first:

- 5 分钟周期边界、重试节奏、serverTime 对齐是否正确
- hidden tab、面板关闭、恢复前台时 timer 是否正确停启
- stale request 是否会污染共享状态
- 缓存命中是否会被误当成新数据
- 复合信号是否错误统计 cached / neutral / non-voting 指标

### `scripts/auto_refresh.user.js`

Check these first:

- URL 匹配逻辑是否过宽或过窄
- 时间计算是否会因为手动刷新、focus、visibility 产生重复刷新或漏刷新

## Output Format

- 先写 `Findings`
- 再写 `Notes`
- 如果没有问题，明确写“没有新的功能性问题”

不要把总结放在 findings 前面。
