---
name: userscript-review
description: Review userscript source and generated artifacts for regressions, stale state, unsafe actions, and race conditions.
---

# userscript-review

Use this skill for a read-only review of userscript changes in this repository.
Do not edit files, regenerate artifacts, stage changes, commit, push, merge, release,
or operate a live trading account while reviewing.

## Workflow

1. Read the repository AGENTS.md and inspect git status --short --branch.
2. Identify the changed source files, generated artifacts, tests, and any user-owned
   changes. Review the source of truth first; treat generated files as build output
   to compare, not as the feature-edit target.
3. Read the detailed document for the affected area:
   - orderbook architecture: docs/binance-orderbook-trade-development.md;
   - orderbook UI/CDP/live paths: docs/binance-orderbook-trade-ui-automation.md;
   - Strategy 27: docs/binance-strategy27-events-development.md;
   - Brooks/m3u8: docs/brooks-media-sync-workflow.md;
   - trading-data, CoinMarketCap-data, auto-refresh, or cross-script lifecycle:
     docs/userscript-validation.md.
4. Run the smallest relevant syntax, unit, DOM, and read-only generated-artifact
   checks that are safe and available. Do not run a build that rewrites the
   worktree during review; report it as missing validation unless an isolated
   output path is available. A review may report missing validation; it must not
   silently treat an unrun check as passed.
5. Review functional and safety findings before style. Report findings ordered by
   severity, with file references and concrete evidence. Put Notes after Findings;
   if there are no issues, say No new functional findings.

## Review Priorities

### Shared checks

- source-of-truth and generated-artifact identity remain consistent;
- behavior-changing metadata version and raw install URLs are correct;
- stale async work cannot overwrite a newer symbol, route, epoch, or lifecycle;
- recovery/retry paths are explicit and cannot duplicate an unknown external action;
- errors preserve the observed reason and invalid state is not hidden by a default;
- tests assert concrete behavior rather than only existence or truthiness.

### binance-orderbook-trade

- current-symbol and current-mode rules are used for LIMIT and MARKET;
- LOT_SIZE, MARKET_LOT_SIZE, and MIN_NOTIONAL remain closed over the current
  symbol, and rules-not-ready refuses to submit;
- DOM automation is scoped to the correct account/orderbook region and reacquires
  nodes after host replacement;
- live UI changes have current DOM/source evidence, do not auto-confirm destructive
  dialogs, preserve the user's page state, and never cancel unrelated orders;
- ladder replacement is current-symbol, same-direction, and basic-order only;
- running controls are single-flight and hot paths avoid unbounded full-page scans.
  Read the UI automation manual for selector, CDP, and live-capture details.

### binance-trading-data

- five-minute boundaries, server-time alignment, retry semantics, hidden-tab and
  closed-panel lifecycle are correct;
- stale requests cannot publish into the active symbol;
- cached, neutral, and non-voting results are not presented as fresh or counted as
  directional votes.

### binance-coinmarketcap-data

- the current Binance symbol maps deterministically to the intended CMC asset;
- page matching and injection are scoped so another route or symbol cannot receive
  the panel;
- missing or ambiguous mappings fail visibly instead of selecting a guessed asset.

### binance-strategy27-events

- route, TradingView symbol, 1S interval, epoch, cursor, sequence, and entity
  ownership are validated before create/update/remove;
- incomplete or input-gap facts do not receive a directional conclusion;
- marker and panel state remain bounded, and the script does not open an
  unauthorized Binance data stream or expose the gateway secret.

### m3u8-downloader

- links remains the original full list; records, failures, and retry indexes retain
  original identity;
- paused partial exports continue the normal queue, while retry-only mode is
  available only for completed exports with failures;
- elapsed time measures active runtime, reset discards without auto-starting, and
  caption URLs use the detected media host while preserving required query values;
- direct Bunny and same-origin success paths share one queue-advance contract.
  Read the Brooks workflow for the complete state model and validation matrix.

### auto_refresh

- URL matching is neither broader nor narrower than the intended page set;
- target-time calculation remains correct after manual refresh, focus changes,
  visibility changes, and repeated scheduling.

### Hand-maintained scripts

- run node --check <file> and verify that the header version changes only when
  behavior changes.
