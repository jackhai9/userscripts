# Binance Orderbook Trade Development Manual

## Source Of Truth

`src/binance-orderbook-trade/` is the development source for the Binance orderbook userscript.

`scripts/binance-orderbook-trade.user.js` is the generated install/update artifact. Keep it as a single readable userscript file. Do not hand-edit it for feature work.

Users install only:

```text
scripts/binance-orderbook-trade.user.js
```

## Runtime

Use the repository Node version:

```bash
nvm use
npm install
```

The expected version is recorded in `.nvmrc`.

If `npm install` appears silent, check whether npm is still downloading tarballs before interrupting it:

```bash
ps -axo pid,ppid,stat,etime,command | rg 'npm install|node .*npm'
ls -lt ~/.npm/_logs | sed -n '1,5p'
```

This repo has worked without a local `127.0.0.1:7890` listener as long as npm can reach `https://registry.npmjs.org/`.

## Commands

Run the full validation set after any `binance-orderbook-trade` source change:

```bash
npm test
npm run build:binance-orderbook-trade
npm run check:binance-orderbook-trade
git diff --check
```

The build command rewrites `scripts/binance-orderbook-trade.user.js` from `src/binance-orderbook-trade/index.user.js`.

## Layout

```text
src/binance-orderbook-trade/
  index.user.js
  core/
    cancel-orders.js
    decimal.js
    ladder-plan.js
    orderbook.js
    quantity.js
  dom/
    account-orders.js
    trade-form.js
test/
  unit/
    binance-orderbook-trade/
  dom/
    binance-orderbook-trade/
  fixtures/binance-orderbook-trade/
  helpers/
scripts/
  binance-orderbook-trade-build.mjs
  binance-orderbook-trade.user.js
```

## Module Boundaries

`core/` must stay browser-DOM-free. Put deterministic logic here:

- decimal normalization and exact arithmetic
- quantity allocation and step-size rounding
- cancel-order text evidence
- orderbook display-step inference
- ladder action specs

`dom/` contains DOM traversal and selector logic that can run under jsdom fixtures:

- bottom account-orders tab detection
- active current-orders pane detection
- trade form tab and action button filtering

`index.user.js` owns side effects:

- Binance page reads and writes
- event listeners
- real clicks
- fetch interception
- storage
- panel rendering
- async execution flow

## Testing Strategy

Prefer unit tests for pure business logic. Add or update tests before moving logic into `core/`.

Use DOM tests when behavior depends on Binance-like markup. Fixtures should be minimal and targeted; avoid copying full production HTML.

Current important test coverage:

- decimal and quantity exactness
- ladder quantity allocation
- current-symbol cancel evidence
- orderbook display-step inference
- ladder action direction mapping
- account order tab scoping
- `aria-controls` pane-id collision protection
- trade action button scoping and own-panel filtering

## Generated Artifact Rules

After build, inspect the generated userscript when changing build behavior:

```bash
sed -n '1,40p' scripts/binance-orderbook-trade.user.js
```

Required properties:

- metadata block at the top
- one `==UserScript==` block
- preserved `@updateURL` and `@downloadURL`
- readable, non-minified output
- generated `@version` matches `src/binance-orderbook-trade/index.user.js`

## Versioning

Bump `@version` in `src/binance-orderbook-trade/index.user.js` when behavior changes, then run:

```bash
npm run build:binance-orderbook-trade
```

Do not bump for docs-only changes.

## Binance Safety Rules

Do not infer trading semantics from stale DOM or old symbol state. Anything involving quantity rules must be derived from the current symbol.

Do not auto-confirm destructive Binance dialogs. The script may open Binance's native cancel confirmation, but final confirmation remains manual.

When selecting account-order tabs, scope to the bottom account-orders tab group. Do not globally match `当前委托` or `Open Orders`.

When a pane is found through `aria-controls`, confirm it contains current-orders controls such as `隐藏其他合约` or `全撤`. Binance may reuse pane ids in unrelated tab systems.

When orderbook depth is missing, infer missing maker prices from the current displayed orderbook step, not from exchange `tickSize`.

## Manual Test Matrix

Run manual checks when behavior touches trading flow, DOM selectors, account orders, or Binance rules:

- switch symbol, then immediately click an orderbook price
- test both `LIMIT` and `MARKET`
- test open and close modes
- verify rules-not-ready refuses to order
- start ladder order, confirm start buttons are disabled while running
- cancel current-symbol orders, verify only Binance native confirmation opens
- verify account-orders tab and hide-other-symbol state are restored
- hide the tab and return, then verify the panel recovers

If a path was not manually tested, state that in the final summary.

## Release Checklist

Before release:

```bash
npm run build:binance-orderbook-trade
npm test
npm run check:binance-orderbook-trade
git diff --check
```

Then verify:

- generated artifact is committed with matching source
- `@version` was bumped for behavior changes
- install URL remains unchanged
- README still points users to the generated single-file userscript
- release reaches `main` through a GitHub PR merged with `gh pr merge`
- do not publish by locally merging into `main` and direct-pushing `main`
