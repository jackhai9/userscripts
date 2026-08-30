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
    continuous-ladder.js
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

For page-context UI operations that can be validated directly, prototype the minimal JavaScript in Chrome DevTools Console/Snippets or an equivalent live-page debugger before editing the userscript. The prototype must prove selector matches, event dispatch, state transition, and failure behavior on the live Binance page. Port the verified selector, event path, and state checks back into the userscript; do not make the userscript change first and rely on production trial-and-error.

Every Binance UI automation change must report the evidence used: live DOM or state inspected, Binance source/chunk/selector/event evidence, verified click or state transition, and any paths not manually tested. If the live source or DOM was not inspected, say that explicitly and do not present the behavior as proven.

Do not auto-confirm destructive Binance dialogs. The script may open Binance's native cancel confirmation, but final confirmation remains manual.

Ladder replacement must stay scoped and direction-aware. Automatic replacement may cancel only visible basic open-order rows for the current symbol and the same plan direction (`开多`, `开空`, `平多`, or `平空`). It must not use current-symbol cancel-all for ladder replacement, must not touch conditional/protection orders, and must retry the ladder plan only after the replacement path is validated by current DOM rows.

Continuous ladder trading is available only for close actions through `Option/Alt + click`; an ordinary click remains one round. A round is the complete existing ladder-close workflow, including any scoped same-direction replacement and cleanup. After a completed round, the runner must observe the same symbol, close mode, current precision, and native close button as ready before starting a full one-second cooldown. It must validate readiness again after the cooldown; losing readiness restarts the wait and a new full cooldown. Every new round must rebuild its plan from the latest panel profile and live trading context. A failed, stopped, or interrupted round ends the continuous session.

Continuous-session feedback stays in the shared ladder status row and uses compact Chinese counters. `2/3 轮` means two rounds completed out of three started, `本轮 1/3 笔` reports the latest partial plan, and `累计 7 笔` reports all confirmed submissions across the session. Confirmed cancellations are appended only when greater than zero. Round outcomes must expose a detached progress snapshot so a terminal continuous summary cannot be overwritten by the latest single-round message.

The active continuous-close control keeps a direction-specific stop action (`停止连续平多` / `停止连续平空`) throughout both execution and inter-round waiting. Before the native submit control is ready, the status appends `等待按钮恢复`. Only after the fixed cooldown actually begins may it append `等待 1s 后继续下一轮`; this is a static duration label, not a countdown. The button must not temporarily revert to a ladder-start action between rounds.

When selecting account-order tabs, scope to the bottom account-orders tab group. Do not globally match `当前委托` or `Open Orders`.

When a pane is found through `aria-controls`, confirm it contains current-orders controls such as `隐藏其他合约` or `全撤`. Binance may reuse pane ids in unrelated tab systems.

SVG action controls need separate treatment from normal buttons. A visible Binance SVG can have `getClientRects()` dimensions without `offsetWidth` / `offsetHeight`, and the SVG itself may not expose a native `.click()` method. If no clickable ancestor exists, dispatch a bubbling `MouseEvent("click")` and verify the live page state changes.

When orderbook depth is missing, infer missing maker prices from the current displayed orderbook step, not from exchange `tickSize`.

Orderbook precision recommendations must remain non-invasive and on demand. The script may sample latest-trade price movement once when a symbol is first seen, and once again when the user clicks refresh, but it must not keep a background sampling loop alive. Each completed sample round replaces the current symbol's stored sample snapshot; do not merge old sample rounds into a new recommendation. The sample window starts only after latest-trade rows are visible. It must not override Binance's remembered precision or change precision during ladder or single-order submission. Do not use the current visible orderbook display step as recommendation fallback: that value is already affected by the user's selected Binance precision and can turn a deliberately coarse test setting such as `1` into a false recommendation. Do not pick the smallest observed move directly; map moves to precision buckets and choose the dominant supported bucket. Applying a recommended precision requires an explicit user click.

Numeric panel profiles are scoped by current symbol, Binance orderbook precision, and trade mode (`OPEN` or `CLOSE`). Quantity multiplier, ladder percentage, level count, and row span must restore independently for each profile. Direction remains symbol-and-mode scoped, while panel expansion and precision samples keep their existing scopes. An unrecognized precision is not a default profile: disable numeric editing and reject single-order or ladder execution until the live `.orderbook-tickSize` value is available. Ladder planning, repricing, and open-order replacement must retain the captured precision and stop if it changes.

Binance's orderbook precision dropdown is not the generic `bn-sdd-option` select path. Current live source renders the orderbook header as `.orderbook-tickSize`, wraps the clickable trigger in `.tick-content`, and renders precision choices inside the same control's unique visible `.ob-ticksize-overlay` as `.ob-ticksize-item`. Precision selection must stay inside that concrete overlay; do not scan generic option, dropdown, popup, or menu selectors elsewhere on the page.

Do not validate orderbook precision selection by opening the dropdown manually first. The bug-prone path is the closed-dropdown path triggered by the script's Apply or decade-adjustment buttons. The current verified sequence is to dispatch `pointerdown`, `mousedown`, `pointerup`, `mouseup`, and `click` on `#futuresOrderbook .orderbook-tickSize` or its `.tick-content`, wait for that control's visible `.ob-ticksize-overlay`, select its exact `.ob-ticksize-item`, and then wait until `.tick-content` displays the target value. Apply, decrease, and increase share one selection task so they cannot race for the same native menu. Decrease and increase may select only an exact native divide-by-10 or multiply-by-10 option; they must not synthesize a value or treat an arbitrary sorted neighbor as a decade step.

Live Tampermonkey verification must prove the new userscript is actually active. Opening a raw GitHub URL or landing on Tampermonkey's `script_installation.php` intermediate page is not enough. Confirm through the extension update UI, the userscript panel behavior, or live DOM/status evidence.

After a Binance userscript release, continue through the full local validation loop without waiting for a separate user reminder: patch the existing Tampermonkey script through MCP, read it back, hard-reload the signed-in Chrome trading tab, use raw CDP to confirm the loaded userscript source and version, and exercise the live path directly affected by the change. Stop only for a concrete access, connection, page-state, unresolved-risk, or current financial-confirmation boundary.

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
- verify precision decrease/increase selects the exact native divide-by-10/multiply-by-10 option, restores the corresponding symbol-mode-precision panel profile, and stops at a missing native decade option
- start ladder order, confirm start buttons are disabled while running
- Option/Alt-click a close ladder button, confirm the next round starts only after the prior round is complete, the native close action is ready, and one full second has elapsed; change ratio, levels, row span, and precision during the wait and confirm the next plan uses the updated profile
- during a continuous close cooldown, make the native close action temporarily unavailable and confirm the cooldown restarts only after readiness returns; confirm Stop also aborts the cooldown immediately
- complete multiple continuous close rounds, then stop both during a round and during cooldown; confirm the Chinese status shows completed/started rounds, latest-round order ratio, cumulative confirmed submissions, and no zero-cancellation segment
- confirm continuous close keeps the direction-specific stop button between rounds, distinguishes `等待按钮恢复` from `等待 1s 后继续下一轮`, and never exposes a start button during the cooldown
- cancel current-symbol orders, verify only Binance native confirmation opens
- keep the native cancel-all dialog open for longer than the former decision deadline, verify the script remains in the dialog-tracking state, then cancel and confirm the original order count and temporary page state are restored
- cancel the native cancel-all dialog through its secondary button, Escape, and backdrop; verify chart and account-order UI state restores immediately without waiting for order clearing
- reload while the native cancel-all dialog is open; verify the next page load restores the original chart OpenOrders setting from the same-tab recovery journal
- replace close ladder orders when existing reduce-only close orders occupy the closeable quantity
- replace open ladder orders only by current-symbol same-direction basic open-order rows; verify no cancel-all path or conditional/protection orders are used
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
