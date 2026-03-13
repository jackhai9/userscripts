# userscripts

## Scope

- 本仓库是真源仓库，脚本源码只放在 `scripts/*.user.js`。
- `README.md` 只维护安装入口、真源说明和发布约束，不承载开发细节。
- 非真源仓库不复制脚本源码，只放安装链接。

## Files

- `scripts/binance-orderbook-trade.user.js`
  Binance 订单簿双击下单，核心风险在 symbol 切换、交易规则读取、首单竞态。
- `scripts/binance-trading-data.user.js`
  Binance 合约交易数据面板，核心风险在 5 分钟调度、缓存回退、前后台切换。
- `scripts/auto_refresh.user.js`
  定时刷新页面，核心风险在 URL 匹配、时间计算、启停行为。
- `skills/userscript-review/SKILL.md`
  代码审查骨架。
- `skills/userscript-release/SKILL.md`
  发版骨架。

## Hard Rules

- 修改 `scripts/` 下任意 userscript，必须同步 bump 该文件头部 `@version`。
- 保留 `@updateURL` 和 `@downloadURL` 指向真源 raw 地址。
- 改 Binance API 相关逻辑时，只信官方文档和现网响应，不根据页面偶然行为猜语义。
- 涉及交易规则时，按当前 `symbol` 的确定性数据计算，不允许用旧 DOM 状态或无 symbol 语义的值去猜。
- 涉及定时器、重试、缓存、前后台切换时，优先保证时间语义闭合，再考虑 UI 表现。
- 不要把“缓存命中”“回退成功”“页面没报错”误判成“拿到了最新数据”。

## Validation

- 最低门槛：对改动过的 userscript 跑 `node --check <file>`。
- 如果改动触及 Binance 数据调度或下单规则，必须补手测结论；没测的路径要明确写出来。
- review 输出优先列 findings，再给 summary。

## Plan Gate

出现下列任一情况，先写 5 行计划再改代码：

- 改到定时器、重试、缓存、epoch、serverTime、visibility、symbol 切换
- 改到最小下单量、LOT_SIZE、MARKET_LOT_SIZE、MIN_NOTIONAL
- 改到 Binance API 参数、接口节奏、数据聚合口径

计划模板：

```md
Goal:
Files:
Risks:
Validation:
Out of scope:
```

纯文案、样式、小注释、版本号 bump 可以跳过。

## Manual Test Matrix

### `binance-orderbook-trade.user.js`

- 切换交易对后立即双击，确认不会沿用上一个 symbol 的最小量或 step。
- `LIMIT` 和 `MARKET` 都测一遍，确认规则来源正确。
- 开仓和平仓都测，确认倍率、方向、tab 状态一致。
- 规则未 ready 时，确认脚本拒绝下单而不是猜数量。
- 前后台切换后回到页面，确认面板还能恢复，且不会后台持续轮询。

### `binance-trading-data.user.js`

- 切换交易对时，确认旧 symbol 的结果不会串到新 symbol。
- 在 5 分钟边界附近打开页面，确认会进入当前周期补抓，而不是漏掉本周期。
- 隐藏标签页再回来，确认 timer 会停、恢复后会补抓。
- 模拟部分接口失败，确认缓存标记、footer 文案、复合信号计票都符合预期。
- 手动关闭面板后，确认前后台切换不会偷偷恢复轮询。

### `auto_refresh.user.js`

- URL 命中时会按目标时间刷新；URL 不命中时完全不工作。
- 手动刷新后，下一次目标时间仍正确。
- 前后台切换、窗口 focus 后，调度仍然正确。

## Done When

- 代码或文档已落盘。
- 改动过的 userscript 已 bump `@version`。
- 最低语法检查已完成，命令和结果已记录。
- 需要手测的路径已说明“已测/未测”。
