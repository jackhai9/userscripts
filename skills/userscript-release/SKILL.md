---
name: userscript-release
version: 1.0.0
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

## Release Checklist

- `@version` updated for every behavior-changing userscript
- generated userscript artifacts refreshed from their source
- tests, build, syntax check, and whitespace check passed where applicable
- release to `main` goes through PR review/merge history, not direct `main` push
- no accidental source-of-truth drift in `README.md`
- final summary includes residual risks when browser hand-testing was skipped

## Notes

- `binance-orderbook-trade` has an automated source test suite; do not pretend `node --check` alone is enough.
- If a change only touches docs or non-script files, version bump is not required.
- Treat "publish", "release", "ship", and "merge to main" as PR-based operations unless the user explicitly authorizes an emergency direct push to `main`.
