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

## Target and Staged Gate

The final repository target is **90% branch coverage across the complete scope**.
The rollout also uses an explicit **66.5% aggregate floor** and requires each
migrated critical module to reach 90%. The floor rounds the initial 66.58%
measurement down to one decimal place. The checked-in threshold policy names
those files; it does not exclude other production sources from the aggregate.

The staged gate and final target are separate facts. A run may pass the staged
gate while still reporting `meetsBranchTarget: false`. It must not be described as
reaching the repository target. Threshold decisions use exact covered/total
counts, not rounded display percentages. New failures, recovery paths, and
boundary conditions should close the remaining gap; do not shrink the source
scope, remove a guard, or invent invalid business states to improve the metric.

`npm run test:coverage -- --require-target` also requires the final aggregate 90%
target. `npm run test:coverage -- --report-only` collects diagnostic evidence
without applying thresholds; CI uses the default gated command. The aggregate
floor and exact critical-source list are stored in
[`branch-policy.json`](../scripts/test-coverage/branch-policy.json).

The policy applies to merged Node and browser results. The complete pipeline runs
weekly and through manual workflow dispatch in `.github/workflows/userscript-tests.yml`.
PRs and main pushes run test lint, generated-artifact checks, and the
[affected test selection](test-selection.md). The existing script-specific
workflows retain their independent checks.

## Reports and Interpretation

The complete baseline on 2026-09-16 used Node 24.16.0, 97 Node test files
(1,326 passing tests), and 92 passing Chromium scenarios. The browser total
contains 87 production scenarios and five collector proofs. All required
captures completed. The merged denominator contains 82 distinct production
source files and **6,765 / 10,160 covered branches (66.58%)**.
The six unmapped VM entries are executions of the three historical installers in
`test/fixtures/strategy29-migration/`, each loaded twice by the settings migration
tests. They remain visible in the report and receive no current-source credit.

| Migrated critical source | Covered / total branches | Coverage |
| --- | ---: | ---: |
| `core/cancel-orders.js` | 74 / 74 | 100% |
| `core/close-action.js` | 39 / 42 | 92.86% |
| `core/close-ladder-recovery.js` | 39 / 39 | 100% |
| `core/continuous-ladder.js` | 108 / 119 | 90.76% |
| `core/order-feedback.js` | 194 / 204 | 95.10% |
| `core/quantity.js` | 26 / 27 | 96.30% |
| `core/chart-save-coalescer.js` | 247 / 273 | 90.48% |

These paths are under `src/binance-orderbook-trade/`. The baseline passes the
staged policy and fails the final aggregate 90% target. This is a dated
measurement, not a promise about later revisions; current reports record source
hashes so their scope can be verified.

Each collection creates `test-results/coverage/run-*/` with the raw captures,
Node test output, and a `report/` directory. `test-results/coverage/latest.json`
points to the last completed report; check its run path and source identity rather
than assuming an older report covers current edits.

The HTML entry is `report/index.html`. `report/coverage-summary.json` records:

- Node version, executed layers, source list, and original source identities;
- exact branch, statement, function, line, and byte metrics;
- the final target and whether it was met;
- capture completeness counts and any executed entries that could not be mapped.

An unmapped historical installer or extracted snippet is visible as unmapped
evidence and is not substituted for current-source execution. Tests passing,
capture completion, meeting a staged threshold, and meeting the final 90% target
are distinct outcomes. Browser fixture coverage is L2 evidence; Tampermonkey
installation and current Binance behavior still require their own authorized
L3/L4 checks.
