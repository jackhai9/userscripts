# Tampermonkey Scripts

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscripts-00485b)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-f1e05a)
![Binance](https://img.shields.io/badge/Binance-Futures%20tools-f0b90b)
![Tests](https://img.shields.io/badge/Tests-node%20--test-111133)

一组面向真实工作流的浏览器 userscripts，主要覆盖 Binance 合约交易辅助、链上/行情数据面板、页面定时刷新和 m3u8 媒体下载。

这个仓库是统一分发入口，目标是避免多仓库双维护：每个脚本只有一个“源码真源仓库”，公开安装入口统一指向 `scripts/*.user.js`。

## 适合谁

- 使用 Tampermonkey 管理浏览器脚本。
- 需要在 Binance 合约页面叠加交易辅助、行情数据或估值信息。
- 需要把重复页面操作、数据查看、媒体导出流程做成可维护脚本。
- 希望脚本保持可读、非压缩、非混淆，方便审计和二次修改。

## 安全说明

- 脚本源码公开可读，生成产物保留为非压缩文件。
- Binance 相关脚本不保存 API key，不请求提现权限，也不替代交易所自身确认流程。
- 下单辅助脚本只在 Binance futures 页面生效；使用前请先用小金额和非关键仓位验证行为。
- Tampermonkey 安装时请确认 `@updateURL` / `@downloadURL` 指向本仓库 raw 地址。

## 安装入口

| 脚本 | 适用场景 | 说明 | 源码真源 | 安装 |
|---|---|---|---|---|
| 【自写】Binance 订单簿单击下单 | Binance Futures | 单击订单簿价格，按当前开仓/平仓 tab 自动填数量并执行下单，内置数量倍率面板 | 本仓库 | [`点击安装`][install-binance-orderbook-trade] |
| 【自写】Binance 合约交易数据面板 | Binance Futures | 在合约交易页面叠加浮动面板，定时拉取交易数据（持仓量、多空比、资金费率等）并显示当前值 + 多空信号 | 本仓库 | [`点击安装`][install-binance-trading-data] |
| 【自写】Binance CoinMarketCap 数据面板 | Binance Futures | 在 Binance 合约页面显示当前币种的 CoinMarketCap 估值、供应量和流动性数据 | 本仓库 | [`点击安装`][install-binance-coinmarketcap-data] |
| 【自写】定时刷新指定页面 | Any page | 指定页面按设定时间自动刷新 | 本仓库 | [`点击安装`][install-auto-refresh] |
| 【自写】CoinMarketCap 估值口径命名 | CoinMarketCap | 在中文币种页面左上角统计区标注并高亮流通市值和 FDV / 总估值 | 本仓库 | [`点击安装`][install-coinmarketcap-valuation-helper] |
| 【改写】m3u8-downloader | Video pages | m3u8 下载增强脚本，仅在白名单视频站启用 | 本仓库 | [`点击安装`][install-m3u8] |

## 重点脚本

### Binance 订单簿单击下单

- 根据当前开仓/平仓 tab 自动识别操作方向。
- 支持数量倍率面板，减少重复输入。
- 处理订单簿价格精度、可用数量、当前委托和阶梯挂单相关边界。
- 适合高频查看盘口、需要快速提交限价单的手动交易场景。

### Binance 合约交易数据面板

- 聚合持仓量、多空比、资金费率、basis 等合约数据。
- 使用浮动面板展示当前值和多空信号。
- 适合在交易页面内快速判断市场结构，不需要频繁切换数据网站。

### m3u8-downloader

- 针对白名单视频站增强 m3u8 识别和导出。
- 支持 Brooks 媒体索引、失败重试、暂停/继续状态和 active runtime 计时。
- 适合把重复下载流程沉淀成可复用脚本。

## 本地开发

```bash
npm install
npm test
```

构建全部已迁移脚本：

```bash
npm run build:userscripts
```

只构建 Binance 脚本：

```bash
npm run build:binance-userscripts
```

## 维护规则

1. 同一脚本只允许一个真源仓库改代码。
2. `src/binance-orderbook-trade/`、`src/binance-trading-data/`、`src/binance-coinmarketcap-data/`、`src/m3u8-downloader/` 是对应脚本的开发真源。
3. 公开安装入口仍是生成后的 `scripts/*.user.js`；修改对应 `src/` 后运行 `npm run build:binance-userscripts` 或单脚本 build 命令。
4. 非真源仓库只放安装链接，不复制脚本源码。
5. 每次发布递增 `@version`，并保留 `@updateURL/@downloadURL` 指向真源 raw 地址。
6. Tampermonkey 统一用安装链接重装，不在面板里手改代码。

开发手册：

- [Binance orderbook trade development](docs/binance-orderbook-trade-development.md)
- [Brooks media sync workflow](docs/brooks-media-sync-workflow.md)

[install-binance-orderbook-trade]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
[install-binance-trading-data]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
[install-binance-coinmarketcap-data]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
[install-auto-refresh]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
[install-coinmarketcap-valuation-helper]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
[install-m3u8]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/m3u8-downloader.user.js
