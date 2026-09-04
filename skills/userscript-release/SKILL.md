---
name: userscript-release
description: Prepare and validate userscript releases across migrated and hand-maintained scripts.
---

# userscript-release

Use this skill when the user asks to release, publish, ship, commit, push, or merge a
userscript change. It is a release workflow, not standing permission to mutate a
remote repository, Tampermonkey, a browser page, or a trading account.

## Workflow

1. Read the repository `AGENTS.md`, inspect `git status --short --branch`, and identify
   the changed source files and generated artifacts. Do not include unrelated user
   changes.
2. Read the detailed manual for the affected workflow:
   - orderbook source, architecture, or build: `docs/binance-orderbook-trade-development.md`;
   - orderbook browser, Tampermonkey, CDP, or live validation: `docs/binance-orderbook-trade-ui-automation.md`;
   - Strategy 27 annotations: `docs/binance-strategy27-events-development.md`;
   - Brooks or m3u8 export behavior: `docs/brooks-media-sync-workflow.md`;
   - trading-data, CoinMarketCap-data, auto-refresh, or cross-script lifecycle:
     `docs/userscript-validation.md`.
3. Apply the source/build/version mapping below. Behavior changes bump the source
   metadata before the build; documentation-only changes do not require a bump.

| Changed path | Version source | Required build |
| --- | --- | --- |
| `src/binance-orderbook-trade/**` | `src/binance-orderbook-trade/index.user.js` | `npm run build:binance-orderbook-trade` |
| `src/binance-trading-data/**`, `src/binance-coinmarketcap-data/**`, or `src/shared/**` | the metadata header of every affected generated artifact | `npm run build:binance-userscripts` (or the affected single-script build) |
| `src/binance-strategy27-events/**` | `src/binance-strategy27-events/index.user.js` | `npm run build:binance-strategy27-events` |
| `src/m3u8-downloader/**` | `src/m3u8-downloader/index.user.js` | `npm run build:m3u8-downloader` |
| An unmigrated `scripts/*.user.js` | that userscript file | no build; bump its header directly |

Never hand-edit a generated artifact for feature work. Keep generated output
readable, non-compressed, non-obfuscated, and preserve its `@updateURL` and
`@downloadURL`.

4. Run the relevant checks:
   - orderbook: `npm test`, `npm run check:binance-orderbook-trade`;
   - migrated Binance userscripts: `npm test`, `npm run check:binance-userscripts`;
   - Strategy 27: `npm run test:binance-strategy27-events`;
   - m3u8: `node --test test/unit/m3u8-downloader-course-export.test.js`,
     `npm run check:m3u8-downloader`;
   - unmigrated scripts: `node --check <file>`.
   Always run `git diff --check`. Before publishing, run the full `npm test` suite
   and every affected build/check command.
5. Inspect the generated metadata and confirm that the generated `@version` matches
   the source. Verify that `README.md` still points to the generated install entry.
6. Only when the current user request explicitly asks for a remote release, use the
   GitHub PR workflow:
   - push the feature branch;
   - create a PR with `gh pr create`;
   - wait for required checks or report which checks are unavailable;
   - merge with `gh pr merge`;
   - never locally merge into `main` and direct-push `main`.
7. If browser validation is requested after the release, follow the L3/L4 procedure
   in `docs/binance-orderbook-trade-ui-automation.md`. Synchronize only the existing
   Tampermonkey script, read it back, verify exact source identity, hard-reload the
   applicable page, and record paths that were not exercised. Do not infer permission
   for order placement, cancellation, transfer, or other financial actions from this
   skill.
8. Report changed files, commands and results, generated/live versions, untested
   paths, and residual risks. A failed or flaky check remains a release finding;
   retries do not turn it green.

## Release Checklist

- [ ] Source-of-truth files are the only feature-edit targets.
- [ ] Behavior-changing metadata versions are bumped before generation.
- [ ] All affected generated artifacts were rebuilt and remain readable.
- [ ] Raw install URLs are unchanged.
- [ ] Relevant tests, builds, syntax checks, and `git diff --check` passed.
- [ ] A remote release, if requested, has PR review/merge history rather than a
      direct `main` push.
- [ ] Tampermonkey/live validation, if requested and authorized, verified exact
      installed source and the affected page path.
- [ ] The final report distinguishes verified, untested, and blocked paths.

## Notes

- `binance-orderbook-trade` has source and DOM tests; `node --check` alone is not
  sufficient.
- A matching version alone does not prove that the installed Tampermonkey source is
  the generated artifact; use the read-back contract in the UI automation manual.
- Do not create a duplicate Tampermonkey script when an existing script can be
  updated.
