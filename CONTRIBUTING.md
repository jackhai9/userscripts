# Contributing

Thanks for your interest in improving these Tampermonkey scripts.

This repository contains browser automation and trading-page helper scripts. Please keep changes small, auditable, and clear about which generated userscript file is affected.

## Before You Start

- Do not submit API keys, cookies, session data, private account identifiers, screenshots with balances, or private website content.
- Open an issue first for large behavior changes or changes that affect Binance order placement.
- Keep each PR focused on one script or one shared helper.
- Do not edit generated files directly when a script has a `src/` source of truth.

## Source of Truth

- `src/binance-orderbook-trade/` generates `scripts/binance-orderbook-trade.user.js`.
- `src/binance-trading-data/` generates `scripts/binance-trading-data.user.js`.
- `src/binance-coinmarketcap-data/` generates `scripts/binance-coinmarketcap-data.user.js`.
- `src/m3u8-downloader/` generates `scripts/m3u8-downloader.user.js`.
- Scripts that have not migrated to `src/` still live directly under `scripts/`.

## Development Setup

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

## Pull Request Checklist

- Explain which script or shared helper changed.
- List the build and test commands you ran.
- Bump the affected userscript `@version` when behavior changes.
- Keep `@updateURL` and `@downloadURL` pointing at this repository's raw install URLs.
- Update README or docs when install steps, behavior, or safety assumptions change.

## Binance Script Safety

PRs that affect Binance UI automation should include:

- what live DOM or page state the change relies on;
- how symbol switching, tabs, current orders, and confirmation dialogs were considered;
- whether the change can place, cancel, or modify orders;
- the manual or automated verification performed.

Scripts must not bypass Binance's own final confirmations or hide meaningful trading risk from the user.

## Bug Reports

Useful reports include:

- browser and Tampermonkey versions;
- target URL pattern without private query data;
- installed userscript version;
- expected behavior and actual behavior;
- sanitized console errors or screenshots.

Never include cookies, API keys, account identifiers, private course links, balances, positions, or order IDs.
