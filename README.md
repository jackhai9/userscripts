# Tampermonkey脚本

常用的油猴脚本。<br>
统一分发入口，避免多仓库双维护。<br>
原则：每个脚本只有一个“源码真源仓库”。

## 安装入口

| 脚本 | 说明 | 源码真源 | 安装 |
|---|---|---|---|
| 【自写】Binance 订单簿双击下单 | 双击订单簿行，按当前开仓/平仓 tab 自动填数量并执行下单，内置数量倍率面板 | 本仓库 | [`点击安装`][install-binance-orderbook-trade] |
| 【自写】Binance 合约交易数据面板 | 在合约交易页面叠加浮动面板，定时拉取交易数据（持仓量、多空比、资金费率等）并显示当前值 + 多空信号 | 本仓库 | [`点击安装`][install-binance-trading-data] |
| 【自写】Binance CoinMarketCap 数据面板 | 在 Binance 合约页面显示当前币种的 CoinMarketCap 估值、供应量和流动性数据 | 本仓库 | [`点击安装`][install-binance-coinmarketcap-data] |
| 【自写】定时刷新指定页面 | 指定页面按设定时间自动刷新 | 本仓库 | [`点击安装`][install-auto-refresh] |
| 【自写】CoinMarketCap 估值口径命名 | 在中文币种页面左上角统计区标注并高亮流通市值和FDV/总估值 | 本仓库 | [`点击安装`][install-coinmarketcap-valuation-helper] |
| 【改写】m3u8-downloader | m3u8 下载增强脚本 | jackhai9/m3u8-downloader | [`点击安装`][install-m3u8] |

## 维护规则

1. 同一脚本只允许一个真源仓库改代码。  
2. 非真源仓库只放安装链接，不复制脚本源码。  
3. 每次发布递增 `@version`，并保留 `@updateURL/@downloadURL` 指向真源 raw 地址。  
4. Tampermonkey 统一用安装链接重装，不在面板里手改代码。  

[install-binance-orderbook-trade]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
[install-binance-trading-data]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
[install-binance-coinmarketcap-data]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
[install-auto-refresh]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
[install-coinmarketcap-valuation-helper]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
[install-m3u8]: https://raw.githubusercontent.com/jackhai9/m3u8-downloader/master/m3u8-downloader.user.js
