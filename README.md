# Tampermonkey Scripts

<p align="center">
  <img src="assets/logo.png" alt="Tampermonkey Scripts logo" width="180" />
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> | English
</p>

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscripts-00485b)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-f1e05a)
![Binance](https://img.shields.io/badge/Binance-Futures%20tools-f0b90b)
![Tests](https://img.shields.io/badge/Tests-node%20--test-111133)
![License](https://img.shields.io/badge/License-MIT-green)

A collection of browser userscripts for real daily workflows: Binance Futures helpers, market data panels, valuation overlays, page automation, and m3u8 media workflows.

This repository is the source of truth and distribution point for the scripts. Generated install files live under `scripts/*.user.js`, while migrated scripts keep their editable source under `src/`.

## Who It Is For

- Users who manage browser scripts with Tampermonkey.
- Traders who want lightweight Binance Futures page helpers and data panels.
- Users who want repeatable browser automation without installing a full extension.
- Developers who prefer readable, non-minified userscripts that can be audited and modified.

## Safety Notes

- Scripts are readable and intentionally not minified.
- Binance-related scripts do not store API keys and do not request withdrawal permissions.
- Order-entry helpers do not replace Binance's own final confirmations or platform risk controls.
- Validate behavior with small size and non-critical positions before using trading-page helpers.
- Confirm `@updateURL` and `@downloadURL` point to this repository's raw install URLs before installing.

## Install

| Script | Target | Description | Source of truth | Install |
| --- | --- | --- | --- | --- |
| Binance orderbook one-click order entry | Binance Futures | Click an orderbook price, infer the current open/close tab, fill quantity, and submit an order with a multiplier panel | This repository | [Install][install-binance-orderbook-trade] |
| Binance Futures data panel | Binance Futures | Overlay open interest, long/short ratios, funding rate, basis, and directional signals | This repository | [Install][install-binance-trading-data] |
| Binance CoinMarketCap data panel | Binance Futures | Show CoinMarketCap valuation, supply, and liquidity data for the current symbol | This repository | [Install][install-binance-coinmarketcap-data] |
| Auto refresh | Any page | Refresh selected pages on a configurable schedule | This repository | [Install][install-auto-refresh] |
| CoinMarketCap valuation labels | CoinMarketCap | Label and highlight circulating market cap and FDV / total valuation in the Chinese UI | This repository | [Install][install-coinmarketcap-valuation-helper] |
| m3u8 downloader | Video pages | Enhanced m3u8 detection and export workflow for allowlisted video sites | This repository | [Install][install-m3u8] |

## Highlighted Scripts

### Binance orderbook one-click order entry

- Infers direction from the current open/close tab.
- Provides a quantity multiplier panel.
- Handles orderbook display precision, available quantity, current orders, and ladder order boundaries.
- Designed for manual traders who frequently inspect the orderbook and submit limit orders.

### Binance Futures data panel

- Aggregates open interest, account/position ratios, taker ratio, funding rate, and basis.
- Displays values and simple directional signals inside the trading page.
- Reduces context switching between Binance and external data pages.

### m3u8 downloader

- Detects and exports m3u8 media sources for allowlisted sites.
- Supports Brooks media indexing, retry flows, pause/resume state, and active runtime tracking.
- Keeps repeated media export work in a maintainable userscript workflow.

## Development

```bash
npm install
npm test
```

Build all migrated scripts:

```bash
npm run build:userscripts
```

Build Binance scripts only:

```bash
npm run build:binance-userscripts
```

## Maintenance Rules

1. Each script has exactly one source of truth.
2. `src/binance-orderbook-trade/`, `src/binance-trading-data/`, `src/binance-coinmarketcap-data/`, and `src/m3u8-downloader/` are source directories for the corresponding generated scripts.
3. Public install entry points remain generated files under `scripts/*.user.js`.
4. Do not copy script source into secondary repositories.
5. Bump `@version` when behavior changes.
6. Keep `@updateURL` and `@downloadURL` pointing to raw files in this repository.

## Documentation

- [Binance orderbook trade development](docs/binance-orderbook-trade-development.md)
- [Brooks media sync workflow](docs/brooks-media-sync-workflow.md)

## License

MIT. See [LICENSE](LICENSE).

[install-binance-orderbook-trade]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
[install-binance-trading-data]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
[install-binance-coinmarketcap-data]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
[install-auto-refresh]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
[install-coinmarketcap-valuation-helper]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
[install-m3u8]: https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/m3u8-downloader.user.js
