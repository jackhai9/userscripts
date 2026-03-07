# Tampermonkey脚本

常用的油猴脚本。<br>
统一分发入口，避免多仓库双维护。<br>
原则：每个脚本只有一个“源码真源仓库”。

## 安装入口

| 脚本 | 说明 | 源码真源 | 安装 |
|---|---|---|---|
| 【自写】Binance 双击平仓 | 双击订单簿行自动填量并平仓，内置数量倍率面板 | 本仓库 | [`点击安装`][install-binance-close-long] |
| 【自写】定时刷新指定页面 | 指定页面按设定时间自动刷新 | 本仓库 | [`点击安装`][install-auto-refresh] |
| 【改写】m3u8-downloader | m3u8 下载增强脚本 | jackhai9/m3u8-downloader | [`点击安装`][install-m3u8] |

## 维护规则

1. 同一脚本只允许一个真源仓库改代码。  
2. 非真源仓库只放安装链接，不复制脚本源码。  
3. 每次发布递增 `@version`，并保留 `@updateURL/@downloadURL` 指向真源 raw 地址。  
4. Tampermonkey 统一用安装链接重装，不在面板里手改代码。  

[install-binance-close-long]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-long.user.js
[install-auto-refresh]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
[install-m3u8]: https://raw.githubusercontent.com/jackhai9/m3u8-downloader/master/m3u8-downloader.user.js
