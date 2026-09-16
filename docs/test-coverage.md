# Production Source Coverage

Coverage measures all JavaScript under `src/` and the two hand-maintained install
scripts, `scripts/auto_refresh.user.js` and
`scripts/coinmarketcap-valuation-helper.user.js`. Generated install artifacts are
mapped back to their original sources, so they do not create another denominator.
Unexecuted source files remain in the report with zero execution credit. Test
files, fixtures, build tooling, and historical installer snapshots are not
production source. The executable scope lives in
[`scripts/test-coverage/config.mjs`](../scripts/test-coverage/config.mjs).

Use `.nvmrc` and install Chromium before collecting the browser layer:

```sh
nvm use
npm ci
npx playwright install chromium
npm run test:coverage
```

`npm run test:coverage:node` collects only Node unit and JSDOM execution, while
retaining the same complete-source denominator. Its result is labeled Node-only;
it cannot satisfy the merged-coverage gate. Neither command starts a development
server or operates a logged-in browser.

## Accurate Mapping and Completion

The coverage compiler reads complete source entries, including userscript
metadata, to preserve original line positions. It requires generated executable
bytes to match the public install artifacts and checks every embedded original
against the current source file. A stale artifact fails collection instead of
producing a report for different code.

The selected Node files are passed to `node:test` through `run({ files })`, not
the CLI's glob expansion. Coverage imports are installed in those actual test
processes. Selected filenames remain literal, including glob metacharacters,
spaces, and newlines.

Node's inspector records the actual executed script source as well as precise
V8 ranges. Complete anonymous VM sources can be identified by exact content.
Partial functions extracted from a source file and quoted copies of installer
text receive no credit for executing that source file. Browser collection also
recognizes complete original modules loaded through Blob URLs.

Browser coverage uses one public CDP session per page and caches script bytes when
Chromium parses them. A real reload must go through `reloadPageWithCoverage` in
`e2e/binance-orderbook/test.js`: it takes a precise checkpoint before discarding
the outgoing document. Raw checkpoints remain in the capture. Only snapshots
with the same session, script ID, URL, and exact source bytes are merged; a new
document keeps its own identity even when it loads the same URL.

Chromium can return positive function-call counts without block ranges after
document teardown. Those calls cannot establish which branches ran. The report
preserves them in `blockEvidenceUnavailable` with raw-capture provenance and
gives them no additional branch credit. Each such function must already have a
captured detailed or zero record with the same function bounds; otherwise the
collector fails, because dropping it could make the reporter infer execution
from the enclosing script. No zero record or execution count is invented.

When coarse calls exist, `metricInterpretation` is
`retained-evidence-lower-bound`: the displayed metrics describe retained evidence,
not all actual calls. Capture completeness and block-evidence completeness are
separate. A lower bound at or above 90% proves the repository target was reached;
a lower bound below 90% does not establish the exact actual coverage. Isolated
Chromium proofs verify ordinary checkpoint counts and a real reload through the
collector, splitter, source map, and final coverage report.

One browser script can contain several installers. The collector validates exact
installer segments against JavaScript statement boundaries and keeps their V8
execution ranges associated with the original bytes. Shared originals appear
once in the final report. An isolated Node-and-Chromium proof checks known branch
counts so repeated bundled copies cannot hide a branch executed by another copy.

Every selected Node test process must finish its capture. Every production
browser scenario must pass and finish its capture, with IDs matched against the
current Playwright run. Missing, stale, skipped, or retried browser evidence
invalidates completeness. The one explicit collector self-test file uses virtual
code; it must pass but does not contribute production coverage. Source-map and
capture tests validate these boundaries independently.

## Repository Gate

The default command requires **90% branch coverage across the complete scope**
and **90% in each of seven critical orderbook modules**. The temporary 66.5%
migration floor has been replaced. The critical-source list adds checks; it does
not exclude other production sources from the aggregate.

Threshold decisions use exact covered/total counts, not rounded display
percentages. New failures, recovery paths, and boundary conditions should close
coverage gaps; do not shrink the source scope, remove a guard, or invent invalid
business states to improve the metric.

`npm run test:coverage -- --report-only` collects diagnostic evidence without
applying thresholds; CI uses the default gated command. The aggregate threshold
and exact critical-source list are stored in
[`branch-policy.json`](../scripts/test-coverage/branch-policy.json).

The policy applies to merged Node and browser results. The complete pipeline runs
weekly and through manual workflow dispatch in `.github/workflows/userscript-tests.yml`.
PRs and main pushes run test lint, generated-artifact checks, and the
[affected test selection](test-selection.md). The existing script-specific
workflows retain their independent checks.

## Reports and Interpretation

The completed migration run on 2026-09-16 used Node 24.16.0, 126 Node test files
(**2,078 passing tests**), and **364 passing Chromium scenarios**. The browser
total contains 357 production scenarios and seven collector proofs. All required
captures completed, without skipped or retried scenarios. The merged denominator
contains 82 distinct production source files and **9,179 / 10,184 covered
branches (90.13%)**. The aggregate gate and all seven critical-module gates pass.

The retained local evidence is
[`run-5M5oY5/report/index.html`](../test-results/coverage/run-5M5oY5/report/index.html),
with exact counts, capture completion, and source hashes in
[`coverage-summary.json`](../test-results/coverage/run-5M5oY5/report/coverage-summary.json).
All 82 recorded source hashes matched the workspace after collection. These
generated reports are local test artifacts and are not committed.

This run records `metricInterpretation: retained-evidence-lower-bound` and 49
function-call records without block evidence. Those records remain auditable
but add no branch credit. The retained lower bound itself exceeds 90%. Six
unmapped Node VM entries also remain visible and receive no current-source
credit.

| Migrated critical source | Covered / total branches | Coverage |
| --- | ---: | ---: |
| `core/cancel-orders.js` | 74 / 74 | 100% |
| `core/close-action.js` | 42 / 42 | 100% |
| `core/close-ladder-recovery.js` | 39 / 39 | 100% |
| `core/continuous-ladder.js` | 110 / 119 | 92.44% |
| `core/order-feedback.js` | 194 / 200 | 97.00% |
| `core/quantity.js` | 26 / 27 | 96.30% |
| `core/chart-save-coalescer.js` | 253 / 273 | 92.67% |

These paths are under `src/binance-orderbook-trade/`. This is a dated measurement,
not a promise about later revisions; subsequent reports must verify their own
source hashes, complete captures, and exact thresholds.

For historical comparison, the first-stage baseline earlier on 2026-09-16 used
97 Node test files (1,326 tests) and 92 Chromium scenarios, with **6,765 / 10,160
covered branches (66.58%)** across the same 82-file source scope. It passed only
the former 66.5% migration floor. That baseline and its smaller branch count do
not describe the completed migration or the currently enforced 90% gate.

Each collection creates `test-results/coverage/run-*/` with the raw captures,
Node test output, and a `report/` directory. `test-results/coverage/latest.json`
points to the last completed report; check its run path and source identity rather
than assuming an older report covers current edits.

The HTML entry is `report/index.html`. `report/coverage-summary.json` records:

- Node version, executed layers, source list, and original source identities;
- branch, statement, function, line, and byte metrics for retained evidence,
  together with their interpretation and any unavailable block evidence;
- the final target and whether it was met;
- capture completeness counts and any executed entries that could not be mapped.

An unmapped historical installer or extracted snippet is visible as unmapped
evidence and is not substituted for current-source execution. Tests passing,
capture completion, detailed block evidence, and meeting the 90% repository target
are distinct outcomes. Browser fixture coverage is L2 evidence; Tampermonkey
installation and current Binance behavior still require their own authorized
L3/L4 checks.
