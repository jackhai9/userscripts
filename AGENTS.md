# userscripts

## Scope and precedence

- Codex global guidance applies before this file (a non-empty `AGENTS.override.md`
  in the Codex home takes precedence over `AGENTS.md` when present). This file adds only
  userscripts- and Binance-specific gates.
- Detailed procedures, selectors, scenario matrices, and historical observations
  belong in the linked manuals, skills, or knowledge runbooks. Keep one canonical
  source for each rule instead of copying long procedures here.
- Source code and executable tests define current behavior. Dated observations and
  authorization from an earlier conversation are evidence, not standing permission
  for external, financial, or destructive actions.

## Source map

| Editable source | Public install artifact |
| --- | --- |
| src/binance-orderbook-trade/ | scripts/binance-orderbook-trade.user.js |
| src/binance-trading-data/ | scripts/binance-trading-data.user.js |
| src/binance-coinmarketcap-data/ | scripts/binance-coinmarketcap-data.user.js |
| src/binance-strategy27-events/ | scripts/binance-strategy27-events.user.js |
| src/binance-strategy29-bollinger/ | scripts/binance-strategy29-bollinger.user.js |
| src/m3u8-downloader/ | scripts/m3u8-downloader.user.js |

- Other scripts remain hand-maintained under scripts/*.user.js until migrated.
- Generated artifacts are readable, non-compressed, non-obfuscated install/update
  entries; do not hand-edit them for feature work.
- README.md and README.zh-CN.md cover installation and source/release navigation,
  not development procedures. Do not copy source into secondary repositories.

## Read-before-work routing

| Work | Read first |
| --- | --- |
| Orderbook source, business contracts, or semantic DOM | docs/binance-orderbook-trade-development.md |
| Orderbook browser, Tampermonkey, CDP, performance, or live evidence | docs/binance-orderbook-trade-ui-automation.md |
| Strategy 27 gateway, chart, or entity contract | docs/binance-strategy27-events-development.md |
| Strategy 29 observer or cross-script chart coordination | docs/binance-strategy29-bollinger-development.md |
| Brooks/m3u8 indexing, export state, timing, or captions | docs/brooks-media-sync-workflow.md |
| Trading-data, CoinMarketCap-data, auto-refresh, or cross-script validation | docs/userscript-validation.md |
| Read-only review | skills/userscript-review/SKILL.md |
| Release or publish | skills/userscript-release/SKILL.md |
| Codex/browser/proxy/helper/connection timeout | global timeout rule; if available, ~/.dotfiles/knowledge/shared/CODEX_TOOL_TIMEOUT_TRIAGE.md |

## Project gates

- For migrated-source behavior changes, bump every affected source userscript
  metadata header before generation; preserve @updateURL and @downloadURL and
  verify each generated version matches its source. The release skill owns the
  exact shared-source mapping.
- Use the build for the changed source area:

  | Changed source | Required build |
  | --- | --- |
  | src/binance-orderbook-trade/** | npm run build:binance-orderbook-trade |
  | src/binance-trading-data/**, src/binance-coinmarketcap-data/**, or src/shared/** | npm run build:binance-userscripts or the affected single-script build |
  | src/binance-strategy27-events/** | npm run build:binance-strategy27-events |
  | src/binance-strategy29-bollinger/** | npm run build:binance-strategy29-bollinger |
  | src/m3u8-downloader/** | npm run build:m3u8-downloader |

- Publish, ship, or merge to main only through a GitHub PR when the current
  request explicitly asks for that action; never direct-push main. This file does
  not authorize commits, pushes, Tampermonkey synchronization, browser mutation,
  or financial actions.
- Binance quantity and trading rules use the current symbol and mode. Before
  changing page automation, collect current DOM/accessibility/source evidence and
  prove the smallest page-context interaction when it is directly testable.
- Destructive Binance actions may open the native confirmation but never
  auto-confirm it. Cancellation/replacement remains current-symbol,
  intended-direction, and basic-order scoped; restore temporary page state and
  distinguish test-owned from concurrent user orders.
- Brooks/m3u8 state keeps the original link/index identity, uses retry-only mode
  only for completed exports with failures, measures active runtime, makes reset
  discard without auto-start, and derives captions from the detected media host
  while preserving required non-title query parameters.

## Validation

- Run the relevant tests, build, syntax/check commands, and git diff --check for
  every behavior change. The release skill contains the complete script matrix.
- Unmigrated userscript changes require node --check on each changed file.
- Changes touching Binance trading, DOM automation, page/data scheduling, or exchange
  rules require the affected manual path and an explicit tested/untested report.
- Documentation-only changes do not require a version bump or generated build.

## High-risk change gate

Before editing timers, retries, caches, epochs, server-time alignment, visibility,
symbol switching, quantity rules, Binance API parameters, or aggregation semantics,
state a short plan with goal, files, risks, validation, and out-of-scope items.
Use the global plan rules and the routed project manual for domain details.
