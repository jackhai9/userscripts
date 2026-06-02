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
  build-userscript.mjs
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

Before changing Binance UI automation behavior, collect current live evidence. This applies to DOM selectors, click targets, dropdown open/close behavior, tab selection, dialogs, button disabled state, input state, visibility checks, and event dispatch. Inspect the live DOM, accessibility tree or screenshot, and Binance's current frontend bundle/source for the relevant component structure and event path. Treat page labels, old notes, historical selectors, and prior memory as hypotheses until the current page/source confirms them.

Every Binance UI automation change must report the evidence used: live DOM or state inspected, Binance source/chunk/selector/event evidence, verified click or state transition, and any paths not manually tested. If the live source or DOM was not inspected, say that explicitly and do not present the behavior as proven.

Do not auto-confirm destructive Binance dialogs. The script may open Binance's native cancel confirmation, but final confirmation remains manual.

When selecting account-order tabs, scope to the bottom account-orders tab group. Do not globally match `当前委托` or `Open Orders`.

When a pane is found through `aria-controls`, confirm it contains current-orders controls such as `隐藏其他合约` or `全撤`. Binance may reuse pane ids in unrelated tab systems.

SVG action controls need separate treatment from normal buttons. A visible Binance SVG can have `getClientRects()` dimensions without `offsetWidth` / `offsetHeight`, and the SVG itself may not expose a native `.click()` method. If no clickable ancestor exists, dispatch a bubbling `MouseEvent("click")` and verify the live page state changes.

When orderbook depth is missing, infer missing maker prices from the current displayed orderbook step, not from exchange `tickSize`.

Orderbook precision recommendations must remain non-invasive and on demand. The script may sample latest-trade price movement once when a symbol is first seen, and once again when the user clicks refresh, but it must not keep a background sampling loop alive. Each completed sample round replaces the current symbol's stored sample snapshot; do not merge old sample rounds into a new recommendation. The sample window starts only after latest-trade rows are visible. It must not override Binance's remembered precision or change precision during ladder or single-order submission. Do not use the current visible orderbook display step as recommendation fallback: that value is already affected by the user's selected Binance precision and can turn a deliberately coarse test setting such as `1` into a false recommendation. Do not pick the smallest observed move directly; map moves to precision buckets and choose the dominant supported bucket. Applying a recommended precision requires an explicit user click.

Binance's orderbook precision dropdown is not the generic `bn-sdd-option` select path. Current live source renders the orderbook header as `.orderbook-tickSize`, wraps the clickable trigger in `.tick-content`, and renders precision choices inside `.ob-ticksize-overlay` as `.ob-ticksize-item`. Target that concrete trigger and option path before falling back to generic option selectors.

Live Tampermonkey verification must prove the new userscript is actually active. Opening a raw GitHub URL or landing on Tampermonkey's `script_installation.php` intermediate page is not enough. Confirm through the extension update UI, the userscript panel behavior, or live DOM/status evidence.

For live Binance tests, confirm the target symbol, order mode, script quantity multiplier, orderbook display precision, and far-away test prices before clicking trade controls. When the user says the zoom/precision should be `1` or max, that refers to the Binance orderbook price-display precision dropdown, not the script quantity multiplier. Set the orderbook precision to the largest/coarsest option, such as `1`, so test orders are placed farther from the live price. Do not treat another open futures tab or another symbol's orders as evidence for the current test.

When browser clicking or navigation becomes unreliable, switch to state-based verification instead of repeatedly clicking: inspect the accessibility tree, DOM text, script status, open-order row count, and Binance toast/status changes. For replacement-order flows, useful evidence includes the old error disappearing, a cancel toast appearing, current-symbol rows changing, and the ladder task reaching a completion status.

## Manual Test Matrix

Run manual checks when behavior touches trading flow, DOM selectors, account orders, or Binance rules:

- switch symbol, then immediately click an orderbook price
- test both `LIMIT` and `MARKET`
- test open and close modes
- verify rules-not-ready refuses to order
- verify orderbook precision recommendation comes from latest-trade price movement, not from the current orderbook display precision
- verify the manual precision refresh button starts one longer sample round without auto-applying or scheduling background resampling
- verify the precision apply button changes Binance orderbook precision only after an explicit user click
- start ladder order, confirm start buttons are disabled while running
- cancel current-symbol orders, verify only Binance native confirmation opens
- replace close ladder orders when existing reduce-only close orders occupy the closeable quantity
- verify SVG cancel controls work when the visible cancel target has no native `.click()` method
- verify account-orders tab and hide-other-symbol state are restored
- verify the userscript version or live behavior after a Tampermonkey update before continuing live tests
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
