---
name: userscript-release
version: 1.0.1
description: Bump versions, run checks, prepare release commit.
---

# userscript-release

Use this skill when shipping changes in this repository.

## Workflow

1. Read `AGENTS.md` first.
2. If `src/binance-orderbook-trade/**` changed, bump `src/binance-orderbook-trade/index.user.js` `@version` when behavior changed, then run `npm run build:binance-orderbook-trade` to refresh `scripts/binance-orderbook-trade.user.js`.
3. For changed userscripts that are still hand-maintained under `scripts/`, bump their `@version`.
4. Verify `@updateURL` and `@downloadURL` still point to this repo's raw GitHub URL.
5. Run the required checks:
   - `npm run build:binance-orderbook-trade`
   - `npm test`
   - `npm run check:binance-orderbook-trade`
   - `git diff --check`
   - `node --check <file>` for changed hand-maintained userscripts outside `binance-orderbook-trade`
6. Summarize what changed, what was verified, and what was not tested.
7. If asked to commit or push, use a concise message that reflects user-facing impact.
8. If asked to publish, ship through GitHub PR workflow:
   - push the feature branch
   - create a PR with `gh pr create`
   - wait for required checks to pass, or explicitly report missing checks
   - merge with `gh pr merge`
   - do not locally merge into `main` and direct-push `main`
9. After the PR is merged, verify the raw GitHub userscript exposes the released `@version`. When the next step is local Tampermonkey validation, use the configured Tampermonkey MCP instead of the extension's manual update checker:
   - identify the existing script by namespace/name and use its returned source path
   - read the installed source immediately before updating it and record its `Last modified` value
   - patch that existing source with the generated `scripts/*.user.js` artifact; do not create a duplicate script
   - do not pass the retrieved `lastModified` back to `tampermonkey_patch`: the current Tampermonkey Editors bridge preserves that old value as the dashboard timestamp instead of advancing it
   - read the installed source back and verify its `@version` and content exactly match the generated artifact
   - verify the returned `Last modified` advanced from the pre-patch value into the current synchronization window; a matching source with a stale timestamp is not a complete MCP sync
   - if the source or timestamp changes unexpectedly between the immediate pre-read and post-read, stop and report the concurrent edit instead of applying another patch
   - hard-reload the applicable target page so the updated userscript actually runs
   - verify the target page loaded normally and record any browser path that was not exercised
   - if Tampermonkey Editors is disconnected, call `tampermonkey_get_connection_code` and ask the user only for the required one-time bridge pairing; do not silently fall back to clicking `Check for updates`

## Release Checklist

- `@version` updated for every behavior-changing userscript
- generated userscript artifacts refreshed from their source
- tests, build, syntax check, and whitespace check passed where applicable
- release to `main` goes through PR review/merge history, not direct `main` push
- released userscript synchronized to the existing local Tampermonkey script through MCP when browser validation follows
- installed `@version` and generated artifact content verified before the target page is hard-reloaded
- installed `Last modified` advanced during the MCP sync and is not the pre-patch timestamp
- no accidental source-of-truth drift in `README.md`
- final summary includes residual risks when browser hand-testing was skipped

## Notes

- `binance-orderbook-trade` has an automated source test suite; do not pretend `node --check` alone is enough.
- If a change only touches docs or non-script files, version bump is not required.
- Treat "publish", "release", "ship", and "merge to main" as PR-based operations unless the user explicitly authorizes an emergency direct push to `main`.
