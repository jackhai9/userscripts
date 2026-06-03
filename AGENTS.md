# userscripts

## Scope

- 本仓库是真源仓库。
- `src/binance-orderbook-trade/` 是 `scripts/binance-orderbook-trade.user.js` 的开发真源。
- `src/binance-trading-data/` 是 `scripts/binance-trading-data.user.js` 的开发真源。
- `src/binance-coinmarketcap-data/` 是 `scripts/binance-coinmarketcap-data.user.js` 的开发真源。
- `scripts/binance-orderbook-trade.user.js`、`scripts/binance-trading-data.user.js`、`scripts/binance-coinmarketcap-data.user.js` 是生成后的单文件安装/更新入口，必须保持可读、非压缩、非混淆。
- 其它 userscript 在迁移前仍以 `scripts/*.user.js` 为真源。
- `README.md` 只维护安装入口、真源说明和发布约束，不承载开发细节。
- 非真源仓库不复制脚本源码，只放安装链接。

## Files

- `scripts/binance-orderbook-trade.user.js`
  Binance 订单簿双击下单，核心风险在 symbol 切换、交易规则读取、首单竞态。
- `scripts/binance-trading-data.user.js`
  Binance 合约交易数据面板，核心风险在 5 分钟调度、缓存回退、前后台切换。
- `scripts/binance-coinmarketcap-data.user.js`
  Binance CoinMarketCap 数据面板，核心风险在 symbol 解析、CMC 资产映射、跨页误注入。
- `scripts/auto_refresh.user.js`
  定时刷新页面，核心风险在 URL 匹配、时间计算、启停行为。
- `docs/binance-orderbook-trade-development.md`
  Binance 订单簿脚本开发手册，记录源码/产物关系、模块边界、测试、构建、发版和手测矩阵。
- `skills/userscript-review/SKILL.md`
  代码审查骨架。
- `skills/userscript-release/SKILL.md`
  发版骨架。

## Hard Rules

- 修改 `src/binance-orderbook-trade/**` 后必须运行 `npm run build:binance-orderbook-trade` 生成 `scripts/binance-orderbook-trade.user.js`。
- 修改 `src/binance-trading-data/**`、`src/binance-coinmarketcap-data/**` 或 `src/shared/**` 后必须运行 `npm run build:binance-userscripts` 或对应单脚本 build 命令生成 `scripts/*.user.js`。
- 修改已迁移的 `src/binance-*` 或 `src/shared/**` 且改变行为时，必须同步 bump 对应生成 userscript 头部 `@version`。
- 修改尚未迁移的 `scripts/` 下任意 userscript，必须同步 bump 该文件头部 `@version`。
- 保留 `@updateURL` 和 `@downloadURL` 指向真源 raw 地址。
- 发布到 `main` 必须通过 GitHub PR 合并；不要在本地 merge 到 `main` 后直接 push `main`。
- 如果用户要求“发布”“上线”或“合并到 main”，默认流程是 push feature branch、创建 PR、等待检查通过，然后用 `gh pr merge` 合并。
- 改 Binance API 相关逻辑时，只信官方文档和现网响应，不根据页面偶然行为猜语义。
- 改 Binance 页面 DOM、事件、点击、下拉、tab、弹窗、按钮状态、输入框状态或可见性判断时，必须先核实现网 DOM/accessibility tree/截图和 Binance 当前前端 bundle/source 中的真实结构与触发路径；不得只凭页面文字、旧记忆、历史选择器或推测改代码。
- 对可在页面上下文里验证的 Binance UI 操作，必须优先用 Chrome DevTools Console/Snippets 或等价调试入口在现网页面先调试通过最小 JS：确认选择器命中、事件触发、状态变化和失败形态；再把调通后的逻辑原样迁回 userscript。不能先在脚本里凭猜测改，再让用户线上试错。
- 上述 Binance UI 自动化改动的交付说明必须列出依据：看过的现网 DOM/状态、相关 Binance source/chunk/selector/event 证据、已验证的点击或状态变化，以及未实测路径。
- 涉及交易规则时，按当前 `symbol` 的确定性数据计算，不允许用旧 DOM 状态或无 symbol 语义的值去猜。
- 涉及定时器、重试、缓存、前后台切换时，优先保证时间语义闭合，再考虑 UI 表现。
- 不要把“缓存命中”“回退成功”“页面没报错”误判成“拿到了最新数据”。
- Codex Chrome automation 的 `evaluate` 环境可能比真实 DevTools Console/页面脚本受限；如果 `fetch`、`XMLHttpRequest`、`DOMParser`、`document.createElement`、`window.addEventListener` 等 API 在 automation 中不可用，不要直接判定目标页面不可运行。先用 live DOM/截图/console/page assets 取证，再用真实 DevTools、Tampermonkey、临时 helper extension 或带 referer 的命令行请求验证完整路径。

## Validation

- `binance-orderbook-trade` 最低门槛：`npm test`、`npm run build:binance-orderbook-trade`、`npm run check:binance-orderbook-trade`。
- 已迁移 Binance userscript 共享逻辑最低门槛：`npm test`、`npm run build:binance-userscripts`、`npm run check:binance-userscripts`。
- 尚未迁移的 userscript 最低门槛：对改动过的 userscript 跑 `node --check <file>`。
- 如果改动触及 Binance 数据调度或下单规则，必须补手测结论；没测的路径要明确写出来。
- review 输出优先列 findings，再给 summary。

## Binance UI Automation Notes

这些经验来自 `scripts/binance-orderbook-trade.user.js` 的真实调试，后续改 Binance 页面自动化时优先套用：

- DOM、事件、点击和状态逻辑必须先做现网证据收集。改选择器、点击目标、下拉打开/关闭逻辑、tab 定位、弹窗确认、按钮禁用、输入框读写或可见性判断前，先检查当前 Binance 页面 DOM、accessibility tree/截图，以及 Binance 前端 bundle/source 里对应组件的 class、事件触发和渲染路径；把证据写进最终说明或 PR。没有证据时只能把结论标为未验证，不能当作事实修改上线。
- 能用 Chrome DevTools Console/Snippets 验证的页面 JS，不要跳过这一步。先在现网页面跑一个最小片段，证明点击、输入、下拉选择或状态读取真的生效；记录可观察结果，例如 DOM 变化、按钮状态、toast、面板文案或订单行变化；再把同一选择器、事件路径和状态校验写回脚本。
- 页面文字不是语义证据。币安 UI 里“全撤”等可点击控件可能只是 `div/span + image`，不是 `button`、`a` 或 `[role="button"]`。先用截图、accessibility tree 或现网 DOM 确认真实结构，再写选择器。
- Binance 的 SVG 操作图标可能有 `getClientRects()` 尺寸但没有 `offsetWidth/offsetHeight`；判断可见性时不要只依赖 offset 尺寸，否则“撤销挂单”等 SVG 会被误判为不可见。
- Binance 的 SVG 操作图标也可能没有可点击祖先，且 `SVGElement` 本身没有 `.click()`。命中 SVG 后不要假设 `target.click()` 可用；要么找到真实可点击祖先，要么用冒泡的 `MouseEvent("click")` 触发，并用现网 DOM/状态验证这条路径。
- 同名 tab 必须按业务区域收窄。不要全局找“当前委托”“Open Orders”；应定位包含“仓位 / 当前委托 / 历史委托 / 历史成交 / 资金流水”的账户订单 tab 组，再在该组或对应 pane 内操作。
- 不要单独信任 Binance tab 的 `aria-controls` / pane `id`。页面里多个 tab 系统可能复用 `bn-tab-pane-*`，`document.getElementById()` 会拿到右侧开仓/平仓表单 pane，而不是底部当前委托 pane。命中 pane 后还必须确认里面有当前委托特征控件，例如“隐藏其他合约”或“全撤”。
- 切换 Binance tab、子 tab 或勾选“隐藏其他合约”后，必须重新解析当前 active pane / scope。不要继续拿切换前缓存的 `openOrdersScope`、pane、row、checkbox 或 button 去等待/读取/点击；Binance 会重渲染同名区域，旧 root 可能还连着 DOM 但已经不是当前可见数据源。
- 破坏性动作只触发平台原生入口，不替用户做最终确认。脚本可以点击币安原生“全撤”以打开原生确认弹窗，但不得自动点击原生弹窗里的“确认”；不要叠加脚本自己的重复确认弹窗。
- 不要用“当前委托区域是否已经渲染”来提前决定撤单按钮是否可用。撤单入口可以保持可点，但必须在点击后主动切到当前委托并实时校验当前 symbol 是否有挂单；没有则提示并停止。
- “隐藏其他合约”要在当前委托面板内确认勾选状态，不能拿仓位面板或旧 tab 里的同名 checkbox 当依据。不要只读 `aria-checked`；币安不同场景可能使用 native `checked` 或内部 input 状态。状态读不准时，应从当前委托可见行里的合约代码确认是否只剩当前 symbol。
- 临时修改页面状态时必须记录原始状态并恢复。比如撤本币挂单时，如果脚本主动切到“当前委托”或临时勾选“隐藏其他合约”，应在 Binance 原生确认弹窗关闭或流程提前停止后恢复到用户原来的 tab / 勾选状态；如果原本已勾选，则不要替用户取消。
- 阶梯自动替换只能撤当前 symbol、同方向、基础单行里的可见挂单：开多只撤开多，开空只撤开空，平多只撤平多，平空只撤平空。不能用“全撤”实现阶梯替换，不能触碰止盈止损/条件单/保护单；撤完后必须重新构建阶梯计划，用真实可用数量验证是否已经解决。
- 线上手测前先确认真实交易对、脚本数量倍率、订单簿价格显示精度和远价挂单范围。用户说“缩放比例调成 1 / 最大”指的是订单簿价格显示精度下拉里的最大档（例如 `1`），不是脚本数量倍率；先把订单簿显示精度调到最大档，让测试挂单价格离现价更远。不要把另一个交易对的页面、订单或状态当成本轮验证对象。
- Tampermonkey raw 安装页可能只停在 `script_installation.php` 中转页，或 Chrome 地址栏显示 raw URL 但页面仍是 Binance。不要把“打开了安装 URL”当成“脚本已更新”；必须用 Tampermonkey 页面显示版本、脚本面板实际行为、或现网 DOM 状态来确认新版本生效。
- 线上交易页自动化如果连续卡在点击/导航上，优先切换到 DOM 状态读取、accessibility tree 和脚本状态文案验证；不要为了“点到页面”反复盲点。核心业务验证应看状态迁移，例如旧错误消失、撤单 toast 出现、`当前委托` 行数变化、阶梯任务完成。
- 订单簿精度下拉不是普通 select，也不能假设 `element.click()` 会在关闭状态下稳定渲染选项。现网验证过的路径是对 `#futuresOrderbook .orderbook-tickSize` / `.tick-content` 发送 `pointerdown`、`mousedown`、`pointerup`、`mouseup`、`click`，再等待 `.ob-ticksize-item` 可见后点击目标档位；“已打开下拉时能点中选项”不能证明“关闭状态下应用按钮可用”。
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
