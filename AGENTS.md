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

## Binance UI Automation Notes

这些经验来自 `scripts/binance-orderbook-trade.user.js` 的真实调试，后续改 Binance 页面自动化时优先套用：

- 页面文字不是语义证据。币安 UI 里“全撤”等可点击控件可能只是 `div/span + image`，不是 `button`、`a` 或 `[role="button"]`。先用截图、accessibility tree 或现网 DOM 确认真实结构，再写选择器。
- 同名 tab 必须按业务区域收窄。不要全局找“当前委托”“Open Orders”；应定位包含“仓位 / 当前委托 / 历史委托 / 历史成交 / 资金流水”的账户订单 tab 组，再在该组或对应 pane 内操作。
- 破坏性动作只触发平台原生入口，不替用户做最终确认。脚本可以点击币安原生“全撤”以打开原生确认弹窗，但不得自动点击原生弹窗里的“确认”；不要叠加脚本自己的重复确认弹窗。
- “隐藏其他合约”要在当前委托面板内确认 `aria-checked`，不能拿仓位面板或旧 tab 里的同名 checkbox 当依据。
- 临时修改页面筛选状态时必须记录原始状态并恢复。比如撤本币挂单时，如果脚本为了限定当前币临时勾选“隐藏其他合约”，应在 Binance 原生确认弹窗关闭后恢复到用户原来的勾选状态；如果原本已勾选，则不要替用户取消。
- 阶梯挂单运行期间，启动类按钮必须禁用；只保留停止/撤单这类运行中控制入口，避免并发启动同一个全局 `ladderTask`。
- 订单簿 DOM 未渲染足够档位时，可以用当前订单簿显示分组的相邻价格差推导缺失档位价格；不要直接拿交易所 `tickSize` 当 UI 档距，因为用户选择的订单簿显示精度可能是 `tickSize` 的多倍。
- 热路径避免全页面扫描。轮询、observer、面板刷新和点击处理应优先在已知面板、tab group、订单簿容器内查找；全局扫描只用于低频动作，且要有明确候选范围。

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

若用户提供了覆盖 Plan Gate 触发条件的完整计划，视同已满足 Plan Gate，直接执行。

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
