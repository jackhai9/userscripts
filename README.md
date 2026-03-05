# Userscripts

统一分发入口，避免多仓库双维护。<br>
原则：每个脚本只有一个“源码真源仓库”，本仓库只做安装索引与少量通用脚本托管。

## 安装入口

| 脚本 | 说明 | 源码真源 | 安装链接 |
|---|---|---|---|
| 【自写】Binance Shift+单击一键平仓 | Shift+单击订单簿任意列后自动填量并按盘口方向点击“平多/平空” | `userscripts` 本仓库 | [`点击安装`][install-binance-close-long] |
| 【自写】每天定时自动刷新页面 | 仅在指定页面按设定时间自动刷新 | `userscripts` 本仓库 | [`点击安装`][install-auto-refresh] |
| 【改写】m3u8-downloader | m3u8 下载增强脚本 | `jackhai9/m3u8-downloader` | [`点击安装`][install-m3u8] |

## 维护规则（稳定版）

1. 同一脚本只允许一个真源仓库改代码。  
2. 非真源仓库只放安装链接，不复制脚本源码。  
3. 每次发布递增 `@version`，并保留 `@updateURL/@downloadURL` 指向真源 raw 地址。  
4. Tampermonkey 统一用安装链接重装，不在面板里手改代码。  

[install-binance-close-long]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-long.user.js
[install-auto-refresh]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
[install-m3u8]: https://raw.githubusercontent.com/jackhai9/m3u8-downloader/master/m3u8-downloader.user.js
