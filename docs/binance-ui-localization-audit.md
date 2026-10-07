# Binance UI Localization Audit

Audited on 2026-10-08. Source and isolated runtime evidence cover the six Binance
userscripts. This is not a live-page or whole-program proof that every possible
provider error is translated.

| Script | Finding and current scope |
| --- | --- |
| Orderbook | Automatic rebalance status bypassed paired copy. Waiting, progress, completion, refusal, and tooltips now retain both languages; account-operation lock refusal is translated too. Existing single-order status literals now explicitly carry both languages. |
| Strategy 27 | Existing paired panel/menu/status text and SPA refresh inspected; targeted tests passed. Diagnostic identifiers and provider errors intentionally remain unchanged. |
| Strategy 29 | Existing paired summary/status/signal labels and SPA refresh inspected; targeted tests passed. Provider diagnostics intentionally remain unchanged. |
| Strategy 31 | Previously all status messages were English. Status copy now supports Chinese/English, including route-only redraw while a request is pending or the observer has stopped. Redraw does not start requests or replace chart annotations. |
| Trading data | Historical Chinese-only UI. Buttons, indicators, direction labels, and timestamps do not follow English routes. Full bilingual support remains unimplemented. Preserve indicator identities when adding localized labels: display names currently also participate in change highlighting. |
| CoinMarketCap data | Historical Chinese UI with mixed English metric names: Unlocked Mkt Cap, Vol/Mkt Cap(24h), Liq/Mkt Cap, and Profile score. Full bilingual support remains unimplemented. UI localization must not change the explicitly Chinese upstream resource/API language contract. |

## Why the omission escaped

The paired-copy test only walks entries that already exist in `PANEL_COPY`.
`formatLocalizedText` also intentionally accepts raw diagnostic strings. New
automatic status strings therefore bypassed the dictionary without failing its
completeness test. Some browser tests even asserted English output on the default
Chinese fixture route.

## Prevention and limits

- Author script-owned UI as `localizedText(zhCN, en)` or a paired copy entry.
  Keep the object until rendering; do not save a language-specific rendered
  string as the persistent status.
- CI runs `lint:ui-copy`. The rule checks text and title at the two orderbook
  status setters, including direct templates, concatenations, conditional
  branches, and raw words inside `combineLocalizedText`. It permits numeric
  counters, punctuation, paired formatter results, and diagnostic variables.
- The rule does not follow aliases, variables, or arbitrary function returns,
  and does not cover other scripts' DOM, ARIA, or prompt sinks. Review remains
  necessary; do not describe this gate as a repository-wide no-untranslated-text
  guarantee.
- New UI scenarios must assert actual Chinese and English output, not just a
  nonempty value. Stateful messages also need a SPA language-switch scenario
  that proves counts, pending operations, retained diagnostics, and completed
  results survive without repeating an action.
- Keep external provider messages, native exceptions, error codes, and protocol
  identifiers copyable. Translate script-owned explanatory text around them;
  do not rewrite arbitrary diagnostics or change financial error handling.

Regression evidence lives in `automatic-account-rebalance.pw.js`,
`binance-strategy31-volume-reversal-locale.test.js`, and
`ui-localization-policy.test.js`. Remaining historical gaps above are explicit
follow-up scope, not covered by passing tests for the bilingual scripts.
